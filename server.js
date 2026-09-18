const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOCAL_ROMS_DIR = path.join(__dirname, 'roms');
const FALLBACK_TEKKEN_DIR = '/Users/abhay/Downloads/Tekken 3 (Everything Unlocked)';
const FALLBACK_BIOS_DIR = path.join(FALLBACK_TEKKEN_DIR, 'PlayStation BIOS');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.bin': 'application/octet-stream',
  '.cue': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function getRomInfo() {
  const info = {
    found: false,
    cue: null,
    tracks: [],
    bios: [],
    totalSizeBytes: 0,
    isOptimized: false
  };

  // 1. Check local optimized roms folder first (~32MB)
  if (fs.existsSync(LOCAL_ROMS_DIR)) {
    const files = fs.readdirSync(LOCAL_ROMS_DIR);
    const gzTrack = files.find(f => f.endsWith('.bin.gz'));
    const rawTrack = files.find(f => f.endsWith('.bin') && !f.includes('scph'));
    const cue = files.find(f => f.endsWith('.cue'));
    const bios = files.find(f => f.includes('scph') && f.endsWith('.bin'));

    if (gzTrack || rawTrack) {
      info.found = true;
      info.isOptimized = true;

      if (cue) {
        const st = fs.statSync(path.join(LOCAL_ROMS_DIR, cue));
        info.cue = { name: cue, size: st.size };
        info.totalSizeBytes += st.size;
      }

      const mainTrack = gzTrack || rawTrack;
      const st = fs.statSync(path.join(LOCAL_ROMS_DIR, mainTrack));
      info.tracks.push({
        name: mainTrack,
        originalName: 'Tekken 3 (USA) (Track 1).bin',
        size: st.size,
        isGz: mainTrack.endsWith('.gz')
      });
      info.totalSizeBytes += st.size;

      if (bios) {
        const bst = fs.statSync(path.join(LOCAL_ROMS_DIR, bios));
        info.bios.push({ name: bios, size: bst.size });
      }

      return info;
    }
  }

  // 2. Fallback to original Downloads folder if local not found
  try {
    if (fs.existsSync(FALLBACK_TEKKEN_DIR)) {
      const files = fs.readdirSync(FALLBACK_TEKKEN_DIR);
      info.found = true;
      for (const file of files) {
        if (file.endsWith('.cue')) {
          const st = fs.statSync(path.join(FALLBACK_TEKKEN_DIR, file));
          info.cue = { name: file, size: st.size };
          info.totalSizeBytes += st.size;
        } else if (file.endsWith('.bin')) {
          const st = fs.statSync(path.join(FALLBACK_TEKKEN_DIR, file));
          info.tracks.push({ name: file, size: st.size, isGz: false });
          info.totalSizeBytes += st.size;
        }
      }
      info.tracks.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (fs.existsSync(FALLBACK_BIOS_DIR)) {
      const biosFiles = fs.readdirSync(FALLBACK_BIOS_DIR);
      for (const file of biosFiles) {
        if (file.endsWith('.bin')) {
          const st = fs.statSync(path.join(FALLBACK_BIOS_DIR, file));
          info.bios.push({ name: file, size: st.size });
        }
      }
    }
  } catch (err) {
    console.error('Error scanning ROM directory:', err);
  }

  return info;
}

function streamFile(filePath, req, res, contentType = 'application/octet-stream') {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    const range = req.headers.range;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

      if (start >= stats.size || end >= stats.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        res.end();
        return;
      }

      const isImmutable = /\.(bin|gz|wasm|cue)$/i.test(filePath) || filePath.includes('/core/') || filePath.includes('/roms/') || filePath.includes('/bios/');
      const cacheControl = isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache';

      const chunksize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': cacheControl
      });
      stream.pipe(res);
    } else {
      const isImmutable = /\.(bin|gz|wasm|cue)$/i.test(filePath) || filePath.includes('/core/') || filePath.includes('/roms/') || filePath.includes('/bios/');
      const cacheControl = isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache';

      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Cache-Control': cacheControl
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // Common headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

  // API: ROM Info
  if (pathname === '/api/rom-info') {
    const info = getRomInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
    return;
  }

  // Stream ROM files
  if (pathname.startsWith('/roms/')) {
    const filename = pathname.slice('/roms/'.length);
    let targetFile = path.normalize(path.join(LOCAL_ROMS_DIR, filename));
    if (!fs.existsSync(targetFile)) {
      targetFile = path.normalize(path.join(FALLBACK_TEKKEN_DIR, filename));
    }
    const ext = path.extname(targetFile).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    streamFile(targetFile, req, res, mime);
    return;
  }

  // Stream BIOS files
  if (pathname.startsWith('/bios/')) {
    const filename = pathname.slice('/bios/'.length);
    let targetFile = path.normalize(path.join(LOCAL_ROMS_DIR, filename));
    if (!fs.existsSync(targetFile)) {
      targetFile = path.normalize(path.join(FALLBACK_BIOS_DIR, filename));
    }
    streamFile(targetFile, req, res, 'application/octet-stream');
    return;
  }

  // Serve static files from /public
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  streamFile(filePath, req, res, mime);
});

// WebSocket Server for Online Multiplayer / Netplay
const wss = new WebSocketServer({ server });
const rooms = new Map(); // roomId -> { host: ws, guest: ws }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

wss.on('connection', (ws) => {
  ws.on('message', (message, isBinary) => {
    // Relay binary frames directly between Host and Guest
    if (isBinary) {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const target = ws.isHost ? room.guest : room.host;
      if (target && target.readyState === 1) {
        target.send(message, { binary: true });
      }
      return;
    }

    try {
      const data = JSON.parse(message.toString());

      // 1. Create Room (Host)
      if (data.type === 'create_room') {
        const roomId = generateRoomCode();
        rooms.set(roomId, { host: ws, guest: null });
        ws.roomId = roomId;
        ws.isHost = true;
        ws.send(JSON.stringify({ type: 'room_created', roomId }));
        console.log(`[Netplay] Room created: ${roomId}`);
        return;
      }

      // 2. Join Room (Guest)
      if (data.type === 'join_room') {
        const roomId = (data.roomId || '').trim().toUpperCase();
        const room = rooms.get(roomId);

        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: `Room "${roomId}" not found.` }));
          return;
        }
        if (room.guest && room.guest.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: `Room "${roomId}" is already full (2/2 players).` }));
          return;
        }

        room.guest = ws;
        ws.roomId = roomId;
        ws.isHost = false;

        ws.send(JSON.stringify({ type: 'room_joined', roomId, role: 'guest' }));
        room.host.send(JSON.stringify({ type: 'guest_connected', roomId }));
        console.log(`[Netplay] Guest joined room: ${roomId}`);
        return;
      }

      // 3. WebRTC Signaling (Relay between Host and Guest)
      if (data.type === 'signal') {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const target = ws.isHost ? room.guest : room.host;
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: 'signal', data: data.data }));
        }
        return;
      }

      // 4. Netplay Input (Bidirectional: Host <-> Guest)
      if (data.type === 'input') {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const target = ws.isHost ? room.guest : room.host;
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({
            type: 'input',
            player: data.player,
            action: data.action,
            button: data.button
          }));
        }
        return;
      }

      // 5. Savestate Handshake Sync (Host -> Guest)
      if (data.type === 'sync_state') {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const target = ws.isHost ? room.guest : room.host;
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({
            type: 'sync_state',
            state: data.state
          }));
        }
        return;
      }

      // 6. Request Sync (Guest -> Host)
      if (data.type === 'request_sync') {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        if (!room || !room.host || room.host.readyState !== 1) return;
        room.host.send(JSON.stringify({ type: 'request_sync' }));
        return;
      }

      // 5. Ping / Pong for Latency measurement
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
        return;
      }

    } catch (err) {
      console.error('[Netplay] Error handling message:', err);
    }
  });

  ws.on('close', () => {
    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      if (ws.isHost) {
        console.log(`[Netplay] Host left room: ${ws.roomId}`);
        if (room.guest && room.guest.readyState === 1) {
          room.guest.send(JSON.stringify({ type: 'peer_disconnected', message: 'Host has disconnected.' }));
        }
        rooms.delete(ws.roomId);
      } else {
        console.log(`[Netplay] Guest left room: ${ws.roomId}`);
        if (room.host && room.host.readyState === 1) {
          room.host.send(JSON.stringify({ type: 'peer_disconnected', message: 'Guest has disconnected.' }));
        }
        room.guest = null;
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tekken 3 Server running at http://localhost:${PORT}`);
});
