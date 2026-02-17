# cc-manager Server API Specification

Base URL: `http://{host}:{port}` (default `http://127.0.0.1:8787`)

All JSON responses use `Content-Type: application/json; charset=utf-8`.

---

## HTTP Endpoints

### `GET /health`

Health check endpoint.

**Response `200`**

```jsonc
{
  "status": "ok",
  "time": "2025-01-15T12:00:00.000Z" // ISO 8601
}
```

---

### `GET /v1/sessions`

List all known sessions, ordered by most recent activity first.

**Query parameters**

| Name      | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `refresh` | string | no       | Set to `"1"` to trigger a JSONL index refresh before returning |

**Response `200`**

```jsonc
{
  "sessions": [
    {
      "session_id": "abc-123",
      "encoded_cwd": "-Users-me-project",
      "cwd": "/Users/me/project",
      "title": "Fix login bug",
      "created_at": 1705300000000,   // epoch ms
      "updated_at": 1705300100000,
      "last_activity_at": 1705300100000,
      "source": "db",               // "db" | "jsonl" | "merged"
      "message_count": 12
    }
  ]
}
```

Sessions are sorted by `last_activity_at DESC`. The `message_count` comes from the JSONL file index and is `0` if the session has not been indexed.

---

### `GET /v1/sessions/:id/history`

Read message history for a session from its JSONL file. Returns cursor-paginated results.

**Path parameters**

| Name | Type   | Description |
| ---- | ------ | ----------- |
| `id` | string | Session ID (URL-encoded if it contains special characters) |

**Query parameters**

| Name          | Type   | Required | Description                                                                 |
| ------------- | ------ | -------- | --------------------------------------------------------------------------- |
| `encoded_cwd` | string | no       | Disambiguate when the same session ID exists under multiple working directories. If omitted the first candidate is used. |
| `cursor`      | string | no       | Integer cursor returned by a previous response's `next_cursor` for pagination |

**Response `200`**

```jsonc
{
  "session_id": "abc-123",
  "encoded_cwd": "-Users-me-project",
  "messages": [
    {
      "role": "user",              // "user" | "assistant"
      "text": "Fix the login bug", // plain text summary (all text blocks joined)
      "content_blocks": [          // optional — raw Anthropic API content blocks
        { "type": "text", "text": "Fix the login bug" }
      ],
      "uuid": "msg-uuid"          // optional
    },
    {
      "role": "assistant",
      "text": "I'll look into that...",
      "content_blocks": [
        { "type": "thinking", "thinking": "Let me analyze..." },
        { "type": "text", "text": "I'll look into that..." },
        { "type": "tool_use", "id": "tool_1", "name": "Read", "input": { "file_path": "/src/login.ts" } }
      ],
      "uuid": "msg-uuid"
    }
  ],
  "next_cursor": 50,       // null if no more pages
  "total_messages": 120
}
```

The `content_blocks` field contains the raw content block array from the JSONL session file when available. Clients should prefer `content_blocks` for rich rendering (tool calls, thinking, etc.) and fall back to `text` for plain display.

**Response `404`** — Session not found

```json
{
  "error": {
    "code": "session_not_found",
    "message": "Session not found"
  }
}
```

**Response `501`** — Indexer not available

```json
{
  "error": {
    "code": "not_implemented",
    "message": "History endpoint requires indexer"
  }
}
```

---

### Static file serving

Any path not matching the API routes above is resolved against `public/` (the Vite build output directory).

- `GET /` and `GET /sessions/*` — Returns `public/index.html` (SPA fallback).
- All other paths — Serves the matching file from `public/`, or returns `404`:

```json
{
  "error": {
    "code": "not_found",
    "message": "Not found"
  }
}
```

---

## Error response shape

All HTTP error responses follow this structure:

```jsonc
{
  "error": {
    "code": "<string>",    // machine-readable error code
    "message": "<string>"  // human-readable description
  }
}
```

---

## WebSocket API

**Endpoint:** `ws://{host}:{port}/v1/ws`

The connection upgrades from HTTP. If the upgrade fails, the server returns:

**Response `400`**

```json
{
  "error": {
    "code": "upgrade_failed",
    "message": "WebSocket upgrade failed"
  }
}
```

The idle timeout for WebSocket connections is **120 seconds**.

All messages in both directions are JSON-encoded strings.

---

### Server-sent messages

#### `hello`

Sent immediately after the WebSocket connection opens.

```jsonc
{
  "type": "hello",
  "requires_auth": false,     // always false (auth not implemented)
  "server_time": 1705300000000 // epoch ms
}
```

#### `session.created`

Sent when a new session is created (in response to `session.create`).

```jsonc
{
  "type": "session.created",
  "request_id": "req-1",
  "session_id": "abc-123",
  "encoded_cwd": "-Users-me-project",
  "cwd": "/Users/me/project"
}
```

#### `session.state`

Sent for state transitions: session resumed, session stopped, index refreshed.

```jsonc
{
  "type": "session.state",
  "request_id": "req-1",        // present for resume/stop, absent for index refresh
  "session_id": "abc-123",      // present for resume, absent for stop/index refresh
  "encoded_cwd": "-Users-me-p", // present for resume, absent for stop/index refresh
  "status": "<string>",         // see status values below
  "stats": { ... }              // present only for "index_refreshed"
}
```

**Status values:**

| Status              | Trigger                     | Extra fields                                          |
| ------------------- | --------------------------- | ----------------------------------------------------- |
| `session_resumed`   | `session.resume` / `session.send` | `request_id`, `session_id`, `encoded_cwd`       |
| `stopped`           | `session.stop` (request found)    | `request_id`                                    |
| `not_found`         | `session.stop` (request not found)| `request_id`                                    |
| `index_refreshed`   | `session.refresh_index`           | `stats: { indexed, skippedUnchanged, parseErrors }` |

#### `stream.message`

Forwarded SDK message from the Claude Agent SDK streaming response. Sent zero or more times during an active prompt.

```jsonc
{
  "type": "stream.message",
  "request_id": "req-1",
  "session_id": "abc-123",   // may be undefined before session ID is resolved
  "sdk_message": { ... }     // raw SDKMessage from @anthropic-ai/claude-agent-sdk
}
```

The `sdk_message` field contains the unmodified message from the SDK. Common message types include `system` (with `subtype: "init"`), `stream_event` (with `event.type` such as `content_block_delta`), and others defined by the SDK.

#### `stream.done`

Sent when a prompt completes successfully.

```jsonc
{
  "type": "stream.done",
  "request_id": "req-1",
  "session_id": "abc-123",         // may be undefined if session ID was never resolved
  "encoded_cwd": "-Users-me-project"
}
```

#### `error`

Sent for any error condition (validation failures, prompt errors, etc.).

```jsonc
{
  "type": "error",
  "code": "<string>",       // machine-readable code (see table below)
  "message": "<string>",    // human-readable description
  "request_id": "req-1",    // present when the error relates to a specific request
  "details": { ... }        // present for validation errors (Zod formatted error)
}
```

**Error codes:**

| Code               | Cause                                          |
| ------------------ | ---------------------------------------------- |
| `invalid_json`     | Message is not valid JSON                      |
| `invalid_payload`  | Message fails Zod schema validation            |
| `invalid_payload`  | `session_id` missing on `session.resume`/`session.send` |
| `session_not_found`| Session metadata not found in the database     |
| `prompt_failed`    | Claude SDK streaming error                     |

#### `pong`

Response to `ping`.

```jsonc
{
  "type": "pong",
  "server_time": 1705300000000 // epoch ms
}
```

---

### Client-sent messages

All client messages are validated against a Zod discriminated union on the `type` field. Invalid JSON returns `invalid_json`; a well-formed JSON object that fails schema validation returns `invalid_payload` with Zod-formatted `details`.

#### `session.create`

Create a new session and send the first prompt.

```jsonc
{
  "type": "session.create",
  "prompt": "Fix the login bug",     // required, min 1 char
  "request_id": "req-1",             // optional (min 1 char), auto-generated UUID if omitted
  "cwd": "/Users/me/project",        // optional (min 1 char), defaults to CC_MANAGER_DEFAULT_CWD (default "/")
  "title": "Fix login"               // optional, 1–256 chars; used as session title hint
}
```

**Preconditions:** None.

**Server response sequence:**

1. `session.created` — once the SDK provides a session ID
2. `stream.message` — zero or more times
3. `stream.done` — on successful completion, OR `error` with code `prompt_failed` on failure

**Side effects:**

- Upserts `session_metadata` row with source `"db"`
- Records `session_created` event
- Records `prompt_completed` or `prompt_error` event on completion

#### `session.resume`

Resume an existing session and send a follow-up prompt.

```jsonc
{
  "type": "session.resume",
  "session_id": "abc-123",                  // required, min 1 char
  "encoded_cwd": "-Users-me-project",       // required, min 1 char
  "prompt": "Now fix the logout bug too",   // required, min 1 char
  "request_id": "req-2",                    // optional (min 1 char), auto-generated UUID if omitted
  "cwd": "/Users/me/project"               // optional (min 1 char), unused (cwd is read from stored metadata)
}
```

**Preconditions:**

- A `session_metadata` row must exist for the given `(session_id, encoded_cwd)` pair. If not found, returns `error` with code `session_not_found`.

**Server response sequence:**

1. `session.state` with `status: "session_resumed"` — once the SDK provides a session ID
2. `stream.message` — zero or more times
3. `stream.done` — on successful completion, OR `error` with code `prompt_failed` on failure

**Side effects:**

- Upserts `session_metadata` row
- Records `session_resumed` event
- Records `prompt_completed` or `prompt_error` event on completion

#### `session.send`

Identical to `session.resume` — sends a follow-up prompt to an existing session. Both message types share the same schema and handler.

```jsonc
{
  "type": "session.send",
  "session_id": "abc-123",                  // required, min 1 char
  "encoded_cwd": "-Users-me-project",       // required, min 1 char
  "prompt": "What about the signup page?",  // required, min 1 char
  "request_id": "req-3",                    // optional (min 1 char)
  "cwd": "/Users/me/project"               // optional (min 1 char)
}
```

#### `session.stop`

Stop an active streaming request.

```jsonc
{
  "type": "session.stop",
  "request_id": "req-1"   // required, min length 1
}
```

**Response:** `session.state` with `status: "stopped"` if the request was found and stopped, or `status: "not_found"` if the request ID was not active.

#### `session.refresh_index`

Trigger a JSONL index refresh.

```jsonc
{
  "type": "session.refresh_index"
}
```

**Response:** `session.state` with `status: "index_refreshed"` and a `stats` object:

```jsonc
{
  "type": "session.state",
  "status": "index_refreshed",
  "stats": {
    "indexed": 5,
    "skippedUnchanged": 42,
    "parseErrors": 0
  }
}
```

If no indexer is configured, all stats values are `0`.

#### `ping`

Keepalive ping.

```jsonc
{
  "type": "ping"
}
```

**Response:** `pong` with current `server_time`.

---

### Connection lifecycle

1. Client opens WebSocket to `/v1/ws`
2. Server sends `hello`
3. Client sends messages; server responds per the sequences described above
4. On disconnect, the server automatically calls `stopRequest` for all active requests associated with the connection

---

## Configuration

All configuration is via environment variables prefixed `CC_MANAGER_`.

| Variable                          | Default                  | Description                        |
| --------------------------------- | ------------------------ | ---------------------------------- |
| `CC_MANAGER_HOST`                 | `127.0.0.1`             | Bind address                       |
| `CC_MANAGER_PORT`                 | `8787`                  | Bind port                          |
| `CC_MANAGER_DB_PATH`              | `~/.cc-manager/manager.db` | SQLite database path            |
| `CC_MANAGER_CLAUDE_PROJECTS_DIR`  | `~/.claude/projects`    | JSONL session file directory       |
| `CC_MANAGER_ALLOWED_TOOLS`        | `Read,Glob,Grep,Bash`   | Comma-separated SDK tool allowlist |
| `CC_MANAGER_MAX_HISTORY_MESSAGES` | `5000`                  | Max messages returned by history   |
| `CC_MANAGER_DEFAULT_CWD`          | `/`                     | Default working directory for new sessions |

Paths starting with `~/` are expanded to the user's home directory.

---

## Data model

Session identity is a composite key of `(session_id, encoded_cwd)`. The `encoded_cwd` is derived from the working directory path by replacing `/` with `-` (via the `encodeCwd` utility).

### `session_metadata`

| Column            | Type    | Description                          |
| ----------------- | ------- | ------------------------------------ |
| `session_id`      | TEXT PK | Claude session identifier            |
| `encoded_cwd`     | TEXT PK | Encoded working directory            |
| `cwd`             | TEXT    | Original working directory path      |
| `title`           | TEXT    | Session title                        |
| `created_at`      | INTEGER | Creation timestamp (epoch ms)        |
| `updated_at`      | INTEGER | Last update timestamp (epoch ms)     |
| `last_activity_at`| INTEGER | Last activity timestamp (epoch ms)   |
| `source`          | TEXT    | `"db"`, `"jsonl"`, or `"merged"`     |

### `session_events`

| Column         | Type           | Description                       |
| -------------- | -------------- | --------------------------------- |
| `id`           | INTEGER PK     | Auto-increment                    |
| `session_id`   | TEXT           | Session identifier                |
| `encoded_cwd`  | TEXT           | Encoded working directory         |
| `event_type`   | TEXT           | Event type string                 |
| `payload_json` | TEXT (nullable)| JSON-encoded event payload        |
| `created_at`   | INTEGER        | Timestamp (epoch ms)              |

**Event types:** `session_created`, `session_resumed`, `prompt_completed`, `prompt_error`

### `session_file_index`

| Column              | Type           | Description                    |
| ------------------- | -------------- | ------------------------------ |
| `session_id`        | TEXT PK        | Session identifier             |
| `encoded_cwd`       | TEXT PK        | Encoded working directory      |
| `jsonl_path`        | TEXT           | Absolute path to JSONL file    |
| `file_mtime_ms`     | INTEGER        | File modification time (ms)    |
| `file_size`         | INTEGER        | File size in bytes             |
| `message_count`     | INTEGER        | Number of messages in file     |
| `first_user_text`   | TEXT (nullable)| First user message text        |
| `last_assistant_text`| TEXT (nullable)| Last assistant message text   |
| `last_indexed_at`   | INTEGER        | Indexing timestamp (epoch ms)  |
