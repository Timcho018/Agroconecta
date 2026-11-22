"""Persistencia provisional JSON. Un proceso; escrituras atómicas y bloqueo local.

El contrato transaction/read es el punto de sustitución por repositorios SQL.
No es una base de datos ni un almacenamiento apto para despliegue multiworker.
"""
import copy
import json
import os
import threading
from pathlib import Path
from typing import Callable, Protocol, TypeVar

T = TypeVar("T")


class Store(Protocol):
    def read(self) -> dict: ...
    def transaction(self, operation: Callable[[dict], T]) -> T: ...


class JsonStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            self._save({"version": 1, "users": {}, "sessions": {}, "records": {}, "events": []})
        if self.read().get("version") != 1:
            raise RuntimeError("Versión del archivo de datos no compatible")

    def read(self) -> dict:
        with self.lock:
            return json.loads(self.path.read_text(encoding="utf-8"))

    def _save(self, data: dict):
        temporary = self.path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)

    def transaction(self, operation: Callable[[dict], T]) -> T:
        with self.lock:
            data = self.read()
            result = operation(data)
            self._save(data)
            return copy.deepcopy(result)
