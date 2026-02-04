import { PRECACHED_MODELS } from '../config/models';

export interface ToolContext {
  permWeb: boolean;
  permTerminal: boolean;
  confirmTerminalDestructive: boolean;
  fetchUrl: (url: string) => Promise<any>;
  runShellCommand: (cmd: string) => Promise<any>;
}

export class Router {

  /**
   * Intelligently selects the best model for the given task.
   * Handles multimodal inputs, image generation intent, and complexity scoring.
   */
  static selectModel(prompt: string, imageCount: number = 0): string {
    const p = prompt.toLowerCase();

    // 1. Image Generation Intent
    if (this.detectImageGeneration(p)) {
      return 'imagen-3.0-generate-001';
    }

    // 2. Multimodal Input -> High Capability
    if (imageCount > 0) {
      return this.getBestProModel();
    }

    // 3. Complexity Scoring
    const score = this.calculateComplexityScore(p);

    if (score >= 4) {
      return this.getBestProModel();
    }

    return this.getBestFlashModel();
  }

  /**
   * Routes tool execution to the appropriate handler (Registry or Native).
   */
  static async executeTool(name: string, args: any, registry: any, context: ToolContext): Promise<any> {

    // 1. Registry Tools (Priority)
    if (registry && registry.has(name)) {
      const tool = registry.get(name);
      return await tool.execute(args, registry.runtime);
    }

    // 2. Native / Legacy Tools
    switch (name) {
      case 'fetch_url':
        if (!context.permWeb) throw new Error('Web access disabled.');
        return await context.fetchUrl(args.url);

      case 'run_shell_command':
        if (!context.permTerminal) throw new Error('Terminal disabled.');
        if (context.confirmTerminalDestructive) {
          return { status: 'error', message: 'Terminal confirmation required (not implemented in streaming yet).' };
        }
        return await context.runShellCommand(String(args.command || ''));

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // --- Internal Heuristics ---

  private static detectImageGeneration(prompt: string): boolean {
    const regex = /(?:generate|create|make|draw).*(?:image|picture|photo|sketch|diagram)/i;
    return regex.test(prompt) || (prompt.includes('edit') && prompt.includes('image'));
  }

  private static calculateComplexityScore(prompt: string): number {
    let score = 0;
    const words = prompt.split(/\s+/).length;

    // Length
    if (words > 50) score += 1;
    if (words > 200) score += 2;

    // Structure
    if (prompt.includes('```')) score += 2;

    // Keywords
    const reasoningKeywords = ['analyze', 'compare', 'evaluate', 'why', 'impact', 'implication'];
    const engineeringKeywords = ['refactor', 'architect', 'security', 'optimize', 'debug', 'api', 'database', 'interface'];
    const complexFormats = ['step-by-step', 'json', 'csv', 'markdown table'];
    const mathKeywords = ['calculate', 'solve', 'equation', 'logic', 'math'];

    if (reasoningKeywords.some(k => prompt.includes(k))) score += 1;
    if (engineeringKeywords.some(k => prompt.includes(k))) score += 2;
    if (complexFormats.some(k => prompt.includes(k))) score += 2;
    if (mathKeywords.some(k => prompt.includes(k))) score += 2;

    return score;
  }

  private static getBestProModel(): string {
    const best = PRECACHED_MODELS.find(m => m.id.includes('pro') && m.isModern);
    return best ? best.id : 'gemini-3-pro-preview';
  }

  private static getBestFlashModel(): string {
    const best = PRECACHED_MODELS.find(m => m.id.includes('flash') && m.isModern);
    return best ? best.id : 'gemini-3-flash';
  }
}
