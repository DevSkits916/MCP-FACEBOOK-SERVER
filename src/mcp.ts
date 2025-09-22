import { createRequestLogger } from './logger';
import type { RequestLogger } from './logger';
import type { ToolContext } from './types';
import { fbMeTool } from './tools/fb.me';
import { fbPageListTool } from './tools/fb.page_list';
import { fbPagePostTool } from './tools/fb.page_post';
import { fbDebugTokenTool } from './tools/fb.debug_token';
import { echoTool } from './tools/echo';

export interface MCPRequestEnvelope {
  id: string;
  tool: string;
  params?: unknown;
}

export interface MCPResponseEnvelope {
  id: string;
  status: 'ok' | 'error';
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ToolError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export interface ToolDefinition {
  name: string;
  description?: string;
  run(params: unknown, ctx: ToolContext): Promise<unknown>;
}

const registry = new Map<string, ToolDefinition>();

function register(tool: ToolDefinition) {
  registry.set(tool.name, tool);
}

register(echoTool);
register(fbMeTool);
register(fbPageListTool);
register(fbPagePostTool);
register(fbDebugTokenTool);

export function parseRequestEnvelope(value: unknown): MCPRequestEnvelope {
  if (!value || typeof value !== 'object') {
    throw new ToolError('invalid_request', 'Request payload must be an object.');
  }
  const { id, tool, params } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id) {
    throw new ToolError('invalid_request', 'Request id is required.');
  }
  if (typeof tool !== 'string' || !tool) {
    throw new ToolError('invalid_request', 'Tool name is required.');
  }
  return { id, tool, params };
}

export function listTools(): string[] {
  return Array.from(registry.keys());
}

export async function dispatchTool(
  env: ToolContext['env'],
  request: MCPRequestEnvelope,
  parentLogger?: RequestLogger
): Promise<MCPResponseEnvelope> {
  const tool = registry.get(request.tool);
  if (!tool) {
    return {
      id: request.id,
      status: 'error',
      error: {
        code: 'not_found',
        message: `Unknown tool: ${request.tool}`,
      },
    };
  }

  const logger = (parentLogger ?? createRequestLogger({ route: 'mcp', tool: tool.name })).child({ tool: tool.name });

  try {
    const result = await tool.run(request.params, { env, logger });
    logger.info('Tool execution complete', { status: 200 });
    return {
      id: request.id,
      status: 'ok',
      result,
    };
  } catch (error) {
    if (error instanceof ToolError) {
      logger.warn('Tool error', { code: error.code });
      return {
        id: request.id,
        status: 'error',
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      };
    }
    logger.error('Unhandled tool error');
    return {
      id: request.id,
      status: 'error',
      error: {
        code: 'internal_error',
        message: 'Unexpected error executing tool.',
      },
    };
  }
}
