import { App, MarkdownRenderer, Component, setIcon } from 'obsidian';
import { ToolAction } from '../types';

export class MessageRenderer {
  app: App;
  container: HTMLElement;

  constructor(app: App, container: HTMLElement) {
    this.app = app;
    this.container = container;
  }

  renderTo(container: HTMLElement) {
    this.container = container; // Allow rebinding
  }

  async renderUserMessage(text: string, avatarUrl: string) {
    const msgBlock = this.container.createDiv('chat-message-block message-block-user');
    const avatar = msgBlock.createEl('img', { cls: 'chat-avatar', attr: { src: avatarUrl } });
    const msgEl = msgBlock.createDiv('chat-message message-user');
    msgEl.innerText = text;
    this.scrollBottom();
    return msgEl;
  }

  async renderAIMessage(text: string, avatarUrl: string, actions: ToolAction[] = []) {
    const msgBlock = this.container.createDiv('chat-message-block message-block-ai');
    const avatar = msgBlock.createEl('img', { cls: 'chat-avatar', attr: { src: avatarUrl } });
    const contentContainer = msgBlock.createDiv('chat-message-content message-ai');

    // Render Actions First
    if (actions && actions.length > 0) {
      await this.renderToolActions(contentContainer, actions);
    }

    // Render Text
    if (text) {
      const msgEl = contentContainer.createDiv('chat-text-content');
      const component = new Component();
      component.load();
      await MarkdownRenderer.render(this.app, text, msgEl, '', component);
    }

    this.scrollBottom();
    return contentContainer;
  }

  startAIMessage(avatarUrl: string) {
    const msgBlock = this.container.createDiv('chat-message-block message-block-ai');
    const avatar = msgBlock.createEl('img', { cls: 'chat-avatar', attr: { src: avatarUrl } });
    const contentContainer = msgBlock.createDiv('chat-message-content message-ai');

    // 1. Tool Actions Container
    const toolContainer = contentContainer.createDiv('chat-tool-actions');

    // 2. Thinking Container (Card Style)
    const thinkingContainer = contentContainer.createDiv('thinking-container');
    thinkingContainer.style.display = 'none';

    // Header with Icon & Text
    const thinkingHeader = thinkingContainer.createDiv('thinking-header');
    setIcon(thinkingHeader.createSpan('thinking-icon'), 'brain-circuit');
    thinkingHeader.createSpan().innerText = 'Thinking Process';

    // Dots Animation (Visible when thinking, hidden when text arrives?)
    const dotsContainer = thinkingContainer.createDiv('thinking-dots');
    dotsContainer.innerHTML = '<div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>';

    // Actual Content (Hidden by default or collateral?)
    const thinkingContent = thinkingContainer.createDiv('thinking-content');
    thinkingContent.style.display = 'none'; // Only show if we have text to show

    // 3. Response Text Container
    const textContainer = contentContainer.createDiv('chat-text-content');

    let currentText = '';
    let lastRenderTime = 0;

    // Debounce Loop for Markdown Rendering
    const update = async (response: import('../types').ChatResponse, isFinal: boolean = false) => {
      // 1. Tools
      if (response.actions && response.actions.length > 0) {
        toolContainer.empty();
        await this.renderToolActions(toolContainer, response.actions);
      }

      // 2. Thinking
      if (response.isThinking || response.thinkingText) {
        thinkingContainer.style.display = 'block';

        // If we have text, show it. If purely "isThinking" signals but no text, show dots.
        if (response.thinkingText && response.thinkingText.trim()) {
          thinkingContent.style.display = 'block';
          thinkingContent.innerText = response.thinkingText;
          dotsContainer.style.display = 'none'; // Hide dots if showing text trace? Or keep both?
          // User "awful" comment suggests they want to see it or NOT see it cleanly.
          // Let's keep dots for "active" state but text is useful history.
        } else if (response.isThinking) {
          dotsContainer.style.display = 'flex';
        }

        if (!response.isThinking && response.thinkingText) {
          // Finished thinking
          dotsContainer.style.display = 'none';
          thinkingContainer.addClass('thinking-code-block'); // Collapsed style?
        }
      }

      // 3. Text (Debounced Markdown for "Typewriter" feel)
      if (response.text && response.text !== currentText) {
        const now = Date.now();
        // Render if final OR > 50ms since last render (Smoother typewriter)
        if (isFinal || (now - lastRenderTime > 50)) {
          // Create a temp element for the Markdown render
          const tempContainer = createDiv();
          const component = new Component();
          component.load();
          await MarkdownRenderer.render(this.app, response.text, tempContainer, '', component);

          // Replace content
          textContainer.empty();
          // Move children to avoid full innerHTML thrashing if possible, but empty+append is safer for hydration
          while (tempContainer.firstChild) {
            textContainer.appendChild(tempContainer.firstChild);
          }

          lastRenderTime = now;
          currentText = response.text;
        }
      } else if (!response.text && textContainer.innerText === '') {
        // Ensure empty container doesn't collapse layout if needed
      }

      this.scrollBottom();
    };

    return { container: contentContainer, update };
  }

  async renderToolActions(container: HTMLElement, actions: ToolAction[]) {
    // Ensure container exists (it might be passed from update loop)
    if (!container) return;
    const actionContainer = container.createDiv('chat-tool-actions');

    for (const action of actions) {
      const toolCard = actionContainer.createDiv('tool-action-card');
      if (action.status === 'error') toolCard.addClass('tool-error');

      // Header
      const header = toolCard.createDiv('tool-header');
      const iconSpan = header.createSpan('tool-icon');
      if (action.tool === 'run_terminal_command') {
        setIcon(iconSpan, 'terminal-square');
      } else if (action.tool === 'fetch_url') {
        setIcon(iconSpan, 'link');
      } else if (action.tool === 'google_search_retrieval') { // Internal name for grounding tool often varies
        setIcon(iconSpan, 'globe');
      } else if (action.tool === 'generate_image') {
        setIcon(iconSpan, 'palette');
      } else {
        setIcon(iconSpan, 'wrench'); // Default icon
      }

      const title = header.createSpan('tool-name');
      title.innerText = `Used ${action.tool}`;

      // Details (Collapsible? For now just simple line)
      const details = toolCard.createDiv('tool-details');
      if (action.tool === 'generate_image') {
        // Special handling for image generation display?
        // The image link comes in the 'result' usually or formatted text.
        // Just show input prompt here.
        details.innerText = `Prompt: "${action.input.prompt}"`;
      } else if (action.tool === 'create_note' || action.tool === 'read_file') {
        details.innerText = action.input.path;
      } else if (action.tool === 'search_content') {
        details.innerText = `"${action.input.query}"`;
      } else if (action.tool === 'run_terminal_command') {
        details.createEl('code', { text: action.input.command, cls: 'tool-input-code' });
      } else if (action.tool === 'fetch_url') {
        details.innerText = action.input.url;
      } else {
        details.innerText = JSON.stringify(action.input);
      }
    }
  }

  renderThinking(container: HTMLElement) {
    const thinkingContainer = container.createDiv('thinking-container');
    thinkingContainer.innerHTML = '<div class="thinking-dots"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>';
    this.scrollBottom();
    return thinkingContainer;
  }

  private scrollBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }
}
