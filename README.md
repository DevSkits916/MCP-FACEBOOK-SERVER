# MCP-FACEBOOK-SERVER
Short version: you can’t run an MCP “server” on GitHub Pages because Pages is static hosting. No server process, no SSE endpoint, no joy. Put the MCP server somewhere that can actually execute code (Cloudflare Workers, Fly, Railway, Vercel, whatever), then use GitHub Pages for the static docs/demo. ChatGPT’s Developer Mode will happily connect to a remote MCP server over HTTP+SSE.  ￼

Here’s a drop-in prompt you can paste into Codex to make the whole thing:

⸻

Prompt for Codex

Build a minimal, production-ready Model Context Protocol (MCP) server that ChatGPT can connect to in Developer Mode via HTTP + SSE, and ship the project with:
	1.	Cloudflare Workers deployment for the MCP server (remote, stateless, scalable)
	2.	A GitHub Pages site for docs and a simple in-browser ping tool that hits the server’s /health and shows the Worker URL it’s using
	3.	Clean instructions in the README for connecting the server in ChatGPT: Settings → Developer → Add MCP server (enter Worker URL)
	4.	Optional OAuth wiring stubs (disabled by default) so I can later require login without rewriting the server

Use modern MCP conventions and keep it small, fast, and verifiable.

Requirements
	•	Transport: HTTP endpoints with Server-Sent Events for the event stream, compliant with MCP’s remote transport. Expose:
	•	POST /mcp for requests
	•	GET /mcp/sse for the event stream (sets Content-Type: text/event-stream, no buffering)
	•	GET /health returning JSON { status: "ok", version }
	•	Tools: Provide two demo tools to prove end-to-end wiring:
	1.	search_web(query: string) fake implementation that returns deterministic mock data and a timestamp
	2.	echo(payload: any) that returns the payload and server time
	•	Resources: Expose one read-only resource server.info that returns a small JSON blob: name, region, commit hash, and uptime seconds
	•	Schema: Keep message and tool schemas explicit and MCP-spec friendly; put TypeScript types in src/types.ts
	•	Auth: Default is no auth. Include commented stubs for OAuth 2.1 (authorization code with PKCE) that can be enabled later (provider-agnostic), plus simple bearer token fallback if ENV.REQUIRE_AUTH === "1"
	•	Perf/limits: Stream responses; set sensible timeouts; limit request body to 256 KB; cap concurrent streams to 100; return 429 with Retry-After headers if overloaded
	•	Observability: Add minimal logs with request id, tool name, duration, and outcome; add /health and /version
	•	CORS: Allow only GET for /health from *; lock down /mcp and /mcp/sse to same-origin or a configurable allowlist via ALLOWED_ORIGINS
	•	No secrets in repo; all config via environment

Tech stack
	•	Server: Cloudflare Worker, TypeScript, native Fetch/SSE APIs (no heavyweight frameworks)
	•	MCP SDK: If a lightweight MCP helper exists, fine; otherwise write small utilities inline
	•	Build: wrangler for deploy; esbuild for bundling; npm scripts
	•	Pages: Plain HTML/JS site under /site that:
	•	Reads SERVER_URL from a small config.js
	•	Shows “Connected to: ”
	•	Has a “Health check” button that GETs /health and renders JSON
	•	Explains how to add the server to ChatGPT Developer Mode

Project structure

mcp-remote-worker/
  package.json
  wrangler.toml
  tsconfig.json
  src/
    index.ts              # Worker entry: routes, SSE stream, request handler
    sse.ts                # tiny SSE utilities
    tools/
      echo.ts
      searchWeb.ts        # returns mock data; easy to swap with real fetch later
    resources/
      serverInfo.ts
    types.ts              # MCP message, tool, resource interfaces
    auth/
      oauth.ts            # commented stub
      bearer.ts           # optional simple token check
    utils.ts              # id gen, json helpers, error formatting
  README.md
  site/                   # GitHub Pages static site
    index.html
    config.js             # window.SERVER_URL="https://<your-worker>.workers.dev"
    styles.css

Worker behavior
	•	Route table:
	•	GET /health → JSON { status, version, commit, time }
	•	GET /mcp/sse → establish SSE stream; send server “ready” event; keepalive pings every 15s
	•	POST /mcp → accept MCP request envelope { id, type, tool, params } and return { id, status, result | error }
	•	On echo tool: respond immediately with the same payload plus { nowIso }
	•	On search_web tool: respond with { query, results: [{title, url, snippet}], generatedAtIso }
	•	On resource server.info: resolve to { name, region, commit, uptimeSec }
	•	Validate inputs; return 400 with details if the payload is off-spec
	•	Stream long results over SSE: send header event, one or more data chunks, final done event

Config & Deploy
	•	Env vars via wrangler.toml:
	•	ALLOWED_ORIGINS (CSV)
	•	REQUIRE_AUTH (“0” or “1”)
	•	SERVER_NAME, REGION, COMMIT
	•	Scripts:
	•	npm run dev → wrangler dev
	•	npm run build → typecheck + bundle
	•	npm run deploy → wrangler deploy
	•	npm run version → prints version/commit JSON used by /version
	•	GitHub Pages:
	•	Serve site/ from the gh-pages branch
	•	site/config.js must point to the Worker URL
	•	README must include:
	•	One-command deploy with npm create cloudflare@latest ... template instructions
	•	How to set SERVER_URL for Pages
	•	How to connect from ChatGPT Developer Mode: Settings → Developer → Add MCP Server, paste https://<worker>.workers.dev/mcp as the base, and ensure the client can reach GET /mcp/sse
	•	Troubleshooting: CORS, SSE blocked by corporate proxies, auth disabled, 429 rate limits

Sample code sketches (keep them concise and correct)

src/index.ts:
	•	Minimal router using new URL(request.url).pathname
	•	GET /health returns JSON with uptime
	•	GET /mcp/sse calls startSseStream(ctx) which:
	•	Returns new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }})
	•	Writes an initial event: ready\ndata: {"server":"…"}\n\n
	•	Heartbeat event: ping
	•	POST /mcp:
	•	Parse JSON, validate { id, tool }
	•	Dispatch to tools/echo.ts or tools/searchWeb.ts
	•	Return success envelope; on error, standardized error envelope

src/tools/echo.ts:
	•	Export run(params): return { ...params, nowIso: new Date().toISOString() }

src/tools/searchWeb.ts:
	•	Export run({ query }): return mock array of 3 items with stable URLs and snippets

src/resources/serverInfo.ts:
	•	Export get(): return { name: env.SERVER_NAME, region: env.REGION, commit: env.COMMIT, uptimeSec }

wrangler.toml:
	•	Set main = "dist/index.mjs"
	•	Bindings for plain text env vars
	•	Compatibility date set to current

site/index.html:
	•	Shows the configured SERVER_URL
	•	Button that fetches /health and renders JSON
	•	Short copy that explains how to add this URL in ChatGPT Developer Mode

Acceptance criteria
	•	npm run dev works locally with wrangler
	•	npm run deploy puts a live server at https://<name>.<account>.workers.dev
	•	GitHub Pages loads at https://<user>.github.io/<repo>/ and shows “Connected to: ”
	•	From ChatGPT Developer Mode, adding the server uses the SSE endpoint successfully; both echo and search_web tools show up and respond
	•	Code is under 500 LOC excluding README and site assets, with clear comments where future real integrations would go

⸻

If you follow that spec, you’ll have a legit remote MCP server that ChatGPT can connect to, plus a Pages site as your friendly little “is it alive” dashboard. Hosting the server itself on Pages is fantasy land; use Workers or any server that can speak HTTP+SSE, because that’s how MCP’s remote transport works.  ￼

If you want me to swap Workers for another host later, that’s a five-minute refit, not a personality transplant.
