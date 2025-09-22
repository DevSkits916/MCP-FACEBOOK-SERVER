import type { Env } from '../types';
import type { RequestLogger } from '../logger';
import type {
  AccountsResponse,
  CreatePostResponse,
  DebugTokenResponse,
  GraphErrorResponse,
  MeResponse,
  PhotoUploadResponse,
} from './types';
import { delay } from '../utils';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const MAX_RETRIES = 3;
const GRAPH_TIMEOUT_MS = 30_000;

export class GraphApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
    public readonly retryable = false
  ) {
    super(message);
  }
}

interface GraphRequestOptions {
  env: Env;
  logger: RequestLogger;
  path: string;
  accessToken: string;
  method?: 'GET' | 'POST';
  searchParams?: Record<string, string>;
  body?: Record<string, string> | URLSearchParams;
}

async function callGraph<T>({ env: _env, logger, path, accessToken, method = 'GET', searchParams, body }: GraphRequestOptions): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  let payload: BodyInit | undefined;
  if (body) {
    if (body instanceof URLSearchParams) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = body;
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        params.set(key, value);
      }
      payload = params;
    }
  }

  let lastError: GraphApiError | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
    const started = Date.now();

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
      const duration = Date.now() - started;

      const text = await response.text();
      const json = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const graphError = extractGraphError(response.status, json as GraphErrorResponse);
        logger.warn('Graph API call failed', {
          fb_call: path,
          status: response.status,
          attempt,
          duration,
          retryable: graphError.retryable,
        });
        if (graphError.retryable && attempt < MAX_RETRIES) {
          await delay(2 ** attempt * 200);
          continue;
        }
        throw graphError;
      }

      logger.debug('Graph API call succeeded', {
        fb_call: path,
        status: response.status,
        duration,
      });

      return json as T;
    } catch (error) {
      if (error instanceof GraphApiError) {
        lastError = error;
        if (error.retryable && attempt < MAX_RETRIES) {
          await delay(2 ** attempt * 200);
          continue;
        }
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        const graphError = new GraphApiError('Graph API request timed out', 504, undefined, attempt < MAX_RETRIES);
        lastError = graphError;
        logger.warn('Graph API request timed out', {
          fb_call: path,
          attempt,
        });
        if (graphError.retryable && attempt < MAX_RETRIES) {
          await delay(2 ** attempt * 200);
          continue;
        }
        throw graphError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error('Unexpected Graph API failure');
}

function extractGraphError(status: number, body: GraphErrorResponse): GraphApiError {
  const err = body?.error;
  const retryable = Boolean(err?.is_transient || status >= 500 || err?.code === 1 || err?.code === 2 || err?.code === 4);
  const graphError = new GraphApiError(err?.message ?? 'Graph API error', status, body, retryable);
  return graphError;
}

export async function fetchMe({ env, accessToken, logger }: { env: Env; accessToken: string; logger: RequestLogger }): Promise<MeResponse> {
  return callGraph<MeResponse>({ env, logger, path: '/me', accessToken, searchParams: { fields: 'id,name' } });
}

export async function fetchManagedPages({
  env,
  accessToken,
  logger,
}: {
  env: Env;
  accessToken: string;
  logger: RequestLogger;
}): Promise<AccountsResponse['data']> {
  const response = await callGraph<AccountsResponse>({
    env,
    logger,
    path: '/me/accounts',
    accessToken,
    searchParams: { fields: 'id,name,access_token' },
  });
  return response.data ?? [];
}

export async function postToPageFeed({
  env,
  pageId,
  accessToken,
  logger,
  message,
  link,
  attachedMedia,
}: {
  env: Env;
  pageId: string;
  accessToken: string;
  logger: RequestLogger;
  message: string;
  link?: string;
  attachedMedia?: string;
}): Promise<CreatePostResponse> {
  const body: Record<string, string> = { message };
  if (link) {
    body.link = link;
  }
  if (attachedMedia) {
    body.attached_media = attachedMedia;
  }
  return callGraph<CreatePostResponse>({
    env,
    logger,
    path: `/${pageId}/feed`,
    accessToken,
    method: 'POST',
    body,
  });
}

export async function uploadPagePhoto({
  env,
  pageId,
  accessToken,
  logger,
  imageUrl,
}: {
  env: Env;
  pageId: string;
  accessToken: string;
  logger: RequestLogger;
  imageUrl: string;
}): Promise<PhotoUploadResponse> {
  const body: Record<string, string> = {
    url: imageUrl,
    published: 'false',
  };
  return callGraph<PhotoUploadResponse>({
    env,
    logger,
    path: `/${pageId}/photos`,
    accessToken,
    method: 'POST',
    body,
  });
}

export async function fetchPermalink({
  env,
  postId,
  accessToken,
  logger,
}: {
  env: Env;
  postId: string;
  accessToken: string;
  logger: RequestLogger;
}): Promise<{ permalink_url?: string }> {
  const response = await callGraph<{ permalink_url?: string }>({
    env,
    logger,
    path: `/${postId}`,
    accessToken,
    searchParams: { fields: 'permalink_url' },
  });
  return response;
}

export async function debugToken({
  env,
  logger,
  inputToken,
}: {
  env: Env;
  logger: RequestLogger;
  inputToken: string;
}): Promise<DebugTokenResponse['data']> {
  const url = new URL(`${GRAPH_BASE}/debug_token`);
  url.searchParams.set('input_token', inputToken);
  const appSecret = env.FACEBOOK_APP_SECRET;
  const appId = env.FACEBOOK_APP_ID;
  if (!appId || !appSecret) {
    throw new Error('Facebook app credentials are required for token debug');
  }
  url.searchParams.set('access_token', `${appId}|${appSecret}`);

  const started = Date.now();
  const response = await fetch(url.toString(), { method: 'GET' });
  const duration = Date.now() - started;
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = (data as GraphErrorResponse | undefined)?.error?.message ?? 'Failed to debug token';
    logger.warn('Debug token request failed', {
      status: response.status,
      duration,
    });
    throw new Error(message);
  }
  logger.info('Token debug success', {
    status: response.status,
    duration,
  });
  return (data as DebugTokenResponse).data;
}
