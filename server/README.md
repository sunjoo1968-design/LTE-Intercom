# LTE Intercom Server

Dependency-free Node.js MVP server for early signaling and room state validation.

## Run

```powershell
cd server
npm test
npm start
```

## Windows Tray Controller

Run:

```powershell
.\start-tray.bat
```

The tray menu supports:

- Open Admin Web
- Start Server
- Restart Server
- Shutdown Server
- Start with Windows
- Exit Tray - Keep Server
- Exit Tray - Shutdown Server

## Portable Build

Build a portable Windows package:

```powershell
npm run build:portable
```

Output:

```text
server/dist/LTE-Intercom-Server-Portable/
  LTE-Intercom-Launcher.exe
  LTE-Intercom-Server.exe
  LTE-Intercom-Tray.exe
  LTE-Intercom-Admin.exe
  tray/
  admin/
  icons/
  config/
  README-FIRST.txt
```

Run `LTE-Intercom-Launcher.exe` first on another PC.

Default port: `8443`.

```powershell
$env:PORT=9000
npm start
```

Admin login:

```powershell
$env:ADMIN_PASSWORD="change-this-password"
npm start
```

If `ADMIN_PASSWORD` is not set, the temporary development password is `admin`.

Open the server control UI:

```text
http://localhost:8443/admin
```

The control UI can create rooms and disconnect a connected participant from the server.
The v1.1 dashboard shows `made by SunjooAn` and uses a direct disconnect action with immediate UI feedback.
It also has server controls for keep-running status, restart, and complete shutdown.
Room creation can include a room password. Android clients must enter the same room password.
Operation logs are written as JSON lines under `server/logs/`.

## HTTP API

- `GET /health`
- `GET /admin`
- `GET /admin/state`
- `POST /admin/server/keep-running`
- `POST /admin/server/restart`
- `POST /admin/server/shutdown`
- `POST /admin/rooms/:roomCode/participants/:participantId/disconnect`
- `GET /rooms`
- `POST /rooms`

Create a room:

```powershell
Invoke-RestMethod -Method Post http://localhost:8443/rooms `
  -ContentType "application/json" `
  -Body '{"code":"LIVE","description":"Main Live Room","password":"1234","channels":[{"id":"pgm","label":"PROGRAM"},{"id":"dir","label":"DIRECTOR"}]}'
```

Room fields:

- `code`: connection key used by Android clients, for example `LIVE`. It is normalized to uppercase and URL-safe characters.
- `description`: display text shown in the server GUI. It can be more descriptive than the code.
- `password`: optional room entry password. Leave blank for an open room.

## WebSocket Signaling

Connect to:

```text
ws://localhost:8443/signal?room=LIVE&password=1234&name=CAM-1
```

Client messages are JSON:

```json
{"type":"state.update","payload":{"talking":true,"listening":true,"muted":false}}
```

```json
{"type":"call.signal","payload":{"channelId":"dir"}}
```

PCM media relay MVP:

```json
{"type":"audio.frame","payload":{"codec":"pcm16","sampleRate":16000,"channels":1,"pcm16":"base64-pcm"}}
```

WebRTC signaling relay is already available:

```json
{"type":"webrtc.signal","payload":{"kind":"offer","sdp":"..."}}
```

Target a specific participant:

```json
{"type":"webrtc.signal","toParticipantId":"participant-id","payload":{"kind":"ice","candidate":"..."}}
```

The next low-latency media step is described in `docs/webrtc-opus-migration.md`.
