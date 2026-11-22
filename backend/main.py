import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apis.auth import router as auth_router
from apis.farm import router as farm_router
from apis.health import router as health_router
from apis.locations import router as locations_router
from apis.crop_catalog import router as catalog_router
from core.database import create_store
from core.settings import get_settings
from services.auth import AuthService
from services.farm import FarmService
from services.storage_media import PrivatePhotoStorage
from services.weather import WeatherService
from services.crop_catalog import CropCatalog


def _allowed_origin(origin: str, host: str, configured_origins: set[str]) -> bool:
    """Check CSRF origins, including local Angular development ports.

    Non-local deployments must use the CORS_ORIGINS allowlist.
    """
    if origin in configured_origins:
        return True
    try:
        parsed = urlsplit(origin)
        local_backend = host.split(":", 1)[0].lower() in {"localhost", "127.0.0.1", "testserver"}
        return (
            local_backend
            and parsed.scheme == "http"
            and parsed.hostname in {"localhost", "127.0.0.1"}
            and parsed.port is not None
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        return False


def create_app(data_path=None):
    @asynccontextmanager
    async def lifespan(app):
        store = create_store(data_path)
        media = None
        catalog = None
        try:
            cfg = get_settings()
            storage_key = cfg.supabase_secret_key or cfg.supabase_service_role_key
            if cfg.supabase_url and storage_key:
                media = PrivatePhotoStorage(cfg.supabase_url, storage_key,
                                            cfg.supabase_storage_bucket)
                # No permitir por accidente fotografías personales en un bucket público.
                from starlette.concurrency import run_in_threadpool
                await run_in_threadpool(media.ensure_private_bucket)
            elif bool(cfg.supabase_url) != bool(storage_key):
                raise RuntimeError('Configura SUPABASE_URL y SUPABASE_SECRET_KEY (o la clave antigua SERVICE_ROLE_KEY).')
            app.state.auth = AuthService(store)
            app.state.farm = FarmService(store, media=media)
            app.state.weather = WeatherService()
            catalog = CropCatalog()
            app.state.crop_catalog = catalog
            app.state.secure_cookies = os.environ.get('AGRO_SECURE_COOKIES', 'false').lower() == 'true'
            yield
        finally:
            if catalog:
                await catalog.close()
            if media:
                media.close()
            close = getattr(store, 'close', None)
            if close:
                close()

    app = FastAPI(title="AgroConecta API", version="0.2.0", lifespan=lifespan)
    allowed = set(get_settings().cors_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(allowed),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def security(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            # The browser sends this header via the Angular interceptor; the
            # development proxy injects it as well for reliable local usage.
            if request.headers.get("X-Agro-Request") != "1":
                return JSONResponse({"detail": "Falta la cabecera de seguridad de AgroConecta. Reinicia Angular para actualizar el proxy."}, status_code=403)
            origin = request.headers.get("origin")
            if origin and not _allowed_origin(origin, request.headers.get("host", ""), allowed):
                return JSONResponse({"detail": "El origen de esta solicitud no está permitido. Abre AgroConecta desde su dirección local autorizada."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Los endpoints JSON siguen siendo no-cache, pero respetamos la caché
        # privada de imágenes versionadas para evitar descargarlas al navegar.
        if 'Cache-Control' not in response.headers:
            response.headers['Cache-Control'] = 'no-store' 
        return response

    app.include_router(health_router)
    app.include_router(auth_router)
    # Antes del comodín /api/{kind}/{record_id}.
    app.include_router(locations_router)
    app.include_router(catalog_router)
    app.include_router(farm_router)
    return app


app = create_app()
