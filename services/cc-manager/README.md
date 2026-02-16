# cc-manager

Production-oriented Claude session manager daemon.

## Responsibilities

- Device bootstrap + access-token auth.
- Claude prompt streaming via `@anthropic-ai/claude-agent-sdk`.
- Session metadata + lock state in SQLite.
- Hybrid history/session indexing from Claude JSONL files.
- REST + WebSocket interface for iOS clients.

## Run

```bash
bun run src/main.ts
```

## Testing

```bash
bun test src
```
