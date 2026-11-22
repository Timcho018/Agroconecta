"""Pruebas sin conexión real: bytes -> Storage privado -> ruta en PostgreSQL."""
import copy
import hashlib
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from services.farm import FarmService
from services.storage_media import PrivatePhotoStorage, StorageUnavailable


def uuid():
    return str(uuid4())


class FakeStorage:
    def __init__(self):
        self.objects = {}
        self.deleted = []
        self.fail_verification = False

    def verified_upload(self, owner, kind, record_id, jpeg):
        path = f'{owner}/{kind}/{record_id}/{uuid()}.jpg'
        self.objects[path] = jpeg
        return path

    def download(self, owner, kind, record_id, path):
        assert path.startswith(f'{owner}/{kind}/{record_id}/')
        return self.objects[path]

    def best_effort_delete(self, owner, kind, record_id, path):
        self.deleted.append(path)
        self.objects.pop(path, None)


class FakePgStore:
    def __init__(self, user, record):
        self.user = user
        self.data = {'records': {record['id']: record}, 'events': []}
        self.photo_writes = []
        self.fail_commit = False

    def get_record(self, owner, kind, record_id):
        record = self.data['records'].get(record_id)
        if record is None or record['kind'] != kind or record['owner'] != owner:
            raise HTTPException(404, 'Registro no encontrado.')
        return copy.deepcopy(record)

    def transaction_scoped(self, owner, kinds, fn, photos=()):
        if self.fail_commit:
            raise RuntimeError('SQL falla')
        data = copy.deepcopy(self.data)
        result = fn(data)
        self.data = data
        self.photo_writes.extend(photos)
        return result


def test_parcel_upload_only_saves_storage_path_not_binary_and_keeps_route():
    owner, pid = uuid(), uuid()
    store = FakePgStore(owner, {'id': pid, 'owner': owner, 'kind': 'plots',
                                'name': 'Mi finca', 'photo_version': None})
    media = FakeStorage()
    farm = FarmService(store, media=media)
    result = farm.photo(owner, pid, b'JPEG-CONTENT')
    assert result['photo_version']
    assert 'photo_path' not in result
    record = store.data['records'][pid]
    assert record['photo_path'].startswith(f'{owner}/parcelas/{pid}/')
    assert 'photo' not in record
    assert store.photo_writes == []
    assert farm.photo(owner, pid) == b'JPEG-CONTENT'
    assert store.data['events'][-1]['action'] == 'Fotografía actualizada'


def test_crop_upload_path_only_and_external_switch_removes_object():
    owner, cid = uuid(), uuid()
    store = FakePgStore(owner, {'id':cid, 'owner':owner, 'kind':'crops', 'name':'Papa',
                                'image_source':'inaturalist', 'image_url':'https://example.com/img.jpg',
                                'active': True, 'created_at':'2026-01-01'})
    media = FakeStorage()
    farm = FarmService(store, media=media)
    result = farm.crop_photo(owner, cid, b'jpeg-bytes')
    assert result['image_source'] == 'custom'
    assert result['crop_photo_version']
    assert 'crop_photo_path' not in result
    record = store.data['records'][cid]
    assert 'crop_photo_b64' not in record
    old_path = record['crop_photo_path']
    assert farm.crop_photo(owner, cid) == b'jpeg-bytes'
    farm.save(owner, 'crops', {'name':'Papa', 'image_source':'inaturalist',
                               'image_url':'https://example.com/photo.jpg'}, cid)
    assert old_path in media.deleted
    assert 'crop_photo_path' not in store.data['records'][cid]


def test_owner_is_checked_before_upload_and_db_failure_cleans_new_object():
    owner, stranger, pid = uuid(), uuid(), uuid()
    store = FakePgStore(owner, {'id':pid, 'owner':owner, 'kind':'plots', 'name':'Finca'})
    media = FakeStorage()
    farm = FarmService(store, media=media)
    with pytest.raises(HTTPException) as exc:
        farm.photo(stranger, pid, b'jpeg')
    assert exc.value.status_code == 404
    assert not media.objects
    store.fail_commit = True
    with pytest.raises(RuntimeError):
        farm.photo(owner, pid, b'jpeg')
    assert not media.objects
    assert media.deleted


def test_replacement_deletes_only_previous_photo_after_success():
    owner, cid = uuid(), uuid()
    store = FakePgStore(owner, {'id':cid, 'owner':owner, 'kind':'crops', 'name':'Cafe'})
    media = FakeStorage()
    farm = FarmService(store, media=media)
    farm.crop_photo(owner, cid, b'first')
    old_path = store.data['records'][cid]['crop_photo_path']
    farm.crop_photo(owner, cid, b'second')
    assert old_path in media.deleted
    assert old_path not in media.objects
    assert farm.crop_photo(owner, cid) == b'second'


def test_storage_http_client_verifies_upload_and_denies_other_record_paths():
    owner, outsider, pid = uuid(), uuid(), uuid()
    objects = {}
    requests = []
    key = 'fake-service-role'

    def handler(request):
        requests.append(request)
        assert request.headers['Authorization'] == f'Bearer {key}'
        assert request.headers['apikey'] == key
        name = request.url.path.split('/storage/v1/object/')[-1]
        if name.startswith('authenticated/'):
            name = name.removeprefix('authenticated/')
        if request.method == 'POST':
            objects[name] = request.content
            return httpx.Response(200, json={'Key': name})
        if request.method == 'GET':
            return httpx.Response(200, content=objects[name])
        if request.method == 'DELETE':
            objects.pop(name, None)
            return httpx.Response(200, json={'message':'ok'})
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        media = PrivatePhotoStorage('https://demo.supabase.co', key, client=client)
        path = media.verified_upload(owner, 'parcelas', pid, b'jpeg-content')
        assert objects[f'{media.bucket}/{path}'] == b'jpeg-content'
        assert media.download(owner, 'parcelas', pid, path) == b'jpeg-content'
        count = len(requests)
        with pytest.raises(ValueError):
            media.download(outsider, 'parcelas', pid, path)
        assert len(requests) == count
        media.delete(owner, 'parcelas', pid, path)
        assert f'{media.bucket}/{path}' not in objects


def test_storage_failed_checksum_removes_untrusted_object():
    owner, cid = uuid(), uuid()
    objects = {}
    def handler(request):
        name = request.url.path.split('/storage/v1/object/')[-1].removeprefix('authenticated/')
        if request.method == 'POST':
            objects[name] = request.content
            return httpx.Response(200)
        if request.method == 'GET':
            return httpx.Response(200, content=b'bad')
        if request.method == 'DELETE':
            objects.pop(name, None)
            return httpx.Response(200)
        return httpx.Response(404)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        media = PrivatePhotoStorage('https://demo.supabase.co', 'secret', client=client)
        with pytest.raises(StorageUnavailable):
            media.verified_upload(owner, 'cultivos', cid, b'right-bytes')
        assert not objects


def test_new_supabase_secret_key_sent_only_in_apikey_not_bearer():
    owner, cid = uuid(), uuid()
    secret_key = 'sb_secret_example_only'
    def handler(request):
        assert request.headers['apikey'] == secret_key
        assert 'authorization' not in request.headers
        return httpx.Response(200, content=b'jpeg-content')
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        media = PrivatePhotoStorage('https://demo.supabase.co', secret_key, client=client)
        photo = f'{owner}/cultivos/{cid}/{uuid()}.jpg'
        assert media.download(owner, 'cultivos', cid, photo) == b'jpeg-content'


def test_plot_without_storage_path_is_not_served_from_database():
    owner, pid = uuid(), uuid()
    store = FakePgStore(owner, {'id':pid, 'owner':owner, 'kind':'plots', 'name':'Parcela',
                                'photo_version':uuid()})
    store.get_photo = lambda u, p: (_ for _ in ()).throw(AssertionError('No debe leer BYTEA'))
    with pytest.raises(HTTPException) as exc:
        FarmService(store, media=FakeStorage()).photo(owner, pid)
    assert exc.value.status_code == 404


def test_bucket_must_be_private_before_using_real_storage():
    responses = [{'id':'agroconecta-private','public': False},
                 {'id':'agroconecta-private','public': True}]
    def handler(request):
        assert request.url.path == '/storage/v1/bucket/agroconecta-private'
        return httpx.Response(200, json=responses.pop(0))
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        media = PrivatePhotoStorage('https://demo.supabase.co', 'sb_secret_demo', client=client)
        media.ensure_private_bucket()
        with pytest.raises(StorageUnavailable, match='PRIVADO'):
            media.ensure_private_bucket()
