// Tekken 3 Web Emulator - Netplay, Local & Mobile Touch Controller
let nostalgistInstance = null;
let isPaused = false;
let detectedRomInfo = null;

// Netplay State
let ws = null;
let isHost = false;
let isGuest = false;
let currentRoomId = null;
let peerConnection = null;
let hasGuestConnected = false;
let frameStreamLoopActive = false;
let pingInterval = null;
let iceCandidatesQueue = [];

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Player 2 keyboard mappings
const GUEST_DEFAULT_MAP = {
  'ArrowUp': 'up',
  'KeyW': 'up',
  'ArrowDown': 'down',
  'KeyS': 'down',
  'ArrowLeft': 'left',
  'KeyA': 'left',
  'ArrowRight': 'right',
  'KeyD': 'right',
  'KeyJ': 'y',       // Square (1 - LP)
  'KeyU': 'y',       
  'KeyI': 'x',       // Triangle (2 - RP)
  'KeyK': 'b',       // Cross (3 - LK)
  'KeyL': 'a',       // Circle (4 - RK)
  'KeyO': 'l',       // L1
  'KeyP': 'r',       // R1
  'Enter': 'start',
  'ShiftRight': 'select',
  'ShiftLeft': 'select'
};

// DOM Elements
const statusPillText = document.getElementById('statusPillText');
const progressWrapper = document.getElementById('progressWrapper');
const progressBarFill = document.getElementById('progressBarFill');
const progressStepText = document.getElementById('progressStepText');
const progressPercent = document.getElementById('progressPercent');
const btnLaunchDetected = document.getElementById('btnLaunchDetected');
const btnHostMatch = document.getElementById('btnHostMatch');
const screenOverlay = document.getElementById('screenOverlay');
const screenFrame = document.getElementById('screenFrame');
const canvas = document.getElementById('emulator-canvas');
const guestCanvas = document.getElementById('guest-canvas');
const guestVideo = document.getElementById('guest-video');
const gameHud = document.getElementById('gameHud');
const touchOverlay = document.getElementById('touchOverlay');
const btnTouchToggle = document.getElementById('btnTouchToggle');

const guestCtx = guestCanvas ? guestCanvas.getContext('2d') : null;

// Multiplayer DOM Elements
const topRoomBar = document.getElementById('topRoomBar');
const topRoomCodeVal = document.getElementById('topRoomCodeVal');
const btnTopCopyCode = document.getElementById('btnTopCopyCode');
const hudRoomBadge = document.getElementById('hudRoomBadge');
const hudRoomCodeVal = document.getElementById('hudRoomCodeVal');
const btnHudCopyCode = document.getElementById('btnHudCopyCode');
const roomDisplayGroup = document.getElementById('roomDisplayGroup');
const roomCodeVal = document.getElementById('roomCodeVal');
const btnCopyInvite = document.getElementById('btnCopyInvite');
const txtRoomCode = document.getElementById('txtRoomCode');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const matchHud = document.getElementById('matchHud');
const p1Name = document.getElementById('p1Name');
const p2Name = document.getElementById('p2Name');
const pingBadge = document.getElementById('pingBadge');
const pingVal = document.getElementById('pingVal');

// HUD Buttons
const btnPause = document.getElementById('btnPause');
const btnRestart = document.getElementById('btnRestart');
const btnSaveState = document.getElementById('btnSaveState');
const btnLoadState = document.getElementById('btnLoadState');
const btnFullscreen = document.getElementById('btnFullscreen');

// ==========================================
// 1. WEBSOCKET CLIENT
// ==========================================
function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'blob';

  ws.onopen = () => {
    startPing();
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      txtRoomCode.value = roomParam.toUpperCase();
      joinRoom(roomParam.toUpperCase());
    }
  };

  ws.onmessage = (e) => {
    // Binary Live Frame Relay (Direct Canvas over WS)
    if (e.data instanceof Blob || e.data instanceof ArrayBuffer) {
      if (isGuest && guestCanvas && guestCtx) {
        // If WebRTC hardware video is actively streaming, skip decoding fallback frame
        if (guestVideo && guestVideo.style.display === 'block' && !guestVideo.paused) {
          return;
        }

        const blob = e.data instanceof Blob ? e.data : new Blob([e.data], { type: 'image/jpeg' });
        createImageBitmap(blob).then(bmp => {
          if (guestCanvas.width !== bmp.width || guestCanvas.height !== bmp.height) {
            guestCanvas.width = bmp.width;
            guestCanvas.height = bmp.height;
          }
          guestCtx.drawImage(bmp, 0, 0);
          bmp.close(); // Prevent GPU VRAM leak on mobile

          screenOverlay.classList.add('hidden');
          canvas.style.display = 'none';
          if (guestVideo.style.display !== 'block') {
            guestCanvas.style.display = 'block';
          }
        }).catch(() => {});
      }
      return;
    }

    try {
      const data = JSON.parse(e.data);
      handleWsMessage(data);
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  ws.onclose = () => {
    stopPing();
    setTimeout(initWebSocket, 2000);
  };
}

function startPing() {
  stopPing();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }
  }, 2500);
}

function stopPing() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function enterAutoFullscreen() {
  const isMobile = /Android|iPhone|iPad|iPod|webOS|Windows Phone/i.test(navigator.userAgent) || 
                   (window.innerWidth <= 1024 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  if (!isMobile) return;

  const target = document.documentElement;
  const reqFs = target.requestFullscreen || 
                target.webkitRequestFullscreen || 
                target.mozRequestFullScreen || 
                target.msRequestFullscreen;

  if (reqFs && !document.fullscreenElement && !document.webkitFullscreenElement) {
    reqFs.call(target).catch(() => {
      const retryOnTouch = () => {
        const fn = target.requestFullscreen || target.webkitRequestFullscreen;
        if (fn && !document.fullscreenElement && !document.webkitFullscreenElement) {
          fn.call(target).catch(() => {});
        }
        window.removeEventListener('touchstart', retryOnTouch);
        window.removeEventListener('touchend', retryOnTouch);
      };
      window.addEventListener('touchstart', retryOnTouch, { once: true, passive: true });
      window.addEventListener('touchend', retryOnTouch, { once: true, passive: true });
    });
  }
}

function setRoomCode(roomId) {
  currentRoomId = roomId;
  if (topRoomBar) topRoomBar.style.display = 'flex';
  if (topRoomCodeVal) topRoomCodeVal.textContent = roomId;
  if (hudRoomBadge) hudRoomBadge.style.display = 'flex';
  if (hudRoomCodeVal) hudRoomCodeVal.textContent = roomId;
  if (roomCodeVal) roomCodeVal.textContent = roomId;
  if (roomDisplayGroup) roomDisplayGroup.style.display = 'flex';
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'room_created':
      setRoomCode(msg.roomId);
      isHost = true;
      isGuest = false;
      p1Name.textContent = 'Host (You)';
      p2Name.textContent = 'Waiting...';
      matchHud.style.display = 'flex';
      break;

    case 'guest_connected':
      hasGuestConnected = true;
      p2Name.textContent = 'P2 (Connected)';
      p2Name.style.color = 'var(--accent-cyan)';
      pingBadge.style.display = 'flex';
      enterAutoFullscreen();
      if (isHost && nostalgistInstance) {
        startHostFrameStreaming();
        startWebRtcAsHost();
      }
      break;

    case 'room_joined':
      setRoomCode(msg.roomId);
      isHost = false;
      isGuest = true;
      enterAutoFullscreen();
      screenOverlay.classList.add('hidden');
      canvas.style.display = 'none';
      guestCanvas.style.display = 'block';
      gameHud.style.display = 'flex';
      matchHud.style.display = 'flex';
      p1Name.textContent = 'Host (P1)';
      p2Name.textContent = 'You (P2)';
      pingBadge.style.display = 'flex';
      setupGuestKeyboardListeners();
      initWebRtcAsGuest();
      break;

    case 'signal':
      handleWebRtcSignal(msg.data);
      break;

    case 'remote_input':
      if (isHost && nostalgistInstance) {
        if (msg.action === 'down') {
          nostalgistInstance.pressDown(msg.button, 2);
        } else {
          nostalgistInstance.pressUp(msg.button, 2);
        }
      }
      break;

    case 'pong':
      const rtt = Date.now() - msg.timestamp;
      pingVal.textContent = `${rtt} ms`;
      break;

    case 'peer_disconnected':
      if (isHost) {
        p2Name.textContent = 'Disconnected';
        p2Name.style.color = '#ff3344';
        hasGuestConnected = false;
        frameStreamLoopActive = false;
      } else {
        alert(msg.message || 'Host disconnected.');
        location.href = '/';
      }
      break;

    case 'error':
      alert(msg.message);
      break;
  }
}

// ==========================================
// 2. SCREEN STREAMING (WEBRTC + WS FALLBACK)
// ==========================================
function startHostFrameStreaming() {
  if (frameStreamLoopActive) return;
  frameStreamLoopActive = true;

  function streamLoop() {
    if (!frameStreamLoopActive || !isHost) return;

    // Pause CPU-heavy JPEG loop if WebRTC hardware video is connected and streaming at 60 FPS
    if (peerConnection && (peerConnection.iceConnectionState === 'connected' || peerConnection.connectionState === 'connected')) {
      setTimeout(streamLoop, 1000);
      return;
    }

    if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536 && canvas && canvas.width > 0) {
      canvas.toBlob((blob) => {
        if (blob && ws && ws.readyState === WebSocket.OPEN && frameStreamLoopActive) {
          ws.send(blob);
        }
        setTimeout(streamLoop, 33);
      }, 'image/jpeg', 0.55);
    } else {
      setTimeout(streamLoop, 40);
    }
  }

  streamLoop();
}

async function startWebRtcAsHost() {
  if (peerConnection) peerConnection.close();
  iceCandidatesQueue = [];
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.onicecandidate = (e) => {
    if (e.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', data: { candidate: e.candidate } }));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection.iceConnectionState === 'connected') {
      frameStreamLoopActive = false; // Stop CPU-heavy JPEG fallback while WebRTC is running!
    } else if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
      startHostFrameStreaming(); // Resume fallback if WebRTC drops
    }
  };

  try {
    const canvasStream = canvas.captureStream(60);
    canvasStream.getVideoTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, canvasStream);
      try {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = 2500000;
        params.encodings[0].maxFramerate = 60;
        sender.setParameters(params).catch(() => {});
      } catch (e) {}
    });

    if (window.__capturedAudioStreams && window.__capturedAudioStreams.length > 0) {
      const audioStream = window.__capturedAudioStreams[0];
      audioStream.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, audioStream);
      });
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'signal', data: { sdp: peerConnection.localDescription } }));
  } catch (err) {
    console.warn('WebRTC Host init:', err);
  }
}

function initWebRtcAsGuest() {
  if (peerConnection) peerConnection.close();
  iceCandidatesQueue = [];
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.onicecandidate = (e) => {
    if (e.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', data: { candidate: e.candidate } }));
    }
  };

  peerConnection.ontrack = (e) => {
    if (e.streams && e.streams[0]) {
      guestVideo.srcObject = e.streams[0];
      guestVideo.play().then(() => {
        guestVideo.style.display = 'block';
        guestCanvas.style.display = 'none';
      }).catch(() => {});
    }
  };
}

async function handleWebRtcSignal(data) {
  if (!peerConnection) return;

  if (data.sdp) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    for (const cand of iceCandidatesQueue) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {}
    }
    iceCandidatesQueue = [];

    if (data.sdp.type === 'offer') {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'signal', data: { sdp: peerConnection.localDescription } }));
    }
  } else if (data.candidate) {
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {}
    } else {
      iceCandidatesQueue.push(data.candidate);
    }
  }
}

// ==========================================
// 3. TOUCH & KEYBOARD INPUTS
// ==========================================
function setupTouchOverlay() {
  if (!touchOverlay) return;

  // Auto-hide touch buttons on desktop without touch
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouchDevice && window.innerWidth > 1024) {
    touchOverlay.classList.add('touch-hidden');
    if (btnTouchToggle) btnTouchToggle.textContent = '🎮 Touch: OFF';
  }

  if (btnTouchToggle) {
    btnTouchToggle.addEventListener('click', () => {
      touchOverlay.classList.toggle('touch-hidden');
      const isHidden = touchOverlay.classList.contains('touch-hidden');
      btnTouchToggle.textContent = isHidden ? '🎮 Touch: OFF' : '🎮 Touch: ON';
    });
  }

  let activeRetroButtons = new Set();
  let activeElementButtons = new Set();

  function triggerButtonAction(btn, action) {
    if (isGuest) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', action, button: btn }));
      }
    } else if (nostalgistInstance) {
      if (action === 'down') {
        nostalgistInstance.pressDown(btn, 1);
      } else {
        nostalgistInstance.pressUp(btn, 1);
      }
    }
  }

  function updateTouchPoints(e) {
    e.preventDefault();
    const newActiveButtons = new Set();
    const newActiveElements = new Set();

    const touches = e.touches;
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const btn = el?.closest('.t-btn');
      if (btn && touchOverlay.contains(btn)) {
        newActiveElements.add(btn);
        const rawBtns = btn.dataset.btn;
        if (rawBtns) {
          rawBtns.split(',').forEach(b => newActiveButtons.add(b.trim()));
        }
      }
    }

    // Newly pressed buttons
    for (const btn of newActiveButtons) {
      if (!activeRetroButtons.has(btn)) {
        triggerButtonAction(btn, 'down');
      }
    }

    // Released buttons
    for (const btn of activeRetroButtons) {
      if (!newActiveButtons.has(btn)) {
        triggerButtonAction(btn, 'up');
      }
    }

    // Update visual active classes
    for (const el of activeElementButtons) {
      if (!newActiveElements.has(el)) {
        el.classList.remove('active');
      }
    }

    for (const el of newActiveElements) {
      if (!activeElementButtons.has(el)) {
        el.classList.add('active');
        if (navigator.vibrate) {
          try { navigator.vibrate(10); } catch(err) {}
        }
      }
    }

    activeRetroButtons = newActiveButtons;
    activeElementButtons = newActiveElements;
  }

  // Handle touch drag across buttons
  touchOverlay.addEventListener('touchstart', (e) => {
    enterAutoFullscreen();
    updateTouchPoints(e);
  }, { passive: false });
  touchOverlay.addEventListener('touchmove', updateTouchPoints, { passive: false });
  touchOverlay.addEventListener('touchend', updateTouchPoints, { passive: false });
  touchOverlay.addEventListener('touchcancel', updateTouchPoints, { passive: false });

  // Mouse drag support for desktop testing
  let isMouseDown = false;
  function handleMouse(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const btn = el?.closest('.t-btn');
    const newActiveButtons = new Set();
    const newActiveElements = new Set();

    if (btn && touchOverlay.contains(btn)) {
      newActiveElements.add(btn);
      const rawBtns = btn.dataset.btn;
      if (rawBtns) {
        rawBtns.split(',').forEach(b => newActiveButtons.add(b.trim()));
      }
    }

    for (const b of newActiveButtons) {
      if (!activeRetroButtons.has(b)) triggerButtonAction(b, 'down');
    }
    for (const b of activeRetroButtons) {
      if (!newActiveButtons.has(b)) triggerButtonAction(b, 'up');
    }

    for (const el of activeElementButtons) {
      if (!newActiveElements.has(el)) el.classList.remove('active');
    }
    for (const el of newActiveElements) {
      if (!activeElementButtons.has(el)) el.classList.add('active');
    }

    activeRetroButtons = newActiveButtons;
    activeElementButtons = newActiveElements;
  }

  touchOverlay.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    handleMouse(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isMouseDown) handleMouse(e);
  });

  window.addEventListener('mouseup', () => {
    if (isMouseDown) {
      isMouseDown = false;
      for (const btn of activeRetroButtons) triggerButtonAction(btn, 'up');
      for (const el of activeElementButtons) el.classList.remove('active');
      activeRetroButtons.clear();
      activeElementButtons.clear();
    }
  });
}

function setupGuestKeyboardListeners() {
  const pressed = new Set();
  window.addEventListener('keydown', (e) => {
    if (!isGuest || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (guestVideo && guestVideo.muted) guestVideo.muted = false;

    const btn = GUEST_DEFAULT_MAP[e.code];
    if (btn && !pressed.has(btn)) {
      pressed.add(btn);
      ws.send(JSON.stringify({ type: 'input', action: 'down', button: btn }));
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!isGuest || !ws || ws.readyState !== WebSocket.OPEN) return;
    const btn = GUEST_DEFAULT_MAP[e.code];
    if (btn) {
      pressed.delete(btn);
      ws.send(JSON.stringify({ type: 'input', action: 'up', button: btn }));
      e.preventDefault();
    }
  });
}

// ==========================================
// 4. CLIENT-SIDE LOCAL STORAGE (IndexedDB)
// ==========================================
const IDB_NAME = 'tekken3_local_cache';
const IDB_VERSION = 1;
const IDB_STORE = 'rom_blobs';

function openRomDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredAsset(key) {
  try {
    const db = await openRomDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[Storage] Read error:', err);
    return null;
  }
}

async function saveStoredAsset(key, data) {
  try {
    const db = await openRomDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(data, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[Storage] Write error:', err);
    return false;
  }
}

// ==========================================
// 5. ROM & EMULATOR INITIALIZATION
// ==========================================
async function checkRomStatus() {
  try {
    const res = await fetch('/api/rom-info');
    const info = await res.json();
    detectedRomInfo = info;

    if (info.found && info.tracks.length > 0) {
      const track1 = info.tracks.find(t => t.name.includes('Track 1')) || info.tracks[0];
      const trackKey = track1.originalName || track1.name;
      const cached = await getStoredAsset(trackKey);

      if (cached) {
        statusPillText.textContent = 'Cached Locally';
        statusPillText.style.color = 'var(--accent-green)';
      } else {
        statusPillText.textContent = info.isOptimized ? '32MB Ready' : 'Ready';
      }
      btnLaunchDetected.disabled = false;
      btnHostMatch.disabled = false;
    } else {
      statusPillText.textContent = 'No ROM';
      btnLaunchDetected.disabled = true;
      btnHostMatch.disabled = true;
    }
  } catch (err) {
    statusPillText.textContent = 'Offline';
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function fetchWithProgress(url, totalExpectedSize, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}`);
  
  const contentLength = +(response.headers.get('Content-Length') || totalExpectedSize || 0);
  const reader = response.body.getReader();
  let receivedLength = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedLength += value.length;
    if (contentLength > 0 && onProgress) {
      onProgress(receivedLength, contentLength);
    }
  }

  return new Blob(chunks);
}

// Launch Tekken 3
async function launchGame(asHost = false) {
  if (!detectedRomInfo) return;

  btnLaunchDetected.disabled = true;
  btnHostMatch.disabled = true;
  progressWrapper.style.display = 'flex';

  try {
    const romFiles = [];

    // 1. Cue File (check cache first)
    if (detectedRomInfo.cue) {
      let cueText = await getStoredAsset(detectedRomInfo.cue.name);
      if (!cueText) {
        progressStepText.textContent = 'Loading CUE...';
        const cueRes = await fetch(`/roms/${encodeURIComponent(detectedRomInfo.cue.name)}`);
        cueText = await cueRes.text();
        await saveStoredAsset(detectedRomInfo.cue.name, cueText);
      }
      romFiles.push({
        fileName: detectedRomInfo.cue.name,
        fileContent: cueText
      });
    }

    // 2. Track 1 (Gameplay .bin - check local storage cache first)
    const track1 = detectedRomInfo.tracks.find(t => t.name.includes('Track 1')) || detectedRomInfo.tracks[0];
    const trackKey = track1.originalName || track1.name;
    let finalTrack1Blob = await getStoredAsset(trackKey);

    if (finalTrack1Blob) {
      progressStepText.textContent = 'Loaded from local storage!';
      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
    } else {
      if (track1.isGz) {
        progressStepText.textContent = `Downloading (${formatBytes(track1.size)})...`;
        
        const compressedBlob = await fetchWithProgress(
          `/roms/${encodeURIComponent(track1.name)}`,
          track1.size,
          (loaded, total) => {
            const pct = Math.round((loaded / total) * 100);
            progressBarFill.style.width = `${pct}%`;
            progressPercent.textContent = `${pct}%`;
          }
        );

        progressStepText.textContent = 'Decompressing...';
        progressBarFill.style.width = '100%';
        progressPercent.textContent = 'Almost ready';

        const decompressedStream = compressedBlob.stream().pipeThrough(new DecompressionStream('gzip'));
        finalTrack1Blob = await new Response(decompressedStream).blob();
      } else {
        progressStepText.textContent = `Loading...`;
        finalTrack1Blob = await fetchWithProgress(
          `/roms/${encodeURIComponent(track1.name)}`,
          track1.size,
          (loaded, total) => {
            const pct = Math.round((loaded / total) * 100);
            progressBarFill.style.width = `${pct}%`;
            progressPercent.textContent = `${pct}%`;
          }
        );
      }

      progressStepText.textContent = 'Saving to local storage...';
      await saveStoredAsset(trackKey, finalTrack1Blob);
    }

    romFiles.push({
      fileName: trackKey,
      fileContent: finalTrack1Blob
    });

    // 3. BIOS (check cache first)
    const biosFiles = [];
    const biosFile = detectedRomInfo.bios.find(b => b.name === 'scph5501.bin') || detectedRomInfo.bios[0];
    if (biosFile) {
      let biosBlob = await getStoredAsset(biosFile.name);
      if (!biosBlob) {
        biosBlob = await (await fetch(`/bios/${encodeURIComponent(biosFile.name)}`)).blob();
        await saveStoredAsset(biosFile.name, biosBlob);
      }
      biosFiles.push({
        fileName: biosFile.name,
        fileContent: biosBlob
      });
    }

    // 4. Host Room
    if (asHost) {
      isHost = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'create_room' }));
      }
    }

    progressStepText.textContent = 'Booting...';
    progressBarFill.style.width = '100%';

    await startEmulator(romFiles, biosFiles);

  } catch (err) {
    progressStepText.textContent = 'Error: ' + err.message;
    btnLaunchDetected.disabled = false;
    btnHostMatch.disabled = false;
  }
}

async function startEmulator(rom, bios) {
  if (nostalgistInstance) {
    await nostalgistInstance.exit();
    nostalgistInstance = null;
  }

  screenOverlay.classList.add('hidden');
  gameHud.style.display = 'flex';
  canvas.style.display = 'block';
  if (guestCanvas) guestCanvas.style.display = 'none';
  if (guestVideo) guestVideo.style.display = 'none';

  const launchOptions = {
    element: canvas,
    core: 'pcsx_rearmed',
    resolveCoreJs: () => '/core/pcsx_rearmed_libretro.js',
    resolveCoreWasm: () => '/core/pcsx_rearmed_libretro.wasm',
    rom: rom,
    retroarchConfig: {
      audio_enable: true,
      audio_sync: false,
      audio_latency: 64,
      video_vsync: false,
      video_smooth: false,
      video_threaded: true,
      input_player1_analog_dpad_mode: 1,
      input_player2_analog_dpad_mode: 1,

      input_player2_up: 'num8',
      input_player2_down: 'num2',
      input_player2_left: 'num4',
      input_player2_right: 'num6',
      input_player2_y: 'u',       // Square (LP)
      input_player2_x: 'i',       // Triangle (RP)
      input_player2_b: 'j',       // Cross (LK)
      input_player2_a: 'k',       // Circle (RK)
      input_player2_l: 'o',       // L1
      input_player2_r: 'p',       // R1
      input_player2_l2: 'l',      // L2
      input_player2_r2: 'm',      // R2
      input_player2_start: 'num1',
      input_player2_select: 'num0'
    },
    retroarchCoreConfig: {
      pcsx_rearmed_spu_interpolation: 'simple',
      pcsx_rearmed_dithering: 'disabled',
      pcsx_rearmed_frameskip: '0'
    }
  };

  if (bios && bios.length > 0) {
    launchOptions.bios = bios;
  }

  nostalgistInstance = await Nostalgist.launch(launchOptions);
  canvas.focus();
  isPaused = false;
  btnPause.textContent = '⏸ Pause';

  if (isHost && hasGuestConnected) {
    startHostFrameStreaming();
    startWebRtcAsHost();
  }
}

function joinRoom(roomId) {
  if (!roomId) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('Connecting...');
    return;
  }
  ws.send(JSON.stringify({ type: 'join_room', roomId }));
}

function requestLandscapeOrientation() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {}
}

// ==========================================
// 5. EVENT LISTENERS
// ==========================================
btnLaunchDetected.addEventListener('click', () => {
  enterAutoFullscreen();
  requestLandscapeOrientation();
  launchGame(false);
});

btnHostMatch.addEventListener('click', () => {
  enterAutoFullscreen();
  requestLandscapeOrientation();
  launchGame(true);
});

btnJoinRoom.addEventListener('click', () => {
  enterAutoFullscreen();
  requestLandscapeOrientation();
  const code = txtRoomCode.value.trim().toUpperCase();
  if (code) joinRoom(code);
});

txtRoomCode.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') btnJoinRoom.click();
});

function copyRoomInvite(btnEl, defaultLabel) {
  if (!currentRoomId) return;
  const inviteUrl = `${window.location.origin}?room=${currentRoomId}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    btnEl.textContent = 'COPIED!';
    setTimeout(() => { btnEl.textContent = defaultLabel; }, 2000);
  }).catch(() => {
    prompt('Room Code: ' + currentRoomId + '\nInvite Link:', inviteUrl);
  });
}

if (btnTopCopyCode) {
  btnTopCopyCode.addEventListener('click', () => copyRoomInvite(btnTopCopyCode, 'COPY'));
}
if (btnHudCopyCode) {
  btnHudCopyCode.addEventListener('click', () => copyRoomInvite(btnHudCopyCode, '📋'));
}
if (btnCopyInvite) {
  btnCopyInvite.addEventListener('click', () => copyRoomInvite(btnCopyInvite, 'Copy Link'));
}

btnPause.addEventListener('click', async () => {
  if (!nostalgistInstance) return;
  if (isPaused) {
    await nostalgistInstance.resume();
    isPaused = false;
    btnPause.textContent = '⏸ Pause';
  } else {
    await nostalgistInstance.pause();
    isPaused = true;
    btnPause.textContent = '▶ Resume';
  }
});

btnRestart.addEventListener('click', async () => {
  if (!nostalgistInstance) return;
  if (confirm('Restart game?')) {
    await nostalgistInstance.restart();
  }
});

btnSaveState.addEventListener('click', async () => {
  if (!nostalgistInstance) return;
  try {
    const state = await nostalgistInstance.saveState();
    localStorage.setItem('tekken3_browser_state', JSON.stringify(state));
    alert('State saved!');
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
});

btnLoadState.addEventListener('click', async () => {
  if (!nostalgistInstance) return;
  try {
    const saved = localStorage.getItem('tekken3_browser_state');
    if (!saved) return alert('No saved state.');
    const stateObj = JSON.parse(saved);
    await nostalgistInstance.loadState(stateObj.state);
    alert('Loaded!');
  } catch (err) {
    alert('Load failed: ' + err.message);
  }
});

btnFullscreen.addEventListener('click', () => {
  requestLandscapeOrientation();
  if (!document.fullscreenElement) {
    screenFrame.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});

canvas.addEventListener('click', () => {
  requestLandscapeOrientation();
  canvas.focus();
});

// Init on load
window.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  checkRomStatus();
  setupTouchOverlay();
});
