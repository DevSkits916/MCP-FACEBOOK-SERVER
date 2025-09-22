import type { ToolDefinition } from '../mcp';
import { requireActiveUserToken } from './helpers';
import { fetchManagedPages } from '../fb/graph';

export const fbPageListTool: ToolDefinition = {
  name: 'fb.page_list',
  description: 'Lists the Facebook Pages managed by the authorized user.',
  async run(_params, ctx) {
    const token = await requireActiveUserToken(ctx.env);
    const logger = ctx.logger.child({ tool: 'fb.page_list' });
    const pages = await fetchManagedPages({ env: ctx.env, accessToken: token.accessToken, logger });
    return pages.map((page) => ({ id: page.id, name: page.name }));
  },
};
