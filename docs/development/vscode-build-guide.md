# VS Code Build Guide

## Open the Workspace

Open this file in VS Code:

```text
C:\Users\lumos\Documents\LTE-Intercom\LTE-Intercom.code-workspace
```

The workspace contains three folders:

- `LTE-Intercom`: repository root and docs
- `Server`: Node.js signaling server
- `Android`: Android Kotlin app

## Required Installs

Server development works now with the installed Node.js runtime.

Android build requires these tools to be installed on Windows:

- JDK 17
- Android Studio
- Android SDK Platform 35
- Android SDK Build Tools 35.x
- Android SDK Platform-Tools for `adb`
- Gradle 8.x or project Gradle wrapper

Detected local paths on this PC:

```text
JDK 17: C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot
Android SDK: C:\Users\lumos\AppData\Local\Android\Sdk
APK output: C:\Users\lumos\Documents\LTE-Intercom\android\app\build\outputs\apk\debug\app-debug.apk
```

Recommended environment variables:

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT="$env:LOCALAPPDATA\Android\Sdk"
$env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
```

Set them permanently through Windows "Environment Variables" after confirming the real install paths.

## VS Code Tasks

Open Command Palette:

```text
Ctrl+Shift+P -> Tasks: Run Task
```

Available tasks:

- `Server: Test`
- `Server: Start`
- `Server: Health Check`
- `Server: WebSocket Smoke`
- `Android: Assemble Debug`
- `Android: Install Debug`
- `Android: Open Logcat`

Recommended first server loop:

1. Run `Server: Test`.
2. Run `Server: Start`.
3. Run `Server: Health Check`.
4. Run `Server: WebSocket Smoke`.

Recommended first Android loop after JDK/SDK install:

1. Run `Android: Assemble Debug`.
2. Connect an Android phone with USB debugging enabled.
3. Run `Android: Install Debug`.
4. Run `Android: Open Logcat`.

## Debug Server

Use VS Code Run and Debug:

```text
Server: Debug
```

The server listens on:

```text
http://localhost:8443
ws://localhost:8443/signal?room=PROD-A&name=CAM-1
```

## Build Completion Roadmap

### Step 1: Server MVP

Current status: implemented.

Remaining:

- persist room config
- add operator dashboard API
- decide media server: LiveKit, mediasoup, Janus, or Pion
- add WebRTC offer/answer routing tests

### Step 2: Android UI MVP

Current status: skeleton, state model, Gradle wrapper, and debug APK build are working.

Remaining:

- replace placeholder `MainActivity` with broadcast key panel UI
- add runtime microphone permission flow
- add server connection screen
- connect WebSocket signaling
- render participant state and Talk/Listen/Call state

### Step 3: Audio MVP

Remaining:

- foreground intercom service
- AudioManager route handling
- wired/USB-C/Bluetooth headset detection
- WebRTC Android audio session
- Opus media send/receive

### Step 4: Verification

Use:

- [verification-plan.md](../03-qa/verification-plan.md)
- `Server: WebSocket Smoke`
- Android physical-device tests with two phones and headsets
- LTE field test with RTT, packet loss, jitter, reconnect count

## Current Known Blockers

- `java`, `gradle`, and `adb` may still not be on the global Windows `PATH`; VS Code tasks use explicit local paths.
- No Android device was connected during the first `adb devices` check.
- Git repository needs safe-directory handling if using Git from this environment.
