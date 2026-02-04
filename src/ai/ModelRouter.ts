import { PRECACHED_MODELS } from '../config/models';

export class ModelRouter {

  /**
   * Selects the optimal model based on prompt complexity and available models.
   * @param prompt User's input text
   * @param imageCount Number of images attached
   * @returns The Model ID to use (e.g., 'gemini-3-pro-preview')
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
    // Priority: Gemini 3 Pro -> 2.5 Pro -> 2.0 Pro -> 1.5 Pro
    // We filter by 'isModern' for the top tier recommendations
    const best = PRECACHED_MODELS.find(m => m.id.includes('pro') && m.isModern);
    return best ? best.id : 'gemini-3-pro-preview';
  }

  private static getBestFlashModel(): string {
    const best = PRECACHED_MODELS.find(m => m.id.includes('flash') && m.isModern);
    return best ? best.id : 'gemini-3-flash';
  }
}
