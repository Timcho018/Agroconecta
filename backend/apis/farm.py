import io
import warnings
from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, Query
from datetime import date
from services.report_export import make_report
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool
from apis.dependencies import current_user
from schemas.domain import MODELS, Stage

router = APIRouter(prefix="/api", tags=["Finca"])
Image.MAX_IMAGE_PIXELS = 20_000_000


@router.get("/summary")
def summary(request: Request, user=Depends(current_user)):
    return request.app.state.farm.summary(user["id"])


@router.get('/reports/export.xlsx')
def export_report(request: Request, user=Depends(current_user),
                  start: date | None = None, end: date | None = None,
                  plot_id: str = Query('', max_length=100),
                  status: str = Query('', max_length=30),
                  q: str = Query('', max_length=120)):
    """Exporta únicamente datos de la cuenta autenticada, filtrados por el servidor."""
    if start and end and start > end:
        raise HTTPException(422, 'La fecha inicial no puede ser posterior a la final.')
    if status and status not in ('Pendiente','En curso','Completada','Cancelada'):
        raise HTTPException(422, 'Estado no válido.')
    if plot_id and not any(p['id'] == plot_id for p in request.app.state.farm.list(user['id'], 'plots')):
        raise HTTPException(404, 'Parcela no encontrada.')
    content = make_report(request.app.state.farm, user['id'],
                          str(start) if start else '', str(end) if end else '',
                          plot_id, status, q)
    return Response(content, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition':'attachment; filename="agroconecta-reporte.xlsx"'})


@router.get("/history")
def history(request: Request, user=Depends(current_user)):
    return request.app.state.farm.history(user["id"])


@router.get("/weather/{plot_id}")
async def weather(plot_id: str, request: Request, user=Depends(current_user)):
    plot = request.app.state.farm.get(user["id"], "plots", plot_id)
    return await request.app.state.weather.forecast(plot)


@router.get("/alerts")
async def alerts(request: Request, user=Depends(current_user)):
    return await request.app.state.weather.alerts(request.app.state.farm, user["id"])




class AlertReview(BaseModel):
    reviewed: bool


@router.put("/alerts/{alert_id}/review")
async def review_alert(alert_id: str, payload: AlertReview, request: Request, user=Depends(current_user)):
    return await request.app.state.weather.review(request.app.state.farm, user["id"], alert_id, payload.reviewed)


@router.post("/harvests/{record_id}/stages")
def stage(record_id: str, payload: Stage, request: Request, user=Depends(current_user)):
    return request.app.state.farm.stage(user["id"], record_id, payload.model_dump(mode="json"))


@router.get("/plots/{record_id}/photo")
def photo(record_id: str, request: Request, user=Depends(current_user)):
    return Response(request.app.state.farm.photo(user["id"], record_id), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600", "Vary": "Cookie"})


@router.post("/plots/{record_id}/photo")
async def upload(record_id: str, file: UploadFile, request: Request, user=Depends(current_user)):
    request.app.state.farm.get(user["id"], "plots", record_id)
    content = await file.read(5 * 1024 * 1024 + 1)
    await file.close()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "La fotografía debe pesar como máximo 5 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                if image.format not in ("JPEG", "PNG", "WEBP"):
                    raise ValueError("Formato no permitido")
                clean = ImageOps.exif_transpose(image).convert("RGB")
                clean.thumbnail((1280, 1280))
                output = io.BytesIO()
                clean.save(output, format="JPEG", quality=81, optimize=True, progressive=True)
        return await run_in_threadpool(request.app.state.farm.photo, user["id"], record_id, output.getvalue())
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "Usa una imagen JPEG, PNG o WebP válida de hasta 20 megapíxeles.")


@router.get('/crops/{record_id}/photo')
def crop_photo(record_id: str, request: Request, user=Depends(current_user)):
    return Response(request.app.state.farm.crop_photo(user['id'], record_id),
                    media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=3600', 'Vary': 'Cookie'})


@router.post('/crops/{record_id}/photo')
async def upload_crop_photo(record_id: str, file: UploadFile, request: Request, user=Depends(current_user)):
    request.app.state.farm.get(user['id'], 'crops', record_id)
    content = await file.read(4 * 1024 * 1024 + 1)
    await file.close()
    if len(content) > 4 * 1024 * 1024:
        raise HTTPException(413, 'La imagen debe pesar como máximo 4 MB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                if image.format not in ('JPEG','PNG','WEBP'):
                    raise ValueError('Formato no permitido')
                clean = ImageOps.exif_transpose(image).convert('RGB')
                clean.thumbnail((960, 960))
                output = io.BytesIO()
                clean.save(output, format='JPEG', quality=77, optimize=True)
        return await run_in_threadpool(request.app.state.farm.crop_photo, user['id'], record_id, output.getvalue())
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, 'Usa una imagen JPEG, PNG o WebP válida de hasta 20 megapíxeles.')


def model_for(kind):
    if kind not in MODELS:
        raise HTTPException(404, "Recurso no encontrado.")
    return MODELS[kind]


def validated(kind, payload):
    try:
        return model_for(kind).model_validate(payload).model_dump(mode="json")
    except ValidationError as error:
        raise HTTPException(422, [{"field": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in error.errors()])


@router.get("/{kind}")
def listing(kind: str, request: Request, user=Depends(current_user)):
    model_for(kind)
    return request.app.state.farm.list(user["id"], kind)


@router.post("/{kind}", status_code=201)
def create(kind: str, payload: dict, request: Request, user=Depends(current_user)):
    return request.app.state.farm.save(user["id"], kind, validated(kind, payload))


@router.get("/{kind}/{record_id}")
def get_record(kind: str, record_id: str, request: Request, user=Depends(current_user)):
    model_for(kind)
    return request.app.state.farm.get(user["id"], kind, record_id)


@router.put("/{kind}/{record_id}")
def update(kind: str, record_id: str, payload: dict, request: Request, user=Depends(current_user)):
    return request.app.state.farm.save(user["id"], kind, validated(kind, payload), record_id)


@router.delete('/templates/{record_id}')
def delete_template(record_id: str, request: Request, user=Depends(current_user)):
    return request.app.state.farm.delete_template(user['id'], record_id)


@router.delete('/activities/{record_id}')
def delete_activity(record_id: str, request: Request, user=Depends(current_user)):
    return request.app.state.farm.delete_activity(user['id'], record_id)
