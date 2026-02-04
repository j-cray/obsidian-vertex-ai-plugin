import { IAgentTool } from '../runtime/tools/types';
import { AgentRuntime } from '../runtime/Runtime';

export class VaultReader implements IAgentTool {
  name = 'read_note';
  description = 'Reads the content of a specific note or markdown file in the vault. Use this to inspect code, user notes, or context.';

  schema = {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'The full path to the note (e.g., "Folder/Note.md").'
      }
    },
    required: ['path']
  };

  private runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  async execute(args: any): Promise<any> {
    const { path } = args;
    try {
      const content = await this.runtime.vault.readNote(path);
      return {
        path,
        content
      };
    } catch (error) {
      return {
        error: `Failed to read note '${path}': ${(error as Error).message}`
      };
    }
  }
}

export class VaultLister implements IAgentTool {
  name = 'list_files';
  description = 'Lists files in the vault. Useful for exploring the directory structure.';

  schema = {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'The folder path to list. Leave empty for root.'
      },
      limit: {
        type: 'NUMBER',
        description: 'Optional limit on number of files to return.'
      }
    }
  };

  private runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  async execute(args: any): Promise<any> {
    let { path, limit } = args;
    try {
      if (!path || path.trim() === '') {
        // List all notes if no path provided, or root?
        // Let's use listFolderContents logic from service for hierarchy
        return await this.runtime.vault.listFolderContents('');
      }
      return await this.runtime.vault.listFolderContents(path);
    } catch (error) {
      return {
        error: `Failed to list files in '${path}': ${(error as Error).message}`
      };
    }
  }
}
