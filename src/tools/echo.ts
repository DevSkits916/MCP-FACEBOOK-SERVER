import type { ToolDefinition } from '../mcp';

export const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes the payload back for diagnostics.',
  async run(params) {
    return { payload: params ?? null };
  },
};
