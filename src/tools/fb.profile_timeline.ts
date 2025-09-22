import type { ToolDefinition } from '../mcp';
import { ToolError } from '../mcp';
import { requireActiveUserToken } from './helpers';
import { fetchProfileTimeline } from '../fb/graph';

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_params', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export const fbProfileTimelineTool: ToolDefinition = {
  name: 'fb.profile_timeline',
  description: 'Retrieves recent posts from the authorized user\'s personal timeline.',
  async run(params, ctx) {
    if (params !== undefined && params !== null && typeof params !== 'object') {
      throw new ToolError('invalid_params', 'Parameters must be an object.');
    }
    const payload = (params as Record<string, unknown>) || {};

    let limit = 10;
    if (payload.limit !== undefined) {
      if (typeof payload.limit !== 'number' || !Number.isFinite(payload.limit)) {
        throw new ToolError('invalid_params', 'limit must be a number.');
      }
      limit = Math.floor(payload.limit);
      if (limit < 1 || limit > 50) {
        throw new ToolError('invalid_params', 'limit must be between 1 and 50.');
      }
    }

    const after = optionalString(payload.after, 'after');
    const before = optionalString(payload.before, 'before');
    if (after && before) {
      throw new ToolError('invalid_params', 'Specify only one of after or before.');
    }

    const userToken = await requireActiveUserToken(ctx.env);
    const logger = ctx.logger.child({ tool: 'fb.profile_timeline' });
    const timeline = await fetchProfileTimeline({
      env: ctx.env,
      accessToken: userToken.accessToken,
      logger,
      limit,
      after,
      before,
    });

    const posts = (timeline.data || []).map((item) => {
      const attachments = (item.attachments?.data || []).map((attachment) => {
        const image = attachment.media?.image;
        const media = image?.src
          ? {
              src: image.src,
              width: image.width ?? null,
              height: image.height ?? null,
            }
          : null;
        return {
          type: attachment.type ?? null,
          title: attachment.title ?? null,
          description: attachment.description ?? null,
          url: attachment.url || attachment.target?.url || null,
          media,
        };
      });
      return {
        id: item.id,
        message: item.message ?? null,
        story: item.story ?? null,
        status_type: item.status_type ?? null,
        created_time: item.created_time,
        permalink_url: item.permalink_url ?? null,
        attachments,
      };
    });

    return {
      posts,
      paging: {
        before: timeline.paging?.cursors?.before ?? null,
        after: timeline.paging?.cursors?.after ?? null,
        previous_url: timeline.paging?.previous ?? null,
        next_url: timeline.paging?.next ?? null,
      },
    };
  },
};
