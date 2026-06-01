# Next Server Admin Tasks

Planned later. Do not implement until requested.

## Confirmed Direction

- Use one server port and separate rooms by room code.
- Do not add port range selection.
- Do not add multi-server-instance port range operation.

## Admin UI Changes

- Hide IPv6 addresses in the network panel.
- Show the server public IP address.
- Rename `ROOM NAME` to `ROOM DESCRIPTION`.
- Keep room creation based on:
  - `ROOM CODE`: app connection key.
  - `ROOM DESCRIPTION`: human-readable room description in the admin UI.
- Keep the default server port as `8443`.
- Keep Android connection format:
  - `ws://SERVER_IP:8443/signal`
  - room separation is done by `ROOM CODE`.
- Make the event log scroll only inside the event log card.
- Add an event log clear button.
- Make the participant/user card area scroll only inside its own panel when many users connect.
- Add expand buttons for the user panel and event log panel so each can be viewed wider/larger.

## Portable Distribution Plan

Goal: reduce size and make deployment to other PCs simple.

Package as separated executable components:

- Server executable.
- Tray controller executable.
- Admin web assets separated from the server executable when practical.
- One main launcher executable that controls the whole package.

Main launcher responsibilities:

- Start the server.
- Start or show the tray controller.
- Open the admin web UI.
- Provide a single first-run entry point for operators.

Portable folder target:

```text
LTE-Intercom-Server-Portable/
  LTE-Intercom-Launcher.exe
  LTE-Intercom-Server.exe
  LTE-Intercom-Tray.exe
  admin/
  icons/
  config/
  README-FIRST.txt
```

Icons:

- Create suitable icons for launcher, server, tray, and admin web.
- Keep icon style professional and broadcast/intercom oriented.

Notes:

- Prefer a small Windows-native or script-packaged launcher over a large Electron app.
- Avoid bundling unnecessary browser runtimes.
- Keep the server runnable without installation.
