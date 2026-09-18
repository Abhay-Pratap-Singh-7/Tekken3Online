// Tekken 3 Web Emulator - Lockstep Input Netplay & Local Rendering
let nostalgistInstance = null;
let isPaused = false;
let detectedRomInfo = null;

// Netplay & Lockstep State
let ws = null;
let isHost = false;
let isGuest = false;
let currentRoomId = null;
let hasGuestConnected = false;
let pingInterval = null;
let pendingSyncState = null;

// Lockstep Dynamic Stalling State
let localFrameCount = 0;
let lastRemoteFrame = 0;
let isLockstepStalled = false;
let stallWatchdog = null;
let frameDrawnThisTick = false;

window.__onEmulatorFrameRender = function() {
  if (!frameDrawnThisTick) {
    frameDrawnThisTick = true;
    localFrameCount++;
    handleFrameTick(localFrameCount);
    requestAnimationFrame(() => {
      frameDrawnThisTick = false;
    });
  }
};

let lastRenderCheckTime = performance.now();
requestAnimationFrame(function frameWatcher(now) {
  if (nostalgistInstance && !isLockstepStalled && (now - lastRenderCheckTime >= 33.3)) {
    lastRenderCheckTime = now;
    if (!frameDrawnThisTick) {
      localFrameCount++;
      handleFrameTick(localFrameCount);
    }
  }
  requestAnimationFrame(frameWatcher);
});

function handleFrameTick(frame) {
  if (!currentRoomId || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'frame_tick', frame }));
  checkLockstepStall();
}

function checkLockstepStall() {
  if (!currentRoomId || (!hasGuestConnected && !isGuest)) return;
  if (!nostalgistInstance) return;

  const frameLead = localFrameCount - lastRemoteFrame;
  const MAX_ALLOWED_LEAD = 2; // Weakest link principle: allow at most 2 frames lead

  if (frameLead > MAX_ALLOWED_LEAD) {
    if (!isLockstepStalled) {
      isLockstepStalled = true;
      nostalgistInstance.pause();

      clearTimeout(stallWatchdog);
      stallWatchdog = setTimeout(() => {
        if (isLockstepStalled && nostalgistInstance) {
          isLockstepStalled = false;
          nostalgistInstance.resume();
        }
      }, 150);
    }
  } else {
    if (isLockstepStalled) {
      isLockstepStalled = false;
      clearTimeout(stallWatchdog);
      nostalgistInstance.resume();
    }
  }
}

// PS1 Controller Mapping for Keyboard (Unified)
const KEYBOARD_MAP = {
  // D-Pad / Movement (Arrow keys or WASD)
  'ArrowUp': 'up',
  'KeyW': 'up',
  'ArrowDown': 'down',
  'KeyS': 'down',
  'ArrowLeft': 'left',
  'KeyA': 'left',
  'ArrowRight': 'right',
  'KeyD': 'right',

  // Tekken 4 Action Buttons
  // Square: Left Punch (LP)
  'KeyJ': 'y',
  'KeyU': 'y',
  'Numpad4': 'y',

  // Triangle: Right Punch (RP)
  'KeyI': 'x',
  'Numpad5': 'x',

  // Cross: Left Kick (LK)
  'KeyK': 'b',
  'KeyZ': 'b',
  'Numpad1': 'b',

  // Circle: Right Kick (RK)
  'KeyL': 'a',
  'KeyX': 'a',
  'Numpad2': 'a',

  // Shoulder buttons
  'KeyQ': 'l',
  'KeyO': 'l',
  'KeyE': 'r',
  'KeyP': 'r',

  // Meta buttons
  'Enter': 'start',
  'Space': 'start',
  'ShiftRight': 'select',
  'ShiftLeft': 'select',
  'Backspace': 'select'
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
const gameHud = document.getElementById('gameHud');
const touchOverlay = document.getElementById('touchOverlay');
const btnTouchToggle = document.getElementById('btnTouchToggle');

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
// 1. BASE64 BINARY CONVERSION HELPERS
// ==========================================
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// ==========================================
// 2. CONTROLLER INPUT DISPATCHER (LOCAL + NETPLAY)
// ==========================================
function handleControllerInput(button, action) {
  const myPlayer = isGuest ? 2 : 1;

  // 1. Execute locally on this device's emulator
  if (nostalgistInstance) {
    if (action === 'down') {
      nostalgistInstance.pressDown(button, myPlayer);
    } else {
      nostalgistInstance.pressUp(button, myPlayer);
    }
  }

  // 2. Transmit button packet over WebSocket to peer (with frame index)
  if (ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
    ws.send(JSON.stringify({
      type: 'input',
      player: myPlayer,
      button,
      action,
      frame: localFrameCount
    }));
  }
}

// ==========================================
// 3. WEBSOCKET NETPLAY CLIENT
// ==========================================
function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  ws = new WebSocket(wsUrl);

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
  }, 2000);
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
  if (matchHud) matchHud.style.display = 'flex';
}

async function sendSavestateToGuest() {
  if (!nostalgistInstance || !ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    console.log('[Netplay] Creating initial synchronization state snapshot...');
    const result = await nostalgistInstance.saveState();
    if (!result || !result.state) return;

    const arrayBuffer = await result.state.arrayBuffer();
    const base64State = arrayBufferToBase64(arrayBuffer);

    ws.send(JSON.stringify({
      type: 'sync_state',
      state: base64State
    }));
    console.log('[Netplay] Synchronized state snapshot transmitted to Guest');
  } catch (err) {
    console.warn('[Netplay] Failed to capture sync state:', err);
  }
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'room_created':
      setRoomCode(msg.roomId);
      isHost = true;
      isGuest = false;
      localFrameCount = 0;
      lastRemoteFrame = 0;
      isLockstepStalled = false;
      p1Name.textContent = 'Host (You)';
      p2Name.textContent = 'Waiting...';
      matchHud.style.display = 'flex';
      break;

    case 'guest_connected':
      hasGuestConnected = true;
      localFrameCount = 0;
      lastRemoteFrame = 0;
      isLockstepStalled = false;
      p2Name.textContent = 'P2 (Connected)';
      p2Name.style.color = 'var(--accent-cyan)';
      pingBadge.style.display = 'flex';
      enterAutoFullscreen();
      // Transmit initial memory state to guest for lockstep sync
      if (isHost && nostalgistInstance) {
        setTimeout(sendSavestateToGuest, 600);
      }
      break;

    case 'room_joined':
      setRoomCode(msg.roomId);
      isHost = false;
      isGuest = true;
      localFrameCount = 0;
      lastRemoteFrame = 0;
      isLockstepStalled = false;
      enterAutoFullscreen();
      matchHud.style.display = 'flex';
      p1Name.textContent = 'Host (P1)';
      p2Name.textContent = 'You (P2)';
      pingBadge.style.display = 'flex';
      // Automatically launch local emulator instance for Guest
      if (!nostalgistInstance) {
        launchGame(false);
      }
      break;

    case 'sync_state':
      try {
        console.log('[Netplay] Received initial savestate from Host, synchronizing...');
        const buffer = base64ToArrayBuffer(msg.state);
        const stateBlob = new Blob([buffer]);
        localFrameCount = 0;
        lastRemoteFrame = 0;
        isLockstepStalled = false;
        if (nostalgistInstance) {
          nostalgistInstance.loadState(stateBlob).then(() => {
            console.log('[Netplay] Local emulator synchronized with Host state!');
          }).catch(err => console.error('[Netplay] loadState error:', err));
        } else {
          pendingSyncState = stateBlob;
        }
      } catch (err) {
        console.error('[Netplay] Sync state decode error:', err);
      }
      break;

    case 'request_sync':
      if (isHost && nostalgistInstance) {
        sendSavestateToGuest();
      }
      break;

    case 'frame_tick':
      if (typeof msg.frame === 'number') {
        lastRemoteFrame = Math.max(lastRemoteFrame, msg.frame);
        checkLockstepStall();
      }
      break;

    case 'input':
      if (typeof msg.frame === 'number') {
        lastRemoteFrame = Math.max(lastRemoteFrame, msg.frame);
        checkLockstepStall();
      }
      // Apply remote player's button press on local emulator engine
      if (nostalgistInstance && msg.player && msg.button) {
        if (msg.action === 'down') {
          nostalgistInstance.pressDown(msg.button, msg.player);
        } else {
          nostalgistInstance.pressUp(msg.button, msg.player);
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
// 4. TOUCH CONTROLS OVERLAY
// ==========================================
function setupTouchOverlay() {
  if (!touchOverlay) return;

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
        handleControllerInput(btn, 'down');
      }
    }

    // Released buttons
    for (const btn of activeRetroButtons) {
      if (!newActiveButtons.has(btn)) {
        handleControllerInput(btn, 'up');
      }
    }

    // Update active visual classes & haptic feedback
    for (const el of activeElementButtons) {
      if (!newActiveElements.has(el)) {
        el.classList.remove('active');
      }
    }

    for (const el of newActiveElements) {
      if (!activeElementButtons.has(el)) {
        el.classList.add('active');
        if (navigator.vibrate) {
          try { navigator.vibrate(8); } catch(err) {}
        }
      }
    }

    activeRetroButtons = newActiveButtons;
    activeElementButtons = newActiveElements;
  }

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
      if (!activeRetroButtons.has(b)) handleControllerInput(b, 'down');
    }
    for (const b of activeRetroButtons) {
      if (!newActiveButtons.has(b)) handleControllerInput(b, 'up');
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
      for (const btn of activeRetroButtons) handleControllerInput(btn, 'up');
      for (const el of activeElementButtons) el.classList.remove('active');
      activeRetroButtons.clear();
      activeElementButtons.clear();
    }
  });
}

// ==========================================
// 5. KEYBOARD CONTROLLER LISTENERS
// ==========================================
const activeKeyboardButtons = new Set();

function setupKeyboardListeners() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const btn = KEYBOARD_MAP[e.code];
    if (!btn) return;

    e.preventDefault();
    if (!activeKeyboardButtons.has(btn)) {
      activeKeyboardButtons.add(btn);
      handleControllerInput(btn, 'down');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const btn = KEYBOARD_MAP[e.code];
    if (!btn) return;

    e.preventDefault();
    if (activeKeyboardButtons.has(btn)) {
      activeKeyboardButtons.delete(btn);
      handleControllerInput(btn, 'up');
    }
  });
}

// ==========================================
// 6. CLIENT-SIDE LOCAL STORAGE (IndexedDB)
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
// 7. ROM & EMULATOR INITIALIZATION
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
    if (asHost && !currentRoomId) {
      requestHostRoom();
    }

    progressStepText.textContent = 'Booting emulator...';
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

  const launchOptions = {
    element: canvas,
    core: 'pcsx_rearmed',
    resolveCoreJs: () => '/core/pcsx_rearmed_libretro.js',
    resolveCoreWasm: () => '/core/pcsx_rearmed_libretro.wasm',
    rom: rom,
    retroarchConfig: {
      audio_enable: true,
      audio_sync: true,               // Hardware SPU audio clock governor (pins fast phones to native speed)
      audio_latency: 64,
      audio_rate_control: true,
      audio_rate_control_delta: 0.005,
      audio_max_timing_skew: 0.05,

      video_vsync: true,
      video_swap_interval: 1,
      video_refresh_rate: 60.0,
      video_target_refresh_rate: 60.0,
      video_smooth: false,
      video_threaded: true,           // Decouples game logic engine from screen rendering
      video_max_swapchain_images: 2,
      fps_update_interval: 30,
      fastforward_ratio: 1.0,         // Strict 1.0x speed governor (no hyper-speedup on 120Hz displays)
      vrr_runloop_enable: false,

      input_player1_analog_dpad_mode: 1,
      input_player2_analog_dpad_mode: 1,

      // Unbind RetroArch default keyboard listeners so our unified JS handler controls inputs cleanly
      input_player1_up: 'nul',
      input_player1_down: 'nul',
      input_player1_left: 'nul',
      input_player1_right: 'nul',
      input_player1_y: 'nul',
      input_player1_x: 'nul',
      input_player1_b: 'nul',
      input_player1_a: 'nul',
      input_player1_l: 'nul',
      input_player1_r: 'nul',
      input_player1_l2: 'nul',
      input_player1_r2: 'nul',
      input_player1_start: 'nul',
      input_player1_select: 'nul',

      input_player2_up: 'nul',
      input_player2_down: 'nul',
      input_player2_left: 'nul',
      input_player2_right: 'nul',
      input_player2_y: 'nul',
      input_player2_x: 'nul',
      input_player2_b: 'nul',
      input_player2_a: 'nul',
      input_player2_l: 'nul',
      input_player2_r: 'nul',
      input_player2_l2: 'nul',
      input_player2_r2: 'nul',
      input_player2_start: 'nul',
      input_player2_select: 'nul'
    },
    retroarchCoreConfig: {
      pcsx_rearmed_spu_interpolation: 'simple',
      pcsx_rearmed_dithering: 'disabled',
      pcsx_rearmed_frameskip: 'auto'  // Local screen rendering skips frames if GPU drops, without affecting core math
    }
  };

  if (bios && bios.length > 0) {
    launchOptions.bios = bios;
  }

  nostalgistInstance = await Nostalgist.launch(launchOptions);
  canvas.focus();
  isPaused = false;
  btnPause.textContent = '⏸ Pause';

  // Apply queued initial state snapshot if guest joined before launch finished
  if (pendingSyncState) {
    try {
      console.log('[Netplay] Applying queued sync state from host...');
      await nostalgistInstance.loadState(pendingSyncState);
      pendingSyncState = null;
      console.log('[Netplay] Queued state successfully applied!');
    } catch (err) {
      console.error('[Netplay] Error applying queued sync state:', err);
    }
  }

  // If Guest finished booting and connected to a room, request a state sync from Host
  if (isGuest && ws && ws.readyState === WebSocket.OPEN && currentRoomId) {
    ws.send(JSON.stringify({ type: 'request_sync' }));
  }

  // If Host and Guest is already waiting, send state snapshot
  if (isHost && hasGuestConnected) {
    setTimeout(sendSavestateToGuest, 800);
  }
}

function joinRoom(roomId) {
  if (!roomId) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setTimeout(() => joinRoom(roomId), 400);
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
// 8. EVENT LISTENERS
// ==========================================
btnLaunchDetected.addEventListener('click', () => {
  enterAutoFullscreen();
  requestLandscapeOrientation();
  launchGame(false);
});

function requestHostRoom() {
  isHost = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'create_room' }));
  } else {
    setTimeout(requestHostRoom, 200);
  }
}

btnHostMatch.addEventListener('click', () => {
  requestHostRoom();
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
  setupKeyboardListeners();
});
