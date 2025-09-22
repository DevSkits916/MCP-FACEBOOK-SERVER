import type { Env } from '../types';

export interface ServerInfo {
  name: string;
  version: string;
  region: string;
  uptimeSec: number;
  time: string;
}

export function buildServerInfo(env: Env, startTime: number): ServerInfo {
  const now = Date.now();
  return {
    name: env.SERVER_NAME || 'mcp-fb-connector',
    version: env.COMMIT || 'dev',
    region: env.REGION || 'global',
    uptimeSec: Math.floor((now - startTime) / 1000),
    time: new Date(now).toISOString(),
  };
}
