# LTE Intercom

Version 1.0 baseline for an Android broadcast intercom client and a Windows PC signaling/admin server.

This project is an early working MVP. It is usable for local/LAN field testing, but audio latency, WebRTC/Opus transport, production security hardening, and UI polishing still need more work in later versions.

## Version 1.0 Scope

- Android native Kotlin intercom app.
- Windows/Node.js server for room management, signaling, PCM audio relay, and WebRTC signaling relay.
- Admin web UI for rooms, participants, talk/listen tally, event log, network/port status, server restart/shutdown, and participant disconnect.
- Windows tray controller and no-console launcher for portable server operation.
- Room password support and admin password support.
- Android room selection from server-created rooms.
- Android detail and compact intercom views.
- Sidetone, echo mode, receive gain, microphone gain, PTT, latch, call signal, and foreground service support.

## Repository Layout

```text
android/   Android Kotlin client
server/    Node.js server, admin UI, tray controller, portable build scripts
docs/      requirements, architecture, QA, and next-step notes
```

## Build

Android debug APK:

```powershell
cd android
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat :app:assembleDebug
```

Server tests:

```powershell
cd server
npm test
```

Portable Windows server package:

```powershell
cd server
npm run build:portable
```

Output is generated under:

```text
server/dist/LTE-Intercom-Server-Portable/
```

The generated `dist/`, Android build outputs, logs, local admin password files, and screenshots are intentionally excluded from git.

## Run

Development server:

```powershell
cd server
npm start
```

Admin UI:

```text
http://localhost:8443/admin
```

Android clients connect through server room selection after entering the server IP.

## Version 1.0 Validation

- `npm test`: passing server test suite.
- `.\gradlew.bat :app:assembleDebug`: passing with JDK 17.
- Portable launcher/server/tray smoke checked locally.

## Next Work

See:

- [docs/next-server-admin-tasks.md](docs/next-server-admin-tasks.md)
- [docs/webrtc-opus-migration.md](docs/webrtc-opus-migration.md)
- [docs/03-qa/verification-plan.md](docs/03-qa/verification-plan.md)
