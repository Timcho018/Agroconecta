"""Galería real de especie: protección de licencias, caché y acceso privado."""
import asyncio
import secrets
import httpx
from fastapi.testclient import TestClient
from main import create_app
from services.crop_catalog import CropCatalog


def test_photo_gallery_excludes_unlicensed_and_uses_cache():
    requests = []

    def handler(request: httpx.Request):
        requests.append(request)
        assert request.url.path == '/v1/observations'
        assert request.url.params['taxon_id'] == '501'
        return httpx.Response(200, json={'results': [
            {'id': 12, 'photos': [
                {'url': 'https://static.inaturalist.org/photos/111/square.jpg',
                 'license_code': 'cc-by', 'attribution': '© Fotógrafa A'},
                {'url': 'https://static.inaturalist.org/photos/222/square.jpg',
                 'license_code': 'all-rights-reserved', 'attribution': '© Fotógrafo B'},
                {'url': 'https://evil.invalid/potato.jpg', 'license_code': 'cc-by'},
            ]},
            {'id': 13, 'photos': [
                {'url': 'https://static.inaturalist.org/photos/333/square.jpg',
                 'license_code': 'cc0', 'attribution': 'CC0'},
            ]},
        ]})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            catalog = CropCatalog(client=client)
            photos = await catalog.photos(501)
            assert len(photos) == 2
            assert photos[0]['url'].endswith('/medium.jpg')
            assert photos[0]['credit'] == '© Fotógrafa A'
            assert photos[0]['observation_url'] == 'https://www.inaturalist.org/observations/12'
            assert photos[1]['license'] == 'cc0'
            assert await catalog.photos(501) == photos
            assert len(requests) == 1
    asyncio.run(check())


def test_gallery_endpoint_authenticated_and_no_genesys(tmp_path):
    with TestClient(create_app(tmp_path / 'data.json')) as client:
        assert client.get('/api/catalog/photos', params={'taxon_id': 1}).status_code == 401
        client.headers['X-Agro-Request'] = '1'
        account = {'name': 'Agricultor', 'email': 'fotos@test.invalid',
                   'password': secrets.token_urlsafe(24)}
        assert client.post('/api/auth/register', json=account).status_code == 201
        assert client.post('/api/auth/login', json={k: account[k] for k in ('email', 'password')}).status_code == 200
        assert client.get('/api/catalog/varieties', params={'crop': 'Papa'}).status_code == 404

        class Stub:
            async def close(self): pass
            async def photos(self, taxon_id):
                assert taxon_id == 501
                return [{'url': 'https://static.inaturalist.org/photos/1/medium.jpg',
                         'credit': '© Fotógrafa', 'license': 'cc-by',
                         'observation_url': 'https://www.inaturalist.org/observations/12'}]

        client.app.state.crop_catalog = Stub()
        response = client.get('/api/catalog/photos', params={'taxon_id': 501})
        assert response.status_code == 200
        assert response.json()[0]['license'] == 'cc-by'
        assert client.get('/api/catalog/photos', params={'taxon_id': -3}).status_code == 422
