import test from "node:test";
import assert from "node:assert/strict";
import { collectAdminState, renderAdminPage } from "../src/admin.js";
import { createStore } from "../src/state.js";

test("collects server admin state", async () => {
  const store = createStore(() => new Date("2026-05-30T00:00:00.000Z"));
  store.createRoom({ name: "LIVE", code: "LIVE" });
  store.joinRoom({
    roomCode: "LIVE",
    displayName: "CAM-1",
    clientId: "client-1"
  });
  store.updateParticipant("LIVE", "client-1", {
    talking: true,
    listening: true,
    rttMs: 42
  });

  const state = await collectAdminState({
    store,
    hub: { peerCount: () => 1 },
    events: { list: () => [{ at: "2026-05-30T00:00:01.000Z", type: "participant.state" }] },
    publicIpResolver: async () => "203.0.113.10"
  });

  assert.equal(state.totals.rooms, 1);
  assert.equal(state.totals.peers, 1);
  assert.equal(state.totals.participants, 1);
  assert.equal(state.totals.talkers, 1);
  assert.equal(state.network.publicIp, "203.0.113.10");
  assert.equal(state.rooms[0].participants[0].displayName, "CAM-1");
});

test("renders admin dashboard html", () => {
  const html = renderAdminPage();

  assert.match(html, /LTE INTERCOM SERVER CONTROL/);
  assert.match(html, /\/admin\/state/);
  assert.match(html, /RESTART SERVER/);
  assert.match(html, /SHUTDOWN SERVER/);
  assert.match(html, /TALLY \/ TALKING/);
  assert.match(html, /ROOM DESCRIPTION/);
  assert.match(html, /ROOM PASSWORD/);
  assert.match(html, /CLEAR/);
});
