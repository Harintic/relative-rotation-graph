from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
import sys
import threading
from typing import TextIO


@dataclass(frozen=True)
class LogEntry:
    id: int
    ts: str
    level: str
    source: str
    message: str


_lock = threading.Lock()
_entries: deque[LogEntry] = deque(maxlen=5000)
_next_id = 1
_stdio_installed = False


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def append_log(level: str, source: str, message: str) -> LogEntry:
    global _next_id
    entry = LogEntry(
        id=_next_id,
        ts=_timestamp(),
        level=level.upper().strip() or "INFO",
        source=source.strip() or "app",
        message=message.rstrip("\n"),
    )
    with _lock:
        _entries.append(entry)
        _next_id += 1
    return entry


def emit_terminal_line(level: str, source: str, message: str) -> LogEntry:
    entry = append_log(level, source, message)
    sys.__stdout__.write(f"[{entry.ts}] {entry.level} {entry.source}: {entry.message}\n")
    sys.__stdout__.flush()
    return entry


def get_logs_since(since: int = 0, limit: int = 500) -> tuple[list[dict], int]:
    with _lock:
        logs = [entry for entry in _entries if entry.id > since][: max(1, limit)]
        next_id = _next_id
    return [entry.__dict__ for entry in logs], next_id


def clear_logs() -> None:
    global _entries
    with _lock:
        _entries = deque(maxlen=5000)


class _TeeStream:
    def __init__(self, wrapped: TextIO, source: str) -> None:
        self._wrapped = wrapped
        self._source = source
        self._buffer = ""

    def write(self, text: str) -> int:
        if not text:
            return 0
        self._wrapped.write(text)
        self._wrapped.flush()
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line:
                append_log("INFO", self._source, line)
        return len(text)

    def flush(self) -> None:
        if self._buffer.strip():
            append_log("INFO", self._source, self._buffer)
            self._buffer = ""
        self._wrapped.flush()


def install_stdio_tee() -> None:
    global _stdio_installed
    if _stdio_installed:
        return
    sys.stdout = _TeeStream(sys.stdout, "stdout")  # type: ignore[assignment]
    sys.stderr = _TeeStream(sys.stderr, "stderr")  # type: ignore[assignment]
    _stdio_installed = True
