"""Resolve the one scratch directory owned by a current P1 work order."""

from __future__ import annotations

import json
import re
from pathlib import Path, PurePosixPath
from typing import Any


SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def _relative_path(value: Any, label: str) -> PurePosixPath:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} is missing")
    path = PurePosixPath(value)
    if path.is_absolute() or value != path.as_posix() or any(
        part in {"", ".", ".."} for part in path.parts
    ):
        raise ValueError(f"{label} is not a normalized relative path")
    return path


def load_p1_task(work_order_file: str | Path, *, require_notebook: bool = True) -> tuple[dict[str, Any], Path, str | None]:
    """Load a current author-narration Query task and return its fixed scratch and notebook."""
    supplied_path = Path(work_order_file).expanduser()
    if supplied_path.is_symlink():
        raise ValueError("work-order.yaml must not be a symlink")
    try:
        work_order_path = supplied_path.resolve(strict=True)
        task = json.loads(work_order_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot read P1 work order: {supplied_path}") from error
    if work_order_path.name != "work-order.yaml" or not isinstance(task, dict):
        raise ValueError("expected one JSON work-order.yaml object")

    identity = (
        task.get("runner"),
        task.get("workflowId"),
        task.get("stageId"),
        task.get("nodeId"),
        task.get("moduleId"),
    )
    valid_identities = {
        ("ai", "narration", "p1", "author-narration", "author-narration"),
        (
            "ai",
            "narration",
            "p1",
            "author-documentary-narration",
            "author-documentary-narration",
        ),
    }
    if identity not in valid_identities:
        raise ValueError("work order is not a current P1 narration-author task")
    execution_id = task.get("executionId")
    task_digest = task.get("taskDigest")
    if not isinstance(execution_id, str) or not SHA256_PATTERN.fullmatch(execution_id):
        raise ValueError("work order has no valid executionId")
    if not isinstance(task_digest, str) or not SHA256_PATTERN.fullmatch(task_digest):
        raise ValueError("work order has no valid taskDigest")

    inputs = task.get("inputs")
    return_request = inputs.get("returnRequest") if isinstance(inputs, dict) else None
    revision_scope = (
        return_request.get("revisionScope")
        if isinstance(return_request, dict)
        else None
    )
    if revision_scope in {"opener", "narration"}:
        raise ValueError("P1 revision work orders must not run Query")

    candidate = _relative_path(task.get("candidatePath"), "candidatePath")
    scratch = _relative_path(task.get("scratchPath"), "scratchPath")
    if candidate.name != "candidate.yaml":
        raise ValueError("P1 candidatePath must end in candidate.yaml")
    expected_scratch = candidate.parent / f"attempt-{execution_id}"
    if scratch != expected_scratch:
        raise ValueError("scratchPath is not bound to this work order executionId")

    workspace_root = work_order_path.parent
    for _ in candidate.parent.parts:
        workspace_root = workspace_root.parent
    expected_work_order = workspace_root.joinpath(*candidate.parent.parts, "work-order.yaml")
    if expected_work_order.resolve() != work_order_path:
        raise ValueError("work order location does not match candidatePath")

    scratch_path = workspace_root.joinpath(*scratch.parts)
    current = workspace_root
    for part in scratch.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("scratchPath must not contain symlinks")
    if not scratch_path.is_dir():
        raise ValueError(f"scratchPath does not exist: {scratch_path}")

    if not require_notebook and task["inputs"]["episodeBrief"].get("referenceProgram"):
        return task, scratch_path, None

    try:
        notebook_id = task["inputs"]["programPlan"]["researchLibrary"]["notebookId"]
    except (KeyError, TypeError) as error:
        raise ValueError("work order has no P1 notebookId") from error
    if not isinstance(notebook_id, str) or not notebook_id.strip():
        raise ValueError("work order has no P1 notebookId")
    return task, scratch_path, notebook_id
