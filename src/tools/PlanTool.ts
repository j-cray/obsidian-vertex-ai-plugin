import { IAgentTool } from '../runtime/tools/types';
import { AgentRuntime } from '../runtime/Runtime';

export class PlanTool implements IAgentTool {
  name = 'propose_plan';
  description = 'Proposes a step-by-step plan for a complex task. Automatically saves the plan to Mastermind/Plans.';

  schema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title of the plan.' },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of steps to execute.'
      }
    },
    required: ['title', 'steps']
  };

  constructor(private runtime: AgentRuntime) { }

  async execute(args: any, runtime: AgentRuntime): Promise<any> {
    const { title, steps } = args;

    if (!title || !steps || !Array.isArray(steps)) {
      throw new Error('Invalid plan format. Title and steps (array) are required.');
    }

    // Generate Filename
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // Keyword extraction from title
    const keywords = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2).slice(0, 4).join('-').toLowerCase();
    const filename = `Mastermind/Plans/${dateStr}-${keywords}-plan.md`;

    // Format Content
    let content = `# ${title}\n\n`;
    content += `**Date:** ${now.toDateString()}\n\n`;
    content += `## Steps\n`;
    steps.forEach((step: string, index: number) => {
      content += `${index + 1}. ${step}\n`;
    });
    content += `\n\n---\n*Plan created by Mastermind*`;

    // Save to Vault
    await runtime.vault.createOrUpdateNote(filename, content);

    return {
      status: 'success',
      message: `Plan saved to ${filename}`,
      plan: { title, steps }
    };
  }
}
