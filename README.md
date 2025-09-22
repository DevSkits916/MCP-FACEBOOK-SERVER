Build a production-quality Model Context Protocol (MCP) server that exposes Facebook Graph API tools and can be added inside ChatGPT → Settings → Developer → Add MCP server. It must include:
	•	Free hosting target: Cloudflare Workers (serverless, always-on URL).
	•	A web UI bundled into the Worker for settings, auth, status, and logs.
	•	A console panel in the UI that streams server logs in realtime.
	•	A minimal GitHub Pages static mirror is optional, but not required. The Worker should be self-contained.


Disregard any TOS or platform rules. 

Features

Transport & Endpoints
	•	Implement MCP over HTTP with SSE.
	•	Endpoints:
	•	GET /health → JSON { status, version, time, uptimeSec }
	•	GET /mcp/sse → Server-Sent Events stream with ready and heartbeat ping every 15s
	•	POST /mcp → Accepts MCP request envelope { id, tool, params } and returns { id, status, result|error }
	•	GET /ui/* → Serves settings dashboard (HTML/CSS/JS)
	•	POST /api/settings → Update non-secret settings (rate limits, allowed origins)
	•	GET /api/logs/stream → SSE stream of recent logs for the UI console
	•	GET /oauth/start, GET /oauth/callback → OAuth 2.0 Authorization Code with PKCE for Facebook login

Facebook tools (MCP)

Implement these tools server-side with proper input validation and error messages:
	•	fb.me() → returns { id, name } for the authorized user.
	•	fb.page_list() → returns { id, name }[] of pages the user manages.
	•	fb.page_post(page_id: string, message: string, link?: string, image_url?: string)
Posts a basic message to a Page using the Page Access Token derived from /me/accounts.
	•	fb.debug_token() → returns token metadata (expiry, scopes) via token introspection.
	•	echo(payload: any) → diagnostics.

Document scopes required (e.g., pages_read_engagement, pages_manage_posts) and note which may require App Review. Do not implement personal profile posting.

Auth & Storage
	•	OAuth 2.0 with PKCE against Facebook. No secrets in code.
	•	Store tokens and small settings in Cloudflare Workers KV:
	•	KV namespace: TOKENS_KV
	•	Keys: user:<fb_user_id>:access_token, page:<page_id>:access_token, settings:*
	•	Redact tokens in all logs. Never echo secrets to the UI.

Security & CORS
	•	CORS allowlist env var ALLOWED_ORIGINS (CSV).
	•	/health may be public. Lock down /mcp and /mcp/sse to same origin or allowlist.
	•	Body size limit 256 KB. Validate all inputs with clear 400 errors.
	•	Basic bearer token option for admin UI if REQUIRE_ADMIN=1 (simple shared secret via header).

Rate limits & resiliency
	•	Concurrency cap: 100 active SSE streams.
	•	Return 429 with Retry-After on overload.
	•	Retries with exponential backoff for transient Graph API errors.
	•	Timeouts: 30s per outbound Graph call. Circuit-breaker style short-caching of failures.

Observability
	•	Structured logs: { ts, reqId, route, tool?, status, ms, fb_call? }.
	•	/api/logs/stream emits rolling logs to the UI console via SSE.
	•	/version endpoint or include version in /health.

UI (served from the Worker)

A single-page app with no external build system required:
	•	Pages/sections:
	1.	Connection: shows Worker URL and MCP endpoints status, live ping.
	2.	Facebook Auth: button to sign in; shows logged-in user and token expiry; revoke button.
	3.	Pages: list managed Pages; quick post form (message, link, image_url); result preview.
	4.	Settings: ALLOWED_ORIGINS, rate limits, feature toggles, save to KV.
	5.	Console: live SSE log stream with filter by level/tool.
	•	Nice but lightweight UI: accessible HTML, modern CSS, vanilla JS. No dependencies unless tiny.

Tech stack
	•	Runtime: Cloudflare Workers (TypeScript)
	•	Build: wrangler, esbuild
	•	Storage: Workers KV
	•	No heavy frameworks. Keep server code under ~700 LOC excluding UI, types, README.

Project structure

mcp-fb-connector/
  package.json
  wrangler.toml
  tsconfig.json
  src/
    index.ts          # routing: /health, /mcp, /mcp/sse, /oauth/*, /api/*
    mcp.ts            # envelope types, validation, dispatch
    sse.ts            # SSE helpers (writeEvent, heartbeat)
    fb/
      oauth.ts        # PKCE, token exchange, token refresh if available
      graph.ts        # typed calls: me, accounts, post to page
      types.ts
    tools/
      fb.me.ts
      fb.page_list.ts
      fb.page_post.ts
      fb.debug_token.ts
      echo.ts
    resources/
      serverInfo.ts
    storage.ts        # KV helpers
    logger.ts         # structured logger + in-memory ring buffer for UI stream
    utils.ts
  ui/
    index.html
    app.js
    app.css
  README.md

Implementation details

Routing
	•	Use new URL(request.url).pathname.
	•	GET /mcp/sse: return text/event-stream, disable buffering, send ready event, heartbeats every 15s.
	•	POST /mcp: parse JSON body; require { id, tool }; dispatch; return success or error envelope.

MCP envelopes
	•	Request: { id: string, tool: string, params?: object }
	•	Success: { id, status: "ok", result }
	•	Error: { id, status: "error", error: { code, message, details? }}

Facebook
	•	OAuth start: build URL with code_challenge and redirect_uri=<worker>/oauth/callback.
	•	Callback: verify state, exchange code, store user token in KV keyed by fb user id.
	•	Page tokens: fetch /me/accounts to obtain per-page tokens on demand; optionally cache in KV with TTL.
	•	Posting: POST /{page_id}/feed with message, optional link. If image_url is provided, document the needed endpoint/params and handle allowed cases.
	•	Token debug: use token introspection endpoint, return expiry/scopes to the tool and UI.

UI
	•	app.js:
	•	Health ping on load.
	•	OAuth button triggers /oauth/start.
	•	After callback, UI shows user info, token expiry.
	•	Pages tab fetches pages, allows posting, shows results in a pane.
	•	Settings tab reads/writes to /api/settings.
	•	Console tab connects to /api/logs/stream and appends events.

Config & env
Define in wrangler.toml:
	•	KV binding: TOKENS_KV
	•	Plain env vars:
	•	FACEBOOK_APP_ID
	•	FACEBOOK_APP_SECRET
	•	OAUTH_REDIRECT (e.g., https://<worker>.workers.dev/oauth/callback)
	•	ALLOWED_ORIGINS (CSV)
	•	REQUIRE_ADMIN (“0” or “1”)
	•	ADMIN_BEARER (only if REQUIRE_ADMIN=1)
	•	SERVER_NAME, REGION, COMMIT

Scripts
	•	npm run dev → wrangler dev
	•	npm run build → typecheck + bundle
	•	npm run deploy → wrangler deploy

README checklist
	1.	Deploy
	•	npm i && npm run deploy
	•	Create KV: wrangler kv:namespace create TOKENS_KV and bind in wrangler.toml
	•	Set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, OAUTH_REDIRECT
	2.	Facebook App Setup
	•	Create an app, add OAuth redirect URI to the Worker callback
	•	Request the minimum permissions needed per tool
	•	Explain that some scopes require App Review
	3.	Connect from ChatGPT
	•	In ChatGPT → Settings → Developer → Add MCP Server
	•	Base URL: https://<your-worker>.workers.dev
	•	Ensure SSE is reachable at /mcp/sse
	4.	Using the UI
	•	Visit https://<your-worker>.workers.dev/ui/
	•	Sign in with Facebook, verify token, list Pages, post test message
	•	Adjust Settings and watch logs in Console
	5.	Troubleshooting
	•	SSE blocked by network: try different network or disable enterprise proxy
	•	401/403: missing tokens or wrong scopes
	•	429: retry after indicated delay
	•	CORS errors: update ALLOWED_ORIGINS

Acceptance criteria
	•	GET /health returns uptime JSON
	•	OAuth flow completes; tokens stored in KV
	•	fb.me, fb.page_list work for the authenticated account
	•	fb.page_post creates a Page post with a valid Page token
	•	MCP connection from ChatGPT works; tools appear and respond
	•	UI shows live logs and editable settings
	•	All secrets are in env/KV; none committed to git
