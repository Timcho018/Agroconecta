import hashlib
import hmac
import secrets
import threading
import time
from uuid import uuid4

from fastapi import HTTPException

from repositories.store import Store

SESSION_SECONDS = 8 * 60 * 60


def password_hash(password: str, salt: str) -> str:
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


class AuthService:
    def __init__(self, store: Store):
        self.store = store
        self.attempts = {}
        self.lock = threading.Lock()

    def throttle(self, key: str):
        now = time.time()
        with self.lock:
            self.attempts = {k: [t for t in v if t > now - 600] for k, v in self.attempts.items() if any(t > now - 600 for t in v)}
            attempts = self.attempts.setdefault(key, [])
            if len(attempts) >= 10:
                raise HTTPException(429, "Demasiados intentos. Espera 10 minutos.")
            attempts.append(now)

    @staticmethod
    def public(user):
        return {k: user[k] for k in ("id", "name", "email")}

    def register(self, payload):
        salt = secrets.token_hex(16)
        user = {"id": str(uuid4()), "name": payload.name, "email": payload.email,
                "salt": salt, "hash": password_hash(payload.password, salt)}

        def create(data):
            if any(u["email"] == user["email"] for u in data["users"].values()):
                raise HTTPException(409, "No se pudo crear la cuenta con este correo.")
            data["users"][user["id"]] = user
        if hasattr(self.store, 'add_user'):
            self.store.add_user(user)
        else:
            self.store.transaction(create)
        return self.public(user)

    def login(self, payload):
        if hasattr(self.store, 'user_by_email'):
            user = self.store.user_by_email(payload.email)
        else:
            users = self.store.read()["users"]
            user = next((u for u in users.values() if u["email"] == payload.email), None)
        candidate = password_hash(payload.password, user["salt"] if user else "00" * 16)
        if not user or not hmac.compare_digest(candidate, user["hash"]):
            raise HTTPException(401, "Correo o contraseña incorrectos.")
        token = secrets.token_urlsafe(32)
        key = hashlib.sha256(token.encode()).hexdigest()
        now = time.time()

        def create(data):
            data["sessions"] = {k: s for k, s in data["sessions"].items() if s["expires"] > now}
            data["sessions"][key] = {"user_id": user["id"], "expires": now + SESSION_SECONDS}
        if hasattr(self.store, 'add_session'):
            self.store.add_session(key, user['id'], now + SESSION_SECONDS, now)
        else:
            self.store.transaction(create)
        return token, self.public(user)

    def current(self, token):
        if not token:
            raise HTTPException(401, "Inicia sesión para continuar.")
        key = hashlib.sha256(token.encode()).hexdigest()
        if hasattr(self.store, 'session_user'):
            user = self.store.session_user(key, time.time())
            if not user:
                raise HTTPException(401, 'La sesión venció. Inicia sesión nuevamente.')
            return self.public(user)
        data = self.store.read()
        session = data["sessions"].get(key)
        if not session or session["expires"] <= time.time():
            raise HTTPException(401, "La sesión venció. Inicia sesión nuevamente.")
        return self.public(data["users"][session["user_id"]])

    def logout(self, token):
        if token:
            key = hashlib.sha256(token.encode()).hexdigest()
            if hasattr(self.store, 'delete_session'):
                self.store.delete_session(key)
            else:
                self.store.transaction(lambda data: data["sessions"].pop(key, None))
