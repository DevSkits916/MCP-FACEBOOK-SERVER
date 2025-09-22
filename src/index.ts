import type { ExecutionContext } from '@cloudflare/workers-types';
import { buildServerInfo } from './resources/serverInfo';
import type { Env, SettingsRecord } from './types';
import {
  buildCorsHeaders,
  ensureAdmin,
  errorResponse,
  handleCorsOptions,
  jsonResponse,
  parseAllowedOrigins,
  readJsonBody,
  resolveCorsOrigin,
  SlidingWindowRateLimiter,
} from './utils';
import { createRequestLogger, getRecentLogs, subscribe } from './logger';
import { sseResponse } from './sse';
import { dispatchTool, parseRequestEnvelope, ToolError } from './mcp';
import {
  clearActiveUser,
  consumeOAuthState,
  deleteUserToken,
  getActiveUserId,
  getSettings,
  saveSettings,
  saveUserToken,
  setActiveUserId,
  storeOAuthState,
} from './storage';
import {
  buildOAuthUrl,
  createCodeChallenge,
  exchangeCodeForToken,
  generateCodeVerifier,
  tokenRecordFromAccessToken,
} from './fb/oauth';
import uiIndex from '../ui/index.html';
import uiScript from '../ui/app.js';
import uiStyles from '../ui/app.css';

const serverStart = Date.now();
const rateLimiter = new SlidingWindowRateLimiter();
const SETTINGS_CACHE_TTL = 30_000;
let cachedSettings: { value: SettingsRecord; fetchedAt: number } | null = null;
let activeMcpStreams = 0;
const MAX_SSE_STREAMS = 100;

async function loadSettings(env: Env): Promise<SettingsRecord> {
  if (cachedSettings && Date.now() - cachedSettings.fetchedAt < SETTINGS_CACHE_TTL) {
    return cachedSettings.value;
  }
  const stored = await getSettings(env);
  if (stored) {
    cachedSettings = { value: stored, fetchedAt: Date.now() };
    return stored;
  }
  const defaults: SettingsRecord = {
    allowedOrigins: parseAllowedOrigins(env),
    rateLimitPerMinute: 60,
    featureFlags: {},
    updatedAt: Date.now(),
  };
  cachedSettings = { value: defaults, fetchedAt: Date.now() };
  return defaults;
}

function mergeAllowedOrigins(env: Env, settings: SettingsRecord): string[] {
  return parseAllowedOrigins(env, settings);
}

function unauthorizedResponse(origin: string | null): Response {
  return errorResponse(401, 'Unauthorized', undefined, origin);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const reqId = crypto.randomUUID();
    const logger = createRequestLogger({ reqId, route: path });

    const settings = await loadSettings(env);
    const allowedOrigins = mergeAllowedOrigins(env, settings);
    const corsOrigin = resolveCorsOrigin(request, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return handleCorsOptions(request, corsOrigin);
    }

    try {
      if (path === '/' && request.method === 'GET') {
        return Response.redirect(new URL('/ui/', url).toString(), 302);
      }

      if (path === '/health' && request.method === 'GET') {
        const info = buildServerInfo(env, serverStart);
        return jsonResponse({ status: 'ok', ...info });
      }

      if (path === '/version' && request.method === 'GET') {
        const info = buildServerInfo(env, serverStart);
        return jsonResponse({ version: info.version, commit: env.COMMIT, region: env.REGION });
      }

      if (path.startsWith('/ui/')) {
        if (path === '/ui/' || path === '/ui/index.html') {
          return new Response(uiIndex, {
            headers: { 'Content-Type': 'text/html; charset=UTF-8' },
          });
        }
        if (path === '/ui/app.js') {
          return new Response(uiScript, {
            headers: { 'Content-Type': 'application/javascript; charset=UTF-8' },
          });
        }
        if (path === '/ui/app.css') {
          return new Response(uiStyles, {
            headers: { 'Content-Type': 'text/css; charset=UTF-8' },
          });
        }
        return new Response('Not found', { status: 404 });
      }

      if (path === '/mcp/sse' && request.method === 'GET') {
        if (corsOrigin === null && request.headers.has('Origin')) {
          return errorResponse(403, 'Origin not allowed');
        }
        if (activeMcpStreams >= MAX_SSE_STREAMS) {
          return new Response('Too many active streams', {
            status: 429,
            headers: { 'Retry-After': '30' },
          });
        }
        activeMcpStreams += 1;
        const response = sseResponse((session) => {
          session.send('ready', {
            status: 'ok',
            time: new Date().toISOString(),
          });
          const interval = setInterval(() => {
            session.send('ping', { ts: new Date().toISOString() });
          }, 15_000);
          return () => {
            clearInterval(interval);
          };
        }, () => {
          activeMcpStreams = Math.max(0, activeMcpStreams - 1);
        });
        if (corsOrigin) {
          response.headers.set('Access-Control-Allow-Origin', corsOrigin);
          response.headers.append('Vary', 'Origin');
        }
        return response;
      }

      if (path === '/mcp' && request.method === 'POST') {
        if (corsOrigin === null && request.headers.has('Origin')) {
          return errorResponse(403, 'Origin not allowed');
        }
        const limit = settings.rateLimitPerMinute ?? 60;
        const rate = rateLimiter.check(limit);
        if (rate.allowed === false) {
          return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': rate.retryAfterSec.toString(),
              ...buildCorsHeaders(corsOrigin),
            },
          });
        }
        const body = await readJsonBody<unknown>(request);
        const envelope = parseRequestEnvelope(body);
        logger.info('Dispatching tool', { tool: envelope.tool });
        const result = await dispatchTool(env, envelope, logger);
        const headers = new Headers({ 'Content-Type': 'application/json' });
        if (corsOrigin) {
          headers.set('Access-Control-Allow-Origin', corsOrigin);
          headers.append('Vary', 'Origin');
        }
        return new Response(JSON.stringify(result), { status: 200, headers });
      }

      if (path === '/api/settings' && request.method === 'GET') {
        if (!ensureAdmin(request, env)) {
          return unauthorizedResponse(corsOrigin);
        }
        const activeUserId = await getActiveUserId(env);
        const current = await loadSettings(env);
        const responseBody = {
          allowedOrigins: mergeAllowedOrigins(env, current),
          rateLimitPerMinute: current.rateLimitPerMinute ?? 60,
          featureFlags: current.featureFlags ?? {},
          activeUserId,
        };
        return jsonResponse(responseBody, {}, corsOrigin);
      }

      if (path === '/api/settings' && request.method === 'POST') {
        if (!ensureAdmin(request, env)) {
          return unauthorizedResponse(corsOrigin);
        }
        const body = await readJsonBody<Record<string, unknown>>(request);
        const allowedOrigins = Array.isArray(body.allowedOrigins)
          ? Array.from(
              new Set(
                body.allowedOrigins
                  .filter((value): value is string => typeof value === 'string')
                  .map((value) => value.trim())
                  .filter((value) => value.length > 0)
              )
            )
          : settings.allowedOrigins;
        const next: SettingsRecord = {
          allowedOrigins,
          rateLimitPerMinute:
            typeof body.rateLimitPerMinute === 'number' && body.rateLimitPerMinute > 0
              ? Math.min(1000, Math.floor(body.rateLimitPerMinute))
              : settings.rateLimitPerMinute,
          featureFlags:
            body.featureFlags && typeof body.featureFlags === 'object'
              ? (body.featureFlags as Record<string, boolean>)
              : settings.featureFlags ?? {},
          updatedAt: Date.now(),
        };
        await saveSettings(env, next);
        cachedSettings = { value: next, fetchedAt: Date.now() };
        const mergedOrigins = mergeAllowedOrigins(env, next);
        return jsonResponse({ ok: true, allowedOrigins: mergedOrigins }, {}, corsOrigin);
      }

      if (path === '/api/logs/stream' && request.method === 'GET') {
        if (!ensureAdmin(request, env)) {
          return unauthorizedResponse(corsOrigin);
        }
        const response = sseResponse((session) => {
          session.send('ready', { ts: new Date().toISOString() });
          const recent = getRecentLogs(200);
          for (const entry of recent) {
            session.send('log', entry);
          }
          const unsubscribe = subscribe((entry) => {
            session.send('log', entry);
          });
          return () => {
            unsubscribe();
          };
        });
        response.headers.set('Cache-Control', 'no-cache, no-transform');
        if (corsOrigin) {
          response.headers.set('Access-Control-Allow-Origin', corsOrigin);
          response.headers.append('Vary', 'Origin');
        }
        return response;
      }

      if (path === '/api/auth/revoke' && request.method === 'POST') {
        if (!ensureAdmin(request, env)) {
          return unauthorizedResponse(corsOrigin);
        }
        const userId = await getActiveUserId(env);
        if (userId) {
          await deleteUserToken(env, userId);
        }
        await clearActiveUser(env);
        return jsonResponse({ ok: true }, {}, corsOrigin);
      }

      if (path === '/api/tools' && request.method === 'GET') {
        return jsonResponse(
          { tools: ['fb.me', 'fb.profile_timeline', 'fb.profile_post', 'fb.page_list', 'fb.page_post', 'fb.debug_token', 'echo'] },
          {},
          corsOrigin
        );
      }

      if (path === '/oauth/start' && request.method === 'GET') {
        if (!ensureAdmin(request, env)) {
          return unauthorizedResponse(corsOrigin);
        }
        const redirectUri = env.OAUTH_REDIRECT || `${url.origin}/oauth/callback`;
        const state = crypto.randomUUID();
        const verifier = generateCodeVerifier();
        const challenge = await createCodeChallenge(verifier);
        await storeOAuthState(env, state, { codeVerifier: verifier, createdAt: Date.now(), redirectUri });
        const authUrl = buildOAuthUrl(env, {
          state,
          codeChallenge: challenge,
          redirectUri,
        });
        logger.info('Redirecting to Facebook OAuth', {});
        const accept = request.headers.get('accept') || '';
        if (accept.includes('application/json')) {
          return jsonResponse({ url: authUrl }, {}, corsOrigin);
        }
        return Response.redirect(authUrl, 302);
      }

      if (path === '/oauth/callback' && request.method === 'GET') {
        const state = url.searchParams.get('state') || '';
        const code = url.searchParams.get('code');
        const errorParam = url.searchParams.get('error');
        if (errorParam) {
          const message = url.searchParams.get('error_description') || 'Authorization failed.';
          return new Response(`<html><body><h1>Authorization error</h1><p>${message}</p></body></html>`, {
            status: 400,
            headers: { 'Content-Type': 'text/html; charset=UTF-8' },
          });
        }
        if (!code) {
          return new Response('<html><body><h1>Missing code</h1></body></html>', {
            status: 400,
            headers: { 'Content-Type': 'text/html; charset=UTF-8' },
          });
        }
        const stored = await consumeOAuthState(env, state);
        if (!stored) {
          return new Response('<html><body><h1>State not found</h1></body></html>', {
            status: 400,
            headers: { 'Content-Type': 'text/html; charset=UTF-8' },
          });
        }
        try {
          const token = await exchangeCodeForToken(env, code, stored.codeVerifier, stored.redirectUri, logger);
          const record = await tokenRecordFromAccessToken(env, token.accessToken, token.tokenType, token.expiresAt, logger);
          await saveUserToken(env, record.userId, record);
          await setActiveUserId(env, record.userId);
          logger.info('OAuth success', { userId: record.userId });
          const html = `<!DOCTYPE html><html><body><h1>Connected!</h1><p>You can close this window.</p><script>window.close();</script></body></html>`;
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
        } catch (error) {
          logger.error('OAuth callback failure');
          const html = '<html><body><h1>OAuth exchange failed</h1><p>Please try again.</p></body></html>';
          return new Response(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
        }
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      if (error instanceof ToolError) {
        logger.warn('Tool error', { code: error.code });
        return errorResponse(400, error.message, error.details, corsOrigin);
      }
      if ('status' in (error as { status?: number }) && 'message' in (error as { message?: string })) {
        const status = (error as { status?: number }).status ?? 500;
        const message = (error as { message?: string }).message ?? 'Internal error';
        logger.error('Request error', { status });
        return errorResponse(status, message, undefined, corsOrigin);
      }
      logger.error('Unhandled error');
      return errorResponse(500, 'Internal Server Error', undefined, corsOrigin);
    }
  },
};
