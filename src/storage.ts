import type { Env, OAuthStateRecord, PageTokenRecord, SettingsRecord, UserTokenRecord } from './types';

const SETTINGS_KEY = 'settings:general';
const ACTIVE_USER_KEY = 'settings:current_user';

export async function getSettings(env: Env): Promise<SettingsRecord | null> {
  const raw = await env.TOKENS_KV.get(SETTINGS_KEY, 'json');
  if (!raw) return null;
  return raw as SettingsRecord;
}

export async function saveSettings(env: Env, settings: SettingsRecord): Promise<void> {
  await env.TOKENS_KV.put(SETTINGS_KEY, JSON.stringify(settings));
}

export async function getActiveUserId(env: Env): Promise<string | null> {
  return env.TOKENS_KV.get(ACTIVE_USER_KEY);
}

export async function setActiveUserId(env: Env, userId: string): Promise<void> {
  await env.TOKENS_KV.put(ACTIVE_USER_KEY, userId);
}

export async function clearActiveUser(env: Env): Promise<void> {
  await env.TOKENS_KV.delete(ACTIVE_USER_KEY);
}

function userTokenKey(userId: string): string {
  return `user:${userId}:access_token`;
}

function pageTokenKey(pageId: string): string {
  return `page:${pageId}:access_token`;
}

export async function getUserToken(env: Env, userId: string): Promise<UserTokenRecord | null> {
  const raw = await env.TOKENS_KV.get(userTokenKey(userId), 'json');
  return (raw as UserTokenRecord) ?? null;
}

export async function saveUserToken(env: Env, userId: string, record: UserTokenRecord): Promise<void> {
  const expiration = record.expiresAt ? Math.floor(record.expiresAt) : undefined;
  await env.TOKENS_KV.put(userTokenKey(userId), JSON.stringify(record), {
    expiration,
  });
}

export async function deleteUserToken(env: Env, userId: string): Promise<void> {
  await env.TOKENS_KV.delete(userTokenKey(userId));
}

export async function getPageToken(env: Env, pageId: string): Promise<PageTokenRecord | null> {
  const raw = await env.TOKENS_KV.get(pageTokenKey(pageId), 'json');
  return (raw as PageTokenRecord) ?? null;
}

export async function savePageToken(env: Env, record: PageTokenRecord): Promise<void> {
  const expiration = record.expiresAt ? Math.floor(record.expiresAt) : undefined;
  await env.TOKENS_KV.put(pageTokenKey(record.pageId), JSON.stringify(record), {
    expiration,
    expirationTtl: record.expiresAt ? undefined : 24 * 60 * 60,
  });
}

export async function deletePageToken(env: Env, pageId: string): Promise<void> {
  await env.TOKENS_KV.delete(pageTokenKey(pageId));
}

export async function storeOAuthState(env: Env, state: string, record: OAuthStateRecord): Promise<void> {
  await env.TOKENS_KV.put(`oauth:${state}`, JSON.stringify(record), { expirationTtl: 600 });
}

export async function consumeOAuthState(env: Env, state: string): Promise<OAuthStateRecord | null> {
  const key = `oauth:${state}`;
  const record = (await env.TOKENS_KV.get(key, 'json')) as OAuthStateRecord | null;
  if (record) {
    await env.TOKENS_KV.delete(key);
  }
  return record;
}
