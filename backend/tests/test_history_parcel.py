"""History and report filtering must preserve a parcel after activity deletion."""
from fastapi.testclient import TestClient
from main import create_app
from services.report_export import filtered_records


def test_deleted_activity_keeps_parcel_association_in_history_and_export(tmp_path):
    with TestClient(create_app(tmp_path / 'state.json')) as client:
        client.headers['X-Agro-Request'] = '1'
        email = 'plot-history@example.invalid'
        password = 'OnlyForTests_12345!'
        assert client.post('/api/auth/register', json={'name':'Carla Campo','email':email,'password':password}).status_code == 201
        assert client.post('/api/auth/login', json={'email':email,'password':password}).status_code == 200
        plot = client.post('/api/plots', json={'name':'La Loma', 'location':'Junín', 'area':2, 'latitude':-11.9, 'longitude':-75.2}).json()
        activity = client.post('/api/activities', json={'title':'Preparar suelo', 'date':'2026-11-20', 'plot_id':plot['id']}).json()
        assert client.delete(f"/api/activities/{activity['id']}").status_code == 200
        events = client.get('/api/history').json()
        own_events = [e for e in events if e['record_id'] == activity['id']]
        assert own_events and {e['action'] for e in own_events} >= {'Registrado','Eliminado'}
        assert all(e['plot_id'] == plot['id'] for e in own_events)
        farm = client.app.state.farm
        owner = client.get('/api/auth/me').json()['id']
        _, _, filtered, _ = filtered_records(farm, owner, plot_id=plot['id'])
        assert {e['action'] for e in filtered if e['record_id'] == activity['id']} >= {'Registrado','Eliminado'}
        assert client.get('/api/reports/export.xlsx', params={'plot_id': plot['id']}).status_code == 200
