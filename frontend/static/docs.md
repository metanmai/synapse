# Synapse API Documentation

Base URL: `https://api.synapsesync.app`

## Authentication

All API requests (except signup, login, and webhooks) require a Bearer token in the Authorization header:

```
Authorization: Bearer <api_key>
```

Get an API key:
- Via web: Sign up at synapsesync.app, go to Account -> API Keys
- Via CLI (interactive): `npx synapsesync-mcp --help` then `login`, `signup`, `init`, or `wizard` from your project directory
- Via CLI (non-interactive): `npx synapsesync-mcp login --email <email> --password <password>` (prints JSON; run `init --key` to write config)

## Auth

### Sign up
`POST /auth/signup`

Body: `{ "email": "user@example.com" }`

Response (201):
```json
{ "id": "uuid", "email": "user@example.com", "api_key": "uuid-uuid" }
```

### Login
`POST /auth/login`

Body: `{ "email": "user@example.com", "password": "...", "label": "cli" }`

Response:
```json
{ "id": "uuid", "email": "user@example.com", "api_key": "uuid-uuid", "label": "cli" }
```

## Projects

### List projects
`GET /api/projects`

Returns all projects you own or are a member of.

Response:
```json
[{ "id": "uuid", "name": "my-project", "owner_id": "uuid", "owner_email": "user@example.com", "role": "owner", "created_at": "..." }]
```

### Create project
`POST /api/projects`

Body: `{ "name": "project-name" }`

Response (201):
```json
{ "id": "uuid", "name": "project-name", "owner_id": "uuid", "created_at": "..." }
```

### Add member
`POST /api/projects/:id/members`

Body: `{ "email": "collaborator@example.com", "role": "editor" }`

Response (201):
```json
{ "id": "uuid", "project_id": "uuid", "user_id": "uuid", "role": "editor" }
```

### Remove member
`DELETE /api/projects/:id/members/:email`

Response:
```json
{ "ok": true }
```

### Export project
`GET /api/projects/:id/export`

Returns a zip file containing all entries as markdown files with YAML frontmatter.

### Import project
`POST /api/projects/:id/import`

Body: multipart/form-data with a `file` field containing a Synapse-exported zip.

Response:
```json
{ "created": 5, "updated": 2, "skipped": 0 }
```

### Create share link
`POST /api/projects/:id/share-links`

Body: `{ "role": "editor", "expires_at": "2027-01-01T00:00:00Z" }`

Response (201):
```json
{ "token": "...", "role": "editor", "expires_at": "..." }
```

### List share links
`GET /api/projects/:id/share-links`

### Delete share link
`DELETE /api/projects/:id/share-links/:token`

### Get activity log
`GET /api/projects/:id/activity?limit=50&offset=0`

## Context Entries

### Save entry
`POST /api/context/save`

Body:
```json
{ "project": "project-name", "path": "decisions/chose-redis.md", "content": "...", "tags": ["decision"], "source": "claude" }
```

Response (201):
```json
{ "id": "uuid", "project_id": "uuid", "path": "decisions/chose-redis.md", "content": "...", "tags": ["decision"], "source": "claude", "created_at": "...", "updated_at": "..." }
```

### Get entry
`GET /api/context/:project/:path`

Response:
```json
{ "id": "uuid", "path": "decisions/chose-redis.md", "content": "...", "tags": ["decision"], "source": "claude", "created_at": "...", "updated_at": "..." }
```

### List entries
`GET /api/context/:project/list?folder=decisions`

Response:
```json
[{ "path": "decisions/chose-redis.md", "tags": ["decision"], "updated_at": "..." }]
```

### Search entries
`GET /api/context/:project/search?q=query&tags=decision&folder=decisions`

Search uses a 3-tier strategy, run in parallel and merged by relevance:
1. **Semantic search** — finds conceptually similar content using vector embeddings (e.g., "auth flow" matches "login and session tokens")
2. **Full-text search** — Postgres `tsvector` websearch matching
3. **Keyword search** — ILIKE fallback for partial/fuzzy matches

Semantic search requires the optional embedding service. Without it, search gracefully degrades to full-text + keyword only.

Response:
```json
[{ "path": "decisions/chose-redis.md", "content": "...", "tags": ["decision"] }]
```

### Delete entry
`DELETE /api/context/:project/:path`

Response:
```json
{ "ok": true }
```

### Version history
`GET /api/context/:project/history/:path`

Free tier: last 3 versions. Pro: unlimited.

Response:
```json
[{ "id": "uuid", "content": "...", "created_at": "..." }]
```

### Restore version
`POST /api/context/:project/restore`

Body: `{ "path": "decisions/chose-redis.md", "historyId": "uuid" }`

Response:
```json
{ "id": "uuid", "path": "decisions/chose-redis.md", "content": "...", "updated_at": "..." }
```

### Load context
`GET /api/context/:project/load`

Returns context entries based on user preferences (full, smart, on_demand, summary_only).

## API Keys

### List keys
`GET /api/account/keys`

Response:
```json
[{ "id": "uuid", "label": "my-laptop", "created_at": "...", "expires_at": "..." }]
```

### Create key
`POST /api/account/keys`

Body: `{ "label": "my-laptop", "expires_at": "2027-01-01T00:00:00Z" }`

Response (201) includes `api_key` (shown once):
```json
{ "id": "uuid", "label": "my-laptop", "api_key": "uuid-uuid", "expires_at": "...", "created_at": "..." }
```

### Revoke key
`DELETE /api/account/keys/:id`

Response:
```json
{ "ok": true }
```

## Billing

### Get status
`GET /api/billing/status`

Response:
```json
{ "tier": "free", "subscription": null }
```

### Create checkout
`POST /api/billing/checkout`

Response:
```json
{ "url": "https://checkout.creem.io/..." }
```

### Open billing portal
`POST /api/billing/portal`

Response:
```json
{ "url": "https://portal.creem.io/..." }
```

### Webhook
`POST /api/billing/webhook`

Used by the payment provider (Creem). Not for direct API use.

## Preferences

### Set preference
`PUT /api/preferences/:project`

Body: `{ "key": "context_loading", "value": "smart" }`

## MCP Server

Connect AI tools via the Model Context Protocol:

```bash
npx synapsesync-mcp login --email <email> --password <password>
```

MCP endpoint: `https://api.synapsesync.app/mcp`

## Rate Limits

120 requests per minute per API key. Responses include:
- `X-RateLimit-Limit`: Max requests per window
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when the window resets

If exceeded, returns 429 with `Retry-After` header.

## Idempotency

For write operations, you can include an `Idempotency-Key` header to ensure the request is only processed once. If a request with the same key has already been processed, the cached response will be returned with an `Idempotency-Replayed: true` header.

## Error Responses

All errors return JSON:
```json
{ "error": "Human-readable message", "code": "ERROR_CODE" }
```

Common codes:
- `VALIDATION_ERROR` - Invalid request body or parameters
- `TIER_LIMIT` - Free tier limit exceeded
- `NOT_FOUND` - Resource not found
- `RATE_LIMIT` - Too many requests
- `AUTH_ERROR` - Invalid credentials
- `KEY_LIMIT` - Maximum API keys reached (10)
- `INTERNAL_ERROR` - Server error
- `CONFLICT` - Resource already exists
- `UNAUTHORIZED` - Missing or invalid API key
- `FORBIDDEN` - Insufficient permissions
