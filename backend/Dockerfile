# Imagen de producción para AgroConecta API (FastAPI + uv, Python 3.12).
# El contexto de build es backend/ (ver Root Directory en Render).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Primero solo las dependencias: mejor aprovechamiento de la caché de capas.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

# Después el código de la aplicación.
COPY . .
RUN uv sync --frozen --no-dev

# Ejecutar sin privilegios de root.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Render inyecta PORT. --proxy-headers hace que request.client.host sea la IP
# real del cliente (necesario para el throttle de login) detrás del proxy.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
