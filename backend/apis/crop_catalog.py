"""Pasarela autenticada para buscar especies vegetales reales."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from apis.dependencies import current_user


router = APIRouter(prefix='/api/catalog', tags=['Catálogo botánico'])

@router.get('/crops')
async def search_crops(request: Request, q: str = Query(min_length=2, max_length=80), user=Depends(current_user)):
    try:
        return await request.app.state.crop_catalog.search(q)
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(502, 'No se pudo consultar iNaturalist. Puedes escribir el cultivo manualmente y añadir una foto.')


@router.get('/photos')
async def species_photos(request: Request,
                         taxon_id: int = Query(ge=1, le=2147483647),
                         user=Depends(current_user)):
    """Fotografías reales de observaciones de la especie, con licencia y autor."""
    try:
        return await request.app.state.crop_catalog.photos(taxon_id)
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(502, 'No se pudieron consultar las fotografías de iNaturalist. Puedes subir una foto propia.')
