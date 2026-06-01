# LTE Intercom Version 1.0 Baseline

Date: 2026-06-01

This document marks the current project state as version 1.0.

## Included

- Android Kotlin intercom client.
- Windows Node.js server.
- Admin web UI for rooms, participants, talk/listen state, network status, event logs, and server controls.
- Room password and admin password support.
- Portable Windows launcher/tray/admin/server build scripts.
- Documentation for build, QA, architecture, and WebRTC/Opus migration.

## Excluded From Git

Generated and local-only files are intentionally excluded:

- Android APK/build folders.
- Gradle cache folders.
- Portable EXE output under `server/dist/`.
- Server logs.
- Local admin password config.
- Temporary screenshots.

Regenerate build output with:

```powershell
cd android
.\gradlew.bat :app:assembleDebug

cd ..\server
npm run build:portable
```

## Known Limitations

- Current media path is still MVP PCM relay, not final low-latency WebRTC/Opus media.
- Android UI and intercom workflow still need more field tuning.
- Beep and audio behavior can vary by Android hardware/audio route.
- Public Internet operation still depends on network/firewall/NAT configuration unless a relay/tunnel service is added later.

## Next Recommended Work

1. Complete WebRTC/Opus media transport.
2. Add stronger server authentication and room authorization policy.
3. Add persistent room configuration export/import.
4. Add structured release packaging and GitHub Release artifacts.
5. Continue Android UI testing on multiple phone/headset combinations.
