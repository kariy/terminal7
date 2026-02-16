# Claude Manager Platform Specification

Version: 1.0  
Status: Draft (implementation-aligned)  
Last updated: 2026-02-16

## 1. Purpose

Define the product and technical behavior for the Claude Manager platform, including:
- iOS client behavior
- remote manager server behavior
- API/message contracts
- data, security, operations, and acceptance criteria

This specification is aligned to the current codebase and also captures the intended product direction for terminal/SSH expansion.

## 2. Product Summary

Claude Manager is an iOS-first remote control surface for Claude Code sessions running on a server.

Current implemented mode:
- Manager Chat Mode: iOS connects to a server, authenticates, creates/resumes Claude sessions, and streams responses.

Planned mode:
- Raw SSH Terminal Mode: iOS opens a manual SSH terminal session for unrestricted shell access.

## 3. Personas and Primary Use Cases

Primary user:
- developer operating Claude Code on a remote machine from iPhone.

Core use cases:
- connect iOS app to a known host
- bootstrap/register device and persist access token
- open a Claude session and send prompts
- resume latest session and load history
- observe connection/session activity from server logs

Future use case:
- manually open raw SSH terminal session to remote host independent of Claude manager protocol

## 4. System Context

Components:
- iOS app (`ios/ClaudeChat`): SwiftUI client + WebSocket/HTTP manager client
- Manager server (`services/cc-manager`): Bun + TypeScript service
- SQLite database: device registration, session metadata, events, file index
- Claude JSONL store: `~/.claude/projects/**/*.jsonl` used for history/index
- Claude Agent SDK: runtime prompt streaming

Network model (current):
- HTTP + WS (no TLS termination in app/server layer)
- default port `8787`
- app configured to connect to server host on fixed port `8787`

## 5. Scope

## 5.1 In Scope (Current)

- iOS host-based connection UX (no username/password)
- device bootstrap to obtain bearer token
- token persistence in Keychain
- WebSocket auth and bidirectional session messaging
- session create/send/resume behavior
- stream token deltas and completion signals
- session history loading through REST APIs
- periodic JSONL indexing and on-demand refresh
- server observability logs for WS connect/recv/send and session creation

## 5.2 Planned Scope (Next)

- manual SSH mode in iOS (raw terminal emulation)
- credential methods for SSH (password/key)
- server-side session multiplexing for terminal mode

## 5.3 Out of Scope (Current Release)

- native TLS cert management inside manager process
- multi-tenant account model
- admin UI for device/token revocation
- push notifications/background execution guarantees

## 6. Client Specification (iOS)

## 6.1 Connection Configuration

Required input:
- `serverHost` (string, non-empty)

Fixed values:
- manager port: `8787`
- HTTP scheme: `http`
- WS scheme: `ws`

Expected behavior:
- if host is empty, connect action is rejected with status `Missing host`
- host is persisted in `UserDefaults`
- app auto-connects on launch when host exists and no active connect is running

## 6.2 Authentication and Bootstrap

Expected behavior:
- app attempts to read access token from Keychain account key `{host}:8787`
- if token is missing, app calls `POST /v1/bootstrap/register-device`
- app stores:
  - `access_token` in Keychain
  - `device_id` in `UserDefaults`
- bootstrap request includes iOS device name

Failure behavior:
- non-2xx bootstrap response surfaces `Connect failed` and appends error message in chat

## 6.3 WebSocket Lifecycle

Expected behavior:
- client opens `ws://{host}:8787/v1/ws`
- immediately sends `auth.init` with bearer token
- on `auth.ok`, connection state becomes `Connected`
- client starts periodic refresh timer every 10 seconds

Disconnect/reconnect behavior:
- on socket receive failure:
  - mark disconnected
  - stop streaming state
  - append socket error message
  - retry `connect()` after 1 second

Manual disconnect behavior:
- close socket with `goingAway`
- stop timers
- set status `Disconnected`

## 6.4 Messaging and Session Behavior

Send behavior:
- empty input is ignored
- send disabled while stream in progress
- if no active session, send `session.create`
- if active session exists, send `session.send` with `session_id` + `encoded_cwd`

Stream behavior:
- `stream.delta` text is appended to current assistant bubble while streaming
- if no active assistant bubble, a new assistant bubble is created
- `stream.done` clears streaming state

Session state behavior:
- on `session.created`, persist `session_id` and `encoded_cwd`
- on `session.state` status `index_refreshed`, trigger history reload

Error behavior:
- server `error` events are surfaced in chat as assistant error messages
- if error code is `unauthorized`, token is deleted from Keychain and auth is reset

## 6.5 History Loading

Trigger:
- after successful `auth.ok`

Sequence:
1. `GET /v1/sessions?refresh=1`
2. choose first (most recent) session
3. `GET /v1/sessions/{sessionId}/history?encoded_cwd={encodedCwd}`
4. replace chat message list with returned history entries

Failure behavior:
- append `Failed to load history` assistant message

## 6.6 Local Persistence

`UserDefaults`:
- `manager.host`
- `manager.deviceId`
- `manager.lastSessionId`
- `manager.lastSessionEncodedCwd`

Keychain:
- account key: `cc-manager-token:{host}:8787`
- accessibility: `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`

## 6.7 Client UX States

Status labels:
- `Disconnected`
- `Bootstrapping...`
- `Authenticating...`
- `Connected`
- `Connect failed`
- `Missing host`

UI constraints:
- connection form visible only when disconnected
- send action enabled only when connected, non-empty input, and not streaming

## 7. Server Specification (Manager)

## 7.1 Runtime and Configuration

Runtime:
- Bun TypeScript server

Default config:
- host: `127.0.0.1`
- port: `8787`
- db: `~/.cc-manager/manager.db`
- projects dir: `~/.claude/projects`
- max history messages per page: `5000`
- allowed tools default: `Read, Glob, Grep, Bash`

Environment variables:
- `CC_MANAGER_HOST`
- `CC_MANAGER_PORT`
- `CC_MANAGER_DB_PATH`
- `CC_MANAGER_CLAUDE_PROJECTS_DIR`
- `CC_MANAGER_MAX_HISTORY_MESSAGES`
- `CC_MANAGER_ALLOWED_TOOLS`
- `CC_MANAGER_BOOTSTRAP_NONCE`

## 7.2 Startup and Background Processing

On startup, server shall:
- initialize/migrate SQLite schema
- perform initial JSONL index refresh
- start HTTP + WS listener
- print startup logs (listen URL, projects dir, DB path)

Background index loop:
- refresh every 15 seconds
- log index stats when new files indexed or parse errors occur

Shutdown behavior:
- on SIGINT/SIGTERM:
  - clear index interval
  - stop server
  - close repository
  - exit process

## 7.3 Authentication Model

Bootstrap:
- `POST /v1/bootstrap/register-device`
- optional bootstrap gate with `CC_MANAGER_BOOTSTRAP_NONCE`
- returns `device_id`, `access_token`, `refresh_token`, `issued_at`

Bearer auth:
- protected REST endpoints require `Authorization: Bearer <token>`
- WS requires `auth.init` before non-auth messages

Token storage:
- access/refresh tokens are salted+hashed before persistence
- plaintext tokens are only returned at bootstrap time

## 7.4 REST API Contracts

### 7.4.1 Health

`GET /health`
- `200` with `{ status: "ok", time: ISO8601 }`

### 7.4.2 Register Device

`POST /v1/bootstrap/register-device`
Request:
- `device_name?: string (1..128)`
- `bootstrap_nonce?: string`

Responses:
- `201` success with device/token payload
- `400` invalid payload
- `403` invalid bootstrap nonce (when nonce configured)

### 7.4.3 List Sessions

`GET /v1/sessions`
Query:
- `refresh=1` optional to force index refresh before listing

Response `200`:
- sessions ordered by `last_activity_at DESC`
- each session includes:
  - `session_id`, `encoded_cwd`, `cwd`, `title`
  - timestamps: `created_at`, `updated_at`, `last_activity_at`
  - `source`, `message_count`

### 7.4.4 Session History

`GET /v1/sessions/{sessionId}/history?encoded_cwd={encodedCwd}&cursor={n}`

Behavior:
- resolves candidate session by `sessionId` and optional `encoded_cwd`
- reads from indexed JSONL path fallback
- returns paged messages up to `maxHistoryMessages`

Responses:
- `200` with `messages`, `next_cursor`, `total_messages`
- `404` if session candidate not found

## 7.5 WebSocket Protocol

Endpoint:
- `WS /v1/ws`

Connection behavior:
- server emits `hello` on open
- server logs WS connect with `connection_id`

Client message types:
- `auth.init`
- `session.create`
- `session.resume`
- `session.send`
- `session.stop`
- `session.refresh_index`
- `ping`

Server message types:
- `hello`
- `auth.ok`
- `session.created`
- `session.state`
- `stream.delta`
- `stream.done`
- `pong`
- `error`

Auth gating:
- any non-`auth.init` message before auth shall return `error: unauthorized`

`session.create` behavior:
- starts a new Claude stream
- on first system init, server emits `session.created`
- server logs `[session] created session_id=...`

`session.send`/`session.resume` behavior:
- requires `session_id`, `encoded_cwd`, `prompt`
- server resumes the existing Claude session stream by `session_id`

Streaming behavior:
- text deltas emitted as `stream.delta`
- stream completion emits `stream.done`
- errors emit `error` with code `prompt_failed`

Stop behavior:
- `session.stop` attempts to close running request
- emits `session.state` status `stopped` or `not_found`

Index refresh behavior:
- `session.refresh_index` triggers index refresh and emits `session.state` status `index_refreshed`

Ping behavior:
- `ping` emits `pong` with server time

Socket close behavior:
- server stops all active requests attached to that connection

## 7.6 Session Semantics

Session identity:
- composite key: `session_id + encoded_cwd`

Metadata source model:
- `db`: created from live WS traffic
- `jsonl`: inferred from Claude JSONL files
- `merged`: when both sources exist for same session key

## 7.7 Indexing and History Behavior

Indexer source:
- scans `projectsDir/{encodedCwd}/*.jsonl`

Change detection:
- re-index only when file `mtime` or `size` differs

Metadata extraction:
- title inferred from first user message, truncated to 120 chars
- message count computed from parsed user/assistant rows

History parsing:
- only text blocks are extracted from message content
- malformed JSON lines are ignored
- response paginates by cursor and max-history limit

## 7.8 Logging and Observability

Server shall log:
- startup configuration summary
- index refresh stats
- websocket connection open with `connection_id`
- every WS inbound payload (`[ws] recv ...`)
- every WS outbound payload (`[ws] send ...`)
- session creation events with `session_id`

Current behavior note:
- WS payload logs include sensitive values (e.g. tokens) and are truncated at 4000 chars

## 8. Data Model

SQLite tables:
- `device_registrations`
- `session_metadata`
- `session_events`
- `session_file_index`
- `schema_migrations`

Key properties:
- WAL mode enabled
- token/refresh hash uniqueness indexed
- metadata ordered by last activity

## 9. Security Requirements

Required:
- bearer token required for protected APIs and WS session operations
- token hashes stored, never plaintext
- bootstrap endpoint optionally guarded by nonce
- keychain-backed token storage on device

Recommended for production hardening:
- TLS termination for HTTP/WS
- token redaction in WS payload logs
- token rotation and revocation endpoints
- rate limiting on bootstrap/auth endpoints
- audit trail export and log retention policy

## 10. Performance and Reliability Requirements

Functional expectations:
- incremental stream updates delivered in near real-time
- index refresh operations should not block WS responsiveness
- reconnect attempts should recover transient network drops automatically

Operational targets (initial):
- manager startup < 5s in normal environment
- WS auth roundtrip < 1s on LAN
- history fetch < 2s for recent sessions under default cap

## 11. Acceptance Criteria

Client:
- can connect with host only (port fixed 8787)
- bootstrap occurs automatically when no token exists
- successful auth transitions UI to Connected
- prompt send creates or reuses session correctly
- streaming updates append to assistant message bubble
- app recovers from transient socket disconnection

Server:
- all REST endpoints validate payloads and return typed error codes
- WS rejects non-authenticated command messages
- `session.created` and WS connect/send/recv logs are emitted
- indexer discovers JSONL sessions and returns history with cursor support

## 12. Roadmap Extensions (Terminal/SSH Mode)

Phase 2 requirements:
- add iOS terminal mode selector: `Claude Managed` vs `Raw SSH`
- implement SSH credential management (password and key)
- add server-side session broker for terminal channels
- preserve manager-mode chat behavior unchanged

Success criteria for Phase 2:
- user can start raw terminal shell without Claude manager protocol
- user can switch modes per host profile
- terminal mode does not break current Claude managed flows
