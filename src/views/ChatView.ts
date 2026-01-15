import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, Component } from 'obsidian';
import MastermindPlugin from '../main';
import { VertexService } from '../services/vertex';
import { VaultService } from '../services/vault';

export const VIEW_TYPE_MASTERMIND = 'mastermind-chat-view';

export class MastermindChatView extends ItemView {
  plugin: MastermindPlugin;
  vertexService: VertexService;
  vaultService: VaultService;
  messageContainer!: HTMLElement;
  inputEl!: HTMLTextAreaElement;

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
    return 'Mastermind AI';
  }

  getIcon() {
    return 'brain-circuit';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('chat-view');

    this.messageContainer = container.createDiv('chat-messages');

    const inputContainer = container.createDiv('chat-input-container');
    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'chat-input',
      attr: {
        placeholder: 'Ask Mastermind...',
        rows: '1'
      }
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSendMessage();
      }
    });

    const sendButton = inputContainer.createEl('button', {
      cls: 'chat-send-button mod-cta',
      text: 'Send'
    });
    sendButton.addEventListener('click', () => this.handleSendMessage());

    // Load History
    if (this.plugin.settings.history && this.plugin.settings.history.length > 0) {
      for (const msg of this.plugin.settings.history) {
        this.appendMessage(msg.role === 'user' ? 'user' : 'ai', msg.parts[0].text);
      }
    } else {
      this.appendMessage('ai', 'Greetings. I am Mastermind. How can I assist you with your knowledge vault today?');
    }
  }

  async handleSendMessage() {
    const message = this.inputEl.value.trim();
    if (!message) return;

    this.inputEl.value = '';
    this.appendMessage('user', message);

    const loadingMsg = this.appendMessage('ai', 'Thinking...');

    try {
      this.vertexService.updateSettings(this.plugin.settings);

      // Gather context
      const context = await this.vaultService.getRelevantContext(message);

      // Multimodal: Gather images from active note
      const images = await this.vaultService.getActiveNoteImages();

      // We pass history and images to vertex service
      const response = await this.vertexService.chat(message, context, this.vaultService, this.plugin.settings.history, images);

      loadingMsg.remove();
      this.appendMessage('ai', response);

      // Update History
      this.plugin.settings.history.push({ role: 'user', parts: [{ text: message }] });
      this.plugin.settings.history.push({ role: 'model', parts: [{ text: response }] });

      // Limit history to last 20 turns
      if (this.plugin.settings.history.length > 40) {
        this.plugin.settings.history = this.plugin.settings.history.slice(-40);
      }

      await this.plugin.saveSettings();
    } catch (error) {
      console.error('Mastermind Error:', error);
      loadingMsg.innerText = 'Error: ' + (error instanceof Error ? error.message : String(error));
      new Notice('Mastermind Chat failed. Check console for details.');
    }
  }

  appendMessage(sender: 'user' | 'ai', text: string): HTMLElement {
    const msgEl = this.messageContainer.createDiv(`chat-message message-${sender}`);

    if (sender === 'ai' && text !== 'Thinking...') {
      // Create a temporary component for markdown rendering
      const component = new Component();
      component.load();
      MarkdownRenderer.render(this.app, text, msgEl, '', component);
    } else {
      msgEl.innerText = text;
    }

    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    return msgEl;
  }

  async onClose() {
    // Cleanup
  }
}
