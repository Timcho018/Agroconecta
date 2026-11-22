import io
import secrets

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from main import create_app
from services.crop_catalog import CropCatalog, clean_photo


def test_clean_photo_requires_reusable_license_and_trusted_host():
    valid = {'url': 'https://static.inaturalist.org/photos/9876/square.jpg',
             'license_code':'cc-by','attribution':'© Author'}
    photo = clean_photo(valid)
    assert photo['url'].endswith('medium.jpg')
    assert photo['license'] == 'cc-by'
    assert not clean_photo(dict(valid, url='https://unsafe.example.com/p.jpg'))['url']
    assert not clean_photo(dict(valid, license_code='all-rights-reserved'))['url']


def test_real_taxa_response_shape_and_cache():
    import asyncio
    count = []
    def handler(request: httpx.Request):
        count.append(request)
        assert request.url.path == '/v1/taxa/autocomplete'
        assert request.url.params['q'] == 'Solanum tuberosum'
        return httpx.Response(200, json={'results':[
            {'id':1,'name':'Solanum tuberosum','iconic_taxon_name':'Plantae','rank':'species',
             'preferred_common_name':'Potato', 'default_photo':{
                 'url':'https://static.inaturalist.org/photos/1/square.jpg',
                 'license_code':'cc-by','attribution':'© Test'}},
            {'id':2,'name':'Animalia test','iconic_taxon_name':'Animalia','rank':'species'},
        ]})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            cat=CropCatalog(client=client)
            result=await cat.search('papa')
            assert len(result)==1
            assert result[0]['name']=='Papa'
            assert result[0]['image_url'].endswith('/medium.jpg')
            assert result[0]['image_credit']=='© Test'
            assert await cat.search('papa')==result
            assert len(count)==1
    asyncio.run(check())


def test_crop_upload_persists_without_sql_migration_and_is_private(tmp_path):
    with TestClient(create_app(tmp_path/'data.json')) as client:
        client.headers['X-Agro-Request']='1'
        account={'name':'Agricultor','email':'uno@test.invalid','password':secrets.token_urlsafe(24)}
        assert client.post('/api/auth/register',json=account).status_code==201
        assert client.post('/api/auth/login',json={k:account[k] for k in ('email','password')}).status_code==200
        photo='https://static.inaturalist.org/photos/1/medium.jpg'
        body={'name':'Papa','image_source':'inaturalist','image_url':photo,
              'image_taxon_id':1,'image_license':'cc-by','image_credit':'© Test'}
        response=client.post('/api/crops',json=body)
        assert response.status_code==201,response.text
        record=response.json();crop_id=record['id']
        assert record['image_url']==photo
        assert client.get('/api/crops/'+crop_id+'/photo').status_code==404
        image=io.BytesIO();Image.new('RGB',(80,80),'green').save(image,'PNG')
        url='/api/crops/'+crop_id+'/photo'
        r=client.post(url,files={'file':('personal.png',image.getvalue(),'image/png')})
        assert r.status_code==200,r.text
        assert r.json()['image_source']=='custom'
        assert r.json()['crop_photo_version']
        assert 'crop_photo_b64' not in str(client.get('/api/crops').json())
        assert client.get(url).headers['content-type']=='image/jpeg'
        assert client.put('/api/crops/'+crop_id,json={'name':'Papa amarilla','image_source':'custom'}).status_code==200
        assert client.get(url).status_code==200
        assert client.put('/api/crops/'+crop_id,json=body).status_code==200
        assert client.get(url).status_code==404
        assert client.post('/api/crops',json={'name':'Dato malo','image_url':'https://bad.site/image.jpg'}).status_code==422
        client.post('/api/auth/logout')
        assert client.get(url).status_code==401


def test_catalog_endpoint_is_authenticated_and_returns_service_results(tmp_path):
    with TestClient(create_app(tmp_path/'data.json')) as client:
        r=client.get('/api/catalog/crops',params={'q':'papa'})
        assert r.status_code==401
        client.headers['X-Agro-Request']='1'
        account={'name':'Agricultor','email':'dos@test.invalid','password':secrets.token_urlsafe(24)}
        assert client.post('/api/auth/register',json=account).status_code==201
        assert client.post('/api/auth/login',json={k:account[k] for k in ('email','password')}).status_code==200
        class Stub:
            async def close(self):
                pass
            async def search(self, q):
                assert q=='papa'
                return [{'name':'Papa','scientific_name':'Solanum tuberosum','image_url':'https://static.inaturalist.org/photos/1/medium.jpg','id':1,'image_credit':'© Test','image_license':'cc-by'}]
        client.app.state.crop_catalog=Stub()
        r=client.get('/api/catalog/crops',params={'q':'papa'})
        assert r.status_code==200
        assert r.json()[0]['scientific_name']=='Solanum tuberosum'
        assert client.get('/api/catalog/crops',params={'q':'x'}).status_code==422


def test_cacao_partial_word_returns_taxon_and_reuses_cache():
    """Buscar «caca» debe dar los mismos resultados que «cacao», sin otra petición."""
    import asyncio
    requests = []

    def handler(request: httpx.Request):
        requests.append(str(request.url))
        assert request.url.params['q'] == 'Theobroma cacao'
        return httpx.Response(200, json={'results': [
            {'id': 25, 'name': 'Theobroma cacao', 'rank': 'species',
             'iconic_taxon_name': 'Plantae', 'preferred_common_name': 'Cacao',
             'default_photo': {'url': 'https://static.inaturalist.org/photos/25/square.jpg',
                               'license_code': 'cc-by', 'attribution': '© Autor'}},
        ]})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            catalog = CropCatalog(client=client)
            partial = await catalog.search('caca')
            complete = await catalog.search('cacao')
            assert partial == complete
            assert partial[0]['name'] == 'Cacao'
            assert partial[0]['image_url'].endswith('/medium.jpg')
            assert len(requests) == 1

    asyncio.run(check())
