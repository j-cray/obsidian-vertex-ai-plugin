import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import MastermindPlugin from '../main';
import { MessageRenderer } from './MessageRenderer';
import { AgentRuntime } from '../runtime/Runtime';
import { ChatMessage } from '../types';

export const VIEW_TYPE_MASTERMIND = 'mastermind-chat-view';

export class MastermindChatView extends ItemView {
  plugin: MastermindPlugin;
  runtime: AgentRuntime;
  messageRenderer!: MessageRenderer;
  messageContainer!: HTMLElement;
  inputEl!: HTMLTextAreaElement;
  toolbarEl!: HTMLElement;
  modelLabel!: HTMLElement;


  // Local state mirrored from store for rendering optimization if needed

  // But we will try to just re-render on changes or optimize renderer later.

  constructor(leaf: WorkspaceLeaf, plugin: MastermindPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.runtime = AgentRuntime.get();
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
    this.renderToolbar(container);



    // --- MESSAGES ---

    this.messageContainer = container.createDiv('chat-messages');
    this.messageRenderer = new MessageRenderer(this.app, this.messageContainer);

    // --- INPUT AREA ---
    this.renderInput(container);

    // --- SUBSCRIPTIONS ---
    this.subscribeToStore();

    // Initial Render
    this.renderMessages(this.runtime.session.messages.get() || []);
  }

  renderToolbar(container: HTMLElement) {
    this.toolbarEl = container.createDiv('chat-toolbar');

    // Model Indicator
    const modelContainer = this.toolbarEl.createDiv('model-picker-container');
    this.modelLabel = modelContainer.createEl('span', { cls: 'model-indicator' });
    this.modelLabel.innerText = this.plugin.settings.modelId || 'gemini-2.0-flash-exp';
    this.modelLabel.title = "Current Model (Click to Settings)";

    this.plugin.onSettingsChange(() => {
      if (this.modelLabel) this.modelLabel.innerText = this.plugin.settings.modelId;
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
    newChatBtn.onclick = () => {
      if (this.runtime.session.isGenerating.get()) {
        new Notice("Please stop generation first.");
        return;
      }
      this.runtime.session.clearHistory();
      new Notice("Started new conversation.");
    };

    // HISTORY (Placeholder/Info)
    const historyBtn = actionsDiv.createEl('button', { cls: 'toolbar-btn' });
    historyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>`;
    historyBtn.title = "History Info";
    historyBtn.onclick = () => {
      const count = this.runtime.session.messages.get()?.length || 0;
      new Notice(`Current session has ${count} messages.`);
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
  }





  renderInput(container: HTMLElement) {

    const inputWrapper = container.createDiv("chat-input-wrapper");
    const inputContainer = inputWrapper.createDiv("chat-input-container");

    // Icons Overlay
    const overlay = inputContainer.createDiv('chat-features-overlay');
    // ... (Use same icons as before or simplify)

    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'chat-input',
      attr: { rows: '1' }
    });

    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = `${this.inputEl.scrollHeight}px`;
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.onSendMessage();
        this.inputEl.style.height = 'auto';
      }
    });

    const sendButton = inputContainer.createEl('button', { cls: 'chat-send-button' });

    // Subscribe to generating state to update button
    this.runtime.session.isGenerating.subscribe((isGen) => {
      if (isGen) {
        sendButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>';
        sendButton.title = "Stop Generating";
      } else {
        sendButton.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        sendButton.title = "Send Message";
      }
    });

    sendButton.addEventListener('click', () => {
      // TODO: Handle stop interaction
      if (this.runtime.session.isGenerating.get()) {
        // No easy way to abort via SessionManager yet without exposing AbortController
        // For now, we just don't support explicit stop in UI phase 1 unless we add abort to SessionManager
        new Notice("Stopping not fully implemented in Phase 1 runtime.");
      } else {
        this.onSendMessage();
      }
    });
  }

  subscribeToStore() {
    // Subscribe to messages
    const unsubMsgs = this.runtime.session.messages.subscribe((msgs) => {
      this.renderMessages(msgs);
    });
    // this.register(() => unsubMsgs()); // If ItemView had register cleanup, but it doesn't really for this

    // We should unsubscribe on close.
    (this as any)._unsubMsgs = unsubMsgs;

    // Subscribe to telemetry/bus for "Thinking"
    // Actually, SessionManager updates the message with 'thinkingText' in types if we added it,
    // OR we listen to bus.

    // Status Chip Updates (Ephemeral)
    this.runtime.bus.on('agent:status:update', (status: string) => {
      this.updateLastMessageStatus(status);
    });

    // Also listen to generating state to clear status
    this.runtime.session.isGenerating.subscribe((isGen) => {
      if (!isGen) {
        this.updateLastMessageStatus(null); // Clear status on finish
      } else {
        this.updateLastMessageStatus("Working...");
      }
    });
  }

  updateLastMessageStatus(status: string | null) {
    if (!this.messageContainer) return;
    const lastBlock = this.messageContainer.lastElementChild as HTMLElement;
    if (lastBlock && lastBlock.classList.contains('chat-message-block') && lastBlock.dataset.role === 'model') {
      this.messageRenderer.updateStatus(lastBlock, status);
    }
  }


  renderMessages(messages: ChatMessage[]) {
    if (!this.messageRenderer) return;

    // Handle empty state
    if (messages.length === 0) {
      this.messageContainer.empty();
      this.messageRenderer.renderAIMessage({
        role: 'model',
        parts: [{ text: 'Greetings. I am Mastermind. Ready.' }]
      } as ChatMessage, this.plugin.settings.profilePictureAI);
      return;
    }

    // Naive Diffing:
    // If we have more messages than DOM nodes, append.
    // If same number, update the last one (assuming it's the only one changing during streaming).
    const domMessages = this.messageContainer.querySelectorAll('.chat-message-block');
    const domCount = domMessages.length;

    // If completely new chat (or clear), reset
    if (domCount === 0 && messages.length > 0) {
      this.messageContainer.empty();
      messages.forEach(msg => this.appendMessage(msg));
    } else if (messages.length > domCount) {
      // Append new messages
      for (let i = domCount; i < messages.length; i++) {
        this.appendMessage(messages[i], i === messages.length - 1 && this.runtime.session.isGenerating.get());
      }
    } else if (messages.length === domCount) {

      // Update the last message only (Streaming case)
      const lastMsgIndex = messages.length - 1;
      const lastMsg = messages[lastMsgIndex];
      const lastDom = domMessages[domCount - 1] as HTMLElement;

      this.messageRenderer.updateMessage(lastDom, lastMsg,
        lastMsg.role === 'user' ? this.plugin.settings.profilePictureUser : this.plugin.settings.profilePictureAI
      );

      // Toggle Pulse Animation
      if (this.runtime.session.isGenerating.get()) {
        lastDom.addClass('pending-generation');
      } else {
        lastDom.removeClass('pending-generation');
      }
    }


    // Scroll to bottom logic could be smarter (only if near bottom)
    // For now, keep simple
    // const last = this.messageContainer.lastElementChild;
    // if (last) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  appendMessage(msg: ChatMessage, isPending: boolean = false) {
    let dom: HTMLElement | undefined;
    if (msg.role === 'user') {
      // renderUserMessage returns promise<HTMLElement>
      // We need to handle this async or just let it float?
      // Typescript might complain about void return.
      // Ideally renderUserMessage shouldn't be async if possible, or we await.
      // But appendMessage is sync called.
      // Let's ignore the promise for now or fire-and-forget, but for Pulse we need the DOM.
      // MessageRenderer.renderAIMessage returns Promise<HTMLElement> (contentContainer).
      // We need the parent block.

      this.messageRenderer.renderUserMessage(msg, this.plugin.settings.profilePictureUser);
    } else {
      this.messageRenderer.renderAIMessage(msg, this.plugin.settings.profilePictureAI).then(content => {
        if (isPending && content.parentElement) {
          content.parentElement.addClass('pending-generation');
        }
      });
    }
  }



  async onSendMessage() {
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';

    // Call Runtime
    await this.runtime.session.sendMessage(text);
  }

  async onClose() {
    if ((this as any)._unsubMsgs) {
      (this as any)._unsubMsgs();
    }
  }
}
