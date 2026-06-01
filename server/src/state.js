import { randomUUID } from "node:crypto";
import { createPasswordHash, verifyPasswordHash } from "./security.js";

const DEFAULT_CHANNELS = [
  { id: "program", label: "PROGRAM", shortLabel: "PGM", listenDefault: true },
  { id: "director", label: "DIRECTOR", shortLabel: "DIR", listenDefault: true },
  { id: "camera", label: "CAMERA", shortLabel: "CAM", listenDefault: false },
  { id: "ifb", label: "IFB", shortLabel: "IFB", listenDefault: false }
];

export function createStore(now = () => new Date()) {
  const rooms = new Map();

  function createRoom(input = {}) {
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
  }

  function listRooms() {
    return [...rooms.values()].map(snapshotRoom);
  }

  function listPublicRooms() {
    return [...rooms.values()].map(snapshotPublicRoom);
  }

  function getRoom(code) {
    return rooms.get(normalizeCode(code));
  }

  function updateRoom(code, input = {}) {
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
  }

  function deleteRoom(code) {
    const normalized = normalizeCode(code);
    const room = rooms.get(normalized);
    if (!room) return null;
    const snapshot = snapshotRoom(room);
    rooms.delete(normalized);
    return snapshot;
  }

  function hasRooms() {
    return rooms.size > 0;
  }

  function roomExists(code) {
    return rooms.has(normalizeCode(code));
  }

  function ensureRoom(code) {
    const normalized = normalizeCode(code);
    const existing = rooms.get(normalized);
    if (existing) return existing;
    createRoom({ name: normalized, code: normalized });
    return rooms.get(normalized);
  }

  function joinRoom({ roomCode, displayName, clientId = randomUUID() }) {
    const room = ensureRoom(roomCode);
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
    return {
      room: snapshotRoom(room),
      participant: { ...participant }
    };
  }

  function removeDuplicateParticipants(roomCode, displayName, exceptId = null) {
    const room = getRoom(roomCode);
    if (!room) return [];
    const normalizedName = normalizeName(displayName).toLowerCase();
    if (!normalizedName) return [];
    const removed = [];
    for (const participant of room.participants.values()) {
      if (participant.id === exceptId) continue;
      if (normalizeName(participant.displayName).toLowerCase() !== normalizedName) continue;
      room.participants.delete(participant.id);
      removed.push({ ...participant, connected: false, updatedAt: now().toISOString() });
    }
    return removed;
  }

  function canJoinRoom(roomCode, password = "") {
    const room = getRoom(roomCode);
    if (!room) return !hasRooms();
    return verifyPasswordHash(password, room.password);
  }

  function isRoomPasswordProtected(roomCode) {
    const room = getRoom(roomCode);
    return Boolean(room?.password);
  }

  function updateParticipant(roomCode, participantId, patch) {
    const room = getRoom(roomCode);
    if (!room) return null;
    const participant = room.participants.get(participantId);
    if (!participant) return null;
    const allowed = [
      "talking",
      "listening",
      "muted",
      "rttMs",
      "packetLoss",
      "jitterMs",
      "headset",
      "network"
    ];
    for (const key of allowed) {
      if (Object.hasOwn(patch, key)) {
        participant[key] = patch[key];
      }
    }
    participant.updatedAt = now().toISOString();
    return { ...participant };
  }

  function leaveRoom(roomCode, participantId) {
    const room = getRoom(roomCode);
    if (!room) return null;
    const participant = room.participants.get(participantId);
    if (!participant) return null;
    room.participants.delete(participantId);
    return { ...participant, connected: false, updatedAt: now().toISOString() };
  }

  return {
    createRoom,
    listRooms,
    listPublicRooms,
    getRoom,
    updateRoom,
    deleteRoom,
    hasRooms,
    roomExists,
    ensureRoom,
    canJoinRoom,
    isRoomPasswordProtected,
    joinRoom,
    removeDuplicateParticipants,
    updateParticipant,
    leaveRoom
  };
}

export function snapshotPublicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    description: room.description || room.name,
    passwordProtected: Boolean(room.password),
    participantCount: room.participants.size
  };
}

export function snapshotRoom(room) {
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

function normalizeName(value) {
  return String(value || "").trim().slice(0, 64);
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
  if (!Array.isArray(channels) || channels.length === 0) {
    return DEFAULT_CHANNELS.map((channel) => ({ ...channel }));
  }
  return channels.slice(0, 24).map((channel, index) => ({
    id: normalizeChannelId(channel.id || `ch-${index + 1}`),
    label: normalizeName(channel.label || `CH ${index + 1}`).toUpperCase(),
    shortLabel: normalizeName(channel.shortLabel || channel.label || `CH${index + 1}`)
      .toUpperCase()
      .slice(0, 8),
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
