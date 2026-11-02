#!/usr/bin/env python3
"""Submit the current Author closeout as one NotebookLM query, without retries."""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "modules" / "author-narration" / "scripts"))
from notebook_lock import notebook_lock
QUERY_TIMEOUT_SECONDS = 180

class QueryServiceFailure(RuntimeError):
    pass


def read_json(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("work order or receipt must be a regular file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("work order or receipt must be an object")
    return value


def load_task(path: Path) -> tuple[dict[str, Any], Path]:
    task = read_json(path.resolve())
    inputs = task.get("inputs", {})
    if task.get("moduleId") != "author-beat" or task.get("stageId") != "p3" or inputs.get("authorPhase") != "quotes":
        raise ValueError("query only accepts the current P3 Author quote closeout work order")
    requests = inputs.get("quoteRequests")
    if not isinstance(requests, list) or not requests or len({item["id"] for item in requests}) != len(requests):
        raise ValueError("quote closeout has no unique current requests")
    if not inputs.get("notebookId") or not inputs.get("cues") or len(task.get("taskDigest", "")) != 64:
        raise ValueError("quote closeout lacks notebook, cues or task identity")
    workspace = path.resolve().parents[4]
    scratch = (workspace / task["scratchPath"]).resolve()
    scratch.relative_to(workspace)
    return task, scratch


def build_prompt(task: dict[str, Any]) -> str:
    inputs = task["inputs"]
    topics = [{"id": item["id"], "request": item["request"],
               "narration": "".join(cue["text"] for cue in inputs["cues"]
                                    if item["cueRange"][0] <= cue["id"] <= item["cueRange"][1])}
              for item in inputs["quoteRequests"]]
    return ("请一次核实以下各项，不改写字幕。每项根据人物、事件和具体说法寻找连续逐字原文及必要上下文，不先按画面字数截短，优先中文，"
            "外文仅使用原始来源原语言。原文必须完整包含在这次真实返回的同一条 cited_text 中。"
            "禁止翻译、概括、拼接、OCR坏字、只有出处或常识补写。找不到时原文列写NO_EXACT_QUOTE，来源列保留实际找到的文献线索，供后续网上查找，继续其它项。"
            "返回普通Markdown表格，恰好三列：id | 原文 | 来源引用。不要JSON，不要代码块。"
            "原文列只放原文，不加引号、加粗或引用编号；该行来源引用列使用真实可打开的来源引用，不手写模拟编号。"
            "必须原样逐项保留id，每项独占一行，不能因一项无原文否定其它项。\n"
            + json.dumps(topics, ensure_ascii=False))


def run_query_once(notebook_id: str, prompt: str) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            [
                "nlm",
                "notebook",
                "query",
                notebook_id,
                prompt,
                "--json",
                "--timeout",
                str(QUERY_TIMEOUT_SECONDS),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=QUERY_TIMEOUT_SECONDS + 30,
        )
    except subprocess.TimeoutExpired as error:
        raise QueryServiceFailure(
            f"NotebookLM query timed out after {QUERY_TIMEOUT_SECONDS + 30} seconds"
        ) from error
    except OSError as error:
        raise QueryServiceFailure(f"NotebookLM query could not run: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise QueryServiceFailure(
            f"NotebookLM query failed or became unknown: {detail or 'no detail'}"
        )
    return result


def run_source_list_once(notebook_id: str) -> list[dict[str, Any]]:
    try:
        source_result = subprocess.run(
            ["nlm", "source", "list", notebook_id, "--json"],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
    except subprocess.TimeoutExpired as error:
        raise QueryServiceFailure("NotebookLM source list timed out after 60 seconds") from error
    except OSError as error:
        raise QueryServiceFailure(f"NotebookLM source list could not run: {error}") from error
    if source_result.returncode != 0:
        detail = (source_result.stderr or source_result.stdout).strip()
        raise QueryServiceFailure(
            f"NotebookLM source list failed: {detail or 'no detail'}"
        )
    try:
        sources = json.loads(source_result.stdout)
    except json.JSONDecodeError as error:
        raise QueryServiceFailure("NotebookLM source list returned invalid JSON") from error
    if not isinstance(sources, list) or not all(
        isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and isinstance(item.get("title"), str)
        for item in sources
    ):
        raise QueryServiceFailure("NotebookLM source list has no stable id/title metadata")
    return sources


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work_order", type=Path)
    args = parser.parse_args()
    try:
        task, scratch = load_task(args.work_order)
        inputs = task["inputs"]
        notebook = inputs["notebookId"]
        requests = inputs["quoteRequests"]
        scratch.mkdir(parents=True, exist_ok=True)
        output = scratch / "historical-quote-query.json"
        with notebook_lock(notebook):
            if output.exists():
                receipt = read_json(output)
                if receipt.get("taskDigest") != task["taskDigest"] or receipt.get("notebookId") != notebook or receipt.get("requests") != requests:
                    raise ValueError("existing receipt does not match this task, notebook and batch")
                if receipt.get("outcome") != "completed":
                    raise ValueError("original query is pending or unknown; recover it, never resubmit")
                response = receipt.get("response")
                if (isinstance(response, dict) and response.get("error")) or any(
                    item.get("reason") == "response-error" for item in receipt.get("items", [])
                ):
                    raise ValueError("original receipt contains a service error, not a no-source result; inspect it, never resubmit")
                print(json.dumps({"receipt": str(output), "outcome": "completed", "reused": True}, ensure_ascii=False))
                return 0
            # Source metadata can be retried before submission; it does not submit a query.
            sources = run_source_list_once(notebook)
            receipt = {"schemaVersion": "2.0", "taskDigest": task["taskDigest"], "notebookId": notebook,
                       "requests": requests, "sources": sources, "outcome": "pending"}
            with output.open("x", encoding="utf-8") as stream:
                json.dump(receipt, stream, ensure_ascii=False)
            try:
                result = run_query_once(notebook, build_prompt(task))
                try:
                    payload = json.loads(result.stdout)
                except (ValueError, TypeError):
                    payload = {"answer": result.stdout, "references": []}
                if isinstance(payload, dict) and payload.get("error"):
                    raise QueryServiceFailure("NotebookLM returned a service error; this is not a no-source result")
            except QueryServiceFailure as error:
                receipt.update(outcome="unknown", error=str(error))
                output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                raise
            receipt.update(outcome="completed", response=payload)
            output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"receipt": str(output), "outcome": "completed", "requests": len(requests)}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        print("Stop. Inspect or recover the original receipt; do not submit another query.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
