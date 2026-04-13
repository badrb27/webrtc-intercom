# WebRTC Intercom

A self-hosted, private audio/video intercom system. Remote users call a host PC directly from their phones — no third-party apps, no accounts, no subscriptions, no port forwarding.

Built with:
- **FastAPI** (Python) — WebSocket signaling server + JWT + TOTP authentication
- **Electron** — desktop tray app for the host PC
- **React PWA** — progressive web app installable on any phone
- **WebRTC** — direct peer-to-peer audio/video (server only handles the handshake)
- **Cloudflare Tunnel** — exposes the local server to the internet for free

---

## How It Works

```
[Caller's Phone]  <──── WebRTC P2P audio/video ────>  [Host PC]
       |                                                    |
  wss://intercom.yourdomain.com/ws/user1          ws://localhost:8080/ws/host
       |                                                    |
  [Cloudflare Tunnel] <──────> [FastAPI server :8080] <────┘
```

1. FastAPI runs locally on port 8080 — WebSocket signaling hub + serves the PWA.
2. Cloudflare Tunnel exposes it at `https://intercom.yourdomain.com` — no router config.
3. Callers open the PWA on their phones and log in.
4. The Electron app on the host PC connects directly to localhost.
5. Once both sides are connected, WebRTC negotiates a direct P2P call. The server is no longer in the media path.

---

## Project Structure

```
webrtc-intercom/
│
├── server/                   # FastAPI signaling server (Python)
│   ├── main.py               # WebSocket hub, presence, message routing
│   ├── auth.py               # JWT + bcrypt + TOTP authentication
│   ├── database.py           # SQLite user storage (aiosqlite)
│   ├── create_user.py        # CLI script to create user accounts
│   ├── requirements.txt      # Python dependencies
│   ├── .env.example          # Environment variable template
│   └── start_server.bat      # One-click server launcher
│
├── desktop/                  # Electron tray app (Node.js)
│   ├── main.js               # Main process: tray, WebSocket, child processes
│   ├── overlay.html          # Always-on-top call overlay window
│   ├── config.example.json   # Config template (copy to config.json)
│   └── package.json
│
├── parent-app/               # React PWA for callers (Vite)
│   ├── src/App.jsx           # Full app: auth, WebSocket, WebRTC, UI
│   ├── vite.config.js
│   └── package.json
│
├── test/
│   └── webrtc-test.html      # Standalone WebRTC + WebSocket test page
│
├── config.example.yml        # Cloudflare Tunnel config template
├── start_tunnel.bat          # Start Cloudflare Tunnel manually
└── SETUP-CLOUDFLARE.md       # Full Cloudflare Tunnel setup guide
```

---

## Setup

### 1. Server

```cmd
cd server
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

copy .env.example .env
:: Edit .env — generate a JWT_SECRET:
::   python -c "import secrets; print(secrets.token_hex(32))"

:: Create the host user (receiver role — this is the PC side)
python create_user.py host YourPassword receiver

:: Create caller users (phone side)
python create_user.py user1 CallerPassword caller
```

`create_user.py` prints a TOTP secret and QR code URL for Google Authenticator setup.

### 2. Desktop app

```cmd
cd desktop
npm install
copy config.example.json config.json
:: Edit config.json — fill in username, password, totp_secret from create_user output
npm start
```

The app starts as a tray icon. It manages the FastAPI server and Cloudflare tunnel automatically as child processes (enable in main.js when ready — see comments).

### 3. Parent PWA

```cmd
cd parent-app
npm install
npm run build
```

The built files in `parent-app/dist/` are served automatically by the FastAPI server. Callers just open the URL in their browser.

### 4. Cloudflare Tunnel

See **[SETUP-CLOUDFLARE.md](SETUP-CLOUDFLARE.md)** for the full guide.

```cmd
cloudflared tunnel login
cloudflared tunnel create intercom
cloudflared tunnel route dns intercom intercom.yourdomain.com
:: copy config.example.yml to C:\Users\YOUR_USERNAME\.cloudflared\config.yml
:: fill in your tunnel ID and domain
```

---

## Configuration

**`desktop/config.json`** (copy from `config.example.json`):

| Key | Description |
|---|---|
| `userId` / `username` | The host's username (must match a `receiver` role user in the DB) |
| `password` / `totp_secret` | Credentials from `create_user.py` output |
| `allowedCallers` | User IDs allowed to call this PC |
| `autoAccept` | `true` = calls auto-accept silently, `false` = calls are ignored |
| `cameraDefault` | Whether the host's camera is on when a call starts |
| `dnd` | Do Not Disturb — reject all incoming calls |

---

## Security

- Passwords are bcrypt-hashed (never stored in plain text)
- TOTP 2FA required on every login (Google Authenticator compatible)
- JWT tokens expire after 24h, stored in memory only (never in localStorage)
- Only users in `allowedCallers` can trigger the call overlay
- The overlay window is always-on-top and cannot be hidden — the host always knows a call is active
- Single-device enforcement: logging in from a second device kicks the first session

---

## Troubleshooting

**Server won't start — "port already in use"**
```cmd
netstat -ano | findstr :8080
taskkill /PID <PID> /F
```

**Electron app won't connect**
- Make sure `config.json` has correct `username`, `password`, and `totp_secret`
- Check `server/.env` has a `JWT_SECRET` set

**Callers can't reach the app**
- Verify the Cloudflare tunnel is running: `sc query cloudflared`
- Check the DNS record in your Cloudflare dashboard

**WebRTC connects but no audio/video**
- Check microphone/camera permissions in the browser
- Both devices need internet access for STUN to work
- Try on mobile data to rule out firewall issues

For Cloudflare-specific issues, see [SETUP-CLOUDFLARE.md](SETUP-CLOUDFLARE.md).
