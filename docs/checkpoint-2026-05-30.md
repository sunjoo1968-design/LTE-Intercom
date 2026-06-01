# LTE Intercom Checkpoint - 2026-05-30

## Android Initial Version

- Android debug APK builds successfully.
- Setup screen supports server IP, port, room, name, sidetone, receive gain, microphone gain, and echo control.
- Room default is `LIVE`; `Your Name` must be changed before entry.
- Main intercom screen keeps the local TALK control fixed at the bottom and shows remote participants above.
- TALK supports hold-to-talk and double-tap latch.
- Background foreground-service operation and exit confirmation are present.
- Audio MVP uses PCM16 relay through the Node server.
- TALK feedback currently uses beep plus haptic feedback, but beep reliability still needs later tuning.

## Server Next Baseline

- Server remains dependency-free Node.js.
- Existing HTTP endpoints and WebSocket `/signal` are preserved.
- Server GUI work starts from an embedded `/admin` control dashboard.
