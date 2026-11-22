"""Búsqueda de localidades peruanas para ubicar parcelas sin escribir coordenadas.

Open-Meteo Geocoding devuelve centroides de poblaciones; el usuario puede
ajustar el marcador en el mapa o elegir su GPS antes de guardar la parcela.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
import httpx

from apis.dependencies import current_user

router = APIRouter(prefix='/api/locations', tags=['Ubicaciones'])


@router.get('/search')
async def search_location(name: str = Query(min_length=2, max_length=80), user=Depends(current_user)):
    term = name.strip()
    if len(term) < 2:
        raise HTTPException(422, 'Escribe el nombre de una localidad o distrito.')
    try:
        async with httpx.AsyncClient(timeout=9.0) as client:
            response = await client.get('https://geocoding-api.open-meteo.com/v1/search', params={
                'name': term, 'count': 8, 'language': 'es', 'countryCode': 'PE', 'format': 'json',
            })
            response.raise_for_status()
            found = response.json().get('results', [])
        return [{'name': place['name'],
                 'label': ', '.join(dict.fromkeys(str(part) for part in (
                     place.get('name'), place.get('admin2'), place.get('admin1')) if part)),
                 'latitude': place['latitude'], 'longitude': place['longitude']}
                for place in found if isinstance(place, dict)
                and isinstance(place.get('latitude'), (int, float))
                and isinstance(place.get('longitude'), (int, float))
                and place.get('name')]
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        raise HTTPException(502, 'No pudimos buscar lugares ahora. Prueba con el mapa o el GPS.')
