import { useState, useEffect, useRef, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES (injected as a style tag — no CSS modules needed for this single-file app)
// ─────────────────────────────────────────────────────────────────────────────

const styles = `
  .app {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
  }

  /* ── Login ─────────────────────────────────── */
  .login-card {
    width: 100%;
    max-width: 360px;
    background: #1e1e2e;
    border-radius: 20px;
    padding: 32px 24px;
    border: 1px solid #2a2a3e;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .login-title {
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    color: #4fc3f7;
    margin-bottom: 6px;
  }
  .login-subtitle {
    text-align: center;
    font-size: 13px;
    color: #546e7a;
    margin-bottom: 28px;
  }
  .field-label {
    font-size: 12px;
    color: #78909c;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: block;
  }
  .field-input {
    width: 100%;
    padding: 14px 16px;
    background: #12121e;
    border: 1.5px solid #2a2a3e;
    border-radius: 12px;
    color: #e0e0e0;
    font-size: 16px;
    margin-bottom: 16px;
    transition: border-color 0.2s;
    outline: none;
  }
  .field-input:focus { border-color: #4fc3f7; }
  .field-input::placeholder { color: #37474f; }
  .btn-primary {
    width: 100%;
    padding: 16px;
    background: #4fc3f7;
    color: #0f0f1a;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 700;
    transition: background 0.2s, transform 0.1s;
    margin-top: 4px;
  }
  .btn-primary:active { transform: scale(0.97); }
  .btn-primary:hover { background: #81d4fa; }
  .btn-primary:disabled { background: #37474f; color: #546e7a; }
  .error-msg {
    background: #2d0a0a;
    border: 1px solid #c62828;
    color: #ef9a9a;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 13px;
    margin-bottom: 16px;
    text-align: center;
  }
  .totp-hint {
    font-size: 12px;
    color: #546e7a;
    text-align: center;
    margin-top: 16px;
  }

  /* ── Main screen ───────────────────────────── */
  .main-screen {
    width: 100%;
    max-width: 360px;
    text-align: center;
  }
  .header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 32px;
  }
  .app-title { font-size: 18px; font-weight: 700; color: #4fc3f7; }
  .logout-btn {
    font-size: 13px;
    color: #546e7a;
    background: none;
    padding: 6px 10px;
    border-radius: 6px;
  }
  .logout-btn:hover { color: #90a4ae; }

  .status-card {
    background: #1e1e2e;
    border-radius: 20px;
    padding: 32px 24px;
    margin-bottom: 20px;
    border: 1px solid #2a2a3e;
  }
  .user-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    margin: 0 auto 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 36px;
    background: #12121e;
    border: 3px solid;
  }
  .user-avatar.online { border-color: #4caf50; }
  .user-avatar.offline { border-color: #37474f; }
  .user-name { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .user-status-label {
    font-size: 14px;
    padding: 4px 14px;
    border-radius: 20px;
    display: inline-block;
    font-weight: 600;
  }
  .user-status-label.online { background: #1b5e20; color: #a5d6a7; }
  .user-status-label.offline { background: #1a1a2e; color: #546e7a; }

  .btn-call {
    width: 100%;
    padding: 20px;
    border-radius: 16px;
    font-size: 20px;
    font-weight: 700;
    background: linear-gradient(135deg, #1b5e20, #2e7d32);
    color: #a5d6a7;
    border: 2px solid #388e3c;
    transition: all 0.2s;
    margin-bottom: 12px;
  }
  .btn-call:hover:not(:disabled) {
    background: linear-gradient(135deg, #2e7d32, #388e3c);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(76,175,80,0.3);
  }
  .btn-call:active:not(:disabled) { transform: translateY(0); }
  .btn-call:disabled {
    background: #1a1a2e;
    color: #37474f;
    border-color: #2a2a3e;
  }

  .ws-status {
    font-size: 12px;
    color: #37474f;
    margin-top: 8px;
  }
  .ws-status.connected { color: #546e7a; }

  /* ── Active call ───────────────────────────── */
  .call-screen {
    width: 100%;
    max-width: 360px;
    text-align: center;
  }
  .call-header {
    margin-bottom: 24px;
  }
  .call-status-badge {
    display: inline-block;
    padding: 4px 14px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .call-status-badge.connecting { background: #4a148c; color: #ce93d8; }
  .call-status-badge.active { background: #1b5e20; color: #a5d6a7; }
  .call-person { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .call-timer { font-size: 42px; font-weight: 300; color: #4fc3f7; letter-spacing: 2px; margin: 16px 0; }

  .video-container {
    position: relative;
    width: 100%;
    aspect-ratio: 9/16;
    max-height: 400px;
    background: #12121e;
    border-radius: 20px;
    overflow: hidden;
    margin-bottom: 20px;
    border: 1px solid #2a2a3e;
  }
  .video-container video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .no-video-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #37474f;
    gap: 8px;
  }
  .no-video-placeholder .icon { font-size: 48px; }
  .no-video-placeholder .text { font-size: 14px; }

  .call-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .ctrl-btn {
    padding: 16px 8px;
    border-radius: 16px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    background: #1e1e2e;
    color: #90a4ae;
    border: 1px solid #2a2a3e;
    transition: all 0.15s;
  }
  .ctrl-btn .icon { font-size: 22px; }
  .ctrl-btn.active { background: #1565c0; color: #90caf9; border-color: #1976d2; }
  .ctrl-btn.active-off { background: #4a148c; color: #ce93d8; border-color: #6a1b9a; }

  .btn-hangup {
    width: 100%;
    padding: 20px;
    border-radius: 16px;
    font-size: 18px;
    font-weight: 700;
    background: linear-gradient(135deg, #b71c1c, #c62828);
    color: #ffcdd2;
    border: 2px solid #e53935;
    transition: all 0.2s;
  }
  .btn-hangup:active { transform: scale(0.97); }
`

// ─────────────────────────────────────────────────────────────────────────────
// WEBRTC CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}

// The user we're calling (hardcoded for now — could be configurable)
const CALL_TARGET = 'host'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Auth state ──────────────────────────────────────────────────────────────
  // JWT is stored in memory only (not localStorage) for security.
  // Refreshing the page will require re-login.
  const [token, setToken] = useState(null)       // null = logged out
  const [userId, setUserId] = useState(null)

  // ── Main screen state ───────────────────────────────────────────────────────
  const [hostOnline, setHostOnline] = useState(false)
  const [wsStatus, setWsStatus] = useState('disconnected') // disconnected | connecting | connected

  // ── Call state ──────────────────────────────────────────────────────────────
  const [callPhase, setCallPhase] = useState('idle') // idle | calling | active
  const [callTimer, setCallTimer] = useState(0)       // seconds elapsed
  const [isMuted, setIsMuted] = useState(false)
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false)

  // ── Refs (don't trigger re-render) ─────────────────────────────────────────
  const wsRef = useRef(null)                  // WebSocket
  const pcRef = useRef(null)                  // RTCPeerConnection
  const localStreamRef = useRef(null)         // Local mic + camera stream
  const remoteVideoRef = useRef(null)         // <video> element for remote stream
  const timerRef = useRef(null)               // call timer interval
  const callTimerStartRef = useRef(null)
  const pendingCandidatesRef = useRef([])     // ICE candidates buffered before remote desc
  const wasKickedRef = useRef(false)          // Prevent reconnect after server kicks us
  const statsIntervalRef = useRef(null)       // getStats() polling interval

  // ── Debug stats ─────────────────────────────────────────────────────────────
  const [rtcStats, setRtcStats] = useState(null) // { localType, localIp, remoteType, remoteIp }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBSOCKET CONNECTION
  // Connect to signaling server after login
  // ─────────────────────────────────────────────────────────────────────────

  const connectWebSocket = useCallback((jwtToken) => {
    // Determine WebSocket URL (same origin but ws:// or wss://)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/${CALL_TARGET}-parent`

    console.log('[WS] Connecting to', wsUrl)
    setWsStatus('connecting')

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Send JWT auth immediately
      ws.send(JSON.stringify({ type: 'auth', token: jwtToken }))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      handleWsMessage(msg, jwtToken)
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected')
      setWsStatus('disconnected')
      setHostOnline(false)
      // Don't reconnect if server kicked us out (another device logged in)
      if (wasKickedRef.current) return
      // Auto-reconnect after 3 seconds if still logged in
      setTimeout(() => {
        if (token) connectWebSocket(token)
      }, 3000)
    }

    ws.onerror = () => {
      console.error('[WS] Connection error')
    }
  }, [token])

  // ─────────────────────────────────────────────────────────────────────────
  // WEBSOCKET MESSAGE HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  const handleWsMessage = useCallback((msg, currentToken) => {
    switch (msg.type) {

      case 'auth-ok':
        console.log('[WS] Authenticated as', msg.user_id)
        setWsStatus('connected')
        break

      case 'presence':
        // Check if the host is in the online list
        const hostIsOnline = msg.online.includes(CALL_TARGET)
        setHostOnline(hostIsOnline)
        console.log('[WS] Online users:', msg.online, '— Host:', badrIsOnline)
        break

      case 'webrtc-offer':
        // We received an offer — we're being called (unusual for parent app)
        // Handle anyway for completeness
        handleIncomingOffer(msg)
        break

      case 'webrtc-answer':
        // Host's desktop app answered our offer
        handleAnswer(msg)
        break

      case 'ice-candidate':
        handleIceCandidate(msg)
        break

      case 'hang-up':
        console.log('[CALL] Remote hung up')
        endCall()
        break

      case 'error':
        console.error('[WS] Server error:', msg.message)
        if (msg.message === 'Logged in from another location') {
          wasKickedRef.current = true
          alert('You have been logged out because this account signed in on another device.')
          setToken(null)
          setUserId(null)
        }
        break
    }
  }, [])

  function sendSignal(msg) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // START A CALL (parent initiates)
  //
  // Our protocol: parent sends call-request → Host's desktop auto-accepts
  // → Host creates WebRTC offer → parent receives offer → parent creates answer
  // → ICE exchange → audio+video connected
  // ─────────────────────────────────────────────────────────────────────────

  async function startCall() {
    setCallPhase('calling')
    console.log('[CALL] Sending call-request to', CALL_TARGET)
    sendSignal({ type: 'call-request', target: CALL_TARGET })

    // After sending call-request, wait for Host's desktop to send us a WebRTC offer
    // That's handled in handleIncomingOffer()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLE INCOMING OFFER (from Host's desktop app)
  // ─────────────────────────────────────────────────────────────────────────

  async function handleIncomingOffer(msg) {
    console.log('[CALL] Received WebRTC offer from', msg.from)
    setCallPhase('calling')

    // Create peer connection
    const pc = new RTCPeerConnection(RTC_CONFIG)
    pcRef.current = pc

    // Clear any leftover buffered ICE candidates from previous call
    pendingCandidatesRef.current = []

    // Set up ALL event handlers BEFORE any async work so no events are missed
    pc.ontrack = (event) => {
      console.log('[CALL] Got remote track:', event.track.kind)
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0]
        // Explicit play() needed on some mobile browsers despite autoPlay attribute
        remoteVideoRef.current.play().catch(() => {})
        if (event.track.kind === 'video') {
          setHasRemoteVideo(true)
        }
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          type: 'ice-candidate',
          target: msg.from,
          candidate: event.candidate.toJSON()
        })
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log('[ICE] State:', pc.iceConnectionState)
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setCallPhase('active')
        startCallTimer()
        startStatsPolling(pc)
      } else if (pc.iceConnectionState === 'failed') {
        console.error('[ICE] Connection failed')
        endCall()
      }
    }

    // Get media with a hard timeout so a pending permission prompt never
    // blocks the WebRTC handshake. Answer must be sent promptly.
    const withTimeout = (promise, ms) =>
      Promise.race([promise, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))])

    let stream = null
    try {
      stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } }),
        8000
      )
    } catch (err) {
      console.warn('[CALL] Video/media failed or timed out, trying audio-only:', err.message)
      try {
        stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({ audio: true }),
          5000
        )
      } catch (audioErr) {
        console.warn('[CALL] Audio also failed or timed out, proceeding without local media:', audioErr.message)
      }
    }

    if (stream) {
      localStreamRef.current = stream
      stream.getTracks().forEach(track => pc.addTrack(track, stream))
    }

    // Set Host's offer as remote description
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))

    // Flush any ICE candidates that arrived before remote description was ready
    for (const candidate of pendingCandidatesRef.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch (_) {}
    }
    pendingCandidatesRef.current = []

    // Create and send our answer
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    // Use plain object — RTCSessionDescription.toJSON() may not fire in all browsers
    sendSignal({
      type: 'webrtc-answer',
      target: msg.from,
      sdp: { type: answer.type, sdp: answer.sdp }
    })

    console.log('[CALL] Sent WebRTC answer')
  }

  async function handleAnswer(msg) {
    if (!pcRef.current) return
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp))
    console.log('[CALL] Set remote description (answer)')
  }

  async function handleIceCandidate(msg) {
    if (!pcRef.current) return
    // Buffer candidates that arrive before setRemoteDescription — common race condition
    if (!pcRef.current.remoteDescription) {
      pendingCandidatesRef.current.push(msg.candidate)
      return
    }
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate))
    } catch (e) {
      console.error('[ICE] Failed to add candidate:', e)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONTROLS
  // ─────────────────────────────────────────────────────────────────────────

  function toggleMute() {
    if (!localStreamRef.current) return
    const newMuted = !isMuted
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !newMuted })
    setIsMuted(newMuted)
  }

  function startStatsPolling(pc) {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
    const poll = async () => {
      if (!pc || pc.iceConnectionState === 'closed') return
      try {
        const stats = await pc.getStats()
        const candidates = {}
        let activePair = null
        stats.forEach(r => {
          if (r.type === 'local-candidate' || r.type === 'remote-candidate') candidates[r.id] = r
          if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') activePair = r
        })
        if (activePair) {
          const loc = candidates[activePair.localCandidateId]
          const rem = candidates[activePair.remoteCandidateId]
          setRtcStats({
            localType: loc?.candidateType ?? '?',
            localIp:   loc?.address ?? loc?.ip ?? '?',
            remoteType: rem?.candidateType ?? '?',
            remoteIp:  rem?.address ?? rem?.ip ?? '?',
          })
        }
      } catch (_) {}
    }
    poll()
    statsIntervalRef.current = setInterval(poll, 3000)
  }

  function hangUp() {
    sendSignal({ type: 'hang-up', target: CALL_TARGET })
    endCall()
  }

  function endCall() {
    setCallPhase('idle')
    setHasRemoteVideo(false)
    setIsMuted(false)
    setRtcStats(null)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current)
      statsIntervalRef.current = null
    }
    setCallTimer(0)

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
    }

    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
  }

  function startCallTimer() {
    callTimerStartRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setCallTimer(Math.floor((Date.now() - callTimerStartRef.current) / 1000))
    }, 1000)
  }

  function formatTimer(secs) {
    const m = String(Math.floor(secs / 60)).padStart(2, '0')
    const s = String(secs % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  // Connect WebSocket when logged in
  useEffect(() => {
    if (token) {
      connectWebSocket(token)
    }
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [token])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        {!token && (
          <LoginScreen onLogin={(tok, uid) => { setToken(tok); setUserId(uid) }} />
        )}

        {token && callPhase === 'idle' && (
          <MainScreen
            userId={userId}
            hostOnline={hostOnline}
            wsStatus={wsStatus}
            onCall={startCall}
            onLogout={() => { setToken(null); setUserId(null); if(wsRef.current) wsRef.current.close() }}
          />
        )}

        {token && callPhase !== 'idle' && (
          <CallScreen
            phase={callPhase}
            timer={formatTimer(callTimer)}
            isMuted={isMuted}
            hasRemoteVideo={hasRemoteVideo}
            remoteVideoRef={remoteVideoRef}
            rtcStats={rtcStats}
            onToggleMute={toggleMute}
            onHangUp={hangUp}
          />
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          totp_code: totpCode.trim()
        })
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          setError('Too many failed attempts. Please wait before trying again.')
        } else {
          setError(data.detail || 'Login failed')
        }
        return
      }

      // Store JWT in memory (not localStorage — more secure)
      onLogin(data.token, data.user_id)

    } catch (err) {
      setError('Cannot connect to server. Is it running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-card">
      <div className="login-title">Family Intercom</div>
      <div className="login-subtitle">Sign in to connect</div>

      {error && <div className="error-msg">{error}</div>}

      <form onSubmit={handleSubmit}>
        <label className="field-label">Username</label>
        <input
          className="field-input"
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />

        <label className="field-label">Password</label>
        <input
          className="field-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <label className="field-label">Authenticator Code</label>
        <input
          className="field-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="6-digit code"
          value={totpCode}
          onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
          autoComplete="one-time-code"
          required
        />

        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <p className="totp-hint">Use Google Authenticator for the 6-digit code</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

function MainScreen({ userId, hostOnline, wsStatus, onCall, onLogout }) {
  return (
    <div className="main-screen">
      <div className="header-bar">
        <div className="app-title">Family Intercom</div>
        <button className="logout-btn" onClick={onLogout}>Sign out</button>
      </div>

      <div className="status-card">
        <div className={`user-avatar ${hostOnline ? 'online' : 'offline'}`}>
          {hostOnline ? '🟢' : '😴'}
        </div>
        <div className="user-name">Host</div>
        <div className={`user-status-label ${hostOnline ? 'online' : 'offline'}`}>
          {hostOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      <button
        className="btn-call"
        onClick={onCall}
        disabled={!hostOnline}
      >
        {hostOnline ? 'Connect to Host' : 'Host is Offline'}
      </button>

      <div className={`ws-status ${wsStatus}`}>
        {wsStatus === 'connected' ? `Connected as ${userId}` :
         wsStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE CALL SCREEN
// ─────────────────────────────────────────────────────────────────────────────

function CallScreen({ phase, timer, isMuted, hasRemoteVideo, remoteVideoRef, rtcStats, onToggleMute, onHangUp }) {
  function describeConnection(s) {
    if (!s) return null
    const types = [s.localType, s.remoteType]
    let mode
    if (types.includes('relay'))       mode = 'relay (TURN)'
    else if (types.includes('srflx'))  mode = 'peer-to-peer (internet)'
    else                               mode = 'peer-to-peer (local)'
    return `${mode} · ${s.localType}→${s.remoteType} · ${s.localIp} ↔ ${s.remoteIp}`
  }
  return (
    <div className="call-screen">
      <div className="call-header">
        <div className={`call-status-badge ${phase === 'active' ? 'active' : 'connecting'}`}>
          {phase === 'active' ? 'Connected' : 'Connecting...'}
        </div>
        <div className="call-person">Host</div>
        {phase === 'active' && <div className="call-timer">{timer}</div>}
      </div>

      <div className="video-container">
        {/* Always render — ref must be attached before ontrack fires so audio works too */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{ display: hasRemoteVideo ? 'block' : 'none' }}
        />
        {!hasRemoteVideo && (
          <div className="no-video-placeholder">
            <div className="icon">🎵</div>
          </div>
        )}
      </div>

      <div className="call-controls">
        <button
          className={`ctrl-btn ${isMuted ? 'active-off' : ''}`}
          onClick={onToggleMute}
        >
          <span className="icon">{isMuted ? '🔇' : '🎤'}</span>
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <button className="ctrl-btn" disabled>
          <span className="icon">🔊</span>
          Speaker
        </button>
      </div>

      <button className="btn-hangup" onClick={onHangUp}>
        End Call
      </button>

      {rtcStats && (
        <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', padding: '6px 12px', wordBreak: 'break-all' }}>
          {describeConnection(rtcStats)}
        </div>
      )}
    </div>
  )
}
