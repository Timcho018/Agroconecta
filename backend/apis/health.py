from fastapi import APIRouter

from schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Comprueba que el proceso responde; no verifica servicios externos."""
    return HealthResponse(status="ok")
