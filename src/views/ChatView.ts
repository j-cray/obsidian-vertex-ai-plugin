import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import MastermindPlugin from '../main';
import { VertexService } from '../services/vertex';
import { VaultService } from '../services/vault';
import { MessageRenderer } from './MessageRenderer'; // Import Renderer
import { ToolAction } from '../types';

export const VIEW_TYPE_MASTERMIND = 'mastermind-chat-view';

interface ChatMessage {
  role: string;
  parts: { text: string }[];
  actions?: ToolAction[];
}

export class MastermindChatView extends ItemView {
  plugin: MastermindPlugin;
  vertexService: VertexService;
  vaultService: VaultService;
  messageRenderer!: MessageRenderer; // New Renderer
  messageContainer!: HTMLElement;
  inputEl!: HTMLTextAreaElement;
  toolbarEl!: HTMLElement;
  modelLabel!: HTMLElement;
  messages: ChatMessage[] = [];

  abortController: AbortController | null = null;
  sendButton!: HTMLElement;
  isGenerating: boolean = false;

  constructor(leaf: WorkspaceLeaf, plugin: MastermindPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.vertexService = new VertexService(plugin.settings);
    this.vaultService = new VaultService(this.app);
  }

  getViewType() {
    return VIEW_TYPE_MASTERMIND;
  }

  getDisplayText() {
    return "Mastermind AI";
  }

  getIcon() {
    return "brain-circuit";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("chat-view");

    // --- TOOLBAR ---
    this.toolbarEl = container.createDiv('chat-toolbar');

    // Model Indicator
    const modelContainer = this.toolbarEl.createDiv('model-picker-container');
    this.modelLabel = modelContainer.createEl('span', { cls: 'model-indicator' });
    this.modelLabel.innerText = this.plugin.settings.modelId || 'gemini-2.0-flash-exp';
    this.modelLabel.title = "Current Model (Click to Settings)";

    this.plugin.onSettingsChange(() => {
      if (this.modelLabel) {
        this.modelLabel.innerText = this.plugin.settings.modelId;
      }
    });

    this.modelLabel.onclick = () => {
      // @ts-ignore
      this.app.setting.open();
      // @ts-ignore
      this.app.setting.openTabById(this.plugin.manifest.id);
    };

    // ACTION BUTTONS
    const actionsDiv = this.toolbarEl.createDiv({ cls: 'toolbar-actions' });
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '8px';

    // NEW CHAT
    const newChatBtn = actionsDiv.createEl('button', { cls: 'toolbar-btn' });
    newChatBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;
    newChatBtn.title = "New Conversation";
    newChatBtn.onclick = async () => {
      if (this.isGenerating) {
        new Notice("Please stop generation first.");
        return;
      }
      if (this.messages.length > 0) {
        if (!this.plugin.settings.history || !Array.isArray(this.plugin.settings.history)) {
          this.plugin.settings.history = [];
        }
        await this.plugin.saveSettings();
      }

      this.messages = [];
      this.renderMessages();
      new Notice("Started new conversation.");
    };

    // HISTORY
    const historyBtn = actionsDiv.createEl('button', { cls: 'toolbar-btn' });
    historyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>`;
    historyBtn.title = "History";
    historyBtn.onclick = () => {
      const savedConversations = this.plugin.settings.history || [];
      new Notice(`History contains ${savedConversations.length} items.`);
    };

    // SETTINGS
    const settingsBtn = actionsDiv.createEl('button', { cls: 'toolbar-btn' });
    settingsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    settingsBtn.title = "Settings";
    settingsBtn.onclick = () => {
      // @ts-ignore
      this.app.setting.open();
      // @ts-ignore
      this.app.setting.openTabById(this.plugin.manifest.id);
    };

    // --- MESSAGES ---
    this.messageContainer = container.createDiv('chat-messages');
    this.messageRenderer = new MessageRenderer(this.app, this.messageContainer);

    // --- INPUT AREA ---
    const inputWrapper = container.createDiv("chat-input-wrapper");
    const inputContainer = inputWrapper.createDiv("chat-input-container");

    // Overlay Icons
    const overlay = inputContainer.createDiv('chat-features-overlay');
    const icons = [
      {
        name: "file",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
      },
      {
        name: "image",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
      },
      {
        name: "mic",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
      },
    ];

    icons.forEach((i) => {
      const btn = overlay.createEl("div", { cls: "feature-icon" });
      btn.innerHTML = i.svg;
      btn.onclick = () => new Notice(`${i.name} feature coming soon!`);
    });

    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'chat-input',
      attr: { rows: '1' } // Clean input, no placeholder
    });

    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = `${this.inputEl.scrollHeight}px`;
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSendMessage();
        this.inputEl.style.height = 'auto'; // Reset height
      }
    });

    this.sendButton = inputContainer.createEl('button', { cls: 'chat-send-button' });
    this.updateSendButton(false);
    this.sendButton.addEventListener('click', () => {
      if (this.isGenerating) {
        this.stopGeneration();
      } else {
        this.handleSendMessage();
      }
    });

    // Hydrate History
    if (this.plugin.settings.history && this.plugin.settings.history.length > 0) {
      this.messages = [...this.plugin.settings.history];
    }
    this.renderMessages();
  }

  updateSendButton(isGenerating: boolean) {
    this.isGenerating = isGenerating;
    if (isGenerating) {
      this.sendButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>';
      this.sendButton.title = "Stop Generating";
    } else {
      this.sendButton.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      this.sendButton.title = "Send Message";
    }
  }

  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      new Notice("Generation stopped.");
      this.updateSendButton(false);
    }
  }

  renderMessages() {
    this.messageContainer.empty();
    this.messageRenderer.renderTo(this.messageContainer);

    if (this.messages.length === 0) {
      this.messageRenderer.renderAIMessage('Greetings. I am Mastermind. How can I assist you in your vault today?', this.plugin.settings.profilePictureAI);
    } else {
      for (const msg of this.messages) {
        if (msg.role === 'user') {
          this.messageRenderer.renderUserMessage(msg.parts[0].text, this.plugin.settings.profilePictureUser);
        } else {
          // Process links asynchronously
          this.vaultService.enhanceTextWithLinks(msg.parts[0].text).then(enhancedText => {
            this.messageRenderer.renderAIMessage(enhancedText, this.plugin.settings.profilePictureAI, msg.actions);
          });
        }
      }
    }
  }

  async handleSendMessage() {
    const message = this.inputEl.value.trim();
    if (!message) return;

    this.inputEl.value = '';
    this.updateSendButton(true); // Set to Stop state

    // Initialize AbortController
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Render User Message
    await this.messageRenderer.renderUserMessage(message, this.plugin.settings.profilePictureUser);

    // Prepare AI Message Container (Streaming)
    const { update } = this.messageRenderer.startAIMessage(this.plugin.settings.profilePictureAI);

    // Streaming Loop with Signal
    let finalResponse: import('../types').ChatResponse = { text: '', actions: [] };

    try {
      this.vertexService.updateSettings(this.plugin.settings);

      const context = await this.vaultService.getRelevantContext(message);
      const images = await this.vaultService.getActiveNoteImages();

      // Pass signal to chat
      for await (const chunk of this.vertexService.chat(message, context, this.vaultService, this.plugin.settings.history, images, signal)) {
        if (signal.aborted) break;
        await update(chunk, false);
        finalResponse = chunk;
      }

      if (!signal.aborted) {
        // Final Polish only if not aborted
        if (finalResponse.text) {
          const enhancedText = await this.vaultService.enhanceTextWithLinks(finalResponse.text);
          finalResponse.text = enhancedText;
          await update(finalResponse, true);
        }

        // State Updates
        const userMsg: ChatMessage = { role: 'user', parts: [{ text: message }] };
        const aiMsg: ChatMessage = {
          role: 'model',
          parts: [{ text: finalResponse.text }],
          actions: finalResponse.actions
        };

        this.messages.push(userMsg);
        this.messages.push(aiMsg);

        this.plugin.settings.history.push(userMsg);
        this.plugin.settings.history.push(aiMsg);

        if (this.plugin.settings.history.length > 40) {
          this.plugin.settings.history = this.plugin.settings.history.slice(-40);
        }

        await this.plugin.saveSettings();
        await (this.vaultService as any).writeHistory(this.plugin.settings.history, (this as any).sessionId);
      }

    } catch (error: any) {
      if (error.name === 'AbortError' || signal.aborted) {
        update({ text: `**[Stopped by User]**\n\n${finalResponse?.text || ''}`, actions: [] }, true);
      } else {
        console.error('Mastermind Error:', error);
        let errorMessage = error instanceof Error ? error.message : String(error);
        update({ text: `**Error**: ${errorMessage}`, actions: [] }, true);
        new Notice('Mastermind Chat failed.');
      }
    } finally {
      this.updateSendButton(false);
      this.abortController = null;
    }
  }

  async onClose() {
    this.stopGeneration();
  }
}
