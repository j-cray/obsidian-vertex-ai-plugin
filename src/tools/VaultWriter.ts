import { IAgentTool } from '../runtime/tools/types';
import { AgentRuntime } from '../runtime/Runtime';

export class VaultWriter implements IAgentTool {
  name = 'write_note';
  description = 'Creates or overwrites a note with the specified content. Use this to write code, summaries, or new notes.';

  schema = {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'The full path to the note (e.g., "Folder/Note.md").'
      },
      content: {
        type: 'STRING',
        description: 'The full content of the note.'
      }
    },
    required: ['path', 'content']
  };

  private runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  async execute(args: any): Promise<any> {
    const { path, content } = args;
    try {
      await this.runtime.vault.createNote(path, content);
      return `Successfully wrote to ${path}`;
    } catch (error) {
      return {
        error: `Failed to write note '${path}': ${(error as Error).message}`
      };
    }
  }
}
