
import { IAgentTool } from '../runtime/tools/types';
import { AgentRuntime } from '../runtime/Runtime';
import { TFile } from 'obsidian';

export class GraphLinkedNotes implements IAgentTool {
  name = 'get_linked_notes';
  description = 'Get the Forward Links for a specific file. Returns a list of files that the target file links TO.';

  schema = {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'The path of the file to analyze (e.g. "Notes/MyNote.md")'
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

    if (!this.runtime.plugin.settings.permVaultRead) {
      return { status: 'error', message: 'Vault Read permission is disabled.' };
    }

    const app = this.runtime.app;

    const file = app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file || !(file instanceof TFile)) {
      return { status: 'error', message: `File not found: ${path}` };
    }

    const cache = app.metadataCache.getFileCache(file);
    if (!cache || !cache.links) {
      return { status: 'success', links: [], count: 0 };
    }

    const links = cache.links.map(l => l.link);
    const uniqueLinks = [...new Set(links)];
    return { status: 'success', links: uniqueLinks, count: uniqueLinks.length };
  }
}

export class GraphBacklinks implements IAgentTool {
  name = 'get_backlinks';
  description = 'Get the Backlinks for a specific file. Returns a list of files that link TO the target file.';

  schema = {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'The path of the file to analyze.'
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

    if (!this.runtime.plugin.settings.permVaultRead) {
      return { status: 'error', message: 'Vault Read permission is disabled.' };
    }

    const app = this.runtime.app;

    const file = app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file || !(file instanceof TFile)) {
      return { status: 'error', message: `File not found: ${path}` };
    }

    const backlinks: string[] = [];

    // Using global Vault iteration as Obsidian API for resolvedLinks is simpler but 'metadataCache.resolvedLinks' is synchronous map.
    // resolvedLinks is { sourcePath: { targetPath: count } }

    const resolvedLinks = app.metadataCache.resolvedLinks;

    for (const sourcePath in resolvedLinks) {
      const links = resolvedLinks[sourcePath];
      if (links[file.path]) {
        backlinks.push(sourcePath);
      }
    }

    return { status: 'success', backlinks, count: backlinks.length };
  }
}
