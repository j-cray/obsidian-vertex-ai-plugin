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
  reason?: string;
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
    const [modelId, reason] = this.selectModel(p, imageCount, complexityScore, strategy, availableModels, selectedSubagent);


    return {
      modelId,
      subagent: selectedSubagent,
      tokenStrategy: strategy,
      reason // Passed through decision
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

  static selectModel(prompt: string, imageCount: number, complexityScore: number = 0, strategy: 'efficient' | 'liberal' = 'efficient', availableModels: string[] = [], subagent?: Subagent): [string, string] {

    const p = prompt.toLowerCase();

    // 0. Search Intent (Grounding Requirement) - Priority 1
    // If the user wants to search, we MUST use a model that supports Google Search Grounding well (Gemini 2.0+ or Pro)
    // Flash 2.5 is "Modern" but user report says it failed. Let's prioritize Pro or known-good Flash.
    if (this.detectSearchIntent(p)) {
      const bestSearchModel = this.getBestSearchModel(availableModels);
      return [bestSearchModel, `Search Intent Detected (Current Events/Internet) -> Selected ${bestSearchModel} for Grounding`];
    }

    // Subagent preference overrides strict complexity
    if (subagent && subagent.preferredModel) {
      if (strategy === 'efficient' && subagent.preferredModel.includes('pro')) {
        const fallback = this.getBestFlashModel(availableModels);
        return [fallback, `Subagent '${subagent.name}' active (Efficient Mode override) -> ${fallback}`];
      }
      // Verify subagent preferred model is available
      if (availableModels.length > 0 && !availableModels.includes(subagent.preferredModel)) {
        // Fallback if preferred not available
        const fallback = strategy === 'liberal' ? this.getBestProModel(availableModels) : this.getBestFlashModel(availableModels);
        return [fallback, `Subagent '${subagent.name}' preferred model unavailable -> Fallback to ${fallback}`];
      }
      return [subagent.preferredModel, `Subagent '${subagent.name}' active -> Preferred Model`];

    }

    // Image Gen Override
    if (this.detectImageGeneration(p)) {
      return ['imagen-3.0-generate-001', 'Image Generation Intent Detected'];
    }

    // Multimodal -> Liberal/Pro
    if (imageCount > 0) {
      const model = this.getBestProModel(availableModels);
      return [model, 'Multimodal Input (Images) -> High Capacity Model'];
    }


    // Strategy based
    if (strategy === 'liberal') {
      const model = this.getBestProModel(availableModels);
      return [model, `High Complexity / Performance Mode -> ${model}`];
    } else {
      const model = this.getBestFlashModel(availableModels);
      return [model, `Low Complexity / Efficient Mode -> ${model}`];
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

  private static detectSearchIntent(prompt: string): boolean {
    const p = prompt.toLowerCase();
    const keywords = ['search', 'google', 'find', 'who is', 'what is', 'current events', 'news', 'latest', 'weather', 'stock', 'price', 'when is'];
    // Simple heuristic: if it explicitly asks to search or asks about real-world entities that might need lookup
    return keywords.some(k => p.includes(k));
  }

  private static getBestSearchModel(availableModels: string[]): string {
    // Priority: Gemini 2.0 (Native Grounding support is best here) > Gemini 1.5 Pro > Gemini 1.5 Flash
    // Note: Gemini 2.5 Flash is reportedly buggy with search (per user), so we prioritize 2.0 Pro/Flash or 1.5 Pro if 2.5 is the only other option?
    // Actually user said "router selected gemini-2.5-flash ... and it said it can't search".
    // This implies 2.5-flash MIGHT work if we actually gave it the tool.
    // But safe bet is 2.0 Pro or 1.5 Pro.

    const hierarchy = [
      'gemini-2.0-pro-exp',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-2.5-flash', // Fallback, we'll try to enable grounding for it too
      'gemini-1.5-flash'
    ];

    return this.safeSelect(hierarchy, availableModels);
  }

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
