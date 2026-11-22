"""Contrato de rutinas V18: pruebas aisladas, sin credenciales ni Supabase real.

Todas las llamadas de negocio deben ser CALL a una rutina fija; SQL de tablas
vive en database/04_Rutinas_Almacenadas.sql, no dentro del repositorio Python.
"""
from __future__ import annotations

import copy
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException

from core.database import create_store
from core.settings import Settings, get_settings
from repositories.postgres_store import PostgresStore, KINDS
from repositories.store import JsonStore


ROOT = Path(__file__).resolve().parents[1]


def uuid():
    return str(uuid4())


class Cursor:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []
        self.result = None

    def execute(self, sql, args=None):
        assert sql == 'CALL public.agro_exec(%s, %s, NULL)'
        operation, params = args
        self.calls.append((operation, params))
        value = self.responses.get(operation)
        self.result = value(params) if callable(value) else value
        if value is None and operation in ('lock', 'save', 'add_session', 'delete_session', 'event', 'stage', 'review'):
            self.result = {'ok': True}

    def fetchone(self):
        return (self.result,)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Connection:
    def __init__(self, cursor):
        self.cur = cursor

    def cursor(self):
        return self.cur

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def store_with_cursor(responses=None):
    store = object.__new__(PostgresStore)
    store.Jsonb = lambda val: val
    cur = Cursor(responses)
    store._connection = lambda: Connection(cur)
    return store, cur


def test_schema_preserves_all_ten_tables_and_private_photos():
    script = (ROOT / 'database' / 'AgroConecta_Supabase_PostgreSQL.sql').read_text()
    tables = {'usuarios', 'sesiones', 'cultivos', 'parcelas', 'plantillas',
              'actividades', 'cosechas', 'etapas_lote', 'bitacora', 'alertas_revisadas'}
    assert len(tables) == 10
    for table in tables:
        assert f'CREATE TABLE IF NOT EXISTS public.{table}' in script
        assert f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY' in script
    assert 'foto_ruta           text' in script and 'foto_jpeg' not in script
    assert 'FOREIGN KEY (usuario_id, parcela_id)' in script


def test_routine_script_exists_and_is_additive():
    sql = (ROOT / 'database' / '04_Rutinas_Almacenadas.sql').read_text()
    assert 'CREATE OR REPLACE PROCEDURE public.agro_exec' in sql
    assert 'CREATE OR REPLACE FUNCTION public.agro_records' in sql
    assert 'CREATE OR REPLACE FUNCTION public.agro_save_record' in sql
    assert 'DROP TABLE' not in sql and 'TRUNCATE' not in sql
    for table in ('usuarios', 'sesiones', 'parcelas', 'cultivos', 'cosechas', 'actividades'):
        assert f'public.{table}' in sql


def test_no_table_query_statements_in_production_repository():
    import re
    source = (ROOT / 'repositories' / 'postgres_store.py').read_text()
    assert "cur.execute('CALL public.agro_exec(%s, %s, NULL)'" in source
    assert not re.search(r'\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\s+(?:\*|INTO|FROM|TABLE|public\.)', source, flags=re.I)


def test_only_call_is_emitted_and_values_are_bound():
    store, cur = store_with_cursor({'user_email': {'id': uuid(), 'name': 'Ana'}})
    user = store.user_by_email("x' OR 1=1 --")
    assert user['name'] == 'Ana'
    assert cur.calls[0][0] == 'user_email'
    assert cur.calls[0][1]['email'] == "x' OR 1=1 --"


def test_list_scopes_owner_and_validates_kind():
    owner, cid = uuid(), uuid()
    row = {'id': cid, 'owner': owner, 'kind': 'crops', 'name': 'Café'}
    store, cur = store_with_cursor({'list': [row]})
    assert store.list_records(owner, 'crops')[0]['name'] == 'Café'
    assert cur.calls[0] == ('list', {'owner': owner, 'kind': 'crops'})
    with pytest.raises(ValueError):
        store.list_records(owner, 'usuarios')


def test_listing_does_not_load_unauthorized_sql_tables():
    owner = uuid()
    store, cur = store_with_cursor({'list': []})
    assert store.list_records(owner, 'plots') == []
    assert len(cur.calls) == 1 and cur.calls[0][0] == 'list'


def test_get_record_invalid_id_rejected_before_database():
    store, cur = store_with_cursor()
    with pytest.raises(HTTPException) as exc:
        store.get_record(uuid(), 'plots', 'incorrecta')
    assert exc.value.status_code == 404 and not cur.calls


def test_get_record_missing_returns_404():
    store, _ = store_with_cursor({'get': None})
    with pytest.raises(HTTPException) as exc:
        store.get_record(uuid(), 'crops', uuid())
    assert exc.value.status_code == 404


def test_get_record_uses_indexed_operation_and_owner():
    owner, pid = uuid(), uuid()
    row = {'id': pid, 'owner': owner, 'kind': 'plots', 'name': 'Parcela 01'}
    store, cur = store_with_cursor({'get': row})
    assert store.get_record(owner, 'plots', pid)['name'] == 'Parcela 01'
    assert cur.calls[0] == ('get', {'owner': owner, 'kind': 'plots', 'id': pid})


def test_harvest_stage_history_from_stored_routine():
    owner, lid = uuid(), uuid()
    stages = [{'stage': 'Cosechado', 'quantity': 100}]
    row = {'id': lid, 'owner': owner, 'kind': 'harvests', 'process_mode': 'legacy', 'stages': stages}
    store, _ = store_with_cursor({'get': row})
    assert store.get_record(owner, 'harvests', lid)['stages'] == stages


def test_harvest_custom_mode_keeps_snapshot():
    row = {'id': 'a', 'owner': 'b', 'kind': 'harvests', 'stage': 'Fermentación',
           'process_mode': 'custom', 'stage_history': [{'stage': 'Cosechado', 'quantity': 10}]}
    assert PostgresStore._decode_record('harvests', 'a', 'b', row)['stages'][0]['quantity'] == 10
    row['owner'] = 'c'
    with pytest.raises(RuntimeError):
        PostgresStore._decode_record('harvests', 'a', 'b', row)


def test_scoped_load_has_one_roundtrip_for_multiple_entities():
    owner, pid, cid = uuid(), uuid(), uuid()
    rows = [{'id': pid, 'owner': owner, 'kind': 'plots', 'name': 'A'},
            {'id': cid, 'owner': owner, 'kind': 'crops', 'name': 'B'}]
    store, cur = store_with_cursor({'list_multiple': rows})
    result = store._load_owned(cur, owner, ('plots', 'crops'))
    assert len(result['records']) == 2
    assert cur.calls == [('list_multiple', {'owner': owner, 'kinds': ['plots', 'crops']})]


def test_scoped_mutation_locks_owner_and_stays_atomic():
    owner, cid = uuid(), uuid()
    record = {'id': cid, 'owner': owner, 'kind': 'crops', 'name': 'Café'}
    store, cur = store_with_cursor({'list_multiple': [record]})
    def change(state):
        state['records'][cid]['name'] = 'Cacao'
        return 'ok'
    assert store.transaction_scoped(owner, ('crops',), change) == 'ok'
    assert [op for op, _ in cur.calls] == ['lock', 'list_multiple', 'save']
    assert cur.calls[0][1] == {'owner': owner}
    assert cur.calls[-1][1]['record']['name'] == 'Cacao'


def test_new_stage_is_appended_not_rewritten():
    owner, lid = uuid(), uuid()
    stage1 = {'stage': 'Cosechado', 'quantity': 40, 'date': '2026-11-01T00:00:00Z'}
    stage2 = {'stage': 'Secado', 'quantity': 35, 'date': '2026-11-02T00:00:00Z'}
    first = {'id': lid, 'owner': owner, 'kind': 'harvests', 'process_mode': 'legacy',
             'stage': 'Cosechado', 'stages': [stage1]}
    store, cur = store_with_cursor()
    before = store.empty_state()
    after = store.empty_state()
    before['records'][lid] = first
    after['records'][lid] = copy.deepcopy(first)
    after['records'][lid]['stage'] = 'Secado'
    after['records'][lid]['stages'] = [stage1, stage2]
    store._persist(cur, before, after)
    assert [op for op, _ in cur.calls] == ['save', 'stage']
    assert cur.calls[-1][1]['stage'] == stage2


def test_disallow_stage_rewriting():
    owner, lid = uuid(), uuid()
    old = {'id': lid, 'owner': owner, 'kind': 'harvests', 'process_mode': 'legacy',
           'stages': [{'stage': 'Cosechado', 'quantity': 10}]}
    store, cur = store_with_cursor()
    before, after = store.empty_state(), store.empty_state()
    before['records'][lid] = old
    after['records'][lid] = dict(old, stages=[{'stage': 'Cosechado', 'quantity': 30}])
    with pytest.raises(RuntimeError, match='historial'):
        store._persist(cur, before, after)


def test_scoped_deletion_only_allows_activity_or_template():
    owner, aid = uuid(), uuid()
    store, cur = store_with_cursor({'remove': {'ok': True}})
    before, after = store.empty_state(), store.empty_state()
    before['records'][aid] = {'id': aid, 'owner': owner, 'kind': 'activities'}
    store._persist(cur, before, after)
    assert cur.calls[0] == ('remove', {'owner': owner, 'kind': 'activities', 'id': aid})
    before['records'][aid]['kind'] = 'crops'
    with pytest.raises(RuntimeError):
        store._persist(cur, before, after)


def test_user_registration_and_session_restore_use_routines():
    owner = uuid()
    store, cur = store_with_cursor({
        'add_user': {'ok': True},
        'session_user': {'id': owner, 'name': 'Eva', 'email': 'e@example.test'},
    })
    store.add_user({'id': owner, 'name': 'Eva', 'email': 'e@example.test', 'salt': 'a'*32, 'hash': 'b'*128})
    store.add_session('c'*64, owner, 1234567, 12)
    assert store.session_user('c'*64, 12)['name'] == 'Eva'
    assert [op for op, _ in cur.calls] == ['add_user', 'add_session', 'session_user']


def test_duplicate_user_reports_conflict():
    store, _ = store_with_cursor({'add_user': {'ok': False}})
    with pytest.raises(HTTPException) as exc:
        store.add_user({'id': uuid(), 'name': 'Ana', 'email': 'test@example.test'})
    assert exc.value.status_code == 409


def test_reports_reviews_and_events_are_scoped():
    owner = uuid()
    store, cur = store_with_cursor({'summary': {'active_plots': 2, 'pending': 3},
                                    'reviews': ['a1'], 'events': [{'id': uuid()}]})
    assert store.summary_for(owner)['pending'] == 3
    assert store.read_reviews(owner) == {'a1': True}
    assert len(store.events_for(owner)) == 1
    assert all(params['owner'] == owner for _, params in cur.calls)


def test_photos_do_not_use_legacy_bytea_routines():
    owner, pid = uuid(), uuid()
    store, cur = store_with_cursor({'list_multiple': [{'id': pid, 'owner': owner, 'kind': 'plots', 'name': 'A'}]})
    assert store.transaction_scoped(owner, ('plots',), lambda _: 'ok') == 'ok'
    assert not any(op in ('get_photo', 'legacy_photo') for op, _ in cur.calls)
    with pytest.raises(RuntimeError, match='Storage'):
        store.transaction_scoped(owner, ('plots',), lambda _: 'ok', photos=((owner, pid, b'bytes'),))


def test_settings_and_reject_missing_postgresql_url(tmp_path, monkeypatch):
    example = (ROOT / '.env.example').read_text()
    assert 'DATABASE_URL=' in example and 'SUPABASE_STORAGE_BUCKET=' in example
    monkeypatch.setenv('DATABASE_URL', '')
    get_settings.cache_clear()
    try:
        assert isinstance(create_store(tmp_path / 'only-tests.json'), JsonStore)
        with pytest.raises(RuntimeError, match='DATABASE_URL'):
            create_store()
    finally:
        get_settings.cache_clear()


def test_reject_invalid_database_url_before_connection(monkeypatch):
    monkeypatch.setenv('DATABASE_URL', 'https://incorrect.invalid/pg')
    get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError, match='DATABASE_URL'):
            create_store()
    finally:
        get_settings.cache_clear()
