/**
 * WebRTC Intercom - Electron Main Process
 * ========================================
 * This file is the entry point for the Electron app.
 * It runs in Node.js (not in the browser) and controls:
 *   - System tray icon and menu
 *   - WebSocket connection to signaling server
 *   - WebRTC peer connection (via renderer process)
 *   - Overlay window (always-on-top notification)
 *   - Anti-spy protection (overlay must be visible during calls)
 *   - Auto-launch on Windows startup
 *   - Config file management
 *   - Connection logging
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const OTPAuth = require('otpauth');

// ── Configuration ──────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'connections.log');
const SERVER_DIR = path.join(__dirname, '..', 'server');
const SERVER_LOG_PATH = path.join(SERVER_DIR, 'server.log');
const CLOUDFLARED_LOG_PATH = path.join(__dirname, 'cloudflared.log');
const CLOUDFLARED_CONFIG = path.join(process.env.USERPROFILE || os.homedir(), '.cloudflared', 'config.yml');

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        console.error('[CONFIG] Failed to load config.json:', e.message);
        return {
            serverUrl: 'ws://localhost:8080/ws/host',
            httpUrl: 'http://localhost:8080',
            userId: 'host',
            username: 'host',
            password: '',
            allowedCallers: ['user1', 'user2'],
            autoAccept: true,
            cameraDefault: false,
            dnd: false
        };
    }
}

function saveConfig(newConfig) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
    config = newConfig;
    console.log('[CONFIG] Saved config.json');
}

let config = loadConfig();

// ── Logging ────────────────────────────────────────────────────────────────────

function logConnection(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_PATH, line);
    console.log('[LOG]', message);
}

// ── App state ──────────────────────────────────────────────────────────────────

let tray = null;              // System tray icon
let overlayWindow = null;     // Always-on-top call overlay
let settingsWindow = null;    // Settings window
let wsClient = null;          // WebSocket connection to signaling server
let jwtToken = null;          // Current JWT token (refreshed on login)
let isConnectedToServer = false;
let reconnectTimeout = null;
let reconnectDelay = 1000;    // Start with 1 second, doubles each attempt (exponential backoff)

// Call state
let activeCallFrom = null;    // user_id of current caller
let callStartTime = null;

// Anti-spy: check every 2 seconds if WebRTC is active without overlay
let antiSpyInterval = null;

// ── Python server process ──────────────────────────────────────────────────────
let serverProcess = null;        // child_process handle
let serverRestartTimeout = null; // pending restart timer
let serverStopping = false;      // true when we're quitting — don't restart

// Kill whatever process is currently listening on a port.
// Needed so a leftover server from a previous session doesn't block our spawn.
function killProcessOnPort(port) {
    try {
        const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { windowsHide: true }).toString();
        for (const line of out.split('\n')) {
            const pid = line.trim().split(/\s+/).pop();
            if (pid && /^\d+$/.test(pid) && pid !== '0') {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { windowsHide: true });
                    console.log(`[SERVER] Killed existing process on port ${port} (PID ${pid})`);
                } catch (_) {}
            }
        }
    } catch (_) { /* no process found — fine */ }
}

function startPythonServer() {
    if (serverStopping || serverProcess) return;

    // Clear any leftover process from a previous run before binding the port
    killProcessOnPort(8080);

    console.log('[SERVER] Starting FastAPI server...');

    // Append-mode log stream — all uvicorn output goes here
    const logStream = fs.createWriteStream(SERVER_LOG_PATH, { flags: 'a' });
    logStream.write(`\n[${new Date().toISOString()}] === Server starting ===\n`);

    serverProcess = spawn('python', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8080'], {
        cwd: SERVER_DIR,        // run from server/ so uvicorn finds main.py and .env
        env: process.env,       // inherit PATH so python is found
        windowsHide: true       // no console window on Windows
    });

    // Pipe stdout and stderr to the log file.
    // Note: uvicorn writes its access logs to stderr, so both streams are normal.
    serverProcess.stdout.on('data', (data) => logStream.write(data));
    serverProcess.stderr.on('data', (data) => logStream.write(data));

    serverProcess.on('close', (code) => {
        logStream.write(`[${new Date().toISOString()}] Server exited (code ${code})\n`);
        logStream.end();
        serverProcess = null;

        if (!serverStopping) {
            console.log(`[SERVER] Exited (code ${code}) — restarting in 3s...`);
            logConnection(`SERVER CRASHED (code ${code}) — restarting in 3s`);
            serverRestartTimeout = setTimeout(startPythonServer, 3000);
        }
    });

    serverProcess.on('error', (err) => {
        // Fires if Python isn't found or can't be launched at all
        logStream.write(`[${new Date().toISOString()}] Failed to start: ${err.message}\n`);
        logStream.end();
        serverProcess = null;
        console.error('[SERVER] Failed to launch:', err.message);

        if (!serverStopping) {
            serverRestartTimeout = setTimeout(startPythonServer, 3000);
        }
    });
}

function stopPythonServer() {
    serverStopping = true;
    if (serverRestartTimeout) {
        clearTimeout(serverRestartTimeout);
        serverRestartTimeout = null;
    }
    if (serverProcess) {
        console.log('[SERVER] Stopping server...');
        try {
            execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { windowsHide: true });
        } catch (_) {
            serverProcess.kill();
        }
        serverProcess = null;
    }
}

// ── Cloudflared tunnel process ─────────────────────────────────────────────────
let cloudflaredProcess = null;
let cloudflaredRestartTimeout = null;
let cloudflaredStopping = false;

function startCloudflared() {
    if (cloudflaredStopping || cloudflaredProcess) return;

    console.log('[TUNNEL] Starting cloudflared...');

    const logStream = fs.createWriteStream(CLOUDFLARED_LOG_PATH, { flags: 'a' });
    logStream.write(`\n[${new Date().toISOString()}] === Cloudflared starting ===\n`);

    // Use config.yml if it exists, otherwise fall back to --url (no DNS routing)
    const cfArgs = fs.existsSync(CLOUDFLARED_CONFIG)
        ? ['tunnel', '--config', CLOUDFLARED_CONFIG, 'run', 'family-intercom']
        : ['tunnel', '--url', 'http://localhost:8080'];

    if (!fs.existsSync(CLOUDFLARED_CONFIG)) {
        console.log('[TUNNEL] config.yml not found — running with --url (no named tunnel)');
    }

    cloudflaredProcess = spawn('cloudflared', cfArgs, {
        env: process.env,
        windowsHide: true
    });

    cloudflaredProcess.stdout.on('data', (data) => logStream.write(data));
    cloudflaredProcess.stderr.on('data', (data) => logStream.write(data));

    cloudflaredProcess.on('close', (code) => {
        logStream.write(`[${new Date().toISOString()}] Cloudflared exited (code ${code})\n`);
        logStream.end();
        cloudflaredProcess = null;

        if (!cloudflaredStopping) {
            console.log(`[TUNNEL] Exited (code ${code}) — restarting in 3s...`);
            logConnection(`TUNNEL CRASHED (code ${code}) — restarting in 3s`);
            cloudflaredRestartTimeout = setTimeout(startCloudflared, 3000);
        }
    });

    cloudflaredProcess.on('error', (err) => {
        logStream.write(`[${new Date().toISOString()}] Failed to start: ${err.message}\n`);
        logStream.end();
        cloudflaredProcess = null;
        console.error('[TUNNEL] Failed to launch:', err.message);

        if (!cloudflaredStopping) {
            cloudflaredRestartTimeout = setTimeout(startCloudflared, 3000);
        }
    });
}

function stopCloudflared() {
    cloudflaredStopping = true;
    if (cloudflaredRestartTimeout) {
        clearTimeout(cloudflaredRestartTimeout);
        cloudflaredRestartTimeout = null;
    }
    if (cloudflaredProcess) {
        console.log('[TUNNEL] Stopping cloudflared...');
        try {
            execSync(`taskkill /pid ${cloudflaredProcess.pid} /T /F`, { windowsHide: true });
        } catch (_) {
            cloudflaredProcess.kill();
        }
        cloudflaredProcess = null;
    }
}

// ── App ready ──────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    console.log('[APP] WebRTC Intercom starting...');

    // Register to start with Windows
    app.setLoginItemSettings({
        openAtLogin: false,   // AUTO-START DISABLED — set to true to re-enable
        path: app.getPath('exe'),
        name: 'WebRTC Intercom',
        args: []
    });

    // Start managed child processes. Both have auto-restart on crash.
    // AUTO-START DISABLED — uncomment to re-enable
    // startPythonServer();
    // startCloudflared();

    // Create system tray
    setupTray();

    // Login and connect to WebSocket (retries until server is up)
    await loginAndConnect();

    // Start anti-spy monitoring
    startAntiSpyMonitor();
});

// Don't quit when all windows are closed (we're a tray app)
app.on('window-all-closed', (e) => {
    e.preventDefault();
});

app.on('before-quit', () => {
    if (antiSpyInterval) clearInterval(antiSpyInterval);
    if (wsClient) wsClient.close();
    stopPythonServer();
    stopCloudflared();
});

// ── System Tray ────────────────────────────────────────────────────────────────

function setupTray() {
    // Create a simple colored icon programmatically
    // In production you'd use a real .ico file
    const icon = createTrayIcon('red'); // Red = disconnected initially
    tray = new Tray(icon);
    tray.setToolTip('WebRTC Intercom - Disconnected');

    updateTrayMenu();

    tray.on('double-click', () => {
        if (settingsWindow) {
            settingsWindow.focus();
        }
    });
}

function createTrayIcon(color) {
    // Create a simple 16x16 colored square as tray icon
    // Colors: green = connected, red = disconnected, yellow = DND
    const colors = {
        green: Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
        ]),
    };

    // Use nativeImage to create a simple icon
    // For a real app, use actual icon files
    try {
        // Try to load icon file if it exists
        const iconPath = path.join(__dirname, `icon-${color}.png`);
        if (fs.existsSync(iconPath)) {
            return nativeImage.createFromPath(iconPath);
        }
    } catch (e) {}

    // Fallback: create empty icon (app will still work, just no visible icon)
    return nativeImage.createEmpty();
}

function updateTrayMenu() {
    const dndLabel = config.dnd ? '✓ DND (Do Not Disturb)' : 'Set DND';
    const statusLabel = isConnectedToServer ? '🟢 Connected' : '🔴 Disconnected';

    const contextMenu = Menu.buildFromTemplate([
        { label: 'WebRTC Intercom', enabled: false },
        { label: statusLabel, enabled: false },
        { type: 'separator' },
        {
            label: dndLabel,
            click: () => {
                config.dnd = !config.dnd;
                saveConfig(config);
                updateTrayMenu();
                console.log(`[TRAY] DND ${config.dnd ? 'enabled' : 'disabled'}`);
            }
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: () => openSettingsWindow()
        },
        {
            label: 'Connection Log',
            click: () => shell.openPath(LOG_PATH)
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(`WebRTC Intercom - ${isConnectedToServer ? 'Connected' : 'Disconnected'}`);
}

function setTrayConnected(connected) {
    isConnectedToServer = connected;
    // In a real app, swap the icon image here
    updateTrayMenu();
}

// ── Authentication ─────────────────────────────────────────────────────────────

async function loginAndConnect() {
    // Step 1: Get JWT token from auth server
    if (config.username && config.password) {
        jwtToken = await getJwtToken();
    }

    // Step 2: Connect WebSocket
    connectWebSocket();
}

async function getJwtToken() {
    try {
        console.log('[AUTH] Logging in as', config.username);

        // We need to make an HTTP request to get the JWT
        // Using Node's built-in fetch (Node 18+) or node-fetch
        const fetchFn = globalThis.fetch || require('node-fetch');

        const response = await fetchFn(`${config.httpUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: config.username,
                password: config.password,
                // Generate live TOTP code from the stored secret (same as Google Authenticator)
                totp_code: new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(config.totp_secret) }).generate()
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.error('[AUTH] Login failed:', error.detail || response.status);
            logConnection(`AUTH FAILED for ${config.username}: ${error.detail || response.status}`);
            return null;
        }

        const data = await response.json();
        console.log('[AUTH] Login successful, got JWT token');
        return data.token;

    } catch (err) {
        console.error('[AUTH] Login error (server offline?):', err.message);
        return null;
    }
}

// ── WebSocket Connection ───────────────────────────────────────────────────────

function connectWebSocket() {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        return; // Already connected
    }

    console.log('[WS] Connecting to', config.serverUrl);

    try {
        wsClient = new WebSocket(config.serverUrl);
    } catch (err) {
        console.error('[WS] Failed to create WebSocket:', err.message);
        scheduleReconnect();
        return;
    }

    wsClient.on('open', () => {
        console.log('[WS] Connected to signaling server');
        reconnectDelay = 1000; // Reset backoff on successful connection

        // Must send auth token within 5 seconds
        // If we don't have a JWT, send a placeholder (server will reject us)
        const authMsg = {
            type: 'auth',
            token: jwtToken || 'no-token'
        };
        wsClient.send(JSON.stringify(authMsg));
    });

    wsClient.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            handleSignalingMessage(msg);
        } catch (e) {
            console.error('[WS] Failed to parse message:', e.message);
        }
    });

    wsClient.on('close', (code, reason) => {
        console.log(`[WS] Disconnected (code: ${code})`);
        setTrayConnected(false);
        scheduleReconnect();

        // If we were in a call, end it
        if (activeCallFrom) {
            logConnection(`CALL ENDED (connection lost) with ${activeCallFrom}`);
            closeOverlay();
            activeCallFrom = null;
        }
    });

    wsClient.on('error', (err) => {
        console.error('[WS] Error:', err.message);
    });
}

function scheduleReconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    console.log(`[WS] Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimeout = setTimeout(async () => {
        // Try to refresh JWT before reconnecting
        if (config.username && config.password && !jwtToken) {
            jwtToken = await getJwtToken();
        }
        connectWebSocket();
    }, reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function sendToServer(msg) {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify(msg));
    }
}

// ── Signaling Message Handler ──────────────────────────────────────────────────

function handleSignalingMessage(msg) {
    console.log('[WS] Received:', msg.type, msg.from ? `from ${msg.from}` : '');

    switch (msg.type) {

        case 'auth-ok':
            // Authentication successful
            console.log('[AUTH] Authenticated as', msg.user_id);
            setTrayConnected(true);
            logConnection(`CONNECTED to signaling server as ${msg.user_id}`);
            break;

        case 'presence':
            // Who's online changed — update tray tooltip
            console.log('[WS] Online users:', msg.online.join(', ') || 'none');
            // Forward to overlay so it can resend offer if caller reconnected
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send('rtc-message', msg);
            }
            break;

        case 'call-request':
            handleIncomingCallRequest(msg);
            break;

        case 'webrtc-offer':
        case 'webrtc-answer':
        case 'ice-candidate':
            // Forward WebRTC signaling messages to the overlay window
            // The overlay handles the actual WebRTC connection
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send('rtc-message', msg);
            }
            break;

        case 'hang-up':
            console.log('[CALL] Remote hung up');
            logConnection(`CALL ENDED (remote hang-up) with ${msg.from}, duration: ${getCallDuration()}`);
            closeOverlay();
            activeCallFrom = null;
            break;

        case 'error':
            console.error('[WS] Server error:', msg.message);
            break;
    }
}

// ── Incoming Call Handler ──────────────────────────────────────────────────────

function handleIncomingCallRequest(msg) {
    const caller = msg.from;
    console.log(`[CALL] Incoming call from "${caller}"`);

    // ── Check DND ─────────────────────────────────────────────────────────────
    if (config.dnd) {
        console.log(`[CALL] Rejecting call from ${caller} — DND is on`);
        logConnection(`CALL REJECTED (DND) from ${caller}`);
        sendToServer({ type: 'hang-up', target: caller });
        return;
    }

    // ── Check if caller is allowed ─────────────────────────────────────────────
    // Only family members in the allowedCallers list can connect
    if (!config.allowedCallers.includes(caller)) {
        console.log(`[CALL] Rejecting call from ${caller} — not in allowedCallers list`);
        logConnection(`CALL REJECTED (unauthorized) from ${caller}`);
        // Silent rejection — don't inform the caller
        return;
    }

    // ── Auto-accept if enabled ─────────────────────────────────────────────────
    if (!config.autoAccept) {
        console.log(`[CALL] Auto-accept is off, ignoring call from ${caller}`);
        logConnection(`CALL IGNORED (auto-accept off) from ${caller}`);
        return;
    }

    // ── Accept the call ────────────────────────────────────────────────────────
    activeCallFrom = caller;
    callStartTime = Date.now();
    logConnection(`CALL ACCEPTED from ${caller}`);

    // Open the overlay window (this also starts the WebRTC connection)
    openOverlayWindow(caller);
}

// ── Overlay Window ─────────────────────────────────────────────────────────────
/**
 * ANTI-SPY PROTECTION:
 * The overlay is a critical security feature. When someone connects to the host's
 * intercom, he MUST be able to see it. The overlay:
 *   1. Is always-on-top (can't be hidden behind other windows)
 *   2. Has a bright border (hard to miss)
 *   3. If closed, IMMEDIATELY kills the WebRTC connection
 *   4. Every 2 seconds, we check — if there's a call but no overlay, kill the call
 */

function openOverlayWindow(callerName) {
    // Close any existing overlay first
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
    }

    overlayWindow = new BrowserWindow({
        width: 380,
        height: 280,
        alwaysOnTop: true,           // CRITICAL: stays on top of all windows
        skipTaskbar: false,           // Show in taskbar
        frame: false,                 // No title bar (we control close button)
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            preload: path.join(__dirname, 'preload.js')
        },
        x: 20,                        // Position near bottom-right corner
        y: 20,
    });

    // Position near bottom-right of screen
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    overlayWindow.setPosition(
        display.workAreaSize.width - 400,
        display.workAreaSize.height - 300
    );

    overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

    // Pass caller info and config to overlay
    overlayWindow.webContents.once('did-finish-load', () => {
        overlayWindow.webContents.send('call-info', {
            caller: callerName,
            serverUrl: config.serverUrl,
            userId: config.userId,
            cameraDefault: config.cameraDefault,
            jwtToken: jwtToken
        });
    });

    // ── ANTI-SPY: Kill call if overlay is closed ───────────────────────────────
    overlayWindow.on('close', () => {
        if (activeCallFrom) {
            console.log('[ANTI-SPY] Overlay closed — killing active call immediately!');
            logConnection(`CALL FORCE-ENDED (overlay closed) with ${activeCallFrom}`);
            sendToServer({ type: 'hang-up', target: activeCallFrom });
            activeCallFrom = null;
        }
    });

    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });

    // Play notification sound
    playNotificationSound();

    console.log('[OVERLAY] Opened overlay for call from', callerName);
}

function closeOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        // Set activeCallFrom to null BEFORE closing to prevent double hang-up
        const hadCall = activeCallFrom;
        activeCallFrom = null;
        overlayWindow.close();
        overlayWindow = null;
    }
}

// ── Anti-spy monitoring ────────────────────────────────────────────────────────

function startAntiSpyMonitor() {
    antiSpyInterval = setInterval(() => {
        // If there's an active call but no overlay window — KILL IT
        if (activeCallFrom && (!overlayWindow || overlayWindow.isDestroyed())) {
            console.log('[ANTI-SPY] Active call detected without overlay! Terminating call.');
            logConnection(`CALL FORCE-ENDED (anti-spy: no overlay) with ${activeCallFrom}`);
            sendToServer({ type: 'hang-up', target: activeCallFrom });
            activeCallFrom = null;
        }
    }, 2000);
}

// ── Settings Window ────────────────────────────────────────────────────────────

function openSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 500,
        height: 600,
        title: 'WebRTC Intercom Settings',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

    settingsWindow.webContents.once('did-finish-load', () => {
        settingsWindow.webContents.send('load-config', config);
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
// IPC = Inter-Process Communication (between main and renderer processes)

// Overlay: WebRTC signal to send
ipcMain.on('send-rtc-signal', (event, msg) => {
    sendToServer(msg);
});

// Overlay: User hung up from overlay button
ipcMain.on('hang-up', (event) => {
    if (activeCallFrom) {
        sendToServer({ type: 'hang-up', target: activeCallFrom });
        logConnection(`CALL ENDED (user hung up) with ${activeCallFrom}, duration: ${getCallDuration()}`);
        activeCallFrom = null;
    }
    closeOverlay();
});

// Settings: Save config
ipcMain.on('save-config', (event, newConfig) => {
    saveConfig(newConfig);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('config-saved');
    }
});

// Settings: Get connection log
ipcMain.handle('get-log', async () => {
    try {
        return fs.readFileSync(LOG_PATH, 'utf8');
    } catch (e) {
        return 'No log entries yet.';
    }
});

// ── Notification Sound ─────────────────────────────────────────────────────────

function playNotificationSound() {
    try {
        const soundPath = path.join(__dirname, 'notification.wav');
        if (fs.existsSync(soundPath)) {
            // Play sound via a hidden BrowserWindow
            const soundWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
            soundWindow.loadURL(`data:text/html,<audio autoplay src="file://${soundPath}"></audio>`);
            setTimeout(() => {
                if (!soundWindow.isDestroyed()) soundWindow.close();
            }, 3000);
        }
    } catch (e) {
        console.log('[SOUND] Could not play notification sound:', e.message);
    }
}

// ── Helper ────────────────────────────────────────────────────────────────────

function getCallDuration() {
    if (!callStartTime) return 'unknown';
    const secs = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
}
