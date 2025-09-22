import type { Env, SettingsRecord } from './types';

export const MAX_BODY_SIZE = 256 * 1024;

export async function readJsonBody<T>(request: Request, limit = MAX_BODY_SIZE): Promise<T> {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > limit) {
    throw new HttpError(413, `Request body too large (max ${limit} bytes)`);
  }
  const text = new TextDecoder().decode(buffer);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new HttpError(400, 'Invalid JSON payload');
  }
}

export function jsonResponse(data: unknown, init: ResponseInit = {}, origin?: string | null): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.append('Vary', 'Origin');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(status: number, message: string, details?: unknown, origin?: string | null): Response {
  return jsonResponse({ error: { message, status, details } }, { status }, origin ?? undefined);
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export function parseAllowedOrigins(env: Env, settings?: SettingsRecord | null): string[] {
  const envOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const settingsOrigins = settings?.allowedOrigins ?? [];
  const combined = new Set<string>([...envOrigins, ...settingsOrigins]);
  return Array.from(combined);
}

export function resolveCorsOrigin(request: Request, allowedOrigins: string[]): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return null;
  }
  if (allowedOrigins.includes('*')) {
    return origin;
  }
  const selfOrigin = new URL(request.url).origin;
  if (origin === selfOrigin) {
    return origin;
  }
  if (allowedOrigins.includes(origin)) {
    return origin;
  }
  return null;
}

export function buildCorsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export function handleCorsOptions(_request: Request, origin: string | null): Response {
  const headers = buildCorsHeaders(origin);
  return new Response(null, { status: 204, headers });
}

export function ensureAdmin(request: Request, env: Env): boolean {
  if (env.REQUIRE_ADMIN !== '1') {
    return true;
  }
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return false;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 && token === env.ADMIN_BEARER;
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class SlidingWindowRateLimiter {
  private windowStart = 0;
  private count = 0;

  check(limit: number, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSec: number } {
    if (!limit || limit <= 0) {
      return { allowed: true };
    }
    const windowMs = 60_000;
    if (now - this.windowStart >= windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    if (this.count >= limit) {
      const retryAfterMs = windowMs - (now - this.windowStart);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    this.count += 1;
    return { allowed: true };
  }
}

export function redactToken(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (value.length <= 8) return '[redacted]';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
