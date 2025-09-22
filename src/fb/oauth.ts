import type { Env, UserTokenRecord } from '../types';
import { createRequestLogger } from '../logger';
import type { OAuthTokenResponse } from './types';
import { fetchMe } from './graph';

const AUTH_BASE = 'https://www.facebook.com/v19.0/dialog/oauth';
const TOKEN_ENDPOINT = 'https://graph.facebook.com/v19.0/oauth/access_token';

export interface OAuthStartParams {
  state: string;
  codeChallenge: string;
  scope?: string;
  redirectUri: string;
}

export function generateCodeVerifier(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  buffer.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildOAuthUrl(env: Env, params: OAuthStartParams): string {
  const url = new URL(AUTH_BASE);
  url.searchParams.set('client_id', env.FACEBOOK_APP_ID);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set(
    'scope',
    params.scope ??
      'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,user_posts,user_photos,publish_actions'
  );
  return url.toString();
}

export interface TokenExchangeResult {
  accessToken: string;
  tokenType: string;
  expiresAt?: number;
}

export async function exchangeCodeForToken(
  env: Env,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  logger = createRequestLogger({ route: 'oauth/token' })
): Promise<TokenExchangeResult> {
  const params = new URLSearchParams();
  params.set('client_id', env.FACEBOOK_APP_ID);
  params.set('redirect_uri', redirectUri);
  params.set('code', code);
  params.set('code_verifier', codeVerifier);
  if (env.FACEBOOK_APP_SECRET) {
    params.set('client_secret', env.FACEBOOK_APP_SECRET);
  }

  const start = Date.now();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const duration = Date.now() - start;

  const text = await response.text();
  const data = text ? (JSON.parse(text) as OAuthTokenResponse) : ({} as OAuthTokenResponse);

  if (!response.ok) {
    logger.error('Failed to exchange authorization code', {
      status: response.status,
      duration,
    });
    throw new Error(`Token exchange failed (${response.status})`);
  }

  let expiresAt: number | undefined;
  if (data.expires_in) {
    expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
  }

  let accessToken = data.access_token;
  let tokenType = data.token_type;

  if (!accessToken) {
    throw new Error('Token exchange response missing access_token');
  }

  // Attempt to exchange for a long-lived token if possible
  if (env.FACEBOOK_APP_SECRET) {
    try {
      const longLived = await exchangeLongLivedToken(env, accessToken, logger);
      accessToken = longLived.accessToken;
      tokenType = longLived.tokenType;
      expiresAt = longLived.expiresAt ?? expiresAt;
    } catch (error) {
      logger.warn('Long-lived token exchange failed; continuing with short-lived token');
    }
  }

  return { accessToken, tokenType, expiresAt };
}

async function exchangeLongLivedToken(
  env: Env,
  shortLivedToken: string,
  logger = createRequestLogger({ route: 'oauth/long-lived' })
): Promise<TokenExchangeResult> {
  const url = new URL(TOKEN_ENDPOINT);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', env.FACEBOOK_APP_ID);
  url.searchParams.set('client_secret', env.FACEBOOK_APP_SECRET);
  url.searchParams.set('fb_exchange_token', shortLivedToken);

  const start = Date.now();
  const response = await fetch(url.toString(), { method: 'GET' });
  const duration = Date.now() - start;
  const text = await response.text();
  const data = text ? (JSON.parse(text) as OAuthTokenResponse) : ({} as OAuthTokenResponse);

  if (!response.ok) {
    logger.warn('Failed to upgrade to long-lived token', {
      status: response.status,
      duration,
    });
    throw new Error('Could not exchange token');
  }

  let expiresAt: number | undefined;
  if (data.expires_in) {
    expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
  }

  if (!data.access_token) {
    throw new Error('Long-lived token response missing access_token');
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresAt,
  };
}

export async function tokenRecordFromAccessToken(
  env: Env,
  accessToken: string,
  tokenType: string,
  expiresAt: number | undefined,
  logger = createRequestLogger({ route: 'oauth/profile' })
): Promise<UserTokenRecord> {
  const me = await fetchMe({ env, accessToken, logger });
  return {
    accessToken,
    tokenType,
    expiresAt,
    userId: me.id,
    userName: me.name,
    obtainedAt: Date.now(),
  };
}
