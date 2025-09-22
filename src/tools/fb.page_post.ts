import type { ToolDefinition } from '../mcp';
import { ToolError } from '../mcp';
import { requireActiveUserToken, ensurePageAccessToken } from './helpers';
import { fetchPermalink, postToPageFeed, uploadPagePhoto } from '../fb/graph';

function assertString(value: unknown, field: string, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) {
      throw new ToolError('invalid_params', `${field} is required.`);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_params', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed && required) {
    throw new ToolError('invalid_params', `${field} cannot be empty.`);
  }
  return trimmed || undefined;
}

function validateUrl(value: string, field: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Only http and https URLs are supported.');
    }
    return url.toString();
  } catch (error) {
    throw new ToolError('invalid_params', `${field} must be a valid URL.`);
  }
}

export const fbPagePostTool: ToolDefinition = {
  name: 'fb.page_post',
  description: 'Publishes a message to a managed Facebook Page.',
  async run(params, ctx) {
    if (!params || typeof params !== 'object') {
      throw new ToolError('invalid_params', 'Parameters must be an object.');
    }
    const payload = params as Record<string, unknown>;
    const pageId = assertString(payload.page_id, 'page_id');
    const message = assertString(payload.message, 'message');
    if (!pageId || !message) {
      throw new ToolError('invalid_params', 'page_id and message are required.');
    }
    if (message.length > 2000) {
      throw new ToolError('invalid_params', 'message must be 2000 characters or fewer.');
    }
    const linkRaw = assertString(payload.link, 'link', false);
    const link = linkRaw ? validateUrl(linkRaw, 'link') : undefined;
    const imageUrlRaw = assertString(payload.image_url, 'image_url', false);
    const imageUrl = imageUrlRaw ? validateUrl(imageUrlRaw, 'image_url') : undefined;

    const userToken = await requireActiveUserToken(ctx.env);
    const logger = ctx.logger.child({ tool: 'fb.page_post' });
    const pageToken = await ensurePageAccessToken(ctx.env, logger, userToken, pageId);

    let attachedMedia: string | undefined;
    if (imageUrl) {
      const upload = await uploadPagePhoto({
        env: ctx.env,
        pageId,
        accessToken: pageToken.accessToken,
        logger,
        imageUrl,
      });
      attachedMedia = JSON.stringify([{ media_fbid: upload.id }]);
    }

    const result = await postToPageFeed({
      env: ctx.env,
      pageId,
      accessToken: pageToken.accessToken,
      logger,
      message,
      link,
      attachedMedia,
    });

    let permalink: string | undefined;
    try {
      const meta = await fetchPermalink({
        env: ctx.env,
        postId: result.id,
        accessToken: pageToken.accessToken,
        logger,
      });
      permalink = meta.permalink_url;
    } catch (error) {
      logger.warn('Unable to fetch permalink', {});
    }

    return {
      id: result.id,
      permalink_url: permalink ?? null,
    };
  },
};
