#!/usr/bin/env python
"""Run one cited P1 query, with bounded retries for confirmed citation loss."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

from notebooklm_tools.cli.utils import get_client
from notebooklm_tools.core.conversation import ConversationMixin

from notebook_lock import notebook_lock
from task_scratch import load_p1_task


QUERY_TIMEOUT_SECONDS = 180
SERVER_RECOVERY_SECONDS = 60
MAX_CONFIRMED_EVIDENCE_ATTEMPTS = 3


class QueryProcessTimedOut(RuntimeError):
    """The local CLI stopped waiting before the server result was collected."""


class QueryEvidenceMissing(ValueError):
    """The server completed the query but returned no usable cited text."""


class QueryEvidenceAttemptsExhausted(RuntimeError):
    """Every allowed submission completed without usable cited text."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run the main cited NotebookLM query after clearing chat, or run the "
            "single allowed same-conversation supplement prompt for explicit fact gaps. "
            "A confirmed answer without usable citations is resubmitted unchanged up to "
            f"{MAX_CONFIRMED_EVIDENCE_ATTEMPTS} total attempts."
        )
    )
    parser.add_argument("work_order", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--confirm-clear-chat",
        action="store_true",
        help="Required acknowledgement that this deletes the target notebook's chat history.",
    )
    mode.add_argument(
        "--supplement",
        action="store_true",
        help="Run the one allowed focused follow-up in the main query conversation.",
    )
    return parser.parse_args()


def read_prompt(path: Path) -> str:
    try:
        prompt = path.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise RuntimeError(f"cannot read prompt file: {error}") from error
    if not prompt:
        raise ValueError("prompt file is empty")
    if len(prompt) > 10_000:
        raise ValueError("prompt exceeds NotebookLM's 10000-character limit")
    return prompt


def reserve_output(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.touch(mode=0o600, exist_ok=False)
    except FileExistsError as error:
        raise ValueError(
            f"output already exists: {path}; never reuse an attempted query path"
        ) from error
    except OSError as error:
        raise RuntimeError(f"cannot reserve output path: {error}") from error


def parse_conversation_id(payload: Any) -> str | None:
    if payload is None or payload == []:
        return None
    if not isinstance(payload, list):
        raise ValueError("chat-history RPC returned an unexpected response")
    first = payload[0]
    if first is None or first == []:
        return None
    if not isinstance(first, list):
        raise ValueError("chat-history RPC returned an unexpected response")
    candidate = first[0]
    if isinstance(candidate, str):
        return candidate
    if isinstance(candidate, list):
        if candidate == [] or candidate == [None]:
            return None
        if isinstance(candidate[0], str):
            return candidate[0]
    raise ValueError("chat-history RPC returned an unexpected response")


def get_conversation_id_strict(client: Any, notebook_id: str) -> str | None:
    """Use the installed client's RPC without its error-to-empty fallback."""
    rpc = getattr(client, "RPC_GET_CONVERSATIONS", None)
    call_rpc = getattr(client, "_call_rpc", None)
    if not rpc or not callable(call_rpc):
        raise RuntimeError("installed NLM client does not expose chat-history RPC")
    payload = call_rpc(
        rpc,
        [[], None, notebook_id, 20],
        path=f"/notebook/{notebook_id}",
    )
    return parse_conversation_id(payload)


def delete_chat_history_strict(
    client: Any,
    notebook_id: str,
    conversation_id: str,
) -> None:
    """Call the live-captured delete-history payload used by NotebookLM."""
    rpc = getattr(client, "RPC_DELETE_CHAT_HISTORY", None)
    call_rpc = getattr(client, "_call_rpc", None)
    if not rpc or not callable(call_rpc):
        raise RuntimeError("installed NLM client does not expose chat-deletion RPC")
    call_rpc(
        rpc,
        [[], conversation_id, None, 1],
        path=f"/notebook/{notebook_id}",
    )


def conversation_has_turns_strict(
    client: Any,
    notebook_id: str,
    conversation_id: str,
) -> bool:
    """Check server-side turns without treating an RPC failure as empty history."""
    rpc = getattr(client, "RPC_GET_CONVERSATION_TURNS", None)
    call_rpc = getattr(client, "_call_rpc", None)
    if not rpc or not callable(call_rpc):
        raise RuntimeError("installed NLM client does not expose conversation-turns RPC")
    payload = call_rpc(
        rpc,
        [
            [2, None, None, [1, None, None, None, None, None, None, None, None, None, [1, 3]]],
            None,
            None,
            conversation_id,
            20,
        ],
        path=f"/notebook/{notebook_id}",
    )
    if payload == []:
        return False
    if not isinstance(payload, list) or not payload:
        raise ValueError("conversation-turns RPC returned an unexpected response")
    turns = payload[0]
    if not isinstance(turns, list):
        raise ValueError("conversation-turns RPC returned an unexpected response")
    return bool(turns)


def get_conversation_turns_raw_strict(
    client: Any,
    notebook_id: str,
    conversation_id: str,
) -> list[Any]:
    """Fetch the full server turn payload, including citation passages."""
    rpc = getattr(client, "RPC_GET_CONVERSATION_TURNS", None)
    call_rpc = getattr(client, "_call_rpc", None)
    if not rpc or not callable(call_rpc):
        raise RuntimeError("installed NLM client does not expose conversation-turns RPC")
    payload = call_rpc(
        rpc,
        [
            [
                2,
                None,
                [1],
                [1, None, None, None, None, None, None, None, None, None, [1, 3]],
            ],
            None,
            None,
            conversation_id,
            20,
        ],
        path=f"/notebook/{notebook_id}",
    )
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], list):
        raise ValueError("conversation-turns RPC returned an unexpected response")
    return payload[0]


def query_pairs_from_raw_turns(raw_turns: list[Any]) -> list[tuple[str, list[Any]]]:
    """Pair newest-first answer turns with their matching query turns."""
    pairs: list[tuple[str, list[Any]]] = []
    pending_answer: list[Any] | None = None
    for entry in raw_turns:
        if not isinstance(entry, list) or len(entry) < 3:
            continue
        if entry[2] == 2 and len(entry) > 4:
            pending_answer = entry
        elif entry[2] == 1 and len(entry) > 3 and isinstance(entry[3], str):
            if pending_answer is not None:
                pairs.append((entry[3], pending_answer))
                pending_answer = None
    return pairs


def payload_from_server_answer(
    prompt: str,
    conversation_id: str,
    answer_turn: list[Any],
) -> dict[str, Any]:
    """Reconstruct the normal query JSON from the server's persisted answer turn."""
    try:
        wrapper = answer_turn[4][0]
        answer = wrapper[0]
        returned_conversation_id = wrapper[2][0]
        type_info = wrapper[4]
    except (IndexError, TypeError) as error:
        raise ValueError("server answer turn has an unexpected response") from error
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("server answer turn has no answer")
    if returned_conversation_id != conversation_id:
        raise ValueError("server answer turn has a different conversation_id")
    citation_data = ConversationMixin._extract_citation_data(type_info)
    return {
        "answer": answer,
        "question": prompt,
        "conversation_id": conversation_id,
        "sources_used": citation_data.get("sources_used", []),
        "citations": citation_data.get("citations", {}),
        "references": citation_data.get("references", []),
    }


def recover_timed_out_query(
    notebook_id: str,
    prompt: str,
    conversation_id: str | None,
    require_only_turn: bool,
) -> dict[str, Any]:
    """Recover this exact completed server turn without submitting another query."""
    deadline = time.monotonic() + SERVER_RECOVERY_SECONDS
    last_problem = "server result is not visible yet"
    while True:
        try:
            with get_client() as client:
                resolved_conversation_id = conversation_id or get_conversation_id_strict(
                    client,
                    notebook_id,
                )
                if resolved_conversation_id is None:
                    last_problem = "server conversation_id is not visible yet"
                else:
                    raw_turns = get_conversation_turns_raw_strict(
                        client,
                        notebook_id,
                        resolved_conversation_id,
                    )
                    pairs = query_pairs_from_raw_turns(raw_turns)
                    if require_only_turn and len(pairs) != 1:
                        last_problem = (
                            "cleared main-query conversation does not contain exactly one turn"
                        )
                    elif not pairs:
                        last_problem = "server conversation has no completed turn yet"
                    elif pairs[0][0].strip() != prompt.strip():
                        last_problem = "latest server turn does not match this exact prompt"
                    else:
                        payload = payload_from_server_answer(
                            prompt,
                            resolved_conversation_id,
                            pairs[0][1],
                        )
                        validate_query_envelope(payload)
                        return payload
        except Exception as error:
            last_problem = str(error)
        if time.monotonic() >= deadline:
            raise RuntimeError(
                "local query process timed out and the exact completed server result "
                f"could not be recovered: {last_problem}"
            )
        time.sleep(2)


def clear_target_chat(notebook_id: str) -> bool:
    with get_client() as client:
        notebooks = client.list_notebooks()
        exact_matches = [item for item in notebooks if getattr(item, "id", None) == notebook_id]
        if len(exact_matches) != 1:
            raise RuntimeError(f"target notebook ID was not found exactly once: {notebook_id}")

        conversation_id = get_conversation_id_strict(client, notebook_id)
        if conversation_id is None:
            return False
        delete_chat_history_strict(client, notebook_id, conversation_id)
        if conversation_has_turns_strict(
            client,
            notebook_id,
            conversation_id,
        ):
            raise RuntimeError(
                "chat deletion could not be verified; "
                f"conversation still contains turns: {conversation_id}"
            )
        return True


def run_query(
    notebook_id: str,
    prompt: str,
    conversation_id: str | None = None,
) -> subprocess.CompletedProcess[str]:
    command = [
        "nlm",
        "notebook",
        "query",
        notebook_id,
        prompt,
        "--json",
        "--timeout",
        str(QUERY_TIMEOUT_SECONDS),
    ]
    if conversation_id is not None:
        command.extend(["--conversation-id", conversation_id])
    try:
        return subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=QUERY_TIMEOUT_SECONDS + 30,
        )
    except FileNotFoundError as error:
        raise RuntimeError("NLM command not found: nlm") from error
    except subprocess.TimeoutExpired as error:
        raise QueryProcessTimedOut(
            f"query process timed out after {QUERY_TIMEOUT_SECONDS + 30} seconds"
        ) from error


def validate_query_envelope(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise ValueError("query response is not a JSON object")
    if payload.get("status") == "error":
        raise ValueError(str(payload.get("error") or "query returned an error"))
    if not isinstance(payload.get("answer"), str) or not payload["answer"].strip():
        raise ValueError("query response has no answer")
    if not isinstance(payload.get("conversation_id"), str) or not payload[
        "conversation_id"
    ].strip():
        raise ValueError("query response has no conversation_id")
    if not isinstance(payload.get("citations"), dict):
        raise ValueError("query response has no citations mapping")
    if "references" in payload and not isinstance(payload["references"], list):
        raise ValueError("query references must be an array")


def validate_query_payload(payload: Any) -> None:
    validate_query_envelope(payload)
    references = payload.get("references")
    if not isinstance(references, list) or not references:
        raise QueryEvidenceMissing("query response has no references")
    if not any(
        isinstance(item, dict)
        and isinstance(item.get("source_id"), str)
        and item["source_id"].strip()
        and item.get("citation_number") is not None
        and isinstance(item.get("cited_text"), str)
        and item["cited_text"].strip()
        for item in references
    ):
        raise QueryEvidenceMissing("query references contain no usable cited_text")


def load_valid_query(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"required main query does not exist: {path}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot read a valid main query: {path}") from error
    validate_query_payload(payload)
    return payload


def main() -> int:
    args = parse_args()
    is_supplement = args.supplement
    try:
        task, scratch_path, notebook_id = load_p1_task(args.work_order)
        with notebook_lock(notebook_id):
            if is_supplement:
                prompt_file = scratch_path / "notebook-query-supplement.txt"
                output_json = scratch_path / "notebook-query-supplement.json"
                main_payload = load_valid_query(scratch_path / "notebook-query.json")
                conversation_id = main_payload["conversation_id"]
            else:
                prompt_file = scratch_path / "notebook-query.txt"
                output_json = scratch_path / "notebook-query.json"
                conversation_id = None
            prompt = read_prompt(prompt_file)
            reserve_output(output_json)
            if not is_supplement:
                chat_was_deleted = clear_target_chat(notebook_id)
            recovered_after_local_timeout = False
            evidence_missing = False
            attempt_count = 0
            while attempt_count < MAX_CONFIRMED_EVIDENCE_ATTEMPTS:
                attempt_count += 1
                attempt_recovered_after_local_timeout = False
                try:
                    result = run_query(notebook_id, prompt, conversation_id)
                except QueryProcessTimedOut:
                    payload = recover_timed_out_query(
                        notebook_id,
                        prompt,
                        conversation_id,
                        require_only_turn=not is_supplement and attempt_count == 1,
                    )
                    output_json.write_text(
                        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8",
                    )
                    attempt_recovered_after_local_timeout = True
                else:
                    if result.stdout:
                        output_json.write_text(result.stdout, encoding="utf-8")
                    if result.returncode != 0:
                        detail = (result.stderr or result.stdout).strip()
                        raise RuntimeError(f"query failed: {detail or 'no error detail'}")
                    try:
                        payload = json.loads(result.stdout)
                    except json.JSONDecodeError as error:
                        raise ValueError("query returned invalid JSON") from error

                validate_query_envelope(payload)
                returned_conversation_id = payload["conversation_id"]
                if conversation_id is not None and returned_conversation_id != conversation_id:
                    raise ValueError(
                        "query did not return the expected conversation_id"
                    )
                recovered_after_local_timeout = attempt_recovered_after_local_timeout
                try:
                    validate_query_payload(payload)
                except QueryEvidenceMissing as error:
                    if attempt_count >= MAX_CONFIRMED_EVIDENCE_ATTEMPTS:
                        if task["moduleId"] == "author-narration":
                            evidence_missing = True
                            break
                        raise QueryEvidenceAttemptsExhausted(
                            f"{error}; same query completed "
                            f"{MAX_CONFIRMED_EVIDENCE_ATTEMPTS} times"
                        ) from error
                    conversation_id = returned_conversation_id
                    continue
                break
    except Exception as error:
        print(str(error), file=sys.stderr)
        if isinstance(error, QueryEvidenceAttemptsExhausted):
            print(
                "Stop here. The script already used every allowed evidence retry.",
                file=sys.stderr,
            )
        elif is_supplement:
            print(
                "Stop here. Do not resubmit an unknown or otherwise invalid supplement.",
                file=sys.stderr,
            )
        else:
            print(
                "Stop here. Do not resubmit an unknown or otherwise invalid main query, "
                "and do not reuse this output path.",
                file=sys.stderr,
            )
        return 1

    summary = {
        "taskDigest": task["taskDigest"],
        "notebookId": notebook_id,
        "output": str(output_json),
        "referenceCount": len(payload.get("references", [])),
        "attemptCount": attempt_count,
        "receipt": (
            "confirmed_answer_without_citations"
            if evidence_missing
            else "recovered_exact_server_result_after_local_timeout"
            if recovered_after_local_timeout
            else "collected_directly"
        ),
    }
    if not is_supplement:
        summary["previousChat"] = "deleted" if chat_was_deleted else "already_empty"
    print(
        json.dumps(summary, ensure_ascii=False)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
