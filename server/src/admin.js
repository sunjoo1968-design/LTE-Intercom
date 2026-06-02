import http from "node:http";
import https from "node:https";
import os from "node:os";

const publicIpCache = {
  value: null,
  checkedAt: 0
};

export async function collectAdminState({ store, hub, events, publicIpResolver = resolvePublicIp }) {
  const rooms = store.listRooms();
  const participants = rooms.flatMap((room) =>
    room.participants.map((participant) => ({
      ...participant,
      roomCode: room.code,
      roomDescription: room.description || room.name
    }))
  );
  const talkers = participants.filter((participant) => participant.talking);
  const listeners = participants.filter((participant) => participant.listening);
  const muted = participants.filter((participant) => participant.muted);
  const publicIp = await publicIpResolver();
  const port = String(process.env.PORT || "8443");
  const interfaces = listNetworkInterfaces();
  const firstLanIp = interfaces[0]?.address || "SERVER_IP";
  const localPortOpen = await checkHttpPort("127.0.0.1", port);
  const publicPortOpen = publicIp && publicIp !== "unavailable"
    ? await checkHttpPort(publicIp, port)
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
      port,
      adminUrl: `http://localhost:${port}/admin`,
      localAppUrl: `ws://${firstLanIp}:${port}/signal`,
      publicAppUrl: publicIp && publicIp !== "unavailable" ? `ws://${publicIp}:${port}/signal` : "",
      roomsUrl: `http://${firstLanIp}:${port}/public/rooms`,
      portStatus: {
        local: localPortOpen ? "OPEN" : "CLOSED",
        public: publicPortOpen ? "OPEN" : "UNKNOWN/CLOSED"
      },
      interfaces
    },
    totals: {
      rooms: rooms.length,
      peers: hub.peerCount(),
      participants: participants.length,
      talkers: talkers.length,
      listeners: listeners.length,
      muted: muted.length
    },
    rooms,
    events: events.list()
  };
}

export function renderAdminPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LTE Intercom Server Control</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07090c;
      --panel: #12171d;
      --panel-2: #171d24;
      --line: #2f3a46;
      --text: #f4f7fb;
      --muted: #9aa8b6;
      --green: #23c16b;
      --yellow: #f5b942;
      --red: #ef3f45;
      --blue: #56a3ff;
      --dark: #0d1116;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      letter-spacing: 0;
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto auto 1fr;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: #0b0f14;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .mark {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border: 2px solid var(--line);
      border-radius: 6px;
      color: var(--green);
      font-weight: 800;
    }

    h1 {
      margin: 0;
      font-size: 19px;
      line-height: 1.1;
    }

    .subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .status-line {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }

    .lamp {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 0 5px rgba(35, 193, 107, 0.16);
    }

    main {
      padding: 18px 22px 24px;
      display: grid;
      gap: 16px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(6, minmax(110px, 1fr));
      gap: 10px;
    }

    .metric,
    .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .metric {
      min-height: 74px;
      padding: 12px 13px;
    }

    .metric .label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .metric .value {
      margin-top: 8px;
      font-size: 25px;
      font-weight: 800;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(330px, 0.9fr);
      gap: 16px;
      align-items: start;
    }

    .control-bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: end;
      padding: 14px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(160px, 1fr));
      gap: 10px;
    }

    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }

    input {
      width: 100%;
      height: 38px;
      padding: 0 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #0d1116;
      color: var(--text);
      font-size: 14px;
      outline: none;
    }

    input:focus {
      border-color: var(--blue);
    }

    button {
      height: 38px;
      padding: 0 13px;
      border: 1px solid rgba(35, 193, 107, 0.7);
      border-radius: 6px;
      background: #123321;
      color: var(--green);
      font-size: 12px;
      font-weight: 900;
      cursor: pointer;
    }

    button:hover {
      filter: brightness(1.15);
    }

    button.danger {
      border-color: rgba(239, 63, 69, 0.78);
      background: #351316;
      color: var(--red);
    }

    button.small {
      height: 28px;
      padding: 0 9px;
      font-size: 10px;
    }

    .control-status {
      padding: 0 14px 13px;
      min-height: 24px;
      color: var(--muted);
      font-size: 12px;
    }

    .server-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 0 14px 14px;
    }

    .password-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 92px;
      gap: 8px;
    }

    .room-form-actions {
      display: grid;
      gap: 8px;
    }

    .hidden {
      display: none !important;
    }

    .head-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .section {
      overflow: hidden;
    }

    .section.users-panel,
    .section.events-panel {
      min-height: 0;
    }

    .section-head {
      min-height: 48px;
      padding: 13px 15px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }

    .section-title {
      font-size: 13px;
      font-weight: 800;
    }

    .section-sub {
      color: var(--muted);
      font-size: 12px;
    }

    .rooms {
      display: grid;
      gap: 12px;
      padding: 14px;
      max-height: 610px;
      overflow-y: auto;
    }

    .room {
      border: 1px solid var(--line);
      border-radius: 7px;
      overflow: hidden;
      background: var(--dark);
    }

    .room-head {
      padding: 11px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-bottom: 1px solid var(--line);
    }

    .room-title {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }

    .room-code {
      font-weight: 800;
      font-size: 18px;
    }

    .room-name {
      color: var(--muted);
      font-size: 12px;
    }

    .room-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .participants {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 10px;
      padding: 12px;
      max-height: 440px;
      overflow-y: auto;
    }

    .participant {
      min-height: 112px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #10151b;
    }

    .participant.talking {
      border-color: rgba(239, 63, 69, 0.9);
      background: #1b1113;
    }

    .tally {
      display: none;
      margin-bottom: 10px;
      padding: 7px 8px;
      border-radius: 5px;
      background: var(--red);
      color: #ffffff;
      font-size: 12px;
      font-weight: 900;
      text-align: center;
    }

    .participant.talking .tally {
      display: block;
    }

    .participant-top,
    .pills {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .participant-top {
      justify-content: space-between;
      margin-bottom: 13px;
    }

    .participant-actions {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
    }

    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 16px;
      font-weight: 800;
    }

    .tag,
    .pill {
      border-radius: 4px;
      border: 1px solid var(--line);
      padding: 4px 6px;
      font-size: 11px;
      font-weight: 800;
      color: var(--muted);
    }

    .pill.on { color: var(--green); border-color: rgba(35, 193, 107, 0.65); }
    .pill.talk { color: var(--red); border-color: rgba(239, 63, 69, 0.8); }
    .pill.muted { color: var(--yellow); border-color: rgba(245, 185, 66, 0.75); }

    .detail {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
    }

    .detail span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .side {
      display: grid;
      gap: 16px;
    }

    .network,
    .events {
      padding: 12px 14px 14px;
    }

    .events {
      height: 360px;
      max-height: 360px;
      overflow-y: auto;
    }

    .network-row,
    .event-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(47, 58, 70, 0.65);
      color: var(--muted);
      font-size: 12px;
    }

    .network-row:last-child,
    .event-row:last-child { border-bottom: 0; }

    .network-row strong,
    .event-row strong {
      color: var(--text);
      font-size: 12px;
    }

    .port-status {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border: 1px solid rgba(47, 58, 70, 0.9);
      border-radius: 999px;
      background: rgba(13, 17, 22, 0.95);
      color: var(--muted);
      font-weight: 900;
    }

    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--muted);
      box-shadow: 0 0 0 3px rgba(154, 168, 182, 0.12);
    }

    .status-badge.open {
      color: var(--green);
      border-color: rgba(35, 193, 107, 0.7);
    }

    .status-badge.open .status-dot {
      background: var(--green);
      box-shadow: 0 0 0 3px rgba(35, 193, 107, 0.18);
    }

    .status-badge.closed {
      color: var(--red);
      border-color: rgba(239, 63, 69, 0.72);
    }

    .status-badge.closed .status-dot {
      background: var(--red);
      box-shadow: 0 0 0 3px rgba(239, 63, 69, 0.18);
    }

    .mono {
      font-family: Consolas, "Courier New", monospace;
    }

    .empty {
      padding: 28px 14px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }

    .credit {
      padding: 2px 4px 0;
      color: #65717e;
      font-size: 11px;
      text-align: center;
    }

    body.expand-users .grid {
      grid-template-columns: 1fr;
    }

    body.expand-users .side {
      display: none;
    }

    body.expand-users .participants {
      max-height: calc(100vh - 360px);
    }

    body.expand-users .rooms {
      max-height: calc(100vh - 260px);
    }

    body.expand-events .grid {
      grid-template-columns: 1fr;
    }

    body.expand-events .grid > .section:first-child,
    body.expand-events .side .section:first-child {
      display: none;
    }

    body.expand-events .events {
      height: calc(100vh - 260px);
      max-height: calc(100vh - 260px);
    }

    @media (max-width: 980px) {
      .summary { grid-template-columns: repeat(3, minmax(110px, 1fr)); }
      .grid { grid-template-columns: 1fr; }
      .control-bar { grid-template-columns: 1fr; }
      header { align-items: flex-start; flex-direction: column; }
    }

    @media (max-width: 560px) {
      main { padding: 12px; }
      header { padding: 14px; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .form-grid { grid-template-columns: 1fr; }
      .participants { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand">
        <div class="mark">IC</div>
        <div>
          <h1>LTE INTERCOM SERVER CONTROL</h1>
          <div class="subtitle">Live network, room, talker, listener and event monitoring</div>
        </div>
      </div>
      <div class="status-line">
        <span class="lamp"></span>
        <span id="serverStatus">CONNECTING</span>
        <span id="serverTime" class="mono"></span>
        <button type="button" class="small" onclick="window.location.href='/admin/password'">ACCOUNT</button>
      </div>
    </header>

    <main>
      <section class="summary">
        <div class="metric"><div class="label">PEERS</div><div id="metricPeers" class="value">0</div></div>
        <div class="metric"><div class="label">ROOMS</div><div id="metricRooms" class="value">0</div></div>
        <div class="metric"><div class="label">PARTICIPANTS</div><div id="metricParticipants" class="value">0</div></div>
        <div class="metric"><div class="label">TALKERS</div><div id="metricTalkers" class="value">0</div></div>
        <div class="metric"><div class="label">LISTENERS</div><div id="metricListeners" class="value">0</div></div>
        <div class="metric"><div class="label">MUTED</div><div id="metricMuted" class="value">0</div></div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <div class="section-title">SERVER CONTROL</div>
            <div class="section-sub">Code is the app connection key. Name is the display label.</div>
          </div>
        </div>
        <form id="createRoomForm" class="control-bar">
          <div class="form-grid">
            <label>ROOM CODE<input id="newRoomCode" maxlength="32" value="LIVE"></label>
            <label>ROOM DESCRIPTION<input id="newRoomDescription" maxlength="64" value="Main Live Room"></label>
            <label>ROOM PASSWORD<div class="password-row"><input id="newRoomPassword" maxlength="64" type="password" placeholder="optional"><button type="button" class="small" onclick="togglePassword('newRoomPassword')">SHOW</button></div></label>
          </div>
          <div class="room-form-actions">
            <button id="roomSubmitButton" type="submit">CREATE ROOM</button>
            <button id="cancelRoomEditButton" type="button" class="small hidden">CANCEL EDIT</button>
          </div>
        </form>
        <div class="server-actions">
          <button type="button" onclick="keepServerRunning()">KEEP RUNNING</button>
          <button type="button" onclick="restartServer()">RESTART SERVER</button>
          <button type="button" class="danger" onclick="shutdownServer()">SHUTDOWN SERVER</button>
          <button type="button" class="danger" onclick="logoutAdmin()">LOGOUT</button>
        </div>
        <div id="controlStatus" class="control-status"></div>
      </section>

      <section class="grid">
        <div class="section users-panel">
          <div class="section-head">
            <div>
              <div class="section-title">ROOMS AND PARTICIPANTS</div>
              <div class="section-sub">Participants stay in join order. TALK shows tally on the card.</div>
            </div>
            <div class="head-actions">
              <button type="button" class="small" onclick="toggleExpand('users')">EXPAND</button>
              <div id="uptime" class="section-sub mono">UPTIME 0s</div>
            </div>
          </div>
          <div id="rooms" class="rooms"></div>
        </div>

        <div class="side">
          <div class="section network-panel">
            <div class="section-head">
              <div class="section-title">NETWORK</div>
              <div id="hostname" class="section-sub mono"></div>
            </div>
            <div id="network" class="network"></div>
          </div>

          <div class="section events-panel">
            <div class="section-head">
              <div class="section-title">EVENT LOG</div>
              <div class="head-actions">
                <button type="button" class="small" onclick="toggleExpand('events')">EXPAND</button>
                <button type="button" class="small danger" onclick="clearEvents()">CLEAR</button>
              </div>
            </div>
            <div id="events" class="events"></div>
          </div>
        </div>
      </section>
      <div class="credit">made by SunjooAn</div>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    let editingRoomCode = null;

    async function refresh() {
      try {
        const response = await fetch('/admin/state', { cache: 'no-store' });
        if (!response.ok) throw new Error('state request failed');
        const state = await response.json();
        render(state);
      } catch (error) {
        $('serverStatus').textContent = 'DISCONNECTED';
      }
    }

    function render(state) {
      $('serverStatus').textContent = state.server.status.toUpperCase();
      $('serverTime').textContent = formatTime(state.server.serverTime);
      $('uptime').textContent = 'UPTIME ' + formatDuration(state.server.uptimeSec);
      $('hostname').textContent = state.network.hostname || '';
      $('metricPeers').textContent = state.totals.peers;
      $('metricRooms').textContent = state.totals.rooms;
      $('metricParticipants').textContent = state.totals.participants;
      $('metricTalkers').textContent = state.totals.talkers;
      $('metricListeners').textContent = state.totals.listeners;
      $('metricMuted').textContent = state.totals.muted;
      renderRooms(state.rooms || []);
      renderNetwork(state.network || {});
      renderEvents(state.events || []);
    }

    function renderRooms(rooms) {
      if (rooms.length === 0) {
        $('rooms').innerHTML = '<div class="empty">No rooms are configured.</div>';
        return;
      }
      $('rooms').innerHTML = rooms.map((room) => {
        const participants = [...(room.participants || [])];
        const participantHtml = participants.length
          ? participants.map((participant) => renderParticipant(participant, room.code)).join('')
          : '<div class="empty">No connected participants.</div>';
        return '<article class="room">' +
          '<div class="room-head">' +
            '<div class="room-title"><div class="room-code">' + escapeHtml(room.code) + '</div><div class="room-name">' + escapeHtml(room.description || room.name) + '</div></div>' +
            '<div class="room-actions">' +
              '<div class="tag">' + room.participantCount + ' USERS</div>' +
              '<button type="button" class="small" data-action="edit-room" data-code="' + escapeHtml(room.code) + '" data-description="' + escapeHtml(room.description || room.name) + '">EDIT</button>' +
              '<button type="button" class="small danger" data-action="delete-room" data-code="' + escapeHtml(room.code) + '">DELETE</button>' +
            '</div>' +
          '</div>' +
          '<div class="participants">' + participantHtml + '</div>' +
        '</article>';
      }).join('');
    }

    function renderParticipant(participant, roomCode) {
      const classes = 'participant' + (participant.talking ? ' talking' : '');
      const rtt = participant.rttMs == null ? '-' : participant.rttMs + ' ms';
      const jitter = participant.jitterMs == null ? '-' : participant.jitterMs + ' ms';
      const loss = participant.packetLoss == null ? '-' : participant.packetLoss + '%';
      return '<div class="' + classes + '">' +
        '<div class="tally">TALLY / TALKING</div>' +
        '<div class="participant-top">' +
          '<div class="name">' + escapeHtml(participant.displayName || 'UNKNOWN') + '</div>' +
          '<div class="tag mono">' + escapeHtml((participant.id || '').slice(0, 8)) + '</div>' +
        '</div>' +
        '<div class="pills">' +
          '<span class="pill ' + (participant.talking ? 'talk' : '') + '">' + (participant.talking ? 'TALK' : 'IDLE') + '</span>' +
          '<span class="pill ' + (participant.listening ? 'on' : '') + '">' + (participant.listening ? 'LISTEN' : 'NO LISTEN') + '</span>' +
          '<span class="pill ' + (participant.muted ? 'muted' : '') + '">' + (participant.muted ? 'MUTED' : 'OPEN') + '</span>' +
        '</div>' +
        '<div class="detail">' +
          '<span>RTT <strong>' + escapeHtml(rtt) + '</strong></span>' +
          '<span>JITTER <strong>' + escapeHtml(jitter) + '</strong></span>' +
          '<span>LOSS <strong>' + escapeHtml(loss) + '</strong></span>' +
          '<span>JOIN <strong>' + escapeHtml(formatTime(participant.joinedAt)) + '</strong></span>' +
        '</div>' +
        '<div class="participant-actions">' +
          '<button type="button" class="small danger" data-action="disconnect-participant" data-room="' + escapeHtml(roomCode) + '" data-participant="' + escapeHtml(participant.id) + '" data-name="' + escapeHtml(participant.displayName || 'UNKNOWN') + '">DISCONNECT</button>' +
        '</div>' +
      '</div>';
    }

    function renderNetwork(network) {
      const interfaces = network.interfaces || [];
      const publicIp = network.publicIp || '-';
      const baseRows =
        '<div class="network-row"><strong>PORT</strong><span class="port-status">' +
          '<span class="mono">' + escapeHtml(network.port || '8443') + '</span>' +
          renderStatusBadge('LAN', network.portStatus?.local) +
          renderStatusBadge('WAN', network.portStatus?.public) +
        '</span></div>' +
        '<div class="network-row"><strong>ADMIN</strong><span class="mono">' + escapeHtml(network.adminUrl || '-') + '</span></div>' +
        '<div class="network-row"><strong>APP LAN</strong><span class="mono">' + escapeHtml(network.localAppUrl || '-') + '</span></div>' +
        '<div class="network-row"><strong>APP WAN</strong><span class="mono">' + escapeHtml(network.publicAppUrl || '-') + '</span></div>' +
        '<div class="network-row"><strong>ROOMS</strong><span class="mono">' + escapeHtml(network.roomsUrl || '-') + '</span></div>';
      if (interfaces.length === 0) {
        $('network').innerHTML =
          '<div class="network-row"><strong>PUBLIC</strong><span class="mono">' + escapeHtml(publicIp) + '</span></div>' +
          baseRows +
          '<div class="empty">No active IPv4 network interface.</div>';
        return;
      }
      $('network').innerHTML =
        '<div class="network-row">' +
          '<strong>PUBLIC</strong>' +
          '<span class="mono">' + escapeHtml(publicIp) + '</span>' +
        '</div>' +
        baseRows +
        interfaces.map((item) =>
          '<div class="network-row">' +
            '<strong>' + escapeHtml(item.name) + '</strong>' +
            '<span class="mono">' + escapeHtml(item.address) + ' / ' + escapeHtml(item.family) + '</span>' +
          '</div>'
        ).join('');
    }

    function renderStatusBadge(label, value) {
      const normalized = String(value || 'UNKNOWN').toUpperCase();
      const css = normalized === 'OPEN' ? 'open' : 'closed';
      return '<span class="status-badge ' + css + '"><span class="status-dot"></span>' +
        escapeHtml(label) + ' ' + escapeHtml(normalized) +
      '</span>';
    }

    function renderEvents(events) {
      if (events.length === 0) {
        $('events').innerHTML = '<div class="empty">No server events yet.</div>';
        return;
      }
      $('events').innerHTML = events.map((event) =>
        '<div class="event-row">' +
          '<strong>' + escapeHtml(formatTime(event.at)) + '</strong>' +
          '<span><span class="mono">' + escapeHtml(event.type) + '</span> ' + escapeHtml(event.displayName || event.roomCode || '') + '</span>' +
        '</div>'
      ).join('');
    }

    function formatDuration(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function formatTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleTimeString([], { hour12: false });
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]);
    }

    function jsString(value) {
      return JSON.stringify(String(value ?? ''));
    }

    async function postJson(url, body = {}) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || 'request failed');
      }
      return data;
    }

    async function putJson(url, body = {}) {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'request failed');
      return data;
    }

    async function deleteJson(url) {
      const response = await fetch(url, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'request failed');
      return data;
    }

    function togglePassword(inputId) {
      const input = $(inputId);
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    async function disconnectParticipant(roomCode, participantId, displayName, button) {
      try {
        if (button) {
          button.disabled = true;
          button.textContent = 'DISCONNECTING';
        }
        $('controlStatus').textContent = 'Disconnecting ' + displayName + ' from ' + roomCode + '...';
        await postJson('/admin/rooms/' + encodeURIComponent(roomCode) + '/participants/' + encodeURIComponent(participantId) + '/disconnect');
        $('controlStatus').textContent = 'Disconnected ' + displayName + '.';
        await refresh();
        setTimeout(refresh, 400);
      } catch (error) {
        $('controlStatus').textContent = 'Disconnect failed: ' + error.message;
        if (button) {
          button.disabled = false;
          button.textContent = 'DISCONNECT';
        }
      }
    }

    function startRoomEdit(roomCode, description) {
      editingRoomCode = roomCode;
      $('newRoomCode').value = roomCode;
      $('newRoomCode').disabled = true;
      $('newRoomDescription').value = description || roomCode;
      $('newRoomPassword').value = '';
      $('newRoomPassword').placeholder = 'blank: keep current, -: clear';
      $('roomSubmitButton').textContent = 'UPDATE ROOM';
      $('cancelRoomEditButton').classList.remove('hidden');
      $('controlStatus').textContent = 'Editing room ' + roomCode + '. Update fields and press UPDATE ROOM.';
      $('newRoomDescription').focus();
    }

    function cancelRoomEdit() {
      editingRoomCode = null;
      $('newRoomCode').disabled = false;
      $('newRoomCode').value = 'LIVE';
      $('newRoomDescription').value = 'Main Live Room';
      $('newRoomPassword').value = '';
      $('newRoomPassword').placeholder = 'optional';
      $('roomSubmitButton').textContent = 'CREATE ROOM';
      $('cancelRoomEditButton').classList.add('hidden');
      $('controlStatus').textContent = 'Room edit cancelled.';
    }

    async function updateRoomFromForm() {
      const roomCode = editingRoomCode;
      const description = $('newRoomDescription').value.trim() || roomCode;
      const password = $('newRoomPassword').value;
      const body = { description };
      if (password.length > 0) body.password = password === '-' ? '' : password;
      try {
        $('controlStatus').textContent = 'Updating room ' + roomCode + '...';
        await postJson('/admin/rooms/' + encodeURIComponent(roomCode) + '/update', body);
        cancelRoomEdit();
        $('controlStatus').textContent = 'Updated room ' + roomCode + '.';
        await refresh();
      } catch (error) {
        $('controlStatus').textContent = 'Update room failed: ' + error.message;
      }
    }

    async function deleteRoom(roomCode) {
      if (!confirm('Delete room ' + roomCode + '? Connected clients in this room will be disconnected.')) return;
      try {
        $('controlStatus').textContent = 'Deleting room ' + roomCode + '...';
        await postJson('/admin/rooms/' + encodeURIComponent(roomCode) + '/delete');
        $('controlStatus').textContent = 'Deleted room ' + roomCode + '.';
        if (editingRoomCode === roomCode) cancelRoomEdit();
        await refresh();
      } catch (error) {
        $('controlStatus').textContent = 'Delete room failed: ' + error.message;
      }
    }

    async function clearEvents() {
      if (!confirm('Clear the server event log?')) return;
      try {
        await postJson('/admin/events/clear');
        $('controlStatus').textContent = 'Event log cleared.';
        await refresh();
      } catch (error) {
        $('controlStatus').textContent = 'Clear log failed: ' + error.message;
      }
    }

    function toggleExpand(panel) {
      const users = panel === 'users';
      const events = panel === 'events';
      document.body.classList.toggle('expand-users', users && !document.body.classList.contains('expand-users'));
      document.body.classList.toggle('expand-events', events && !document.body.classList.contains('expand-events'));
    }

    async function keepServerRunning() {
      try {
        const result = await postJson('/admin/server/keep-running');
        $('controlStatus').textContent = 'Server remains running. PID ' + result.pid + '.';
      } catch (error) {
        $('controlStatus').textContent = 'Server status request failed: ' + error.message;
      }
    }

    async function restartServer() {
      if (!confirm('Restart the intercom server now? Connected clients will be disconnected.')) return;
      try {
        await postJson('/admin/server/restart');
        $('controlStatus').textContent = 'Server restart requested. Reconnecting...';
        setTimeout(refresh, 2500);
      } catch (error) {
        $('controlStatus').textContent = 'Restart failed: ' + error.message;
      }
    }

    async function shutdownServer() {
      if (!confirm('Completely shut down the intercom server? Connected clients will be disconnected.')) return;
      try {
        await postJson('/admin/server/shutdown');
        $('controlStatus').textContent = 'Server shutdown requested. This page can be closed.';
        setTimeout(() => {
          $('serverStatus').textContent = 'SHUTDOWN';
        }, 1000);
      } catch (error) {
        $('controlStatus').textContent = 'Shutdown failed: ' + error.message;
      }
    }

    async function logoutAdmin() {
      await postJson('/admin/logout').catch(() => {});
      window.location.href = '/admin';
    }

    $('createRoomForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (editingRoomCode) {
        await updateRoomFromForm();
        return;
      }
      const code = $('newRoomCode').value.trim();
      const description = $('newRoomDescription').value.trim() || code;
      const password = $('newRoomPassword').value;
      if (!code) {
        $('controlStatus').textContent = 'Room code is required.';
        return;
      }
      try {
        await postJson('/rooms', { code, name: description, description, password });
        $('newRoomPassword').value = '';
        $('controlStatus').textContent = 'Created room ' + code + '.';
        await refresh();
      } catch (error) {
        $('controlStatus').textContent = 'Create room failed: ' + error.message;
      }
    });

    $('cancelRoomEditButton').addEventListener('click', cancelRoomEdit);

    $('rooms').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'disconnect-participant') {
        await disconnectParticipant(
          button.dataset.room || '',
          button.dataset.participant || '',
          button.dataset.name || 'UNKNOWN',
          button
        );
        return;
      }
      if (button.dataset.action === 'edit-room') {
        startRoomEdit(button.dataset.code || '', button.dataset.description || '');
        return;
      }
      if (button.dataset.action === 'delete-room') {
        await deleteRoom(button.dataset.code || '');
      }
    });

    window.startRoomEdit = startRoomEdit;
    window.deleteRoom = deleteRoom;
    window.disconnectParticipant = disconnectParticipant;
    window.clearEvents = clearEvents;
    window.toggleExpand = toggleExpand;
    window.keepServerRunning = keepServerRunning;
    window.restartServer = restartServer;
    window.shutdownServer = shutdownServer;
    window.logoutAdmin = logoutAdmin;
    window.togglePassword = togglePassword;

    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

export function renderLoginPage({ defaultPassword = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LTE Intercom Admin Login</title>
  <style>
    :root { color-scheme: dark; --bg:#07090c; --panel:#12171d; --line:#2f3a46; --text:#f4f7fb; --muted:#9aa8b6; --green:#23c16b; --red:#ef3f45; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font-family:Arial, Helvetica, sans-serif; }
    form { width:min(420px, calc(100vw - 32px)); padding:24px; background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    h1 { margin:0 0 6px; font-size:22px; }
    p { margin:0 0 18px; color:var(--muted); font-size:13px; line-height:1.45; }
    label { display:grid; gap:7px; color:var(--muted); font-size:12px; font-weight:800; }
    input { height:42px; padding:0 12px; border:1px solid var(--line); border-radius:6px; background:#0d1116; color:var(--text); font-size:15px; }
    button { width:100%; height:42px; margin-top:16px; border:1px solid rgba(35,193,107,.7); border-radius:6px; background:#123321; color:var(--green); font-weight:900; }
    .warn { margin-top:14px; color:var(--red); font-size:12px; }
  </style>
</head>
<body>
  <form method="post" action="/admin/login">
    <h1>Admin Login</h1>
    <p>Enter the server administrator password.</p>
    <label>ADMIN PASSWORD<input name="password" type="password" autocomplete="current-password" autofocus></label>
    <button type="submit">LOGIN</button>
    ${defaultPassword ? '<div class="warn">Default password is active. Set ADMIN_PASSWORD before field use.</div>' : ''}
  </form>
</body>
</html>`;
}

export function renderPasswordPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Change Admin Password</title>
  <style>
    :root { color-scheme: dark; --bg:#07090c; --panel:#12171d; --line:#2f3a46; --text:#f4f7fb; --muted:#9aa8b6; --green:#23c16b; --red:#ef3f45; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font-family:Arial, Helvetica, sans-serif; }
    form { width:min(460px, calc(100vw - 32px)); padding:24px; background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    h1 { margin:0 0 6px; font-size:22px; }
    p, #status { color:var(--muted); font-size:13px; line-height:1.45; }
    label { display:grid; gap:7px; margin-top:14px; color:var(--muted); font-size:12px; font-weight:800; }
    input { height:42px; padding:0 12px; border:1px solid var(--line); border-radius:6px; background:#0d1116; color:var(--text); font-size:15px; }
    button { width:100%; height:42px; margin-top:16px; border:1px solid rgba(35,193,107,.7); border-radius:6px; background:#123321; color:var(--green); font-weight:900; }
    .secondary { background:#171d24; border-color:var(--line); color:var(--muted); }
    .row { display:grid; grid-template-columns: minmax(0,1fr) 86px; gap:8px; }
  </style>
</head>
<body>
  <form id="passwordForm">
    <h1>Change Admin Password</h1>
    <p>This page is separated from live server operation controls.</p>
    <label>CURRENT PASSWORD<input id="currentPassword" type="password" autocomplete="current-password"></label>
    <label>NEW PASSWORD<div class="row"><input id="newPassword" type="password" autocomplete="new-password"><button type="button" class="secondary" onclick="togglePassword()">SHOW</button></div></label>
    <button type="submit">CHANGE PASSWORD</button>
    <button type="button" class="secondary" onclick="window.location.href='/admin'">BACK TO ADMIN</button>
    <div id="status"></div>
  </form>
  <script>
    function togglePassword() {
      const input = document.getElementById('newPassword');
      input.type = input.type === 'password' ? 'text' : 'password';
    }
    document.getElementById('passwordForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const status = document.getElementById('status');
      if (!currentPassword || newPassword.length < 4) {
        status.textContent = 'Current password and a new password of 4+ characters are required.';
        return;
      }
      const response = await fetch('/admin/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      status.textContent = response.ok ? 'Admin password changed.' : 'Password change failed.';
      if (response.ok) {
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
      }
    });
  </script>
</body>
</html>`;
}

function listNetworkInterfaces() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.internal) continue;
      if (entry.family !== "IPv4" && entry.family !== 4) continue;
      result.push({
        name,
        address: entry.address,
        family: entry.family,
        mac: entry.mac
      });
    }
  }
  return result;
}

async function resolvePublicIp() {
  if (process.env.PUBLIC_IP) return process.env.PUBLIC_IP;
  const now = Date.now();
  if (publicIpCache.value && now - publicIpCache.checkedAt < 5 * 60 * 1000) {
    return publicIpCache.value;
  }

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

function checkHttpPort(host, port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host,
        port: Number(port),
        path: "/health",
        timeout: 900
      },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}
