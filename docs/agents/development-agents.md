# Development Agents

This project uses delegated agents for parallel development and verification.

## Active Agent Roles

### Android App Agent

- Scope: `android/`
- Owns the Android native Kotlin app skeleton, UI state model, headset/audio implementation notes, and Android build prerequisites.
- Must not edit `server/`.

### Verification Agent

- Scope: `docs/03-qa/`
- Owns Zero Script QA planning, server smoke checks, Android manual verification, and LTE field test checklists.
- Must not edit `server/` or `android/`.

### Main Development Agent

- Scope: `server/`, repository coordination, integration review.
- Owns the dependency-free Node.js server MVP until the media-server decision is finalized.

## Coordination Rules

- Each agent keeps edits inside its assigned scope.
- Agents do not revert changes from other agents.
- Integration happens after each agent reports changed files and verification status.
- Server verification starts with HTTP health/rooms endpoints before WebRTC media work.
