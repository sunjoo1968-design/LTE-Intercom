import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/state.js";

test("creates rooms with default intercom channels", () => {
  const store = createStore(() => new Date("2026-05-29T00:00:00.000Z"));
  const room = store.createRoom({ name: "prod a" });

  assert.equal(room.code, "PROD-A");
  assert.equal(room.channels.length, 4);
  assert.equal(room.channels[0].shortLabel, "PGM");
  assert.equal(room.participantCount, 0);
});

test("joins, updates, and leaves a participant", () => {
  const store = createStore(() => new Date("2026-05-29T00:00:00.000Z"));
  store.createRoom({ name: "PROD-A" });

  const joined = store.joinRoom({
    roomCode: "PROD-A",
    displayName: "CAM-1",
    clientId: "client-1"
  });
  assert.equal(joined.participant.displayName, "CAM-1");
  assert.equal(joined.room.participantCount, 1);

  const updated = store.updateParticipant("PROD-A", "client-1", {
    talking: true,
    muted: false,
    rttMs: 42,
    ignored: true
  });
  assert.equal(updated.talking, true);
  assert.equal(updated.rttMs, 42);
  assert.equal(updated.ignored, undefined);

  const left = store.leaveRoom("PROD-A", "client-1");
  assert.equal(left.connected, false);
  assert.equal(store.listRooms()[0].participantCount, 0);
});

test("rejects duplicate room codes", () => {
  const store = createStore();
  store.createRoom({ name: "PROD-A" });

  assert.throws(() => store.createRoom({ name: "prod a" }), /already exists/);
});

test("protects rooms with passwords", () => {
  const store = createStore(() => new Date("2026-05-29T00:00:00.000Z"));
  const room = store.createRoom({ code: "LIVE", description: "Main Live Room", password: "1234" });

  assert.equal(room.passwordProtected, true);
  assert.equal(store.canJoinRoom("LIVE", "bad"), false);
  assert.equal(store.canJoinRoom("LIVE", "1234"), true);
});

test("updates and deletes configured rooms", () => {
  const store = createStore(() => new Date("2026-05-29T00:00:00.000Z"));
  store.createRoom({ code: "LIVE", description: "Main Live Room", password: "1234" });

  const updated = store.updateRoom("LIVE", { description: "Studio A", password: "5678" });
  assert.equal(updated.description, "Studio A");
  assert.equal(store.canJoinRoom("LIVE", "1234"), false);
  assert.equal(store.canJoinRoom("LIVE", "5678"), true);

  const deleted = store.deleteRoom("LIVE");
  assert.equal(deleted.code, "LIVE");
  assert.equal(store.listRooms().length, 0);
});
