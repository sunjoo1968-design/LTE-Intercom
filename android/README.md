# LTE Intercom Android

Android native Kotlin client for the LTE Intercom version 1.0 MVP.

## Features

- Server IP entry with four numeric IP fields.
- Room list loading from the server.
- Required display name before joining a room.
- Optional room password entry with show/hide control.
- Detail view with participants, local talk control, listen state, call signal, and tally state.
- Compact view with talk/listen counters and participant number labels.
- Press-and-hold PTT and double-tap latch.
- Foreground service for active intercom sessions.
- Sidetone toggle, echo control mode, receive gain, and microphone gain controls.
- PCM audio relay MVP with WebSocket signaling.

## Build Requirements

- JDK 17.
- Android Studio or Android SDK.
- Android SDK platform/build tools compatible with the Gradle project.

If a newer Java version is first on `PATH`, set JDK 17 before building:

```powershell
cd C:\Users\lumos\Documents\LTE-Intercom\android
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat :app:assembleDebug
```

Debug APK output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Runtime Notes

- The app expects the server to expose port `8443`.
- Rooms are created in the server admin UI first, then selected in the Android app.
- Room passwords are enforced by the server during WebSocket join.
- Current audio transport is still MVP PCM relay. WebRTC/Opus migration is planned in `docs/webrtc-opus-migration.md`.

## Main Source Files

```text
app/src/main/java/com/lteintercom/app/MainActivity.kt
app/src/main/java/com/lteintercom/app/ui/IntercomPanelView.kt
app/src/main/java/com/lteintercom/app/net/IntercomSignalingClient.kt
app/src/main/java/com/lteintercom/app/audio/
app/src/main/java/com/lteintercom/app/model/
```
