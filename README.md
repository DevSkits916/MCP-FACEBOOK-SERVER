# MCP Facebook Connector

A Cloudflare Workers implementation of a Model Context Protocol (MCP) server that exposes Facebook Graph API tools. The worker
provides production-ready HTTP + SSE endpoints, OAuth with PKCE, persistent storage in Workers KV, and a built-in admin dashboard
for health checks, Facebook authorization, page management, settings, and live log streaming. The server can be registered inside
ChatGPT under **Settings → Developer → Add MCP server** to surface the tools in the ChatGPT UI.

## Features

- **MCP endpoints** – `GET /health`, `POST /mcp`, `GET /mcp/sse` (heartbeats every 15 seconds) with structured request logging and
  per-minute rate limiting.
- **Facebook Graph tools** – `fb.me`, `fb.profile_timeline`, `fb.profile_post`, `fb.page_list`, `fb.page_post`, `fb.debug_token`, and `echo` with extensive validation and
  retry logic for transient Graph API errors. Page posting supports optional link and image URL attachments by creating
  unpublished photos and attaching them to the feed post.
- **OAuth 2.0 + PKCE** – `GET /oauth/start` and `GET /oauth/callback` integrate with Facebook Login, exchange for long-lived tokens,
  and persist tokens in Workers KV (`user:<id>`, `page:<id>`). Tokens are redacted from logs.
- **Settings & storage** – `POST /api/settings`, `GET /api/settings`, `GET /api/tools`, `POST /api/auth/revoke`, and `GET
  /api/logs/stream` expose administrative controls. Settings (allowed origins, rate limits, feature flags) and the active user ID are
  cached in KV.
- **Security** – CORS allowlist via `ALLOWED_ORIGINS`, optional bearer protection for UI/API endpoints when `REQUIRE_ADMIN=1`, body
  limit of 256 KB, 100 active SSE connection cap, and retry-after responses on overload.
- **Observability** – JSON logs with `{ts, level, reqId, route, tool, status, ms, fb_call}`, retained in-memory for streaming to the
  dashboard console.
- **Self-contained UI** – `/ui/` serves a single-page dashboard (vanilla JS + CSS) covering connection status, OAuth, managed pages
  with quick post form, settings editor, and realtime console. The UI supports storing an admin token locally and streams server logs
  with filters for level and tool name.

## Project structure

```
mcp-fb-connector/
├── package.json
├── wrangler.toml
├── tsconfig.json
├── src/
│   ├── index.ts              # Router, CORS, rate limiting, OAuth, API endpoints, UI assets
│   ├── mcp.ts                # Envelope validation and tool dispatch
│   ├── sse.ts                # Server-Sent Events helpers
│   ├── logger.ts             # Structured logger with ring buffer + subscriptions
│   ├── utils.ts              # JSON helpers, admin auth, rate limiter
│   ├── storage.ts            # Workers KV helpers (tokens, settings, OAuth state)
│   ├── resources/serverInfo.ts
│   ├── fb/
│   │   ├── graph.ts          # Graph API client with retries, page posting, token debug
│   │   ├── oauth.ts          # PKCE utilities, long-lived token exchange, profile lookup
│   │   └── types.ts
│   ├── tools/
│   │   ├── echo.ts
│   │   ├── fb.me.ts
│   │   ├── fb.page_list.ts
│   │   ├── fb.page_post.ts
│   │   ├── fb.debug_token.ts
│   │   └── helpers.ts        # Shared token + page helpers
│   └── global.d.ts           # Text module declarations for UI assets
└── ui/
    ├── index.html            # Dashboard shell
    ├── app.css               # Modern responsive styling
    └── app.js                # Dashboard logic, MCP calls, SSE log parser
```

## Prerequisites

1. **Create a Facebook App** in the [Meta for Developers](https://developers.facebook.com/) console.
   - Configure **Facebook Login** with `https://<your-worker>.workers.dev/oauth/callback` as a valid OAuth redirect URI.
   - Request the minimum scopes required by the tools:
     - `public_profile` and `pages_show_list` – enumerate managed pages (`fb.page_list`).
     - `pages_read_engagement`, `pages_manage_posts` – read tokens and publish posts (`fb.page_post`). These typically require App Review.
     - Optional additional scopes (e.g., `pages_manage_metadata`) depending on your use cases.
2. **Install Wrangler** (`npm install -g wrangler`) and authenticate with `wrangler login`.
3. **Provision Workers KV** – `wrangler kv:namespace create TOKENS_KV` and copy the generated ID into `wrangler.toml`.

## Configuration

Update the environment variables in `wrangler.toml` (or via `wrangler secret put` for sensitive values):

| Variable             | Description                                                                 |
| -------------------- | --------------------------------------------------------------------------- |
| `FACEBOOK_APP_ID`    | Facebook App ID                                                             |
| `FACEBOOK_APP_SECRET`| Facebook App Secret (used for long-lived tokens & debug endpoint)           |
| `OAUTH_REDIRECT`     | Redirect URL (defaults to `<worker>/oauth/callback`)                        |
| `ALLOWED_ORIGINS`    | CSV allowlist for MCP requests (e.g., `https://chat.openai.com`)            |
| `REQUIRE_ADMIN`      | `"1"` to require `Authorization: Bearer <token>` on UI/API routes           |
| `ADMIN_BEARER`       | Shared secret if admin mode is enabled                                     |
| `SERVER_NAME`        | Display name for `/health`                                                  |
| `REGION`, `COMMIT`   | Optional metadata surfaced via `/health`                                   |

## Installation & deployment

```bash
npm install
npm run build           # optional dry-run bundle
wrangler deploy         # deploy to Cloudflare Workers
```

During deployment Wrangler will confirm bindings (`TOKENS_KV`) and environment variables. For local development run `npm run dev`
which uses `wrangler dev` and supports live reloading.

## Using the dashboard

1. Navigate to `https://<your-worker>.workers.dev/ui/`.
2. If admin auth is enabled, paste the shared secret into the **Admin token** field and click **Apply**.
3. Review the **Connection** section to ensure `/health`, `/mcp`, and `/mcp/sse` respond successfully.
4. In **Facebook Authorization**, click **Connect with Facebook**. The UI requests `/oauth/start` (JSON mode) and opens the Facebook
   consent screen in a new window. After completing the flow the callback stores the token in KV and closes the window.
5. The page automatically refreshes the linked user, token expiry, and managed resources list.
6. Explore **Profile → Timeline** to page through recent personal posts. The Newer/Older controls use Graph cursors to request
   additional results.
7. Use **Profile → Share to profile** to publish to your personal timeline with optional `link` and `image_url` fields. Successful
   posts refresh the timeline automatically.
8. Use **Pages → Quick Post** to publish to a page you manage. Optional `link` and `image_url` fields are validated before issuing
   Graph API requests. The result includes the Facebook post ID and permalink when available.
9. Update **Settings** (allowed origins, rate limit, verbose logging flag). Changes are persisted to KV and applied immediately.
10. The **Console** tab streams structured logs over SSE with filters for level and tool. A reconnect button restarts the stream if
    network issues occur.

## MCP integration

In ChatGPT:

1. Open **Settings → Developer → Add MCP server**.
2. Set the base URL to your worker, e.g., `https://<your-worker>.workers.dev`.
3. ChatGPT connects to `GET /mcp/sse` for readiness and uses `POST /mcp` for tool invocations. Ensure the origin is included in
   `ALLOWED_ORIGINS` so requests are accepted.
4. The tools appear as `fb.me`, `fb.profile_timeline`, `fb.profile_post`, `fb.page_list`, `fb.page_post`, `fb.debug_token`, and `echo`.

## Security notes

- `/mcp` and `/mcp/sse` require same-origin or allowlisted origins. Requests exceeding 256 KB fail with `413`.
- SSE connections are capped at 100 concurrent streams. Additional clients receive `429` with `Retry-After` headers.
- Admin mode (`REQUIRE_ADMIN=1`) restricts `/ui/*`, `/api/*`, and `/oauth/start` endpoints to callers presenting the correct bearer
  token. The UI persists the token only in `localStorage` on the client.
- Tokens and secrets are never written to logs; values with keys containing `token`/`secret` are redacted before emission.

## Troubleshooting

| Symptom                          | Resolution                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/oauth/start` returns 401       | Provide the admin bearer token or disable admin mode during initial setup.                                   |
| MCP requests rejected with 403   | Add the caller origin (e.g., `https://chat.openai.com`) to `ALLOWED_ORIGINS` or the dashboard settings page.  |
| Facebook API errors (code 190)   | Token expired or missing scopes. Re-run the OAuth flow and ensure required permissions are approved.          |
| 429 responses                    | Respect the `Retry-After` header or raise the per-minute rate limit in settings if appropriate.              |
| Log console empty                | Check network policies blocking SSE or click **Reconnect** to open a fresh stream.                           |

## Facebook scopes & limitations

The worker now supports both personal profiles and managed Pages. Minimum recommended scopes:

- `public_profile`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `user_posts`
- `user_photos`
- `publish_actions`

Posting with images relies on `/{page_id}/photos` or `/me/photos` followed by the corresponding `/feed` call with
`attached_media`. Some combinations may still require additional permissions depending on Facebook’s policies; consult the
[Graph API documentation](https://developers.facebook.com/docs/graph-api/).

## Development scripts

- `npm run dev` – start Wrangler in development mode.
- `npm run typecheck` – TypeScript type checking.
- `npm run build` – dry-run deploy to verify bundle and bindings.
- `npm run deploy` – deploy to production.

## License

This project is provided as-is without warranty. Configure environment variables and permissions carefully before exposing the
worker to production traffic.
