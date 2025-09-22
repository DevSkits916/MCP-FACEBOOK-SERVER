import type { ToolDefinition } from '../mcp';
import { fetchMe } from '../fb/graph';
import { requireActiveUserToken } from './helpers';

export const fbMeTool: ToolDefinition = {
  name: 'fb.me',
  description: 'Returns the id and name for the authorized Facebook user.',
  async run(_params, ctx) {
    const token = await requireActiveUserToken(ctx.env);
    const logger = ctx.logger.child({ tool: 'fb.me' });
    const profile = await fetchMe({ env: ctx.env, accessToken: token.accessToken, logger });
    return {
      id: profile.id,
      name: profile.name,
      expires_at: token.expiresAt ?? null,
    };
  },
};
