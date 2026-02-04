import { AgentRuntime } from '../Runtime';
import { Writable, writable } from '../store/Store';
import { ChatMessage } from '../../types';

export class SessionManager {
  private runtime: AgentRuntime;

  /** Reactive store for chat messages */
  public messages: Writable<ChatMessage[]> = writable([]);

  /** Reactive store for "is thinking/generating" state */
  public isGenerating: Writable<boolean> = writable(false);

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
    this.loadHistory();
  }

  private loadHistory() {
    const history = this.runtime.plugin.settings.history || [];
    // Ensure it's a valid array of ChatMessage
    if (Array.isArray(history)) {
      this.messages.set(history as ChatMessage[]);
    }
  }

  /**
   * Add a message to the session and persist it.
   */
  public addMessage(message: ChatMessage) {
    this.messages.update((msgs: ChatMessage[]) => {
      const newHistory = [...msgs, message];
      this.persist(newHistory);
      return newHistory;
    });
  }

  /**
   * Clear current history.
   */
  public clearHistory() {
    this.messages.set([]);
    this.persist([]);
  }

  /**
   * Save to plugin settings
   */
  private async persist(history: ChatMessage[]) {
    // Pruning logic can go here (e.g. limit to last 50 messages)
    const limit = 50;
    // TODO: Make limit dynamic based on model

    const pruned = history.slice(-limit);

    this.runtime.plugin.settings.history = pruned;
    await this.runtime.plugin.saveSettings();
  }

  public setGenerating(generating: boolean) {
    this.isGenerating.set(generating);
  }

  /**
   * Main entry point for user interaction
   */
  public async sendMessage(text: string, signal?: AbortSignal) {
    if (!text.trim()) return;

    this.setGenerating(true);

    // 1. Add User Message
    const userMsg: ChatMessage = { role: 'user', parts: [{ text }] };
    this.addMessage(userMsg);

    try {
      // 2. Prepare Context
      const context = await this.runtime.vault.getRelevantContext(text);
      const images = await this.runtime.vault.getActiveNoteImages();

      // 3. Create placeholder AI message
      const aiMsg: ChatMessage = { role: 'model', parts: [{ text: '' }], actions: [] };
      this.addMessage(aiMsg);

      // Helper to update the last message (the AI one)
      const updateLastMessage = (chunk: Partial<ChatMessage>, isThinking = false) => {
        this.messages.update((msgs: ChatMessage[]) => {
          const last = msgs[msgs.length - 1];
          if (last.role === 'model') {
            if (chunk.parts) last.parts = chunk.parts;
            if (chunk.actions) last.actions = chunk.actions;
            // Trigger bus events for UI streaming if needed
            // For now, the store update is enough for reactive UI

            if (isThinking) {
              this.runtime.bus.trigger('agent:thinking', chunk.parts?.[0]?.text);
            }
          }
          return msgs;
        });
      };

      this.runtime.bus.trigger('agent:action:start', { type: 'chat', prompt: text });

      let finalText = '';
      let finalActions: any[] = [];

      // 4. Stream Response
      const history = this.messages.get(); // Get current history
      // Note: We might want to filter history here or inside VertexService

      for await (const chunk of this.runtime.vertex.chat(text, context, this.runtime.vault, history, images, signal)) {
        if (signal?.aborted) break;

        if (chunk.isThinking) {
          // Handle thinking updates?
          // Currently ChatView handled it with a special flag.
          // We can just log it or update a store property.
          // For simplicity, we might append to text or handle specially if we had a thinking store.
          // Re-using 'thinkingText' from types if available?
          this.runtime.bus.trigger('agent:thinking', chunk.thinkingText);
        } else {
          finalText = chunk.text;
          finalActions = chunk.actions || [];

          updateLastMessage({
            parts: [{ text: finalText }],
            actions: finalActions
          });
        }
      }

      // 5. Enhance Links (Post-processing)
      if (finalText && !signal?.aborted) {
        const enhanced = await this.runtime.vault.enhanceTextWithLinks(finalText);
        updateLastMessage({ parts: [{ text: enhanced }] });

        // Persist after full response
        this.messages.update((msgs: ChatMessage[]) => {
          this.persist(msgs);
          return msgs;
        });
      }

      this.runtime.bus.trigger('agent:action:end', { text: finalText, actions: finalActions });

    } catch (error) {
      console.error('Mastermind: Chat Error', error);
      this.runtime.bus.trigger('error', error);

      // Append error to chat
      this.addMessage({
        role: 'model',
        parts: [{ text: `**Error:** ${error instanceof Error ? error.message : String(error)}` }]
      });
    } finally {
      this.setGenerating(false);
    }
  }
}
