@echo off
echo Starting Cloudflare Tunnel for WebRTC Intercom...
echo Tunnel URL: https://intercom.yourdomain.com
echo.
echo Make sure the FastAPI server is running first (start_server.bat)
echo Press Ctrl+C to stop the tunnel
echo.
cloudflared tunnel --url http://localhost:8080 run intercom
