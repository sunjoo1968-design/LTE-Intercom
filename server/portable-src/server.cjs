const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_CHANNELS = [
  { id: "program", label: "PROGRAM", shortLabel: "PGM", listenDefault: true },
  { id: "director", label: "DIRECTOR", shortLabel: "DIR", listenDefault: true },
  { id: "camera", label: "CAMERA", shortLabel: "CAM", listenDefault: false },
  { id: "ifb", label: "IFB", shortLabel: "IFB", listenDefault: false }
];

const baseDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8443);
const host = process.env.HOST || "0.0.0.0";
const store = createStore();
const hub = createSignalingHub();
const events = createEventLog();
const auth = createAdminAuth();
const publicIpCache = { value: null, checkedAt: 0 };

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: "request_error",
      message: error.message
    });
  }
});

attachSignaling(server);

server.listen(port, host, () => {
  console.log(`LTE Intercom server listening on http://${host}:${port}`);
  console.log(`LTE Intercom server control UI http://localhost:${port}/admin`);
});

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "lte-intercom-server",
      rooms: store.listRooms().length,
      peers: hub.peerCount(),
      serverTime: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/public/rooms") {
    sendJson(res, 200, { rooms: store.listPublicRooms() });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
    if (!auth.isAuthenticated(req)) {
      sendHtml(res, 200, renderLoginPage());
      return;
    }
    sendHtml(res, 200, readAdminHtml());
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin/password") {
    if (!auth.isAuthenticated(req)) {
      sendHtml(res, 200, renderLoginPage());
      return;
    }
    sendHtml(res, 200, renderPasswordPage());
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/login") {
    const body = await readForm(req);
    if (!auth.verifyPassword(body.password)) {
      events.push("admin.login.failed", { remoteAddress: req.socket.remoteAddress });
      sendHtml(res, 401, renderLoginPage());
      return;
    }
    auth.setSessionCookie(res);
    events.push("admin.login", { remoteAddress: req.socket.remoteAddress });
    redirect(res, "/admin");
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/logout") {
    auth.clearSessionCookie(res);
    events.push("admin.logout", { remoteAddress: req.socket.remoteAddress });
    redirect(res, "/admin");
    return;
  }

  if (url.pathname.startsWith("/admin") && !auth.isAuthenticated(req)) {
    sendJson(res, 401, { error: "admin_auth_required" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin/state") {
    sendJson(res, 200, await collectAdminState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/events/clear") {
    events.clear();
    events.push("admin.events.clear", { pid: process.pid });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/password") {
    const body = await readJson(req);
    auth.changePassword(body.currentPassword, body.newPassword);
    events.push("admin.password.changed", { remoteAddress: req.socket.remoteAddress });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/server/keep-running") {
    events.push("admin.server.keep-running", { pid: process.pid });
    sendJson(res, 200, { ok: true, action: "keep-running", pid: process.pid });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/server/restart") {
    events.push("admin.server.restart", { pid: process.pid });
    sendJson(res, 202, { ok: true, action: "restart" });
    scheduleRestart();
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/server/shutdown") {
    events.push("admin.server.shutdown", { pid: process.pid });
    sendJson(res, 202, { ok: true, action: "shutdown" });
    scheduleShutdown();
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    sendJson(res, 200, { events: events.list() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/rooms") {
    if (!auth.isAuthenticated(req)) {
      sendJson(res, 401, { error: "admin_auth_required" });
      return;
    }
    sendJson(res, 200, { rooms: store.listRooms() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/rooms") {
    if (!auth.isAuthenticated(req)) {
      sendJson(res, 401, { error: "admin_auth_required" });
      return;
    }
    const body = await readJson(req);
    const room = store.createRoom(body);
    events.push("room.created", {
      roomCode: room.code,
      roomDescription: room.description || room.name,
      passwordProtected: room.passwordProtected,
      source: "http"
    });
    sendJson(res, 201, { room });
    return;
  }

  const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)$/);
  if ((req.method === "PUT" || req.method === "DELETE") && roomMatch) {
    if (!auth.isAuthenticated(req)) {
      sendJson(res, 401, { error: "admin_auth_required" });
      return;
    }
    const roomCode = decodeURIComponent(roomMatch[1]);
    if (req.method === "PUT") {
      const body = await readJson(req);
      const room = store.updateRoom(roomCode, body);
      events.push("room.updated", {
        roomCode: room.code,
        roomDescription: room.description || room.name,
        passwordProtected: room.passwordProtected
      });
      sendJson(res, 200, { room });
      return;
    }
    const room = store.getRoom(roomCode);
    if (!room) {
      sendJson(res, 404, { error: "room_not_found" });
      return;
    }
    hub.disconnectRoom(room.code);
    const deleted = store.deleteRoom(room.code);
    events.push("room.deleted", { roomCode: deleted.code, participantCount: deleted.participantCount });
    sendJson(res, 200, { ok: true, room: deleted });
    return;
  }

  const disconnectMatch = url.pathname.match(/^\/admin\/rooms\/([^/]+)\/participants\/([^/]+)\/disconnect$/);
  if (req.method === "POST" && disconnectMatch) {
    const roomCode = decodeURIComponent(disconnectMatch[1]);
    const participantId = decodeURIComponent(disconnectMatch[2]);
    const room = store.getRoom(roomCode);
    const participant = room?.participants.get(participantId);
    if (!room || !participant) {
      sendJson(res, 404, { error: "participant_not_found" });
      return;
    }
    const disconnected = hub.disconnect(room.code, participantId);
    const removed = store.leaveRoom(room.code, participantId);
    const nextRoom = store.getRoom(room.code);
    if (removed) {
      hub.broadcast(room.code, { type: "participant.left", participant: removed, room: nextRoom ? snapshotRoom(nextRoom) : null });
    }
    events.push("admin.participant.disconnect", {
      roomCode: room.code,
      displayName: participant.displayName,
      participantId,
      peerConnected: disconnected
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  const adminRoomActionMatch = url.pathname.match(/^\/admin\/rooms\/([^/]+)\/(update|delete)$/);
  if (req.method === "POST" && adminRoomActionMatch) {
    const roomCode = decodeURIComponent(adminRoomActionMatch[1]);
    const action = adminRoomActionMatch[2];
    if (action === "update") {
      const body = await readJson(req);
      const room = store.updateRoom(roomCode, body);
      events.push("room.updated", {
        roomCode: room.code,
        roomDescription: room.description || room.name,
        passwordProtected: room.passwordProtected
      });
      sendJson(res, 200, { room });
      return;
    }
    const room = store.getRoom(roomCode);
    if (!room) {
      sendJson(res, 404, { error: "room_not_found" });
      return;
    }
    hub.disconnectRoom(room.code);
    const deleted = store.deleteRoom(room.code);
    events.push("room.deleted", { roomCode: deleted.code, participantCount: deleted.participantCount });
    sendJson(res, 200, { ok: true, room: deleted });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/rooms/")) {
    if (!auth.isAuthenticated(req)) {
      sendJson(res, 401, { error: "admin_auth_required" });
      return;
    }
    const roomCode = decodeURIComponent(url.pathname.split("/")[2] || "");
    const room = store.getRoom(roomCode);
    if (!room) {
      sendJson(res, 404, { error: "room_not_found" });
      return;
    }
    sendJson(res, 200, { room: snapshotRoom(room) });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

function attachSignaling(httpServer) {
  httpServer.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/signal") {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    const roomCode = url.searchParams.get("room") || "LIVE";
    const roomPassword = url.searchParams.get("password") || "";
    const displayName = url.searchParams.get("name") || "REMOTE";
    const remoteAddress = req.socket.remoteAddress;
    const clientId = randomUUID();
    const accept = createHash("sha1").update(`${key}${WS_MAGIC}`).digest("base64");

    if (!store.roomExists(roomCode) && store.hasRooms()) {
      events.push("participant.room.failed", { roomCode, displayName, remoteAddress });
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!store.canJoinRoom(roomCode, roomPassword)) {
      events.push("participant.auth.failed", { roomCode, displayName, remoteAddress });
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n"));

    const duplicateParticipants = store.removeDuplicateParticipants(roomCode, displayName);
    for (const duplicate of duplicateParticipants) {
      hub.disconnect(roomCode, duplicate.id);
      events.push("participant.replaced", {
        roomCode,
        displayName: duplicate.displayName,
        participantId: duplicate.id,
        remoteAddress
      });
    }

    const join = store.joinRoom({ roomCode, displayName, clientId });
    const peer = {
      id: clientId,
      roomCode: join.room.code,
      send: (message) => sendFrame(socket, JSON.stringify(message)),
      close: () => socket.destroy()
    };
    hub.add(peer);
    events.push("participant.joined", {
      roomCode: peer.roomCode,
      displayName: join.participant.displayName,
      participantId: clientId,
      remoteAddress
    });

    peer.send({ type: "welcome", participant: join.participant, room: join.room });
    hub.broadcast(peer.roomCode, { type: "participant.joined", participant: join.participant, room: join.room }, peer);

    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        let frame;
        while ((frame = readFrame(buffer))) {
          buffer = buffer.subarray(frame.consumed);
          if (frame.opcode === 0x8) {
            socket.end();
            return;
          }
          if (frame.opcode === 0x9) {
            sendControlFrame(socket, 0xA, frame.payload);
            continue;
          }
          if (frame.opcode !== 0x1) continue;
          handleMessage(frame.payload.toString("utf8"), peer);
        }
      } catch {
        socket.end();
      }
    });
    socket.on("close", () => cleanupPeer(peer));
    socket.on("error", () => cleanupPeer(peer));
  });
}

function handleMessage(raw, peer) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    peer.send({ type: "error", error: "invalid_json" });
    return;
  }

  if (message.type === "state.update") {
    const participant = store.updateParticipant(peer.roomCode, peer.id, message.payload || {});
    if (!participant) return;
    const room = store.getRoom(peer.roomCode);
    events.push("participant.state", {
      roomCode: peer.roomCode,
      displayName: participant.displayName,
      participantId: participant.id,
      talking: participant.talking,
      listening: participant.listening,
      muted: participant.muted
    });
    hub.broadcast(peer.roomCode, { type: "participant.state", participant, room: room ? snapshotRoom(room) : null });
    return;
  }

  if (message.type === "call.signal") {
    events.push("call.signal", {
      roomCode: peer.roomCode,
      fromParticipantId: peer.id,
      channelId: message.payload?.channelId
    });
    hub.broadcast(peer.roomCode, { type: "call.signal", fromParticipantId: peer.id, payload: message.payload || {} });
    return;
  }

  if (message.type === "room.snapshot") {
    const room = store.getRoom(peer.roomCode);
    if (room) peer.send({ type: "room.snapshot", room: snapshotRoom(room) });
    return;
  }

  if (message.type === "audio.frame") {
    const payload = message.payload || {};
    if (typeof payload.pcm16 !== "string") {
      peer.send({ type: "error", error: "invalid_audio_frame" });
      return;
    }
    hub.broadcast(peer.roomCode, {
      type: "audio.frame",
      fromParticipantId: peer.id,
      payload: {
        codec: "pcm16",
        sampleRate: payload.sampleRate || 16000,
        channels: payload.channels || 1,
        pcm16: payload.pcm16
      }
    }, peer);
    return;
  }

  if (message.type === "webrtc.signal") {
    const payload = message.payload || {};
    const targetParticipantId = message.toParticipantId || payload.toParticipantId;
    const outgoing = {
      type: "webrtc.signal",
      fromParticipantId: peer.id,
      toParticipantId: targetParticipantId || null,
      payload
    };
    events.push("webrtc.signal", {
      roomCode: peer.roomCode,
      fromParticipantId: peer.id,
      toParticipantId: targetParticipantId || null,
      kind: payload.kind || payload.type || "unknown"
    });
    if (targetParticipantId) {
      if (!hub.sendTo(peer.roomCode, targetParticipantId, outgoing)) {
        peer.send({ type: "error", error: "target_participant_not_found", participantId: targetParticipantId });
      }
    } else {
      hub.broadcast(peer.roomCode, outgoing, peer);
    }
    return;
  }

  peer.send({ type: "error", error: "unknown_message_type", messageType: message.type });
}

function cleanupPeer(peer) {
  const participant = store.leaveRoom(peer.roomCode, peer.id);
  const room = store.getRoom(peer.roomCode);
  hub.remove(peer);
  if (participant) {
    events.push("participant.left", {
      roomCode: peer.roomCode,
      displayName: participant.displayName,
      participantId: participant.id
    });
    hub.broadcast(peer.roomCode, { type: "participant.left", participant, room: room ? snapshotRoom(room) : null });
  }
}

function createStore(now = () => new Date()) {
  const rooms = new Map();
  return {
    createRoom(input = {}) {
      const name = normalizeName(input.description || input.name) || "LIVE";
      const code = normalizeCode(input.code || name);
      if (rooms.has(code)) {
        const error = new Error(`Room already exists: ${code}`);
        error.statusCode = 409;
        throw error;
      }
      const room = {
        id: randomUUID(),
        code,
        name,
        description: name,
        password: createPasswordHash(input.password),
        channels: normalizeChannels(input.channels),
        participants: new Map(),
        createdAt: now().toISOString()
      };
      rooms.set(code, room);
      return snapshotRoom(room);
    },
    listRooms() {
      return [...rooms.values()].map(snapshotRoom);
    },
    listPublicRooms() {
      return [...rooms.values()].map(snapshotPublicRoom);
    },
    getRoom(code) {
      return rooms.get(normalizeCode(code));
    },
    updateRoom(code, input = {}) {
      const normalized = normalizeCode(code);
      const room = rooms.get(normalized);
      if (!room) {
        const error = new Error("room_not_found");
        error.statusCode = 404;
        throw error;
      }
      const nextDescription = normalizeName(input.description || input.name);
      if (nextDescription) {
        room.name = nextDescription;
        room.description = nextDescription;
      }
      if (Object.hasOwn(input, "password")) {
        room.password = createPasswordHash(input.password);
      }
      return snapshotRoom(room);
    },
    deleteRoom(code) {
      const normalized = normalizeCode(code);
      const room = rooms.get(normalized);
      if (!room) return null;
      const snapshot = snapshotRoom(room);
      rooms.delete(normalized);
      return snapshot;
    },
    hasRooms() {
      return rooms.size > 0;
    },
    roomExists(code) {
      return rooms.has(normalizeCode(code));
    },
    ensureRoom(code) {
      const normalized = normalizeCode(code);
      const existing = rooms.get(normalized);
      if (existing) return existing;
      this.createRoom({ name: normalized, code: normalized });
      return rooms.get(normalized);
    },
    canJoinRoom(roomCode, password = "") {
      const room = this.getRoom(roomCode);
      if (!room) return !this.hasRooms();
      return verifyPasswordHash(password, room.password);
    },
    joinRoom({ roomCode, displayName, clientId = randomUUID() }) {
      const room = this.ensureRoom(roomCode);
      const participant = {
        id: clientId,
        displayName: normalizeName(displayName) || `USER-${room.participants.size + 1}`,
        connected: true,
        talking: false,
        listening: true,
        muted: false,
        rttMs: null,
        packetLoss: null,
        jitterMs: null,
        joinedAt: now().toISOString(),
        updatedAt: now().toISOString()
      };
      room.participants.set(clientId, participant);
      return { room: snapshotRoom(room), participant: { ...participant } };
    },
    removeDuplicateParticipants(roomCode, displayName, exceptId = null) {
      const room = this.getRoom(roomCode);
      if (!room) return [];
      const normalizedName = normalizeName(displayName).toLowerCase();
      if (!normalizedName) return [];
      const removed = [];
      for (const [participantId, participant] of room.participants.entries()) {
        if (participantId === exceptId) continue;
        if (normalizeName(participant.displayName).toLowerCase() !== normalizedName) continue;
        room.participants.delete(participantId);
        removed.push({ ...participant, connected: false, updatedAt: now().toISOString() });
      }
      return removed;
    },
    updateParticipant(roomCode, participantId, patch) {
      const room = this.getRoom(roomCode);
      if (!room) return null;
      const participant = room.participants.get(participantId);
      if (!participant) return null;
      for (const key of ["talking", "listening", "muted", "rttMs", "packetLoss", "jitterMs", "headset", "network"]) {
        if (Object.hasOwn(patch, key)) participant[key] = patch[key];
      }
      participant.updatedAt = now().toISOString();
      return { ...participant };
    },
    leaveRoom(roomCode, participantId) {
      const room = this.getRoom(roomCode);
      if (!room) return null;
      const participant = room.participants.get(participantId);
      if (!participant) return null;
      room.participants.delete(participantId);
      return { ...participant, connected: false, updatedAt: now().toISOString() };
    }
  };
}

function snapshotPublicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    description: room.description || room.name,
    passwordProtected: Boolean(room.password),
    participantCount: room.participants.size
  };
}

function snapshotRoom(room) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    description: room.description || room.name,
    passwordProtected: Boolean(room.password),
    channels: room.channels.map((channel) => ({ ...channel })),
    participants: [...room.participants.values()].map((participant) => ({ ...participant })),
    participantCount: room.participants.size,
    createdAt: room.createdAt
  };
}

function createSignalingHub() {
  const peersByRoom = new Map();
  return {
    add(peer) {
      const roomPeers = peersByRoom.get(peer.roomCode) || new Set();
      roomPeers.add(peer);
      peersByRoom.set(peer.roomCode, roomPeers);
    },
    remove(peer) {
      const roomPeers = peersByRoom.get(peer.roomCode);
      if (!roomPeers) return;
      roomPeers.delete(peer);
      if (roomPeers.size === 0) peersByRoom.delete(peer.roomCode);
    },
    broadcast(roomCode, message, exceptPeer = null) {
      const roomPeers = peersByRoom.get(roomCode);
      if (!roomPeers) return;
      for (const peer of roomPeers) {
        if (peer !== exceptPeer) peer.send(message);
      }
    },
    sendTo(roomCode, participantId, message) {
      const roomPeers = peersByRoom.get(roomCode);
      if (!roomPeers) return false;
      for (const peer of roomPeers) {
        if (peer.id === participantId) {
          peer.send(message);
          return true;
        }
      }
      return false;
    },
    disconnect(roomCode, participantId) {
      const roomPeers = peersByRoom.get(roomCode);
      if (!roomPeers) return false;
      for (const peer of roomPeers) {
        if (peer.id === participantId) {
          peer.close();
          return true;
        }
      }
      return false;
    },
    disconnectRoom(roomCode) {
      const roomPeers = peersByRoom.get(roomCode);
      if (!roomPeers) return 0;
      const peers = [...roomPeers];
      for (const peer of peers) peer.close();
      return peers.length;
    },
    peerCount() {
      let count = 0;
      for (const peers of peersByRoom.values()) count += peers.size;
      return count;
    }
  };
}

function createEventLog(limit = 100) {
  const rows = [];
  return {
    push(type, detail = {}) {
      const row = { at: new Date().toISOString(), type, ...detail };
      writeOperationLog(row);
      rows.push(row);
      while (rows.length > limit) rows.shift();
    },
    list() {
      return [...rows].reverse();
    },
    clear() {
      rows.length = 0;
    }
  };
}

function writeOperationLog(row) {
  const logDir = process.env.LOG_DIR || path.join(baseDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const safeRow = { ...row };
  for (const key of Object.keys(safeRow)) {
    if (/password|token|secret/i.test(key)) safeRow[key] = "[redacted]";
  }
  fs.appendFile(path.join(logDir, `operations-${date}.jsonl`), `${JSON.stringify(safeRow)}\n`, () => {});
}

async function collectAdminState() {
  const rooms = store.listRooms();
  const participants = rooms.flatMap((room) =>
    room.participants.map((participant) => ({ ...participant, roomCode: room.code, roomDescription: room.description || room.name }))
  );
  const publicIp = await resolvePublicIp();
  const interfaces = listNetworkInterfaces();
  const firstLanIp = interfaces[0]?.address || "SERVER_IP";
  const portText = String(port || "8443");
  const localPortOpen = await checkHttpPort("127.0.0.1", portText);
  const publicPortOpen = publicIp && publicIp !== "unavailable"
    ? await checkHttpPort(publicIp, portText)
    : false;
  return {
    server: {
      service: "lte-intercom-server",
      status: "online",
      serverTime: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      pid: process.pid,
      node: process.version,
      memory: process.memoryUsage()
    },
    network: {
      hostname: os.hostname(),
      publicIp,
      port: portText,
      adminUrl: `http://localhost:${portText}/admin`,
      localAppUrl: `ws://${firstLanIp}:${portText}/signal`,
      publicAppUrl: publicIp && publicIp !== "unavailable" ? `ws://${publicIp}:${portText}/signal` : "",
      roomsUrl: `http://${firstLanIp}:${portText}/public/rooms`,
      portStatus: {
        local: localPortOpen ? "OPEN" : "CLOSED",
        public: publicIp && publicIp !== "unavailable" ? (publicPortOpen ? "OPEN" : "CLOSED") : "UNKNOWN"
      },
      interfaces
    },
    totals: {
      rooms: rooms.length,
      peers: hub.peerCount(),
      participants: participants.length,
      talkers: participants.filter((participant) => participant.talking).length,
      listeners: participants.filter((participant) => participant.listening).length,
      muted: participants.filter((participant) => participant.muted).length
    },
    rooms,
    events: events.list()
  };
}

function listNetworkInterfaces() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal) continue;
      if (entry.family !== "IPv4" && entry.family !== 4) continue;
      result.push({ name, address: entry.address, family: entry.family, mac: entry.mac });
    }
  }
  return result;
}

async function resolvePublicIp() {
  if (process.env.PUBLIC_IP) return process.env.PUBLIC_IP;
  const now = Date.now();
  if (publicIpCache.value && now - publicIpCache.checkedAt < 5 * 60 * 1000) return publicIpCache.value;
  const value = await new Promise((resolve) => {
    const req = https.get("https://api.ipify.org?format=json", { timeout: 1500 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(typeof body.ip === "string" ? body.ip : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
  publicIpCache.value = value || "unavailable";
  publicIpCache.checkedAt = now;
  return publicIpCache.value;
}

function readAdminHtml() {
  const file = path.join(baseDir, "admin", "index.html");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  return "<!doctype html><title>LTE Intercom Server</title><h1>Admin UI not found</h1>";
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")).entries());
}

function redirect(res, location) {
  res.writeHead(303, { location, "cache-control": "no-store" });
  res.end();
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function scheduleRestart() {
  const helperScript = [
    "const { spawn } = require('node:child_process');",
    "const execPath = process.env.LTE_INTERCOM_RESTART_EXEC;",
    "const cwd = process.env.LTE_INTERCOM_RESTART_CWD;",
    "setTimeout(() => { const child = spawn(execPath, [], { cwd, detached: true, stdio: 'ignore', env: process.env }); child.unref(); }, 900);",
    "setTimeout(() => {}, 1400);"
  ].join("\n");
  spawn(process.execPath, ["-e", helperScript], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, LTE_INTERCOM_RESTART_EXEC: process.execPath, LTE_INTERCOM_RESTART_CWD: process.cwd() }
  }).unref();
  scheduleShutdown();
}

function scheduleShutdown() {
  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }, 150).unref();
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) === 0x80;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Frame too large");
    length = Number(bigLength);
    offset += 8;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload, consumed: offset + length };
}

function sendFrame(socket, text) {
  const payload = Buffer.from(text, "utf8");
  socket.write(Buffer.concat([buildHeader(0x1, payload.length), payload]));
}

function sendControlFrame(socket, opcode, payload) {
  socket.write(Buffer.concat([buildHeader(opcode, payload.length), payload]));
}

function buildHeader(opcode, length) {
  if (length < 126) return Buffer.from([0x80 | opcode, length]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

function normalizeName(value) {
  return String(value || "").trim().slice(0, 64);
}

function createAdminAuth() {
  const password = String(process.env.ADMIN_PASSWORD || "admin");
  const configPath = process.env.ADMIN_AUTH_FILE || path.join(baseDir, "config", "admin-auth.json");
  let hasStoredPassword = false;
  let passwordHash = loadAdminPasswordHash(configPath);
  if (passwordHash) {
    hasStoredPassword = true;
  } else {
    passwordHash = createPasswordHash(password);
  }
  const token = randomBytesHex(32);
  return {
    get isDefaultPassword() {
      return !hasStoredPassword && password === "admin";
    },
    verifyPassword(input) {
      return verifyPasswordHash(input, passwordHash);
    },
    changePassword(currentPassword, newPassword) {
      if (!this.verifyPassword(currentPassword)) {
        const error = new Error("current_password_invalid");
        error.statusCode = 401;
        throw error;
      }
      if (String(newPassword || "").trim().length < 4) {
        const error = new Error("new_password_too_short");
        error.statusCode = 400;
        throw error;
      }
      passwordHash = createPasswordHash(newPassword);
      saveAdminPasswordHash(configPath, passwordHash);
      hasStoredPassword = true;
    },
    isAuthenticated(req) {
      return parseCookies(req.headers.cookie || "").lte_intercom_admin === token;
    },
    setSessionCookie(res) {
      res.setHeader("set-cookie", `lte_intercom_admin=${token}; HttpOnly; SameSite=Strict; Path=/`);
    },
    clearSessionCookie(res) {
      res.setHeader("set-cookie", "lte_intercom_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    }
  };
}

function loadAdminPasswordHash(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (parsed?.passwordHash?.salt && parsed?.passwordHash?.hash) return parsed.passwordHash;
  } catch {
    return null;
  }
  return null;
}

function saveAdminPasswordHash(configPath, passwordHash) {
  if (!configPath) return;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ passwordHash, updatedAt: new Date().toISOString() }, null, 2));
}

function renderLoginPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LTE Intercom Admin Login</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090c;color:#f4f7fb;font-family:Arial,Helvetica,sans-serif}form{width:min(420px,calc(100vw - 32px));padding:24px;background:#12171d;border:1px solid #2f3a46;border-radius:8px}h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#9aa8b6;font-size:13px}label{display:grid;gap:7px;color:#9aa8b6;font-size:12px;font-weight:800}input{height:42px;padding:0 12px;border:1px solid #2f3a46;border-radius:6px;background:#0d1116;color:#f4f7fb;font-size:15px}button{width:100%;height:42px;margin-top:16px;border:1px solid rgba(35,193,107,.7);border-radius:6px;background:#123321;color:#23c16b;font-weight:900}.warn{margin-top:14px;color:#ef3f45;font-size:12px}</style></head><body><form method="post" action="/admin/login"><h1>Admin Login</h1><p>Enter the server administrator password.</p><label>ADMIN PASSWORD<input name="password" type="password" autocomplete="current-password" autofocus></label><button type="submit">LOGIN</button>${auth.isDefaultPassword ? '<div class="warn">Default password is active. Change it in Admin before field use.</div>' : ""}</form></body></html>`;
}

function renderPasswordPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Change Admin Password</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090c;color:#f4f7fb;font-family:Arial,Helvetica,sans-serif}main{width:min(460px,calc(100vw - 32px));padding:24px;background:#12171d;border:1px solid #2f3a46;border-radius:8px}h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#9aa8b6;font-size:13px}label{display:grid;gap:7px;margin-top:12px;color:#9aa8b6;font-size:12px;font-weight:800}input{height:42px;padding:0 12px;border:1px solid #2f3a46;border-radius:6px;background:#0d1116;color:#f4f7fb;font-size:15px}button,a{display:block;text-align:center;width:100%;box-sizing:border-box;height:42px;line-height:42px;margin-top:16px;border:1px solid rgba(35,193,107,.7);border-radius:6px;background:#123321;color:#23c16b;font-weight:900;text-decoration:none}a{border-color:#2f3a46;background:#0d1116;color:#9aa8b6}</style></head><body><main><h1>Change Admin Password</h1><p>This page is separated from the live server dashboard.</p><label>CURRENT PASSWORD<input id="current" type="password" autocomplete="current-password"></label><label>NEW PASSWORD<input id="next" type="password" autocomplete="new-password"></label><button id="save" type="button">SAVE PASSWORD</button><a href="/admin">BACK TO ADMIN</a></main><script>document.getElementById('save').onclick=async()=>{const currentPassword=document.getElementById('current').value;const newPassword=document.getElementById('next').value;const res=await fetch('/admin/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({currentPassword,newPassword})});alert(res.ok?'Password changed':'Password change failed');if(res.ok) location.href='/admin';};</script></body></html>`;
}

function checkHttpPort(host, portValue) {
  return new Promise((resolve) => {
    const req = http.get({ host, port: Number(portValue), path: "/health", timeout: 900 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function createPasswordHash(password) {
  const value = String(password || "");
  if (!value) return null;
  const salt = randomBytesHex(16);
  return { salt, hash: hashPassword(value, salt) };
}

function verifyPasswordHash(password, stored) {
  if (!stored?.salt || !stored?.hash) return true;
  return safeEqual(hashPassword(String(password || ""), stored.salt), stored.hash);
}

function hashPassword(password, salt) {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function randomBytesHex(length) {
  return randomBytes(length).toString("hex");
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return createHash("sha256").update(leftBuffer).digest("hex") === createHash("sha256").update(rightBuffer).digest("hex");
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function normalizeChannels(channels) {
  if (!Array.isArray(channels) || channels.length === 0) return DEFAULT_CHANNELS.map((channel) => ({ ...channel }));
  return channels.slice(0, 24).map((channel, index) => ({
    id: normalizeChannelId(channel.id || `ch-${index + 1}`),
    label: normalizeName(channel.label || `CH ${index + 1}`).toUpperCase(),
    shortLabel: normalizeName(channel.shortLabel || channel.label || `CH${index + 1}`).toUpperCase().slice(0, 8),
    listenDefault: Boolean(channel.listenDefault)
  }));
}

function normalizeChannelId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}
