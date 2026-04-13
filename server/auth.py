"""
auth.py — Authentication: JWT tokens, bcrypt passwords, TOTP codes.

FLOW:
  1. Client POST /auth/login with {username, password, totp_code}
  2. Server checks password hash with bcrypt
  3. Server checks TOTP code with pyotp
  4. If both pass, return a JWT token (24h expiry)
  5. Client sends {"type": "auth", "token": "..."} on WebSocket connect
  6. Server validates JWT and tags the connection with user_id + role
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext
import pyotp

from database import get_user

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Config ─────────────────────────────────────────────────────────────────────

JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is not set. Add it to server/.env")

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

# bcrypt context for hashing and verifying passwords
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── In-memory rate limiting ────────────────────────────────────────────────────
# Tracks failed login attempts per IP to prevent brute force.
# Format: { "ip_address": {"count": int, "window_start": datetime} }
# Resets after 15 minutes.
failed_attempts: dict[str, dict] = {}
MAX_ATTEMPTS = 5
WINDOW_MINUTES = 15


def check_rate_limit(ip: str):
    """Raise 429 if this IP has exceeded failed login attempts."""
    now = datetime.now(timezone.utc)
    record = failed_attempts.get(ip)

    if record:
        window_start = record["window_start"]
        # Reset counter if the 15-minute window has passed
        if (now - window_start).total_seconds() > WINDOW_MINUTES * 60:
            del failed_attempts[ip]
        elif record["count"] >= MAX_ATTEMPTS:
            remaining = WINDOW_MINUTES * 60 - int((now - window_start).total_seconds())
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed login attempts. Try again in {remaining} seconds."
            )


def record_failed_attempt(ip: str):
    """Increment failed login counter for this IP."""
    now = datetime.now(timezone.utc)
    if ip not in failed_attempts:
        failed_attempts[ip] = {"count": 0, "window_start": now}
    failed_attempts[ip]["count"] += 1


def clear_failed_attempts(ip: str):
    """Clear failed attempts on successful login."""
    failed_attempts.pop(ip, None)


# ── JWT helpers ────────────────────────────────────────────────────────────────

def create_jwt(user_id: str, role: str) -> str:
    """Create a signed JWT token with user_id, role, and expiry."""
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS)
    payload = {
        "sub": user_id,       # subject = user_id
        "role": role,
        "exp": expire          # expiry timestamp
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> Optional[dict]:
    """
    Verify a JWT token and return its payload, or None if invalid/expired.
    Returns: {"sub": user_id, "role": role, "exp": ...}
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


# ── Password helpers ───────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Check a plaintext password against a bcrypt hash."""
    return pwd_context.verify(plain, hashed)


# ── TOTP helpers ───────────────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    """Generate a new random TOTP secret (Base32 encoded)."""
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    """
    Verify a 6-digit TOTP code against a secret.
    pyotp allows 1 window of drift (30 seconds before/after) to account for clock skew.
    """
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ── Login endpoint ─────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    """
    Authenticate with username + password + TOTP code.
    Returns JWT token on success.
    Rate limited: max 5 failures per IP per 15 minutes.
    """
    ip = request.client.host

    # Check rate limit before doing anything
    check_rate_limit(ip)

    # Look up user in database
    user = await get_user(body.username)

    if not user:
        record_failed_attempt(ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Verify bcrypt password
    if not verify_password(body.password, user["password_hash"]):
        record_failed_attempt(ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Verify TOTP code
    if not verify_totp(user["totp_secret"], body.totp_code):
        record_failed_attempt(ip)
        raise HTTPException(status_code=401, detail="Invalid TOTP code")

    # All checks passed — generate JWT
    clear_failed_attempts(ip)
    token = create_jwt(user["username"], user["role"])

    return {"token": token, "user_id": user["username"], "role": user["role"]}
