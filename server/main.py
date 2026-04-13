"""
main.py — Family Intercom FastAPI Server
=========================================

This server does two things:
  1. WebSocket signaling: coordinates WebRTC handshakes between devices
  2. Static file serving: hosts the parent PWA from ../parent-app/dist/

SIGNALING FLOW:
  - Each client connects at /ws/{user_id}
  - Within 5 seconds, client must send {"type": "auth", "token": "JWT..."}
  - After auth, client appears in the "online" list
  - Clients send JSON messages; server routes them to the target user
  - On connect/disconnect: broadcast presence update to all clients

MESSAGE TYPES:
  auth           → Authenticate the WebSocket connection with JWT
  call-request   → Ask another user to start a call
  webrtc-offer   → SDP offer (callee → caller)
  webrtc-answer  → SDP answer (caller → callee)
  ice-candidate  → ICE network path candidate (both directions)
  hang-up        → End the call

PRESENCE MESSAGES (server → all clients):
  {"type": "presence", "online": ["host", "user1", "user2"]}
"""

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
load_dotenv()  # Load JWT_SECRET and other vars from server/.env

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from auth import router as auth_router, verify_jwt
from database import init_db

# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run on startup and shutdown."""
    print("[SERVER] Starting Family Intercom Server...")
    await init_db()
    print("[SERVER] Database initialized")
    yield
    print("[SERVER] Shutting down...")


app = FastAPI(title="Family Intercom", version="1.0.0", lifespan=lifespan)

# Register auth routes (/auth/login, /auth/setup-totp)
app.include_router(auth_router)


# ── Connection Manager ─────────────────────────────────────────────────────────

class ConnectionManager:
    """
    Manages all active WebSocket connections.

    Connections go through two phases:
      1. Unauthenticated: connected but waiting for auth message (max 5 seconds)
      2. Authenticated: tagged with user_id, visible in presence list

    We store: {user_id: WebSocket}
    One user_id can only have ONE active connection (new login kicks old one).
    """

    def __init__(self):
        # Authenticated connections: user_id → WebSocket
        self.active: dict[str, WebSocket] = {}

    async def authenticate(self, user_id: str, websocket: WebSocket):
        """Register an authenticated connection. Kick existing connection if any."""
        if user_id in self.active:
            # Kick the old connection (user reconnected)
            old_ws = self.active[user_id]
            try:
                await old_ws.send_json({"type": "error", "message": "Logged in from another location"})
                await old_ws.close(1008)  # Policy violation
            except Exception:
                pass
            print(f"[WS] Kicked existing connection for {user_id}")

        self.active[user_id] = websocket
        print(f"[WS] Authenticated: {user_id} (total: {len(self.active)})")

    def disconnect(self, user_id: str):
        """Remove a disconnected user."""
        self.active.pop(user_id, None)
        print(f"[WS] Disconnected: {user_id} (remaining: {len(self.active)})")

    async def send_to(self, user_id: str, message: dict) -> bool:
        """Send a message to a specific user. Returns False if not connected."""
        ws = self.active.get(user_id)
        if not ws:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception as e:
            print(f"[WS] Failed to send to {user_id}: {e}")
            self.active.pop(user_id, None)
            return False

    async def broadcast_presence(self):
        """
        Send the current online user list to ALL connected clients.
        Called whenever someone connects or disconnects.

        Message format: {"type": "presence", "online": ["host", "user1"]}
        """
        online_list = list(self.active.keys())
        message = {"type": "presence", "online": online_list}

        # Send to all connected users
        disconnected = []
        for user_id, ws in list(self.active.items()):
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(user_id)

        # Clean up any failed sends
        for uid in disconnected:
            self.active.pop(uid, None)

        print(f"[PRESENCE] Online: {online_list}")


manager = ConnectionManager()


# ── Supported message types and required fields ───────────────────────────────

# These are the message types that get forwarded from one client to another.
# Each must have a "target" field with the destination user_id.
ROUTABLE_TYPES = {
    "call-request",
    "webrtc-offer",
    "webrtc-answer",
    "ice-candidate",
    "hang-up",
}


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for signaling.

    Protocol:
      1. Accept connection (any user_id in the URL is just a hint)
      2. Wait up to 5 seconds for {"type": "auth", "token": "JWT..."}
      3. Validate JWT — the actual user_id comes from the token, not the URL
      4. Register connection, broadcast presence
      5. Route messages until disconnect
    """
    await websocket.accept()
    print(f"[WS] New connection: URL user_id hint = {user_id}")

    authenticated_user_id: Optional[str] = None

    # ── Phase 1: Wait for auth message (5-second timeout) ─────────────────────
    try:
        auth_task = asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        auth_msg = await auth_task
    except asyncio.TimeoutError:
        print(f"[WS] Auth timeout for {user_id} — closing")
        await websocket.send_json({"type": "error", "message": "Authentication timeout"})
        await websocket.close(1008)
        return
    except Exception as e:
        print(f"[WS] Error waiting for auth: {e}")
        return

    # Validate the auth message
    if auth_msg.get("type") != "auth":
        await websocket.send_json({"type": "error", "message": "First message must be auth"})
        await websocket.close(1008)
        return

    token = auth_msg.get("token", "")

    # Verify the JWT — no test-token bypass in production
    payload = verify_jwt(token)
    if not payload:
        await websocket.send_json({"type": "error", "message": "Invalid or expired token"})
        await websocket.close(1008)
        return
    authenticated_user_id = payload["sub"]  # user_id is in the "sub" (subject) field

    # ── Phase 2: Register and broadcast presence ──────────────────────────────
    await manager.authenticate(authenticated_user_id, websocket)
    await websocket.send_json({
        "type": "auth-ok",
        "user_id": authenticated_user_id
    })
    await manager.broadcast_presence()

    # ── Phase 3: Message loop ─────────────────────────────────────────────────
    try:
        while True:
            data = await websocket.receive_json()
            await handle_message(authenticated_user_id, data)

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: {authenticated_user_id}")
    except Exception as e:
        print(f"[WS] Error for {authenticated_user_id}: {e}")
    finally:
        # Always clean up and broadcast updated presence
        if authenticated_user_id:
            manager.disconnect(authenticated_user_id)
            await manager.broadcast_presence()


async def handle_message(from_user: str, msg: dict):
    """
    Route a message from one client to another.

    All routable messages must have:
      - type: one of ROUTABLE_TYPES
      - target: the user_id to deliver to

    The server adds a "from" field before forwarding.
    """
    msg_type = msg.get("type")

    if msg_type not in ROUTABLE_TYPES:
        print(f"[WS] Unknown message type '{msg_type}' from {from_user}")
        return

    target = msg.get("target")
    if not target:
        print(f"[WS] Message from {from_user} has no target field")
        return

    # Add the sender's identity to the message
    msg["from"] = from_user

    # Forward to target
    delivered = await manager.send_to(target, msg)
    if not delivered:
        print(f"[WS] Target '{target}' not online — message dropped ({msg_type})")
        # Notify sender that target is offline
        await manager.send_to(from_user, {
            "type": "error",
            "message": f"User '{target}' is not online"
        })


# ── Health check ───────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Simple health check. Does not expose who is online."""
    return {"status": "ok", "count": len(manager.active)}


# ── Static file serving ────────────────────────────────────────────────────────
# Serves the React PWA from ../parent-app/dist/
# This must be LAST so it doesn't intercept API routes.

DIST_DIR = os.path.join(os.path.dirname(__file__), "..", "parent-app", "dist")

if os.path.exists(DIST_DIR):
    # Mount static assets (JS, CSS, images)
    assets_dir = os.path.join(DIST_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    async def serve_index():
        """Serve the React app's index.html."""
        return FileResponse(os.path.join(DIST_DIR, "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """
        Single-Page App catch-all: serve index.html for any unknown path.
        This lets React Router handle client-side navigation.
        """
        # Check if it's a real file first
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise serve index.html (let React handle routing)
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
else:
    print(f"[SERVER] Warning: dist directory not found at {DIST_DIR}")
    print("[SERVER] Run 'npm run build' in parent-app/ to build the frontend")

    @app.get("/")
    async def serve_placeholder():
        index_path = os.path.join(DIST_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"message": "Frontend not built yet. Run npm run build in parent-app/"}
