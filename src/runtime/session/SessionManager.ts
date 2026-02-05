import { AgentRuntime } from '../Runtime';
import { Writable, writable } from '../store/Store';
import { ChatMessage } from '../../types';

export class SessionManager {
  private runtime: AgentRuntime;

  /** Reactive store for chat messages */
  public messages: Writable<ChatMessage[]> = writable([]);

  /** Reactive store for "is thinking/generating" state */
  public isGenerating: Writable<boolean> = writable(false);



  private abortController: AbortController | null = null;

  private currentSessionFile: string | null = null;



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
    this.currentSessionFile = null; // Reset session file on clear
  }

  public loadSession(messages: ChatMessage[], filename: string) {
    this.messages.set(messages);
    this.persist(messages);
    this.currentSessionFile = filename;
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

  public abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }


  /**
   * Main entry point for user interaction
   */
  public async sendMessage(text: string, attachments: ChatAttachment[] = [], externalSignal?: AbortSignal) {
    if (!text.trim() && attachments.length === 0) return;

    // Cancel previous if any (though UI blocks this usually)
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = externalSignal || this.abortController.signal;



    this.setGenerating(true);

    // 1. Add User Message
    const userMsg: ChatMessage = {
      role: 'user',
      parts: [{ text }],
      attachments: attachments
    };
    this.addMessage(userMsg);

    try {
      // 2. Prepare Context
      const context = await this.runtime.vault.getRelevantContext(text);

      // Process Attachments
      const processedImages: any[] = [];
      let attachedContext = "";

      for (const att of attachments) {
        if (att.type === 'image') {
          // Ensure base64 is clean
          const base64 = att.data.includes('base64,') ? att.data.split('base64,')[1] : att.data;
          processedImages.push({
            inlineData: {
              data: base64,
              mimeType: att.mimeType || 'image/jpeg'
            }
          });
        } else if (att.type === 'file' || att.type === 'text') {
          attachedContext += `\n\n[ATTACHED FILE: ${att.name}]\n${att.data}\n`;
        }
      }

      // Combine attached text with prompt or context?
      // It's better to append to prompt for visibility to the model as "part of the request".
      const fullText = attachedContext ? `${text}\n${attachedContext}` : text;

      // Existing images (from active note) - specific feature
      const activeNoteImages = await this.runtime.vault.getActiveNoteImages();
      const allImages = [...processedImages, ...activeNoteImages];

      // 3. Create placeholder AI message
      const aiMsg: ChatMessage = { role: 'model', parts: [{ text: '' }], actions: [] };
      this.addMessage(aiMsg);

      // Helper to update the last message (the AI one) IMMUTABLY
      const updateLastMessage = (chunk: Partial<ChatMessage>, isThinking = false) => {
        this.messages.update((msgs: ChatMessage[]) => {
          if (msgs.length === 0) return msgs;

          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];

          if (last.role === 'model') {
            // Create a COPY of the last message
            const updatedLast = { ...last };

            if (chunk.parts) updatedLast.parts = chunk.parts;
            if (chunk.actions) updatedLast.actions = chunk.actions;
            if (chunk.thinking) updatedLast.thinking = chunk.thinking;
            if (chunk.model) updatedLast.model = chunk.model;

            // Trigger bus events
            if (isThinking) {
              this.runtime.bus.trigger('agent:thinking', chunk.thinking);
            }

            // Return NEW array with NEW message object
            const newMsgs = [...msgs];
            newMsgs[lastIdx] = updatedLast;
            return newMsgs;
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


      // Fetch User Profile
      let userProfile = '';
      try {
        const profilePath = this.runtime.plugin.settings.userProfilePath || 'Mastermind/User Profile.md';
        userProfile = await this.runtime.vault.readNote(profilePath) || '';
      } catch (e) {
        // Ignore if profile doesn't exist
      }

      for await (const chunk of this.runtime.vertex.chat(fullText, context, this.runtime.vault, history, allImages, userProfile, this.runtime.tools, signal)) {


        if (signal?.aborted) break;


        if (chunk.isThinking) {
          updateLastMessage({ thinking: chunk.thinkingText }, true);
        }

        // ALWAYS update text/actions if present, even if thinking
        if (chunk.text !== undefined || (chunk.actions && chunk.actions.length > 0)) {
          finalText = chunk.text || finalText; // Keep existing if undefined, update if present
          if (chunk.actions) finalActions = chunk.actions;

          updateLastMessage({
            parts: [{ text: finalText }],
            actions: finalActions,
            model: chunk.acceptedModelId
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

        // Auto-save to History (if enabled)
        if (this.runtime.plugin.settings.saveConversationHistory) {
          await this.saveSessionToVault(this.messages.get());
        }
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
      this.abortController = null;
    }


  }

  private async saveSessionToVault(history: ChatMessage[]) {
    if (history.length === 0) return;

    // Generate filename if needed
    if (!this.currentSessionFile) {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

      // Extract keywords from first user message
      const firstUserMsg = history.find(m => m.role === 'user');
      let keywords = 'conversation';
      if (firstUserMsg && firstUserMsg.parts[0].text) {
        const text = firstUserMsg.parts[0].text;
        // distinct words provided by user, simple heuristic
        const words = text.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        keywords = words.slice(0, 4).join('-').toLowerCase();
      }

      this.currentSessionFile = `${dateStr}-${timeStr}-${keywords}`;
    }

    try {
      await this.runtime.vault.writeHistory(history, this.currentSessionFile);
    } catch (e) {
      console.error('Mastermind: Failed to save history', e);
    }
  }
}

