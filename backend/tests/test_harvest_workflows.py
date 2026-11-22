"""Cosechas con etapas por lote y plantillas reutilizables (sin migración SQL)."""
import secrets
from fastapi.testclient import TestClient
from main import create_app
from repositories.postgres_store import PostgresStore


def client_for(tmp_path):
    return TestClient(create_app(tmp_path/'workflows.json'))


def setup(client, email='farm-1@example.invalid'):
    client.headers['X-Agro-Request'] = '1'
    credentials={'name':'Agricultor','email':email,'password':secrets.token_urlsafe(24)}
    assert client.post('/api/auth/register',json=credentials).status_code==201
    assert client.post('/api/auth/login',json={k:credentials[k] for k in ('email','password')}).status_code==200
    return client.post('/api/plots',json={'name':'Parcela de prueba','location':'Huancayo','area':2,
        'latitude':-12.1,'longitude':-75.2}).json()


def create_template(c):
    response=c.post('/api/templates',json={'name':'Proceso cacao','title':'Proceso cacao',
        'purpose':'harvest','steps':['Fermentación','Secado','Almacenamiento'],
        'category':'Poscosecha'})
    assert response.status_code==201,response.text
    return response.json()


def test_custom_process_full_flow_and_template_snapshot(tmp_path):
    with client_for(tmp_path) as c:
        plot=setup(c)
        tpl=create_template(c)
        response=c.post('/api/harvests',json={'plot_id':plot['id'],'date':'2026-11-01',
            'quantity':500,'process_template_id':tpl['id']})
        assert response.status_code==201,response.text
        lot=response.json();assert lot['process_steps']==['Cosechado','Fermentación','Secado','Almacenamiento','Cerrado']
        assert lot['stage']=='Cosechado' and len(lot['stages'])==1
        path='/api/harvests/'+lot['id']+'/stages'
        assert c.post(path,json={'stage':'Secado','quantity':490}).status_code==409
        assert c.post(path,json={'stage':'Fermentación','quantity':501}).status_code==422
        assert c.post(path,json={'stage':'Fermentación','quantity':480,'notes':'Fermentado'}).status_code==200
        assert c.post(path,json={'stage':'Secado','quantity':390}).status_code==200
        assert c.post(path,json={'stage':'Almacenamiento','quantity':385}).status_code==200
        assert c.delete('/api/templates/'+tpl['id']).status_code==200
        assert c.post(path,json={'stage':'Cerrado','quantity':385}).status_code==200
        assert c.post(path,json={'stage':'Cerrado','quantity':385}).status_code==409
        saved=c.get('/api/harvests/'+lot['id']).json()
        assert saved['stage']=='Cerrado' and saved['current_quantity']==385
        assert saved['process_steps'][1]=='Fermentación' and len(saved['stages'])==5
        assert saved['stage_history']==saved['stages']
        assert not c.get('/api/templates').json()


def test_manual_stages_and_invalid_names(tmp_path):
    with client_for(tmp_path) as c:
        plot=setup(c)
        base={'plot_id':plot['id'],'date':'2026-11-01','quantity':200}
        assert c.post('/api/harvests',json=dict(base,process_steps=['Secado','secado'])).status_code==422
        assert c.post('/api/harvests',json=dict(base,process_steps=['Cerrado'])).status_code==422
        assert c.post('/api/harvests',json=dict(base,process_steps=[''])).status_code==422
        created=c.post('/api/harvests',json=dict(base,process_steps=['Selección','Lavado'])).json()
        assert created['stage']=='Cosechado'
        path='/api/harvests/'+created['id']+'/stages'
        assert c.post(path,json={'stage':'Lavado','quantity':198}).status_code==409
        assert c.post(path,json={'stage':'Selección','quantity':198}).status_code==200
        assert c.post(path,json={'stage':'Lavado','quantity':190}).status_code==200
        assert c.post(path,json={'stage':'Cerrado','quantity':190}).status_code==200
        direct=c.post('/api/harvests',json=dict(base,process_steps=[])).json()
        assert direct['process_steps']==['Cosechado','Cerrado']
        assert c.post('/api/harvests/'+direct['id']+'/stages',json={'stage':'Cerrado','quantity':200}).status_code==200


def test_only_owner_may_reuse_template(tmp_path):
    with client_for(tmp_path) as c:
        p=setup(c)
        template=create_template(c)
        # Switch user; template is no longer visible and can't be used to create a lot.
        second=setup(c,'farm-2@example.invalid')
        response=c.post('/api/harvests',json={'plot_id':second['id'],'date':'2026-11-01',
            'quantity':10,'process_template_id':template['id']})
        assert response.status_code==404
        assert c.get('/api/templates').json()==[]


def test_legacy_process_still_supported(tmp_path):
    with client_for(tmp_path) as c:
        p=setup(c)
        lot=c.post('/api/harvests',json={'plot_id':p['id'],'date':'2026-11-01','quantity':50}).json()
        assert lot['process_mode']=='legacy'
        assert c.post('/api/harvests/'+lot['id']+'/stages',json={'stage':'Procesamiento','quantity':45}).status_code==200


def test_postgres_custom_mode_uses_existing_json_columns():
    record={'id':'a','owner':'b','kind':'harvests','stage':'Fermentación',
        'process_mode':'custom','stage_history':[{'stage':'Cosechado','quantity':10},
        {'stage':'Fermentación','quantity':9}]}
    result=PostgresStore._decode_record('harvests','a','b',record)
    assert len(result['stages'])==2 and result['stages'][-1]['stage']=='Fermentación'
