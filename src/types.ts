export interface Env {
  TOKENS_KV: KVNamespace;
  ALLOWED_ORIGINS?: string;
  REQUIRE_ADMIN?: string;
  ADMIN_BEARER?: string;
  FACEBOOK_APP_ID: string;
  FACEBOOK_APP_SECRET: string;
  OAUTH_REDIRECT?: string;
  SERVER_NAME?: string;
  REGION?: string;
  COMMIT?: string;
}

export interface SettingsRecord {
  allowedOrigins: string[];
  rateLimitPerMinute?: number;
  featureFlags?: Record<string, boolean>;
  updatedAt: number;
}

export interface UserTokenRecord {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number; // epoch seconds
  scope?: string[];
  userId: string;
  userName?: string;
  obtainedAt: number;
}

export interface PageTokenRecord {
  pageId: string;
  accessToken: string;
  pageName?: string;
  expiresAt?: number;
  obtainedAt: number;
}

export interface OAuthStateRecord {
  codeVerifier: string;
  createdAt: number;
  redirectUri: string;
}

export interface ToolContext {
  env: Env;
  logger: import('./logger').RequestLogger;
}
