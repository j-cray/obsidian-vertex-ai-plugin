import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal } from 'obsidian';
import MastermindPlugin from '../main';
import { MessageRenderer } from './MessageRenderer';
import { AgentRuntime } from '../runtime/Runtime';
import { ChatMessage, ChatAttachment } from '../types';
import { HistoryModal } from './HistoryModal';


export const VIEW_TYPE_MASTERMIND = 'mastermind-chat-view';

export class MastermindChatView extends ItemView {
  plugin: MastermindPlugin;
  runtime: AgentRuntime;
  messageRenderer!: MessageRenderer;
  messageContainer!: HTMLElement;
  inputEl!: HTMLTextAreaElement;
  toolbarEl!: HTMLElement;
  modelLabel!: HTMLElement;

  // Staged attachments
  attachments: ChatAttachment[] = [];
  chipsContainer!: HTMLElement;



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
    historyBtn.title = "Conversation History";
    historyBtn.onclick = () => {
      new HistoryModal(this.app, this.plugin).open();
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

    // Chips Container (Staging Area)
    this.chipsContainer = inputWrapper.createDiv('chat-attachment-chips');
    this.chipsContainer.style.display = 'none';

    const inputContainer = inputWrapper.createDiv("chat-input-container");

    // --- LEFT FEATURES MENU ---
    const featuresContainer = inputContainer.createDiv('chat-features-menu');

    // The main "+" Toggle Button
    const plusBtn = featuresContainer.createEl('button', { cls: 'chat-plus-button' });
    plusBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    plusBtn.title = "Add Attachment";

    // The Pop-up Menu (Hidden by default)
    const menuPopup = featuresContainer.createDiv('chat-plus-popup');
    menuPopup.style.display = 'none';

    const createMenuItem = (icon: string, title: string, onClick: () => void) => {
      const btn = menuPopup.createEl('button', { cls: 'chat-plus-menu-item' });
      btn.innerHTML = icon; // Expecting SVG string
      btn.title = title;
      btn.onclick = (e) => {
        e.stopPropagation();
        menuPopup.style.display = 'none'; // Close on select
        plusBtn.removeClass('active');
        onClick();
      };
      return btn;
    };

    // 1. File Upload
    createMenuItem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
      "Attach File",
      () => this.triggerFileSelect('all')
    );

    // 2. Image Upload
    createMenuItem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
      "Upload Image",
      () => this.triggerFileSelect('image')
    );

    // 3. Camera
    createMenuItem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
      "Take Photo",
      () => this.handleCamera()
    );

    // 4. Voice
    createMenuItem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
      "Voice Input",
      () => this.handleVoice()
    );

    // Toggle Menu
    plusBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = menuPopup.style.display !== 'none';
      menuPopup.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) plusBtn.addClass('active');
      else plusBtn.removeClass('active');
    };

    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (menuPopup.style.display === 'flex') {
        menuPopup.style.display = 'none';
        plusBtn.removeClass('active');
      }
    });

    // --- INPUT FIELD ---
    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'chat-input',
      attr: { rows: '1', placeholder: 'Ask Mastermind...' }
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

    // --- RIGHT SEND BUTTON ---
    const sendButton = inputContainer.createEl('button', { cls: 'chat-send-button' });

    // Subscribe to generating state to update button
    this.runtime.session.isGenerating.subscribe((isGen) => {
      if (isGen) {
        // Red Square for Stop
        sendButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stop-icon"><rect x="6" y="6" width="12" height="12"></rect></svg>';
        sendButton.title = "Stop Generating";
        sendButton.addClass('is-stop');
      } else {
        // Arrow for Send
        sendButton.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        sendButton.title = "Send Message";
        sendButton.removeClass('is-stop');
      }
    });

    sendButton.addEventListener('click', () => {
      if (this.runtime.session.isGenerating.get()) {
        this.runtime.session.abort();
      } else {
        this.onSendMessage();
      }
    });
  }

  // --- MULTIMODAL HANDLERS ---

  triggerFileSelect(mode: 'image' | 'all') {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (mode === 'image') input.accept = 'image/*';

    input.onchange = async () => {
      if (input.files) {
        for (let i = 0; i < input.files.length; i++) {
          const file = input.files[i];
          await this.readAndAttach(file);
        }
      }
    };
    input.click();
  }

  async readAndAttach(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const isImage = file.type.startsWith('image/');
        const content = e.target.result.toString();

        if (isImage) {
          this.addAttachment({
            type: 'image',
            data: content, // Base64
            mimeType: file.type,
            name: file.name
          });
        } else {
          // Text file assumption or read as text? FileReader readAsDataURL returns base64
          // For text files we might want readAsText.
          // But checking mime type safely is hard.
          // Re-read as text if not image?
          if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.ts') || file.name.endsWith('.js') || file.name.endsWith('.json')) {
            const textReader = new FileReader();
            textReader.onload = (ev) => {
              if (ev.target?.result) {
                this.addAttachment({
                  type: 'file',
                  data: ev.target.result.toString(),
                  name: file.name,
                  mimeType: file.type
                });
              }
            }
            textReader.readAsText(file);
          } else {
            new Notice(`Skipping binary file: ${file.name}`);
          }
        }
      }
    };

    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
    } else {
      // Trigger text logic above
      reader.readAsDataURL(file); // Just to trigger "onload" but logic inside handles text re-read
    }
  }

  handleCamera() {
    // Create a modal for camera
    // Simple HTML5 video element
    // For now, simpler implementation:
    // Use hidden input with capture="environment" -> mobile friendly
    // On desktop, we need a modal.

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment'; // tries to use camera
    input.onchange = async () => {
      if (input.files && input.files[0]) {
        await this.readAndAttach(input.files[0]);
      }
    }
    input.click();
  }

  handleVoice() {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      new Notice("Voice input not supported in this browser/environment.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    new Notice("Listening...");

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        this.inputEl.value += (this.inputEl.value ? ' ' : '') + transcript;
        // Trigger input event to resize
        this.inputEl.dispatchEvent(new Event('input'));
      }
    };

    recognition.onerror = (event: any) => {
      new Notice("Voice recognition error: " + event.error);
    };

    recognition.start();
  }

  addAttachment(att: ChatAttachment) {
    this.attachments.push(att);
    this.renderChips();
  }

  removeAttachment(index: number) {
    this.attachments.splice(index, 1);
    this.renderChips();
  }

  renderChips() {
    this.chipsContainer.empty();
    if (this.attachments.length === 0) {
      this.chipsContainer.style.display = 'none';
      return;
    }
    this.chipsContainer.style.display = 'flex';

    this.attachments.forEach((att, idx) => {
      const chip = this.chipsContainer.createDiv('attachment-chip');

      let icon = '';
      if (att.type === 'image') icon = '🖼️'; // or svg
      else if (att.type === 'file') icon = '📄';
      else icon = '📎';

      chip.createEl('span', { text: `${icon} ${att.name || 'Attachment'}` });

      const close = chip.createEl('button', { cls: 'chip-close' });
      close.innerHTML = '×';
      close.onclick = () => this.removeAttachment(idx);
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

    // Also listen to generating state to clear status and animation
    this.runtime.session.isGenerating.subscribe((isGen) => {
      this.updateGenerationEffects(isGen);
      if (!isGen) {
        this.updateLastMessageStatus(null); // Clear status on finish
      } else {
        this.updateLastMessageStatus("Working...");
      }
    });
  }

  updateGenerationEffects(isGen: boolean) {
    if (!this.messageContainer) return;

    // Update the last message block's animation state
    const lastBlock = this.messageContainer.lastElementChild as HTMLElement;
    if (lastBlock && lastBlock.classList.contains('chat-message-block') && lastBlock.dataset.role === 'model') {
      if (isGen) {
        lastBlock.addClass('pending-generation');
      } else {
        lastBlock.removeClass('pending-generation');
      }
    }

    // Update send button state (already handled in renderInput but good to be centralized if refactored)
    // The send button subscription is separate in renderInput.
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
      } as ChatMessage, this.plugin.settings.profilePictureAI).then(el => {
        if (el.parentElement) el.parentElement.addClass('empty-state-greeting');
      });
      return;
    }


    // Naive Diffing:
    // If we have more messages than DOM nodes, append.
    // If same number, update the last one (assuming it's the only one changing during streaming).
    const domMessages = this.messageContainer.querySelectorAll('.chat-message-block');
    let domCount = domMessages.length;

    // Check if the only message is the empty state greeting, if so treat as empty
    if (domCount === 1 && domMessages[0].classList.contains('empty-state-greeting')) {
      this.messageContainer.empty(); // Clear greeting
      domCount = 0;
    }

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
    await this.runtime.session.sendMessage(text, this.attachments);

    // Clear Attachments
    this.attachments = [];
    this.renderChips();
  }

  async onClose() {
    if ((this as any)._unsubMsgs) {
      (this as any)._unsubMsgs();
    }
  }
}
