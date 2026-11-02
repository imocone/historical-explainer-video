"""One process-wide lock per NotebookLM notebook."""

from __future__ import annotations

import fcntl
import hashlib
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


@contextmanager
def notebook_lock(notebook_id: str) -> Iterator[None]:
    if not isinstance(notebook_id, str) or not notebook_id.strip():
        raise ValueError("notebook_id is required for the NotebookLM lock")
    digest = hashlib.sha256(notebook_id.encode("utf-8")).hexdigest()
    lock_path = Path(tempfile.gettempdir()) / f"xiaoxinxixn-notebooklm-{digest}.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)
