# WebRTC/Opus Migration Plan

## Current Media Mode

- Android captures 16 kHz mono PCM while TALK is active.
- The app sends PCM frames through the existing `/signal` WebSocket as `audio.frame`.
- The server relays frames to other participants in the same room.

This mode is useful for proving routing and UI behavior, but it is not the final low-latency transport.

## Target Media Mode

- Keep the current WebSocket `/signal` path for room state, participant state, call signals, and WebRTC signaling.
- Move voice media to WebRTC audio tracks.
- Use Opus codec through WebRTC instead of raw PCM JSON frames.
- Keep the current UI behavior: local TALK gates outbound audio, remote TALK state remains visible, and setup controls still apply to route/gain where possible.

## Server Work

- Keep `webrtc.signal` relay in `server/src/ws.js`; it already broadcasts SDP/ICE payloads to the room.
- Use targeted `webrtc.signal` delivery for SDP/ICE. The server accepts `toParticipantId` and delivers to that peer only, falling back to room broadcast when no target is supplied.
- Add optional room media capability metadata:
  - `mediaMode: "pcm16-websocket" | "webrtc-opus"`
  - `sampleRate`
  - `codec`

## Android Work

1. Add a native WebRTC Android dependency and initialize `PeerConnectionFactory`.
   - Candidate dependency: `io.github.webrtc-sdk:android`.
   - Avoid the old `org.webrtc:google-webrtc:1.0.32006` unless compatibility testing requires it.
2. Create one outbound audio track per local user.
3. Negotiate peers through existing `webrtc.signal` messages:
   - offer
   - answer
   - ice
4. Gate outbound audio with current TALK state:
   - TALK ON: enable local audio track
   - TALK OFF: disable local audio track
5. Keep PCM WebSocket as fallback until WebRTC is stable on LTE.

## Validation Steps

- Two phones in the same room connect and exchange SDP/ICE.
- TALK ON from phone 1 is heard on phone 2 via WebRTC audio.
- TALK OFF immediately mutes outbound audio.
- Bluetooth headset routing still works.
- LTE test confirms lower delay than PCM WebSocket mode.
