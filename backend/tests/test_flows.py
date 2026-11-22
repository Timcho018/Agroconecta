import io
import json
import secrets
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from main import create_app
from repositories.store import JsonStore


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "data.json")) as client:
        client.headers["X-Agro-Request"] = "1"
        yield client


def account(client, email="test@example.invalid"):
    payload = {"name": "Persona de prueba", "email": email, "password": secrets.token_urlsafe(24)}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    response = client.post("/api/auth/login", json={k: payload[k] for k in ("email", "password")})
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"]
    return payload


def plot(client):
    response = client.post("/api/plots", json={"name": "Parcela de prueba", "location": "Perené", "area": 2.5,
                                             "latitude": -10.95, "longitude": -75.23})
    assert response.status_code == 201, response.text
    return response.json()


def test_auth_isolation_and_logout(client):
    assert client.get("/api/plots").status_code == 401
    first = account(client)
    owned = plot(client)
    assert "hash" not in client.get("/api/auth/me").json()
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    account(client, "second@example.invalid")
    assert client.get("/api/plots").json() == []
    assert client.put("/api/plots/" + owned["id"], json={k: owned[k] for k in ("name", "location", "area", "latitude", "longitude")}).status_code == 404
    assert client.post("/api/activities", json={"title": "Ajena", "date": "2026-11-07", "plot_id": owned["id"]}).status_code == 404
    raw = json.dumps(client.app.state.farm.store.read())
    assert first["password"] not in raw
    assert client.cookies.get("agro_session") not in raw


def test_validation_origin_and_throttle(client):
    assert client.post("/api/auth/register", json={}, headers={"Origin": "https://untrusted.invalid"}).status_code == 403
    assert client.post("/api/auth/register", json={"name": "Uno", "email": "bad", "password": "short"}).status_code == 422
    payload = {"email": "missing@example.invalid", "password": "invalid-but-long-enough"}
    for _ in range(10):
        assert client.post("/api/auth/login", json=payload).status_code == 401
    assert client.post("/api/auth/login", json=payload).status_code == 429


def test_complete_farm_flow(client):
    account(client)
    crop = client.post("/api/crops", json={"name": "Café", "variety": "Caturra", "cycle_days": 365}).json()
    p = plot(client)
    values = {k: p[k] for k in ("name", "location", "area", "latitude", "longitude")}
    values["crop_id"] = crop["id"]
    assert client.put("/api/plots/" + p["id"], json=values).status_code == 200
    task = {"title": "Inspeccionar parcela", "date": "2026-11-07", "plot_id": p["id"], "category": "Inspección"}
    created = client.post("/api/activities", json=task).json()
    assert client.put("/api/activities/" + created["id"], json=dict(task, status="Completada")).status_code == 200
    lot = client.post("/api/harvests", json={"plot_id": p["id"], "date": "2026-11-07", "quantity": 120}).json()
    path = "/api/harvests/" + lot["id"] + "/stages"
    assert client.post(path, json={"stage": "Secado", "quantity": 100}).status_code == 409
    assert client.post(path, json={"stage": "Procesamiento", "quantity": 121}).status_code == 422
    for stage, quantity in [("Procesamiento", 110), ("Secado", 80), ("Almacenado", 75), ("Cerrado", 75)]:
        assert client.post(path, json={"stage": stage, "quantity": quantity}).status_code == 200
    assert client.post(path, json={"stage": "Cerrado", "quantity": 75}).status_code == 409
    summary = client.get("/api/summary").json()
    assert summary["harvest_kg"] == 120 and summary["current_kg"] == 75 and summary["completed"] == 1
    assert len(client.get("/api/history").json()) == 10
    assert client.put("/api/plots/" + p["id"], json=dict(values, active=False)).status_code == 200
    assert client.post("/api/activities", json=task).status_code == 409


def test_photo_validation_and_private_access(client):
    account(client)
    p = plot(client)
    path = "/api/plots/" + p["id"] + "/photo"
    assert client.post(path, files={"file": ("bad.jpg", b"not an image", "image/jpeg")}).status_code == 422
    image = io.BytesIO()
    Image.new("RGB", (20, 20), "green").save(image, "PNG")
    assert client.post(path, files={"file": ("test.png", image.getvalue(), "image/png")}).status_code == 200
    photo_response = client.get(path)
    assert photo_response.headers['content-type'] == 'image/jpeg'
    assert photo_response.headers['cache-control'].startswith('private')
    assert photo_response.headers['vary'] == 'Cookie'
    assert client.get('/api/plots').headers['cache-control'] == 'no-store' 
    account(client, "other@example.invalid")
    assert client.get(path).status_code == 404


def test_json_restart_rollback_and_concurrency(tmp_path):
    path = tmp_path / "store.json"
    store = JsonStore(path)
    def increment(_):
        store.transaction(lambda d: d.update(counter=d.get("counter", 0) + 1))
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(increment, range(20)))
    assert JsonStore(path).read()["counter"] == 20
    def fail(data):
        data["counter"] = -1
        raise ValueError("test")
    with pytest.raises(ValueError):
        store.transaction(fail)
    assert store.read()["counter"] == 20


def test_weather_failure_never_fabricates(client, monkeypatch):
    import httpx
    account(client)
    p = plot(client)
    async def fail(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(httpx.AsyncClient, "get", fail)
    assert client.get("/api/weather/" + p["id"]).status_code == 502
    response = client.get("/api/alerts").json()
    assert response["items"] == [] and response["unavailable"] == []


def test_crop_deactivation_keeps_existing_links_and_blocks_new_ones(client):
    account(client)
    crop = client.post('/api/crops', json={'name': 'Café'}).json()
    payload = {'name': 'Parcela uno', 'location': 'Perené', 'area': 1, 'latitude': -10, 'longitude': -75, 'crop_id': crop['id']}
    existing = client.post('/api/plots', json=payload).json()
    assert client.put('/api/crops/' + crop['id'], json={'name': 'Café', 'active': False}).json()['active'] is False
    assert client.get('/api/plots/' + existing['id']).json()['crop_id'] == crop['id']
    assert client.put('/api/plots/' + existing['id'], json=dict(payload, name='Parcela editada')).status_code == 200
    assert client.post('/api/plots', json=dict(payload, name='Parcela nueva')).status_code == 409
    assert client.put('/api/crops/' + crop['id'], json={'name': 'Café', 'active': True}).json()['active'] is True
    assert client.post('/api/plots', json=dict(payload, name='Parcela nueva')).status_code == 201


def test_invalid_quantities_and_foreign_resources_are_rejected(client):
    account(client)
    p = plot(client)
    lot = client.post('/api/harvests', json={'plot_id': p['id'], 'date': '2026-11-01', 'quantity': 10}).json()
    path = '/api/harvests/' + lot['id'] + '/stages'
    assert client.post('/api/harvests', json={'plot_id': p['id'], 'date': '2026-11-01', 'quantity': -1}).status_code == 422
    assert client.post(path, json={'stage': 'Procesamiento', 'quantity': -1}).status_code == 422
    assert client.post(path, json={'stage': 'Almacenado', 'quantity': 5}).status_code == 409
    account(client, 'foreign@example.invalid')
    assert client.get('/api/plots/' + p['id']).status_code == 404
    assert client.get('/api/plots/' + p['id'] + '/photo').status_code == 404
    assert client.post(path, json={'stage': 'Procesamiento', 'quantity': 5}).status_code == 404


def test_every_protected_resource_requires_a_session(client):
    for resource in ('plots', 'crops', 'activities', 'templates', 'harvests', 'history', 'summary', 'alerts', 'weather/missing'):
        assert client.get('/api/' + resource).status_code == 401, resource
    for kind in ('plots', 'crops', 'activities', 'templates', 'harvests'):
        assert client.post('/api/' + kind, json={}).status_code == 401
        assert client.put('/api/' + kind + '/missing', json={}).status_code == 401
    assert client.get('/api/plots/missing/photo').status_code == 401
    assert client.post('/api/plots/missing/photo', files={'file': ('photo.png', b'invalid', 'image/png')}).status_code == 401
    assert client.post('/api/harvests/missing/stages', json={'stage': 'Procesamiento', 'quantity': 1}).status_code == 401


def test_all_record_types_and_links_are_isolated(client):
    account(client)
    p = plot(client)
    payloads = {
        'crops': {'name': 'Cultivo privado'},
        'templates': {'name': 'Plantilla privada', 'title': 'Revisar cultivo'},
        'activities': {'title': 'Labor privada', 'date': '2026-11-01', 'plot_id': p['id']},
        'harvests': {'plot_id': p['id'], 'date': '2026-11-01', 'quantity': 10},
    }
    records = {}
    for kind, payload in payloads.items():
        response = client.post('/api/' + kind, json=payload)
        assert response.status_code == 201
        records[kind] = response.json()
    payloads['plots'] = {key: p[key] for key in ('name', 'location', 'area', 'latitude', 'longitude')}
    records['plots'] = p
    account(client, 'isolation-b@example.invalid')
    for kind, record in records.items():
        assert client.get('/api/' + kind).json() == []
        path = '/api/' + kind + '/' + record['id']
        assert client.get(path).status_code == 404
        assert client.put(path, json=payloads[kind]).status_code == 404
    assert client.get('/api/history').json() == []
    assert client.get('/api/summary').json() == dict(active_plots=0, area=0, pending=0, harvest_kg=0, current_kg=0, completed=0)
    assert client.get('/api/alerts').json()['items'] == []
    assert client.get('/api/weather/' + p['id']).status_code == 404
    assert client.post('/api/plots', json=dict(payloads['plots'], crop_id=records['crops']['id'])).status_code == 404
    assert client.post('/api/activities', json=payloads['activities']).status_code == 404
    assert client.post('/api/harvests', json=payloads['harvests']).status_code == 404
    assert client.post('/api/plots/' + p['id'] + '/photo', files={'file': ('test.png', b'invalid', 'image/png')}).status_code == 404


def test_invalid_references_and_physical_values(client):
    account(client)
    p = plot(client)
    values = {key: p[key] for key in ('name', 'location', 'area', 'latitude', 'longitude')}
    assert client.post('/api/plots', json=dict(values, crop_id='missing')).status_code == 404
    assert client.post('/api/activities', json={'title': 'Labor', 'date': '2026-11-01', 'plot_id': 'missing'}).status_code == 404
    assert client.post('/api/harvests', json={'date': '2026-11-01', 'quantity': 10, 'plot_id': 'missing'}).status_code == 404
    for invalid in ({'area': 0}, {'area': -1}, {'latitude': 91}, {'longitude': -181}):
        assert client.put('/api/plots/' + p['id'], json=dict(values, **invalid)).status_code == 422
    assert client.get('/api/plots/' + p['id']).json()['area'] == p['area']


def test_session_expiry_and_logout_revoke_old_cookie(client, monkeypatch):
    import services.auth as auth
    account(client)
    token = client.cookies.get('agro_session')
    assert client.post('/api/auth/logout').status_code == 204
    client.cookies.set('agro_session', token)
    assert client.get('/api/plots').status_code == 401
    client.cookies.clear()
    account(client, 'expiry@example.invalid')
    current_time = auth.time.time()
    monkeypatch.setattr(auth.time, 'time', lambda: current_time + auth.SESSION_SECONDS + 1)
    assert client.get('/api/plots').status_code == 401


def test_alert_review_is_private_reversible_and_survives_json_reload(client, monkeypatch):
    """Un aviso vigente puede revisarse, pero otra cuenta no puede modificarlo."""
    account(client)
    p = plot(client)
    task = client.post('/api/activities', json={
        'title': 'Inspeccionar cafetal', 'plot_id': p['id'], 'date': '2020-01-01'
    }).json()

    async def clear_forecast(_):
        return {'days': []}

    monkeypatch.setattr(client.app.state.weather, 'forecast', clear_forecast)
    alert_id = 'task-' + task['id']
    response = client.get('/api/alerts')
    assert response.status_code == 200
    assert response.json()['items'][0]['id'] == alert_id
    assert response.json()['items'][0]['reviewed'] is False

    path = '/api/alerts/' + alert_id + '/review'
    assert client.put(path, json={'reviewed': True}).status_code == 200
    assert client.get('/api/alerts').json()['items'][0]['reviewed'] is True
    assert JsonStore(client.app.state.farm.store.path).read()['alert_reviews']

    account(client, 'second-alert@example.invalid')
    assert client.get('/api/alerts').json()['items'] == []
    assert client.put(path, json={'reviewed': False}).status_code == 404
    assert client.put('/api/alerts/random-alert/review', json={'reviewed': True}).status_code == 404
    assert client.post('/api/auth/logout').status_code == 204
    assert client.put(path, json={'reviewed': False}).status_code == 401


def test_forecast_alert_only_for_relevant_lot_and_disappears_when_closed(client, monkeypatch):
    """El clima se cruza con actividades y lotes actuales; los avisos no son inventados."""
    from datetime import datetime, timedelta, timezone

    account(client)
    p = plot(client)
    lot = client.post('/api/harvests', json={
        'plot_id': p['id'], 'date': '2020-01-01', 'quantity': 100
    }).json()
    stages = '/api/harvests/' + lot['id'] + '/stages'
    assert client.post(stages, json={'stage': 'Procesamiento', 'quantity': 90}).status_code == 200
    assert client.post(stages, json={'stage': 'Secado', 'quantity': 80}).status_code == 200

    local_today = datetime.now(timezone(timedelta(hours=-5))).date().isoformat()

    async def rainy(_):
        return {'days': [{'date': local_today, 'rain_probability': 85}]}

    monkeypatch.setattr(client.app.state.weather, 'forecast', rainy)
    items = client.get('/api/alerts').json()['items']
    assert len(items) == 1
    assert lot['code'] in items[0]['detail']
    assert items[0]['type'] == 'Pronóstico'

    assert client.post(stages, json={'stage': 'Almacenado', 'quantity': 75}).status_code == 200
    assert client.post(stages, json={'stage': 'Cerrado', 'quantity': 75}).status_code == 200
    assert client.get('/api/alerts').json()['items'] == []


def test_local_angular_proxy_origin_is_accepted(tmp_path):
    """Replicate Angular/Vite proxy requests; different local ports remain usable."""
    from fastapi.testclient import TestClient

    with TestClient(create_app(tmp_path / "origin-check.json")) as browser:
        payload = {"name": "Persona de prueba", "email": "origin@example.invalid", "password": secrets.token_urlsafe(24)}
        for origin in ("http://localhost:4200", "http://127.0.0.1:4200", "http://localhost:4201"):
            # Bad input must reach the route (422), not be rejected by origin policy (403).
            response = browser.post("/api/auth/register", json={}, headers={"Origin": origin, "X-Agro-Request": "1"})
            assert response.status_code == 422, (origin, response.text)

        response = browser.post("/api/auth/register", json=payload, headers={"Origin": "http://localhost:4200", "X-Agro-Request": "1"})
        assert response.status_code == 201, response.text
        login = browser.post("/api/auth/login", json={"email": payload["email"], "password": payload["password"]}, headers={"Origin": "http://localhost:4200", "X-Agro-Request": "1"})
        assert login.status_code == 200, login.text
        assert browser.get("/api/auth/me").status_code == 200

        blocked = browser.post("/api/auth/logout", json={}, headers={"Origin": "https://malicious.example", "X-Agro-Request": "1"})
        assert blocked.status_code == 403
        spoofed = browser.post("/api/auth/logout", json={}, headers={"Origin": "http://localhost.evil.invalid:4200", "X-Agro-Request": "1"})
        assert spoofed.status_code == 403
        missing_header = browser.post("/api/auth/logout", json={}, headers={"Origin": "http://localhost:4200"})
        assert missing_header.status_code == 403
        assert "cabecera" in missing_header.json()["detail"].lower()


def test_location_search_requires_login(client):
    assert client.get('/api/locations/search?name=Satipo').status_code == 401


def test_location_search_with_city_result_is_private_and_parameterized(client, monkeypatch):
    import httpx
    account(client)
    sent = []
    async def fake_get(self, url, **kwargs):
        sent.append((url, kwargs))
        return httpx.Response(200, json={'results': [
            {'name': 'Perené', 'admin2': 'Chanchamayo', 'admin1': 'Junín',
             'latitude': -10.94, 'longitude': -75.22},
        ]}, request=httpx.Request('GET', url))
    monkeypatch.setattr(httpx.AsyncClient, 'get', fake_get)
    res = client.get('/api/locations/search?name=Peren%C3%A9')
    assert res.status_code == 200
    assert res.json() == [{'name':'Perené', 'label':'Perené, Chanchamayo, Junín',
                           'latitude':-10.94, 'longitude':-75.22}]
    assert sent[0][1]['params']['countryCode'] == 'PE'
    assert client.get('/api/locations/search?name=X').status_code == 422


def test_alerts_do_not_contact_weather_when_there_is_nothing_to_warn(client, monkeypatch):
    import httpx
    account(client, 'only-plot@example.invalid')
    plot(client)
    calls = []
    async def fail_if_called(*args, **kwargs):
        calls.append(args)
        raise httpx.ConnectError('No weather necessary')
    monkeypatch.setattr(httpx.AsyncClient, 'get', fail_if_called)
    response = client.get('/api/alerts')
    assert response.status_code == 200
    assert response.json()['items'] == []
    assert response.json()['unavailable'] == []
    assert calls == []


def test_delete_only_own_activities_and_keep_audit(client):
    account(client)
    owner_plot = plot(client)
    values = {"title": "Limpieza de campo", "date": "2026-11-21", "plot_id": owner_plot["id"], "category": "Mantenimiento"}
    created = client.post('/api/activities', json=values).json()
    assert client.get('/api/summary').json()['pending'] == 1
    assert client.delete('/api/activities/' + created['id']).json() == {'deleted': True, 'id': created['id']}
    assert client.get('/api/activities').json() == []
    assert client.get('/api/summary').json()['pending'] == 0
    assert client.delete('/api/activities/' + created['id']).status_code == 404
    assert client.get('/api/history').json()[0]['action'] == 'Eliminado'
    assert client.delete('/api/plots/' + owner_plot['id']).status_code == 405
    other_task = client.post('/api/activities', json=values).json()
    account(client, 'otro@example.invalid')
    assert client.delete('/api/activities/' + other_task['id']).status_code == 404
    assert client.get('/api/activities').json() == []


def test_delete_template_removes_only_owned_template_and_preserves_scheduled_tasks(client):
    account(client)
    parcel = plot(client)
    template = client.post('/api/templates', json={'name': 'Riego semanal', 'title': 'Regar cultivo', 'category': 'Mantenimiento'}).json()
    activity = client.post('/api/activities', json={'title': 'Regar cultivo', 'date': '2026-11-21', 'plot_id': parcel['id']}).json()
    # Una plantilla no debe eliminar la actividad que ya se programó con ella.
    assert client.delete('/api/templates/' + template['id']).json() == {'deleted': True, 'id': template['id']}
    assert client.get('/api/templates').json() == []
    assert client.get('/api/activities/' + activity['id']).status_code == 200
    assert any(entry['action'] == 'Eliminado' and entry['record_id'] == template['id']
               for entry in client.get('/api/history').json())
    assert client.delete('/api/templates/' + template['id']).status_code == 404


def test_delete_template_requires_session_and_correct_owner(client):
    account(client, 'owner-template@example.invalid')
    template = client.post('/api/templates', json={'name': 'Abonar campo', 'title': 'Abonar cultivo'}).json()
    client.post('/api/auth/logout')
    assert client.delete('/api/templates/' + template['id']).status_code == 401
    account(client, 'another-template@example.invalid')
    assert client.delete('/api/templates/' + template['id']).status_code == 404
    assert client.get('/api/templates').json() == []
