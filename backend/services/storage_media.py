"""Fotos privadas en Supabase Storage.

Las claves privilegiadas solo viven en FastAPI. Angular nunca recibe una URL de
Storage ni una credencial. Las claves de objeto incorporan el ID del agricultor,
el tipo y el ID de la entidad, y se comprueban antes de cualquier lectura/borrado.
"""
from __future__ import annotations

import hashlib
import logging
from urllib.parse import quote, urlsplit
from uuid import UUID, uuid4

import httpx

log = logging.getLogger(__name__)


class StorageUnavailable(RuntimeError):
    pass


class PrivatePhotoStorage:
    def __init__(self, project_url: str, service_key: str, bucket: str = 'agroconecta-private',
                 client: httpx.Client | None = None):
        parts = urlsplit(project_url.strip())
        if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError('SUPABASE_URL debe ser la URL HTTPS de tu proyecto Supabase.')
        if not service_key.strip():
            raise ValueError('Falta SUPABASE_SECRET_KEY o SUPABASE_SERVICE_ROLE_KEY en el backend.')
        if not bucket or any(char not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for char in bucket):
            raise ValueError('Nombre de bucket inválido.')
        self.root = project_url.rstrip('/') + '/storage/v1/object'
        self.bucket = bucket
        self.headers = {'apikey': service_key}
        # Nuevas claves sb_secret_* NO son JWT; enviarlas como Bearer produce Invalid JWT.
        if not service_key.startswith('sb_secret_'):
            self.headers['Authorization'] = f'Bearer {service_key}'
        self.client = client if client is not None else httpx.Client(timeout=httpx.Timeout(25.0, connect=8.0))
        self._owns_client = client is None

    def close(self):
        if self._owns_client:
            self.client.close()

    @staticmethod
    def _base(owner: str, kind: str, record_id: str) -> str:
        if kind not in ('parcelas', 'cultivos'):
            raise ValueError('Tipo de imagen inválido.')
        return f'{UUID(str(owner))}/{kind}/{UUID(str(record_id))}/'

    def _url(self, path: str, *, private=False) -> str:
        return f'{self.root}/{"authenticated/" if private else ""}{self.bucket}/{quote(path, safe="/")}'

    def _validate_path(self, owner: str, kind: str, record_id: str, path: str):
        prefix = self._base(owner, kind, record_id)
        if not isinstance(path, str) or not path.startswith(prefix):
            raise ValueError('La imagen no pertenece a este registro.')
        suffix = path[len(prefix):]
        if '/' in suffix or not suffix.endswith('.jpg'):
            raise ValueError('Ruta de fotografía incorrecta.')
        UUID(suffix[:-4])

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            response = self.client.request(method, url, headers={**self.headers, **kwargs.pop('headers', {})}, **kwargs)
            response.raise_for_status()
            return response
        except (httpx.HTTPError, OSError) as exc:
            # Evitar exponer URLs con token y mensajes internos en errores HTTP.
            log.warning('Fallo %s contra Supabase Storage: %s', method, type(exc).__name__)
            raise StorageUnavailable('No se pudo acceder a las fotografías en Supabase Storage.') from exc

    def ensure_private_bucket(self):
        """No cargar datos sensibles a un bucket público por error de configuración."""
        base = self.root.rsplit('/object', 1)[0]
        details = self._request('GET', f'{base}/bucket/{self.bucket}')
        try:
            public = details.json()['public']
        except (ValueError, KeyError, TypeError) as exc:
            raise StorageUnavailable('No se pudo verificar si el bucket es privado.') from exc
        if public is not False:
            raise StorageUnavailable('El bucket de fotografías debe ser PRIVADO. Desactiva Public bucket.')

    def upload(self, owner: str, kind: str, record_id: str, jpeg: bytes) -> str:
        if not jpeg or len(jpeg) > 5 * 1024 * 1024:
            raise ValueError('Fotografía JPEG fuera del tamaño permitido.')
        path = self._base(owner, kind, record_id) + f'{uuid4()}.jpg'
        self._request('POST', self._url(path), content=jpeg,
                      headers={'Content-Type': 'image/jpeg', 'cache-control': '3600', 'x-upsert': 'false'})
        return path

    def download(self, owner: str, kind: str, record_id: str, path: str) -> bytes:
        self._validate_path(owner, kind, record_id, path)
        return self._request('GET', self._url(path, private=True)).content

    def verified_upload(self, owner: str, kind: str, record_id: str, jpeg: bytes) -> str:
        path = self.upload(owner, kind, record_id, jpeg)
        try:
            saved = self.download(owner, kind, record_id, path)
            if hashlib.sha256(saved).digest() != hashlib.sha256(jpeg).digest():
                raise StorageUnavailable('La fotografía no se verificó correctamente en Storage.')
            return path
        except Exception:
            self.best_effort_delete(owner, kind, record_id, path)
            raise

    def delete(self, owner: str, kind: str, record_id: str, path: str):
        self._validate_path(owner, kind, record_id, path)
        self._request('DELETE', self._url(path))

    def best_effort_delete(self, owner: str, kind: str, record_id: str, path: str):
        try:
            self.delete(owner, kind, record_id, path)
        except (StorageUnavailable, ValueError):
            log.warning('No se pudo eliminar una foto reemplazada; verificar objetos huérfanos del bucket.')
