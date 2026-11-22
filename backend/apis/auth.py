from fastapi import APIRouter, Depends, Request, Response
from apis.dependencies import current_user
from schemas.domain import Login, Register
from services.auth import SESSION_SECONDS

router = APIRouter(prefix="/api/auth", tags=["Autenticación"])


@router.post("/register", status_code=201)
def register(payload: Register, request: Request):
    request.app.state.auth.throttle("register:" + request.client.host)
    return request.app.state.auth.register(payload)


@router.post("/login")
def login(payload: Login, request: Request, response: Response):
    request.app.state.auth.throttle("login:" + request.client.host)
    token, user = request.app.state.auth.login(payload)
    response.set_cookie("agro_session", token, max_age=SESSION_SECONDS, httponly=True,
                        secure=request.app.state.secure_cookies, samesite="lax", path="/")
    return user


@router.get("/me")
def me(user=Depends(current_user)):
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    request.app.state.auth.logout(request.cookies.get("agro_session"))
    response.delete_cookie("agro_session", path="/")
