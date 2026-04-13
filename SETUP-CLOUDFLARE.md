# Cloudflare Tunnel Setup — WebRTC Intercom

This guide exposes your local server (running on `http://localhost:8080`) to the internet at `https://intercom.yourdomain.com` so callers can access it from their phones.

Cloudflare Tunnel is free, works through firewalls/NAT, and handles HTTPS + WebSocket automatically.

---

## Prerequisites

- A domain name added to your Cloudflare account
- The intercom server running on port 8080

---

## Step 1 — Install cloudflared

**Option A: winget (recommended)**
```cmd
winget install Cloudflare.cloudflared
```

**Option B: Direct download**
1. Go to https://github.com/cloudflare/cloudflared/releases
2. Download `cloudflared-windows-amd64.exe`
3. Rename to `cloudflared.exe` and place in `C:\Windows\System32\`

Verify:
```cmd
cloudflared --version
```

---

## Step 2 — Authenticate

```cmd
cloudflared tunnel login
```

This opens your browser — log in and select your domain. A credentials file is saved to `C:\Users\YOUR_USERNAME\.cloudflared\cert.pem`.

---

## Step 3 — Create a Tunnel

```cmd
cloudflared tunnel create intercom
```

This outputs a **Tunnel ID** (a UUID like `a1b2c3d4-...`) — copy it. It also creates:
```
C:\Users\YOUR_USERNAME\.cloudflared\YOUR-TUNNEL-ID.json
```

---

## Step 4 — Configure the Tunnel

Copy `config.example.yml` (from the project root) to:
```
C:\Users\YOUR_USERNAME\.cloudflared\config.yml
```

Fill in your values:
```yaml
tunnel: YOUR-TUNNEL-ID-HERE
credentials-file: C:\Users\YOUR_USERNAME\.cloudflared\YOUR-TUNNEL-ID.json

ingress:
  - hostname: intercom.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

---

## Step 5 — Create the DNS Record

```cmd
cloudflared tunnel route dns intercom intercom.yourdomain.com
```

This creates a CNAME in your Cloudflare DNS automatically. No port forwarding needed.

---

## Step 6 — Test the Tunnel

Start the FastAPI server, then:
```cmd
cloudflared tunnel run intercom
```

Open `https://intercom.yourdomain.com/health` — you should see `{"status": "ok"}`.

Press `Ctrl+C` to stop.

---

## Step 7 — Run as a Windows Background Service

```cmd
cloudflared service install
net start cloudflared
```

To manage the service:
```cmd
net stop cloudflared
net start cloudflared
sc query cloudflared
cloudflared service uninstall
```

---

## WebSocket Support

Cloudflare Tunnel proxies WebSocket connections automatically.

| Client | Connection URL |
|---|---|
| Host PC (same machine as server) | `ws://localhost:8080/ws/host` — bypasses tunnel |
| Callers on phones / remote devices | `wss://intercom.yourdomain.com/ws/user1` — through tunnel |

---

## Troubleshooting

**Tunnel connects but WebSocket fails**
- Make sure FastAPI is running (`uvicorn main:app --port 8080`)

**"ERR_TUNNEL_CONNECTION_FAILED"**
- Tunnel is running but FastAPI is not — start the server first

**ICE connection fails (no audio)**
- Both devices need a working internet connection for STUN
- Try on mobile data to rule out firewall issues

**TOTP code invalid**
- Ensure your phone's time is synced (TOTP is time-sensitive)
- Android: Settings → General Management → Date and Time → Automatic

**Tunnel not found after reboot**
- Run `sc query cloudflared` to check service status
