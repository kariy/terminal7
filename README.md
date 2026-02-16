# cc-sdk-test

This repository now contains a production-oriented **Claude Code manager backend** and a matching iOS chat client flow.

Full software specification: `docs/software-spec.md`

## What is implemented

- Remote manager service (`services/cc-manager`) built with Bun + TypeScript.
- SQLite-backed metadata/auth/lock store.
- Hybrid session discovery:
  - manager metadata in SQLite
  - inferred Claude session history from `~/.claude/projects/**/*.jsonl`
- Token-authenticated REST + WebSocket API.
- Single-device lock semantics per Claude session.
- iOS client flow updated to:
  - bootstrap without username/password
  - store access token in Keychain
  - authenticate to manager over WebSocket
  - stream Claude chat messages and load history

## Quick start

Install dependencies:

```bash
bun install
```

Start manager service:

```bash
bun run dev:manager
```

Expose manager on all interfaces (`0.0.0.0`):

```bash
bun run dev:manager:public
```

Manager defaults:

- Host: `127.0.0.1`
- Port: `8787`
- DB: `~/.cc-manager/manager.db`
- Claude projects directory: `~/.claude/projects`

Run manager tests:

```bash
bun run test:manager
```

## API overview

- `POST /v1/bootstrap/register-device`
  - Body: `{ "device_name": "..." }`
  - Returns device id + access token
- `GET /v1/sessions` (Bearer token)
- `GET /v1/sessions/:sessionId/history?encoded_cwd=...` (Bearer token)
- `POST /v1/sessions/:sessionId/lock/acquire` (Bearer token)
- `POST /v1/sessions/:sessionId/lock/release` (Bearer token)
- `GET /health`
- `WS /v1/ws`
  - `auth.init`, `session.create`, `session.send`, `session.resume`, `session.stop`, `session.refresh_index`

## Environment variables

- `CC_MANAGER_HOST`
- `CC_MANAGER_PORT`
- `CC_MANAGER_DB_PATH`
- `CC_MANAGER_CLAUDE_PROJECTS_DIR`
- `CC_MANAGER_LOCK_TTL_SECONDS`
- `CC_MANAGER_MAX_HISTORY_MESSAGES`
- `CC_MANAGER_ALLOWED_TOOLS` (comma separated)
- `CC_MANAGER_BOOTSTRAP_NONCE` (optional bootstrap gate)

## Existing scripts

- `bun run dev:manager` - start production manager
- `bun run dev:manager:public` - start manager on `0.0.0.0:8787`
- `bun run dev:cli` - run legacy CLI experiment (`index.ts`)
- `bun run dev:legacy-server` - run legacy WebSocket server (`server.ts`)
- `bun run ios:build` - build `ClaudeChat` for physical iOS devices
- `bun run ios:install` - install latest built app to the first connected iPhone (or pass `IOS_DEVICE_ID`)
- `bun run ios:build-install` - build and then install in one command
