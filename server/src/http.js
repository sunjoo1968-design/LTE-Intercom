import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { collectAdminState, renderAdminPage, renderLoginPage, renderPasswordPage } from "./admin.js";
import { createOperationLogger } from "./operation-log.js";
import { createAdminAuth } from "./security.js";
import { snapshotRoom } from "./state.js";
import { attachSignaling } from "./ws.js";

export function createApp({ store, logger = console } = {}) {
  if (!store) throw new Error("store is required");

  const hub = createSignalingHub();
  const operationLogger = createOperationLogger();
  const events = createEventLog(100, operationLogger);
  const auth = createAdminAuth();

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, store, hub, events, server, auth);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(res, statusCode, {
        error: statusCode === 500 ? "internal_server_error" : "request_error",
        message: error.message
      });
      if (statusCode === 500) logger.error(error);
    }
  });

  attachSignaling(server, { store, hub, events, logger });

  return { server, hub };
}

async function route(req, res, store, hub, events, server, auth) {
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
      sendHtml(res, 200, renderLoginPage({ defaultPassword: auth.isDefaultPassword }));
      return;
    }
    sendHtml(res, 200, renderAdminPage());
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin/password") {
    if (!auth.isAuthenticated(req)) {
      sendHtml(res, 401, renderLoginPage({ defaultPassword: auth.isDefaultPassword }));
      return;
    }
    sendHtml(res, 200, renderPasswordPage());
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/login") {
    const body = await readForm(req);
    if (!auth.verifyPassword(body.password)) {
      events.push("admin.login.failed", { remoteAddress: req.socket.remoteAddress });
      sendHtml(res, 401, renderLoginPage({ defaultPassword: auth.isDefaultPassword }));
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
    sendJson(res, 200, await collectAdminState({ store, hub, events }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/events/clear") {
    events.clear();
    events.push("admin.events.clear", {
      pid: process.pid
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/password") {
    const body = await readJson(req);
    auth.changePassword(body.currentPassword, body.newPassword);
    events.push("admin.password.changed", {
      remoteAddress: req.socket.remoteAddress
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/server/keep-running") {
    events.push("admin.server.keep-running", {
      pid: process.pid
    });
    sendJson(res, 200, { ok: true, action: "keep-running", pid: process.pid });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/server/restart") {
    events.push("admin.server.restart", {
      pid: process.pid
    });
    sendJson(res, 202, { ok: true, action: "restart" });
    scheduleRestart(server);
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin/server/shutdown") {
    events.push("admin.server.shutdown", {
      pid: process.pid
    });
    sendJson(res, 202, { ok: true, action: "shutdown" });
    scheduleShutdown(server);
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
    events.push("room.deleted", {
      roomCode: deleted.code,
      participantCount: deleted.participantCount
    });
    sendJson(res, 200, { ok: true, room: deleted });
    return;
  }

  const adminDisconnectMatch = url.pathname.match(/^\/admin\/rooms\/([^/]+)\/participants\/([^/]+)\/disconnect$/);
  if (req.method === "POST" && adminDisconnectMatch) {
    const roomCode = decodeURIComponent(adminDisconnectMatch[1]);
    const participantId = decodeURIComponent(adminDisconnectMatch[2]);
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
    events.push("room.deleted", {
      roomCode: deleted.code,
      participantCount: deleted.participantCount
    });
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

function createSignalingHub() {
  const peersByRoom = new Map();

  function add(peer) {
    const roomPeers = peersByRoom.get(peer.roomCode) || new Set();
    roomPeers.add(peer);
    peersByRoom.set(peer.roomCode, roomPeers);
  }

  function remove(peer) {
    const roomPeers = peersByRoom.get(peer.roomCode);
    if (!roomPeers) return;
    roomPeers.delete(peer);
    if (roomPeers.size === 0) peersByRoom.delete(peer.roomCode);
  }

  function broadcast(roomCode, message, exceptPeer = null) {
    const roomPeers = peersByRoom.get(roomCode);
    if (!roomPeers) return;
    for (const peer of roomPeers) {
      if (peer !== exceptPeer) peer.send(message);
    }
  }

  function sendTo(roomCode, participantId, message) {
    const roomPeers = peersByRoom.get(roomCode);
    if (!roomPeers) return false;
    for (const peer of roomPeers) {
      if (peer.id === participantId) {
        peer.send(message);
        return true;
      }
    }
    return false;
  }

  function disconnect(roomCode, participantId) {
    const roomPeers = peersByRoom.get(roomCode);
    if (!roomPeers) return false;
    for (const peer of roomPeers) {
      if (peer.id === participantId) {
        peer.close();
        return true;
      }
    }
    return false;
  }

  function disconnectRoom(roomCode) {
    const roomPeers = peersByRoom.get(roomCode);
    if (!roomPeers) return 0;
    const peers = [...roomPeers];
    for (const peer of peers) peer.close();
    return peers.length;
  }

  function peerCount() {
    let count = 0;
    for (const peers of peersByRoom.values()) count += peers.size;
    return count;
  }

  return { add, remove, broadcast, sendTo, disconnect, disconnectRoom, peerCount };
}

function createEventLog(limit = 100, operationLogger = null) {
  const events = [];

  function push(type, detail = {}) {
    operationLogger?.write(type, detail);
    events.push({
      at: new Date().toISOString(),
      type,
      ...detail
    });
    while (events.length > limit) events.shift();
  }

  function list() {
    return [...events].reverse();
  }

  function clear() {
    events.length = 0;
  }

  return { push, list, clear };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return Object.fromEntries(params.entries());
}

function redirect(res, location) {
  res.writeHead(303, {
    location,
    "cache-control": "no-store"
  });
  res.end();
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function scheduleRestart(server) {
  const helperScript = [
    "const { spawn } = require('node:child_process');",
    "const execPath = process.env.LTE_INTERCOM_RESTART_EXEC;",
    "const args = JSON.parse(process.env.LTE_INTERCOM_RESTART_ARGS || '[]');",
    "const cwd = process.env.LTE_INTERCOM_RESTART_CWD;",
    "setTimeout(() => {",
    "  const child = spawn(execPath, args, { cwd, detached: true, stdio: 'ignore', env: process.env });",
    "  child.unref();",
    "}, 900);",
    "setTimeout(() => {}, 1400);"
  ].join("\n");

  spawn(process.execPath, ["-e", helperScript], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      LTE_INTERCOM_RESTART_EXEC: process.execPath,
      LTE_INTERCOM_RESTART_ARGS: JSON.stringify(process.argv.slice(1)),
      LTE_INTERCOM_RESTART_CWD: process.cwd()
    }
  }).unref();

  scheduleShutdown(server);
}

function scheduleShutdown(server) {
  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }, 150).unref();
}
