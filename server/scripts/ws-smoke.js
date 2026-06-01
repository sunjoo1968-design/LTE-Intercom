const baseUrl = process.env.WS_URL || "ws://localhost:8443/signal?room=PROD-A";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 3000);
const seen = [];

const cam = new WebSocket(`${baseUrl}&name=CAM-1`);
const pd = new WebSocket(`${baseUrl}&name=PD`);

const timeout = setTimeout(() => {
  finish(false, `Timed out waiting for WebSocket broadcasts: ${JSON.stringify(seen)}`);
}, timeoutMs);

let sawState = false;
let sawAudio = false;
let sawTargetedWebRtc = false;
let pdParticipantId = null;

cam.addEventListener("open", () => {
  setTimeout(() => {
    cam.send(
      JSON.stringify({
        type: "state.update",
        payload: {
          talking: true,
          listening: true,
          muted: false,
          rttMs: 42
        }
      })
    );
    cam.send(
      JSON.stringify({
        type: "audio.frame",
        payload: {
          codec: "pcm16",
          sampleRate: 16000,
          channels: 1,
          pcm16: Buffer.from([0, 0, 1, 0, 255, 255, 0, 0]).toString("base64")
        }
      })
    );
  }, 250);
});

cam.addEventListener("message", (event) => {
  const message = remember("cam", event.data);
  if (message.type === "welcome" && message.participant?.id) {
    // CAM can target PD only after PD's welcome has been observed below.
    return;
  }
});

pd.addEventListener("message", (event) => {
  const message = remember("pd", event.data);
  if (message.type === "welcome" && message.participant?.id) {
    pdParticipantId = message.participant.id;
    setTimeout(() => {
      cam.send(
        JSON.stringify({
          type: "webrtc.signal",
          toParticipantId: pdParticipantId,
          payload: {
            kind: "offer",
            sdp: "v=0\r\n"
          }
        })
      );
    }, 100);
  }
  if (
    message.type === "participant.state" &&
    message.participant.displayName === "CAM-1" &&
    message.participant.talking === true
  ) {
    sawState = true;
  }
  if (
    message.type === "audio.frame" &&
    message.fromParticipantId &&
    message.payload?.codec === "pcm16" &&
    message.payload?.pcm16
  ) {
    sawAudio = true;
  }
  if (
    message.type === "webrtc.signal" &&
    message.toParticipantId === pdParticipantId &&
    message.payload?.kind === "offer"
  ) {
    sawTargetedWebRtc = true;
  }
  if (sawState && sawAudio && sawTargetedWebRtc) {
    finish(true, `WebSocket broadcast PASS: ${JSON.stringify(seen)}`);
  }
});

for (const socket of [cam, pd]) {
  socket.addEventListener("error", () => {
    finish(false, `WebSocket error: ${JSON.stringify(seen)}`);
  });
}

function remember(client, data) {
  const message = JSON.parse(data);
  seen.push([client, message.type]);
  return message;
}

function finish(ok, message) {
  clearTimeout(timeout);
  try {
    cam.close();
    pd.close();
  } catch {
    // The process is ending; close failures are not meaningful here.
  }
  console.log(message);
  process.exit(ok ? 0 : 1);
}
