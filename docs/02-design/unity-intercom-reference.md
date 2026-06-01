# Unity Intercom Reference Notes

Reference:

- https://www.unityintercom.com/pro
- https://www.unityintercom.com/products

## Relevant Patterns

- Unity Intercom is positioned as production intercom over Wi-Fi or cellular data.
- Unity Intercom Pro emphasizes party-line channel volume control.
- Pro also includes global or sticky channels, where selected talk/listen channels remain active while switching groups.
- Unity Intercom Connect is described as sending and receiving many low-latency streams over IP.

## Project UI Decision

For this MVP, the Android panel should prioritize actual connected participants because that is the current test workflow:

- Show server-provided participants as cards.
- Keep Talk, Listen, Call per participant card.
- Fall back to sample party-line channels only when the server has no participant list.
- Later add a dedicated party-line/group mode inspired by Unity Intercom Pro:
  - per-channel volume
  - group switching
  - global/sticky channels
  - participant monitor strip
