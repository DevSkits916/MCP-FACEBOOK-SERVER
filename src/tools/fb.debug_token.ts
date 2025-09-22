import type { ToolDefinition } from '../mcp';
import { ToolError } from '../mcp';
import { debugToken } from '../fb/graph';
import { requireActiveUserToken } from './helpers';

export const fbDebugTokenTool: ToolDefinition = {
  name: 'fb.debug_token',
  description: 'Inspects a Facebook access token for validity, expiry, and scopes.',
  async run(params, ctx) {
    let token: string | undefined;
    if (params && typeof params === 'object') {
      const payload = params as Record<string, unknown>;
      if (payload.token !== undefined && payload.token !== null) {
        if (typeof payload.token !== 'string') {
          throw new ToolError('invalid_params', 'token must be a string when provided.');
        }
        token = payload.token;
      }
    } else if (params !== undefined && params !== null) {
      throw new ToolError('invalid_params', 'Parameters must be an object.');
    }

    if (!token) {
      const userToken = await requireActiveUserToken(ctx.env);
      token = userToken.accessToken;
    }

    const logger = ctx.logger.child({ tool: 'fb.debug_token' });
    const info = await debugToken({ env: ctx.env, logger, inputToken: token });

    return {
      app_id: info.app_id,
      application: info.application,
      expires_at: info.expires_at,
      is_valid: info.is_valid,
      scopes: info.scopes,
      type: info.type,
      user_id: info.user_id,
    };
  },
};
