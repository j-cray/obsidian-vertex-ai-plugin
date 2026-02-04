import { PRECACHED_MODELS } from '../config/models';
import { Subagent } from '../types';

export interface ToolContext {
  permWeb: boolean;
  permTerminal: boolean;
  confirmTerminalDestructive: boolean;
  fetchUrl: (url: string) => Promise<any>;
  runShellCommand: (cmd: string) => Promise<any>;
}

export interface RoutingDecision {
  modelId: string;
  subagent?: Subagent;
  tokenStrategy: 'efficient' | 'liberal';
}

export class Router {

  /**
   * Intelligently selects the best model, subagent, and strategy for the task.
   */
  static plan(prompt: string, images: any[], subagents: Subagent[], efficiencyMode: 'auto' | 'efficient' | 'performance', availableModels: string[] = []): RoutingDecision {

    const p = prompt.toLowerCase();
    const imageCount = images.length;
    const complexityScore = this.calculateComplexityScore(p);

    // 1. Determine Subagent
    const selectedSubagent = this.selectSubagent(p, subagents);

    // 2. Determine Strategy
    let strategy: 'efficient' | 'liberal' = 'efficient';
    if (efficiencyMode === 'performance') strategy = 'liberal';
    else if (efficiencyMode === 'efficient') strategy = 'efficient';
    else {
      // Auto
      if (complexityScore >= 4 || imageCount > 0 || (selectedSubagent && selectedSubagent.preferredModel?.includes('pro'))) {
        strategy = 'liberal';
      }
    }

    // 3. Select Model
    let modelId = this.selectModel(p, imageCount, complexityScore, strategy, availableModels, selectedSubagent);


    return {
      modelId,
      subagent: selectedSubagent,
      tokenStrategy: strategy
    };
  }

  static selectSubagent(prompt: string, subagents: Subagent[]): Subagent | undefined {
    if (!subagents || subagents.length === 0) return undefined;

    // Simple keyword matching for now.
    for (const agent of subagents) {
      if (agent.triggers.some(trigger => prompt.includes(trigger.toLowerCase()))) {
        return agent;
      }
    }
    return undefined;
  }

  static selectModel(prompt: string, imageCount: number, complexityScore: number = 0, strategy: 'efficient' | 'liberal' = 'efficient', availableModels: string[] = [], subagent?: Subagent): string {

    const p = prompt.toLowerCase();

    // Subagent preference overrides strict complexity
    if (subagent && subagent.preferredModel) {
      if (strategy === 'efficient' && subagent.preferredModel.includes('pro')) {
        return this.getBestFlashModel(availableModels);
      }
      // Verify subagent preferred model is available
      if (availableModels.length > 0 && !availableModels.includes(subagent.preferredModel)) {
        // Fallback if preferred not available
        return strategy === 'liberal' ? this.getBestProModel(availableModels) : this.getBestFlashModel(availableModels);
      }
      return subagent.preferredModel;

    }

    // Image Gen Override
    if (this.detectImageGeneration(p)) {
      return 'imagen-3.0-generate-001';
    }

    // Multimodal -> Liberal/Pro
    if (imageCount > 0) {
      return this.getBestProModel(availableModels);
    }


    // Strategy based
    if (strategy === 'liberal') {
      return this.getBestProModel(availableModels);
    } else {
      return this.getBestFlashModel(availableModels);
    }

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

  // --- Internal Heuristics ---

  private static safeSelect(candidates: string[], available: string[]): string {
    // If available list is empty, we assume all are potentially available (legacy behavior) or we just pick the first candidate
    if (!available || available.length === 0) return candidates[0];

    // Find the first candidate that exists in available list
    for (const c of candidates) {
      if (available.includes(c)) return c;
    }

    // Fallback: Just return the first available model, or the first candidate if none match
    return available[0] || candidates[0];
  }

  private static getBestProModel(available: string[] = []): string {
    const candidates = [
      'gemini-3-pro',
      'gemini-3-pro-preview',
      'gemini-2.5-pro',
      'gemini-2.0-pro-exp',
      'gemini-1.5-pro'
    ];
    // PRECACHED_MODELS is useful for metadata, but here we just need IDs in preference order
    return this.safeSelect(candidates, available);
  }

  private static getBestFlashModel(available: string[] = []): string {
    const candidates = [
      'gemini-3-flash',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash'
    ];
    return this.safeSelect(candidates, available);
  }

}
