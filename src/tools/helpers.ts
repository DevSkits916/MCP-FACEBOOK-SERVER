import { ToolError } from '../mcp';
import { fetchManagedPages } from '../fb/graph';
import { getActiveUserId, getPageToken, getUserToken, savePageToken } from '../storage';
import type { Env, PageTokenRecord, UserTokenRecord } from '../types';
import type { RequestLogger } from '../logger';

export async function requireActiveUserToken(env: Env): Promise<UserTokenRecord> {
  const userId = await getActiveUserId(env);
  if (!userId) {
    throw new ToolError('auth_required', 'No Facebook user is linked. Sign in using the dashboard.');
  }
  const token = await getUserToken(env, userId);
  if (!token || !token.accessToken) {
    throw new ToolError('auth_required', 'Facebook access token is missing. Re-authenticate via the dashboard.');
  }
  if (token.expiresAt && token.expiresAt * 1000 < Date.now()) {
    throw new ToolError('auth_expired', 'Facebook access token has expired. Please sign in again.');
  }
  return token;
}

export async function ensurePageAccessToken(
  env: Env,
  logger: RequestLogger,
  userToken: UserTokenRecord,
  pageId: string
): Promise<PageTokenRecord> {
  const cached = await getPageToken(env, pageId);
  if (cached && (!cached.expiresAt || cached.expiresAt * 1000 > Date.now() + 60_000)) {
    return cached;
  }

  const pages = await fetchManagedPages({ env, accessToken: userToken.accessToken, logger });
  const page = pages.find((item) => item.id === pageId);
  if (!page) {
    throw new ToolError('not_found', 'The requested Page is not managed by the authorized user.');
  }
  const record: PageTokenRecord = {
    pageId: page.id,
    pageName: page.name,
    accessToken: page.access_token,
    obtainedAt: Date.now(),
  };
  await savePageToken(env, record);
  return record;
}
