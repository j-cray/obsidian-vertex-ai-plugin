import { IAgentTool } from '../runtime/tools/types';
import { AgentRuntime } from '../runtime/Runtime';

export class VaultSearch implements IAgentTool {
  name = 'search_vault';
  description = 'Semantically searches the vault for relevant notes based on a query. Use this to find information when you don\'t know the exact file path.';

  schema = {
    type: 'OBJECT',
    properties: {
      query: {
        type: 'STRING',
        description: 'The search query (e.g., "how does the authentication work?").'
      }
    },
    required: ['query']
  };

  private runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  async execute(args: any): Promise<any> {
    const { query } = args;
    try {
      const results = await this.runtime.vector.search(query);
      if (results.length === 0) {
        return "No relevant notes found.";
      }
      return results.map(r => `Path: ${r.path} (Score: ${r.score.toFixed(2)})`).join('\n');
    } catch (error) {
      return {
        error: `Failed to search vault: ${(error as Error).message}`
      };
    }
  }
}
