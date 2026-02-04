import { TFile } from 'obsidian';
import { AgentRuntime } from '../runtime/Runtime';

interface VectorIndexItem {
  path: string;
  mtime: number;
  embedding: number[];
}

interface VectorStoreData {
  version: number;
  items: VectorIndexItem[];
}

export class VectorStore {
  private runtime: AgentRuntime;
  private items: Map<string, VectorIndexItem> = new Map();
  private readonly STORE_PATH = '.obsidian/plugins/obsidian-vertex-ai-mastermind/indices.json';
  private isLoaded = false;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  async load() {
    if (this.isLoaded) return;

    try {
      const exists = await this.runtime.app.vault.adapter.exists(this.STORE_PATH);
      if (exists) {
        const content = await this.runtime.app.vault.adapter.read(this.STORE_PATH);
        const data = JSON.parse(content) as VectorStoreData;
        this.items = new Map(data.items.map(i => [i.path, i]));
        console.log(`Mastermind: VectorStore loaded ${this.items.size} items.`);
      }
    } catch (error) {
      console.error('Mastermind: Failed to load VectorStore', error);
    }
    this.isLoaded = true;
  }

  async save() {
    const data: VectorStoreData = {
      version: 1,
      items: Array.from(this.items.values())
    };
    try {
      await this.runtime.app.vault.adapter.write(this.STORE_PATH, JSON.stringify(data));
    } catch (error) {
      console.error('Mastermind: Failed to save VectorStore', error);
    }
  }

  async indexNote(file: TFile) {
    if (!this.isLoaded) await this.load();

    const existing = this.items.get(file.path);
    if (existing && existing.mtime === file.stat.mtime) {
      return; // Up to date
    }

    const content = await this.runtime.app.vault.read(file);
    if (!content || content.length < 50) return; // Skip empty/small notes

    // For simplicity in V1, we embed the first 2000 chars as a summary
    // Phase 2 enhancement: Chunking
    const textToEmbed = content.substring(0, 2048);

    try {
      const embedding = await this.runtime.vertex.getEmbeddings(textToEmbed);
      this.items.set(file.path, {
        path: file.path,
        mtime: file.stat.mtime,
        embedding
      });
      await this.save(); // Naive save on every index for safety in V1
    } catch (error) {
      console.warn(`Mastermind: Failed to index ${file.path}`, error);
    }
  }

  async search(query: string, limit = 5): Promise<{ path: string, score: number }[]> {
    if (!this.isLoaded) await this.load();

    try {
      // Embed Query
      const queryEmbedding = await this.runtime.vertex.getEmbeddings(query);

      const results: { path: string, score: number }[] = [];

      for (const item of this.items.values()) {
        const score = this.cosineSimilarity(queryEmbedding, item.embedding);
        results.push({ path: item.path, score });
      }

      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    } catch (error) {
      console.error('Mastermind: Vector search failed', error);
      return [];
    }
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    if (magnitudeA && magnitudeB) {
      return dotProduct / (magnitudeA * magnitudeB);
    } else {
      return 0;
    }
  }
}
