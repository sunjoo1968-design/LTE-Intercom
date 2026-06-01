import { createHash, randomUUID } from "node:crypto";
import { snapshotRoom } from "./state.js";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function attachSignaling(server, { store, hub, events, logger = console }) {
  server.on("upgrade", (req, socket) => {
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
      events?.push("participant.room.failed", {
        roomCode,
        displayName,
        remoteAddress
      });
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!store.canJoinRoom(roomCode, roomPassword)) {
      events?.push("participant.auth.failed", {
        roomCode,
        displayName,
        remoteAddress
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n"
      ].join("\r\n")
    );

    const duplicateParticipants = store.removeDuplicateParticipants(roomCode, displayName);
    for (const duplicate of duplicateParticipants) {
      hub.disconnect(roomCode, duplicate.id);
      events?.push("participant.replaced", {
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
    events?.push("participant.joined", {
      roomCode: peer.roomCode,
      displayName: join.participant.displayName,
      participantId: clientId,
      remoteAddress
    });
    logger.log(
      `[signal] joined room=${peer.roomCode} name=${join.participant.displayName} peer=${clientId} remote=${remoteAddress}`
    );

    peer.send({ type: "welcome", participant: join.participant, room: join.room });
    hub.broadcast(
      peer.roomCode,
      { type: "participant.joined", participant: join.participant, room: join.room },
      peer
    );

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
          handleMessage(frame.payload.toString("utf8"), { store, hub, events, peer, logger });
        }
      } catch (error) {
        logger.warn("websocket_frame_error", error.message);
        socket.end();
      }
    });

    socket.on("close", () => cleanupPeer({ store, hub, events, peer }));
    socket.on("error", () => cleanupPeer({ store, hub, events, peer }));
  });
}

function handleMessage(raw, { store, hub, events, peer, logger }) {
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
    events?.push("participant.state", {
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
    events?.push("call.signal", {
      roomCode: peer.roomCode,
      fromParticipantId: peer.id,
      channelId: message.payload?.channelId
    });
    hub.broadcast(peer.roomCode, {
      type: "call.signal",
      fromParticipantId: peer.id,
      payload: message.payload || {}
    });
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
    hub.broadcast(
      peer.roomCode,
      {
        type: "audio.frame",
        fromParticipantId: peer.id,
        payload: {
          codec: "pcm16",
          sampleRate: payload.sampleRate || 16000,
          channels: payload.channels || 1,
          pcm16: payload.pcm16
        }
      },
      peer
    );
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
    events?.push("webrtc.signal", {
      roomCode: peer.roomCode,
      fromParticipantId: peer.id,
      toParticipantId: targetParticipantId || null,
      kind: payload.kind || payload.type || "unknown"
    });
    if (targetParticipantId) {
      const delivered = hub.sendTo(peer.roomCode, targetParticipantId, outgoing);
      if (!delivered) peer.send({ type: "error", error: "target_participant_not_found", participantId: targetParticipantId });
    } else {
      hub.broadcast(peer.roomCode, outgoing, peer);
    }
    return;
  }

  logger.warn("unknown_signaling_message", message.type);
  peer.send({ type: "error", error: "unknown_message_type", messageType: message.type });
}

function cleanupPeer({ store, hub, events, peer }) {
  const participant = store.leaveRoom(peer.roomCode, peer.id);
  const room = store.getRoom(peer.roomCode);
  hub.remove(peer);
  if (participant) {
    events?.push("participant.left", {
      roomCode: peer.roomCode,
      displayName: participant.displayName,
      participantId: participant.id
    });
    hub.broadcast(peer.roomCode, { type: "participant.left", participant, room: room ? snapshotRoom(room) : null });
  }
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
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Frame too large");
    }
    length = Number(bigLength);
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;

  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    opcode,
    payload,
    consumed: offset + length
  };
}

function sendFrame(socket, text) {
  const payload = Buffer.from(text, "utf8");
  const header = buildHeader(0x1, payload.length);
  socket.write(Buffer.concat([header, payload]));
}

function sendControlFrame(socket, opcode, payload) {
  const header = buildHeader(opcode, payload.length);
  socket.write(Buffer.concat([header, payload]));
}

function buildHeader(opcode, length) {
  if (length < 126) {
    return Buffer.from([0x80 | opcode, length]);
  }
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
