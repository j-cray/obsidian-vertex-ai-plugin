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
  toolbarEl!: HTMLElement;
  modelPickerEl!: HTMLSelectElement;

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

    // --- TOOLBAR ---
    this.toolbarEl = container.createDiv('chat-toolbar');

    // Model Picker (Compact, maybe just text or icon in the overlay style, but user wants it in Settings too)
    // User said "Gui should be in the settings panel too...". It implies it can remain here.
    // "Remove the background from the top bar".

    // Model Picker (Revived as Dropdown)
    const modelContainer = this.toolbarEl.createDiv('model-picker-container');
    const modelSelect = modelContainer.createEl('select', { cls: 'model-picker' });

    const options = this.plugin.settings.availableModels.length > 0
      ? this.plugin.settings.availableModels
      : [this.plugin.settings.modelId, 'gemini-1.5-pro', 'gemini-1.5-flash'];

    // Deduplicate
    [...new Set(options)].forEach(m => {
      const opt = modelSelect.createEl('option', { value: m, text: m });
      if (m === this.plugin.settings.modelId) opt.selected = true;
    });

    modelSelect.addEventListener('change', async () => {
      this.plugin.settings.modelId = modelSelect.value;
      await this.plugin.saveSettings();
      new Notice(`Switched to ${modelSelect.value}`);
    });

    // Settings Button
    const settingsBtn = this.toolbarEl.createEl('button', { cls: 'toolbar-btn' });
    settingsBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
    settingsBtn.addEventListener('click', () => {
      // @ts-ignore
      this.app.setting.open();
      // @ts-ignore
      this.app.setting.openTabById(this.plugin.manifest.id);
    });

    // --- MESSAGES ---
    this.messageContainer = container.createDiv('chat-messages');

    // --- INPUT AREA ---
    const inputWrapper = container.createDiv('chat-input-wrapper');
    const inputContainer = inputWrapper.createDiv('chat-input-container');

    // Overlay Icons (Left)
    const overlay = inputContainer.createDiv('chat-features-overlay');
    // SVG Icons for File, Image, Camera, Mic
    const icons = [
      { name: 'file', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>' },
      { name: 'image', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>' },
      { name: 'mic', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>' }
    ];

    icons.forEach(i => {
      const btn = overlay.createEl('div', { cls: 'feature-icon' });
      btn.innerHTML = i.svg;
      btn.onclick = () => new Notice(`${i.name} feature coming soon!`);
    });

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

    // Send Button with Telegram Paper Plane
    const sendButton = inputContainer.createEl('button', {
      cls: 'chat-send-button'
    });
    // Telegram-like paper plane SVG
    sendButton.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    sendButton.addEventListener('click', () => this.handleSendMessage());

    // Load History
    if (this.plugin.settings.history && this.plugin.settings.history.length > 0) {
      for (const msg of this.plugin.settings.history) {
        this.appendMessage(msg.role === 'user' ? 'user' : 'ai', msg.parts[0].text);
      }
    } else {
      this.appendMessage('ai', 'Greetings. I am Mastermind. How can I assist you in your vault today?');
    }
  }

  async handleSendMessage() {
    const message = this.inputEl.value.trim();
    if (!message) return;

    this.inputEl.value = '';
    this.appendMessage('user', message);

    // Thinking Animation
    const thinkingContainer = this.messageContainer.createDiv('thinking-container');
    thinkingContainer.innerHTML = '<div class="thinking-dots"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>';
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;

    try {
      this.vertexService.updateSettings(this.plugin.settings);

      // Gather context
      const context = await this.vaultService.getRelevantContext(message);

      // Multimodal: Gather images from active note
      const images = await this.vaultService.getActiveNoteImages();

      // We pass history and images to vertex service
      const response = await this.vertexService.chat(message, context, this.vaultService, this.plugin.settings.history, images);

      thinkingContainer.remove(); // Remove thinking animation
      this.appendMessage('ai', response);

      // Update History
      this.plugin.settings.history.push({ role: 'user', parts: [{ text: message }] });
      this.plugin.settings.history.push({ role: 'model', parts: [{ text: response }] });

      // Limit history
      if (this.plugin.settings.history.length > 40) {
        this.plugin.settings.history = this.plugin.settings.history.slice(-40);
      }

      await this.plugin.saveSettings();
    } catch (error) {
      console.error('Mastermind Error:', error);
      thinkingContainer.remove();
      // Show error message
      this.appendMessage('ai', `**Error**: ${error instanceof Error ? error.message : String(error)}`);
      new Notice('Mastermind Chat failed.');
    }
  }

  async appendMessage(sender: 'user' | 'ai', text: string): Promise<HTMLElement> {
    const msgBlock = this.messageContainer.createDiv(`chat-message-block message-block-${sender}`);

    // Avatar
    const avatarUrl = sender === 'user' ? this.plugin.settings.profilePictureUser : this.plugin.settings.profilePictureAI;
    const avatar = msgBlock.createEl('img', { cls: 'chat-avatar', attr: { src: avatarUrl } });

    const msgEl = msgBlock.createDiv(`chat-message message-${sender}`);

    if (sender === 'ai') {
      // Smart Wikilinking
      const linkedText = await this.processWikilinks(text);

      // Create a temporary component for markdown rendering
      const component = new Component();
      component.load();
      await MarkdownRenderer.render(this.app, linkedText, msgEl, '', component);
    } else {
      msgEl.innerText = text;
    }

    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    return msgEl;
  }

  async processWikilinks(text: string): Promise<string> {
    const fileNames = await this.vaultService.getAllFileNames();

    // Create a regex to find exact matches of filenames, avoiding already linked text
    // This is a simplified approach; a full parser would be more robust but complex.
    // We look for the filename as a whole word.

    // Sort filenames by length (descending) to match longest titles first
    const sortedNames = Array.from(fileNames).sort((a, b) => b.length - a.length);

    let processedText = text;

    for (const name of sortedNames) {
      if (name.length < 3) continue; // Skip very short names to avoid false positives

      // Regex explanation:
      // (?<!\[\[) - Negative lookbehind: not preceded by [[
      // \b - Word boundary
      // (${escapeRegExp(name)}) - The filename
      // \b - Word boundary
      // (?!\]\]) - Negative lookahead: not followed by ]]
      const regex = new RegExp(`(?<!\\[\\[)\\b(${this.escapeRegExp(name)})\\b(?!\\]\\])`, 'g');

      processedText = processedText.replace(regex, '[[$1]]');
    }

    return processedText;
  }

  escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async onClose() {
    // Cleanup
  }
}
