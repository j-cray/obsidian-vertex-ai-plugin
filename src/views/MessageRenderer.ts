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

    // 2. Thinking Container
    const thinkingContainer = contentContainer.createDiv('thinking-container');
    thinkingContainer.style.display = 'none';

    // Header with Icon & Text
    const thinkingHeader = thinkingContainer.createDiv('thinking-header');
    setIcon(thinkingHeader.createSpan('thinking-icon'), 'brain-circuit');
    thinkingHeader.createSpan().innerText = 'Thinking Process';

    // Dots Animation (shown while waiting)
    const dotsContainer = thinkingContainer.createDiv('thinking-dots');
    dotsContainer.innerHTML = '<div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>';
    dotsContainer.style.display = 'none';

    // Thinking Content (with scrollable limit)
    const thinkingContent = thinkingContainer.createDiv('thinking-content');
    thinkingContent.style.display = 'none';
    thinkingContent.style.maxHeight = '200px';
    thinkingContent.style.overflowY = 'auto';

    // 3. Response Text Container
    const textContainer = contentContainer.createDiv('chat-text-content');

    // State management for smooth animations
    let fullTextToRender = '';
    let fullThinkingText = '';
    let thinkingTypewriterInterval: any = null;
    let lastThinkingLength = 0;
    let lastTextRenderTime = 0;

    const update = async (response: import('../types').ChatResponse, isFinal: boolean = false) => {
      // 1. Render Tool Actions
      if (response.actions && response.actions.length > 0) {
        toolContainer.empty();
        await this.renderToolActions(toolContainer, response.actions);
      }

      // 2. Handle Thinking Block with Typewriter Effect
      if (response.thinkingText && response.thinkingText.length > 0) {
        thinkingContainer.style.display = 'block';

        // Update target thinking text
        fullThinkingText = response.thinkingText;
        thinkingContent.style.display = 'block';
        dotsContainer.style.display = 'none';

        // Start typewriter for thinking if not already running
        if (!thinkingTypewriterInterval) {
          thinkingTypewriterInterval = setInterval(() => {
            if (lastThinkingLength < fullThinkingText.length) {
              // Add 3-5 chars per frame for smooth but visible progress
              const charsToAdd = Math.min(5, fullThinkingText.length - lastThinkingLength);
              thinkingContent.innerText = fullThinkingText.substring(0, lastThinkingLength + charsToAdd);
              lastThinkingLength += charsToAdd;
              thinkingContent.scrollTop = thinkingContent.scrollHeight; // Auto-scroll
            } else if (isFinal) {
              // Thinking is complete
              clearInterval(thinkingTypewriterInterval);
              thinkingTypewriterInterval = null;
              thinkingContent.innerText = fullThinkingText;
              thinkingContainer.addClass('thinking-code-block');
            }
          }, 15); // ~67 updates/sec, creates smooth flowing effect
        }
      }

      // 3. Handle Response Text with Debounced Markdown Rendering
      if (response.text && response.text !== fullTextToRender) {
        fullTextToRender = response.text;

        // Render markdown with debounce to avoid too many DOM updates
        const now = Date.now();
        if (isFinal || (now - lastTextRenderTime > 100)) {
          const tempContainer = createDiv();
          const component = new Component();
          component.load();
          await MarkdownRenderer.render(this.app, fullTextToRender, tempContainer, '', component);

          textContainer.empty();
          while (tempContainer.firstChild) {
            textContainer.appendChild(tempContainer.firstChild);
          }
          lastTextRenderTime = now;
        }
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
