import { ToolAction } from '../types';

export interface ToolContext {
  permWeb: boolean;
  permTerminal: boolean;
  confirmTerminalDestructive: boolean;
  fetchUrl: (url: string) => Promise<any>;
  runShellCommand: (cmd: string) => Promise<any>;
}

export class ToolRouter {
  static async routeAndExecute(name: string, args: any, registry: any, context: ToolContext): Promise<any> {

    // 1. Registry Tools (Priority)
    if (registry && registry.has(name)) {
      const tool = registry.get(name);
      return await tool.execute(args, registry.runtime);
    }

    // 2. Legacy / Native Tools
    // These are currently hosted on the service but routed here.
    switch (name) {
      case 'fetch_url':
        if (!context.permWeb) {
          throw new Error('Web access disabled.');
        }
        return await context.fetchUrl(args.url);

      case 'run_shell_command':
        if (!context.permTerminal) {
          throw new Error('Terminal disabled.');
        }
        if (context.confirmTerminalDestructive) {
          // In the future this should trigger a UI confirmation interception.
          // For now, streaming flow doesn't support pause-and-resume easily, so we error or warn.
          // BUT, currently VertexService returned a pseudo-error object.
          return { status: 'error', message: 'Terminal confirmation required (not implemented in streaming yet).' };
        }
        return await context.runShellCommand(String(args.command || ''));

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
