"""AgroConecta: adaptador PostgreSQL mediante rutinas almacenadas.

La ÚNICA sentencia enviada por la aplicación es CALL public.agro_exec(...).
Las consultas y escrituras a tablas viven en database/04_Rutinas_Almacenadas.sql.
La autorización de los registros se valida en los servicios y en cada rutina.
"""
from __future__ import annotations

import copy
from threading import RLock
from typing import Callable, TypeVar
from uuid import UUID

from fastapi import HTTPException

T = TypeVar('T')
KINDS = ('crops', 'plots', 'templates', 'activities', 'harvests')


def _uuid(value):
    return str(UUID(str(value))) if value else None


class PostgresStore:
    def __init__(self, dsn: str):
        try:
            from psycopg_pool import ConnectionPool
            from psycopg.types.json import Jsonb
        except ImportError as exc:
            raise RuntimeError('Instala las dependencias: uv sync') from exc
        self.Jsonb = Jsonb
        self.lock = RLock()
        self.pool = ConnectionPool(conninfo=dsn, min_size=1, max_size=5,
                                   kwargs={'connect_timeout': 8}, open=False)
        try:
            self.pool.open(wait=True)
            with self.pool.connection() as conn, conn.cursor() as cur:
                version = self._call(cur, 'health')
                if version.get('version') != 20:
                    raise RuntimeError('Instala el esquema V20 y 04_Rutinas_Almacenadas.sql antes de iniciar el backend.')
        except Exception:
            self.close()
            raise

    def close(self):
        self.pool.close()

    def _connection(self):
        return self.pool.connection()

    def _call(self, cur, action: str, **params):
        """Llamada parametrizada: no contiene SQL de tablas ni SQL dinámico."""
        cur.execute('CALL public.agro_exec(%s, %s, NULL)',
                    (action, self.Jsonb(params)))
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f'La rutina {action} no devolvió una respuesta.')
        return row[2] if len(row) > 2 else row[0]

    @staticmethod
    def empty_state():
        return {'version': 1, 'users': {}, 'sessions': {}, 'records': {},
                'events': [], 'alert_reviews': {}}

    @staticmethod
    def _decode_record(kind, row_or_id, owner=None, payload=None):
        row = payload if payload is not None else row_or_id
        if not isinstance(row, dict) or not row:
            raise RuntimeError(f'Datos incompletos de {kind}')
        record = copy.deepcopy(row)
        if record.get('kind') != kind or (owner is not None and (record.get('owner') != str(owner) or record.get('id') != str(row_or_id))):
            raise RuntimeError(f'Registro de tipo incorrecto: {kind}')
        if kind == 'harvests':
            record['stages'] = (copy.deepcopy(record.get('stage_history', []))
                                if record.get('process_mode') == 'custom'
                                else copy.deepcopy(record.get('stages', [])))
        return record

    def _load_owned(self, cur, owner, kinds):
        state = self.empty_state()
        wanted = tuple(dict.fromkeys(kinds))
        if any(kind not in KINDS for kind in wanted):
            raise ValueError('Entidad no permitida')
        # Un viaje de red para todas las entidades vinculadas a la operación.
        rows = self._call(cur, 'list_multiple', owner=_uuid(owner), kinds=list(wanted))
        for raw in rows:
            record = self._decode_record(raw.get('kind'), raw)
            state['records'][record['id']] = record
        return state

    def list_records(self, owner, kind):
        if kind not in KINDS:
            raise ValueError('Entidad no admitida')
        with self._connection() as conn, conn.cursor() as cur:
            return [self._decode_record(kind, row) for row in
                    self._call(cur, 'list', owner=_uuid(owner), kind=kind)]

    def get_record(self, owner, kind, record_id):
        if kind not in KINDS:
            raise HTTPException(404, 'Registro no encontrado.')
        try:
            rid = _uuid(record_id)
        except ValueError:
            raise HTTPException(404, 'Registro no encontrado.')
        with self._connection() as conn, conn.cursor() as cur:
            row = self._call(cur, 'get', owner=_uuid(owner), kind=kind, id=rid)
        if not row:
            raise HTTPException(404, 'Registro no encontrado.')
        return self._decode_record(kind, row)

    def _persist(self, cur, before, after):
        removed = set(before['records']) - set(after['records'])
        for record_id in removed:
            old = before['records'][record_id]
            if old['kind'] not in ('activities', 'templates'):
                raise RuntimeError('No se permite eliminar este registro.')
            result = self._call(cur, 'remove', owner=_uuid(old['owner']),
                                kind=old['kind'], id=_uuid(record_id))
            if not result.get('ok'):
                raise RuntimeError('No se pudo eliminar el registro.')

        for record in after['records'].values():
            if before['records'].get(record['id']) == record:
                continue
            kind = record['kind']
            if kind not in KINDS:
                raise RuntimeError('Entidad no admitida')
            data = {key: value for key, value in record.items() if key not in ('photo', 'stages')}
            self._call(cur, 'save', kind=kind, record=data)
            if kind == 'harvests':
                previous = before['records'].get(record['id'], {}).get('stages', [])
                current = record.get('stages', [])
                if current[:len(previous)] != previous:
                    raise RuntimeError('No se puede alterar el historial de un lote.')
                for order, stage in enumerate(current[len(previous):], start=len(previous)+1):
                    self._call(cur, 'stage', owner=_uuid(record['owner']),
                               harvest=_uuid(record['id']), order=order, stage=stage)

        previous_events = {ev['id'] for ev in before['events']}
        for event in after['events']:
            if event['id'] not in previous_events:
                self._call(cur, 'event', event=event)

        for user_id, user in after['users'].items():
            if before['users'].get(user_id) != user:
                self._call(cur, 'add_user', user=user)
        for token in before['sessions'].keys() - after['sessions'].keys():
            self._call(cur, 'delete_session', token=token)
        for token, session in after['sessions'].items():
            if before['sessions'].get(token) != session:
                self._call(cur, 'add_session', token=token, session=session, now=0)
        for user_id in before['alert_reviews'].keys() | after['alert_reviews'].keys():
            old = before['alert_reviews'].get(user_id, {})
            new = after['alert_reviews'].get(user_id, {})
            for alert_id in old.keys() | new.keys():
                if bool(old.get(alert_id)) != bool(new.get(alert_id)):
                    self._call(cur, 'review', owner=_uuid(user_id), alert=alert_id,
                               reviewed=bool(new.get(alert_id)))

    def transaction_scoped(self, owner, kinds, operation, photos=()):
        with self._connection() as conn, conn.cursor() as cur:
            self._call(cur, 'lock', owner=_uuid(owner))
            before = self._load_owned(cur, owner, tuple(dict.fromkeys(kinds)))
            after = copy.deepcopy(before)
            result = operation(after)
            self._persist(cur, before, after)
            if any(jpeg is not None for _owner, _plot, jpeg in photos):
                raise RuntimeError('Las fotografías se guardan exclusivamente en Supabase Storage.')
            return copy.deepcopy(result)

    def user_by_email(self, email):
        with self._connection() as conn, conn.cursor() as cur:
            return self._call(cur, 'user_email', email=email)

    def add_user(self, user):
        with self._connection() as conn, conn.cursor() as cur:
            result = self._call(cur, 'add_user', user=user)
        if not result.get('ok'):
            raise HTTPException(409, 'No se pudo crear la cuenta con este correo.')

    def add_session(self, token_hash, user_id, expiry, now):
        with self._connection() as conn, conn.cursor() as cur:
            self._call(cur, 'add_session', token=token_hash,
                       session={'user_id': _uuid(user_id), 'expires': expiry}, now=now)

    def session_user(self, token_hash, now):
        with self._connection() as conn, conn.cursor() as cur:
            return self._call(cur, 'session_user', token=token_hash, now=now)

    def delete_session(self, token_hash):
        with self._connection() as conn, conn.cursor() as cur:
            self._call(cur, 'delete_session', token=token_hash)

    def events_for(self, owner):
        with self._connection() as conn, conn.cursor() as cur:
            return self._call(cur, 'events', owner=_uuid(owner))

    def summary_for(self, owner):
        with self._connection() as conn, conn.cursor() as cur:
            return self._call(cur, 'summary', owner=_uuid(owner))

    def read_reviews(self, owner):
        with self._connection() as conn, conn.cursor() as cur:
            return {id_: True for id_ in self._call(cur, 'reviews', owner=_uuid(owner))}

    def set_review(self, owner, alert_id, reviewed):
        with self._connection() as conn, conn.cursor() as cur:
            self._call(cur, 'review', owner=_uuid(owner), alert=alert_id, reviewed=bool(reviewed))
        return {'id': alert_id, 'reviewed': reviewed}

    def read(self):
        with self._connection() as conn, conn.cursor() as cur:
            return self._call(cur, 'snapshot')

    def transaction(self, operation: Callable[[dict], T]) -> T:
        with self.lock, self._connection() as conn, conn.cursor() as cur:
            self._call(cur, 'lock')
            before = self._call(cur, 'snapshot')
            after = copy.deepcopy(before)
            result = operation(after)
            self._persist(cur, before, after)
            return copy.deepcopy(result)

    def import_snapshot(self, state, photos=()):
        def change(data):
            if any((data['users'], data['sessions'], data['records'], data['events'], data['alert_reviews'])):
                raise RuntimeError('La base de datos no está vacía.')
            data.update(copy.deepcopy(state))
            return len(data['records'])
        return self.transaction(change)
