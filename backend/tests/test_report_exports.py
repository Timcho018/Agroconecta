"""Validación del Excel real y de los filtros de permisos de Historial y reportes."""
import io
import secrets
import zipfile
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
from main import create_app

NS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def login(client, email):
    password = secrets.token_urlsafe(22)
    assert client.post('/api/auth/register', json={'name': 'Usuario prueba', 'email': email, 'password': password}).status_code == 201
    assert client.post('/api/auth/login', json={'email': email, 'password': password}).status_code == 200


def cells(xml):
    root=ET.fromstring(xml)
    return [''.join(c.itertext()) for c in root.findall('.//x:c',NS)]


def test_export_xlsx_is_auth_private_filtered_and_readable(tmp_path):
    with TestClient(create_app(tmp_path / 'db.json')) as client:
        client.headers['X-Agro-Request'] = '1'
        assert client.get('/api/reports/export.xlsx').status_code == 401
        login(client, 'one@example.invalid')
        p=client.post('/api/plots',json={'name':'Parcela de café','location':'Perené','area':1,'latitude':-10.9,'longitude':-75.1}).json()
        assert client.post('/api/activities',json={'title':'Abonar','date':'2026-10-21','plot_id':p['id'],'category':'Mantenimiento','status':'Completada'}).status_code==201
        assert client.post('/api/activities',json={'title':'Inspección','date':'2026-11-21','plot_id':p['id'],'category':'Inspección','status':'Pendiente'}).status_code==201
        assert client.post('/api/harvests',json={'date':'2026-11-20','plot_id':p['id'],'quantity':42}).status_code==201
        response=client.get('/api/reports/export.xlsx?start=2026-11-01&status=Pendiente')
        assert response.status_code==200,response.text
        assert response.headers['content-type'].startswith('application/vnd.openxmlformats')
        assert response.content[:2]==b'PK'
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            assert z.testzip() is None
            all_xml=['[Content_Types].xml','xl/workbook.xml','xl/styles.xml',
                     'xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml',
                     'xl/worksheets/sheet3.xml','xl/worksheets/sheet4.xml']
            for file in all_xml:
                ET.fromstring(z.read(file))
            activities=' '.join(cells(z.read('xl/worksheets/sheet2.xml')))
            assert 'Inspección' in activities and 'Abonar' not in activities
            harvest=' '.join(cells(z.read('xl/worksheets/sheet3.xml')))
            assert 'Parcela de café' in harvest and '42' in harvest
            assert client.get('/api/reports/export.xlsx?start=2026-12-01&end=2026-11-01').status_code==422
            assert client.get('/api/reports/export.xlsx?plot_id=bad').status_code==404
        client.post('/api/auth/logout')
        login(client,'two@example.invalid')
        response=client.get('/api/reports/export.xlsx')
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            all_sheets=' '.join(z.read(f'xl/worksheets/sheet{i}.xml').decode() for i in range(1,5))
            assert 'Parcela de café' not in all_sheets and 'Inspección' not in all_sheets


def test_export_escapes_formula_like_user_input(tmp_path):
    with TestClient(create_app(tmp_path / 'db.json')) as client:
        client.headers['X-Agro-Request'] = '1'
        login(client, 'formula@example.invalid')
        p=client.post('/api/plots',json={'name':'=SUM(1+1)','location':'Jauja','area':1,'latitude':-11.8,'longitude':-75.2}).json()
        client.post('/api/activities',json={'title':'+cmd','date':'2026-11-15','plot_id':p['id']})
        response=client.get('/api/reports/export.xlsx')
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            sheet=z.read('xl/worksheets/sheet2.xml').decode()
            assert 't="inlineStr"' in sheet
            assert '<f>' not in sheet
            assert '=SUM(1+1)' in sheet and '+cmd' in sheet
