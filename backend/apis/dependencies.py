from fastapi import Request


def current_user(request: Request):
    return request.app.state.auth.current(request.cookies.get("agro_session"))
