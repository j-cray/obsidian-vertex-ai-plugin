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

    // Typewriter State
    let fullTextToRender = '';
    let fullThinkingText = '';
    let displayedTextLength = 0;
    let isRendering = false;
    let typeWriterInterval: any = null;

    // Smoother Typewriter Logic
    const processTypewriterQueue = async () => {
      if (isRendering) return;
      isRendering = true;

      // Calculate how many chars we need to add
      const targetLength = fullTextToRender.length;

      if (displayedTextLength < targetLength) {
        // Determine chunk size based on backlog to catch up if behind
        const backlog = targetLength - displayedTextLength;
        // Faster if backlog is huge, slower if small (1-3 chars)
        const charsToAdd = backlog > 50 ? 5 : (backlog > 20 ? 2 : 1);

        const nextChunk = fullTextToRender.substring(displayedTextLength, displayedTextLength + charsToAdd);
        displayedTextLength += charsToAdd;

        // Append text mostly raw, creating span for animation if needed, or just markdown render the WHOLE thing if heavily formatted?
        // MarkdownRenderer on partial text is risky (breaks formatting).
        // HYBRID APPROACH:
        // 1. Render FULL Markdown to a hidden div.
        // 2. Reveal it? No, that doesn't typewrite.
        // 3. Simple approach: specific debounce for Markdown, BUT smooth scroll for text.
        // The user wants "one letter at a time".
        // Markdown rendering is expensive. We can't re-render MD on every letter.
        // compromise: Render Markdown frequently (debounce 50ms), but internally use CSS to reveal? Complex.

        // REVISED APPROACH per User Request:
        // "comes in big chunks not one letter at a time".
        // The issue is likely `vertex.ts` yielding explicitly large chunks.
        // But here we can cheat. We can display *plaintext* typewriter for the "tip" of the stream?
        // No, switching between plaintext and markdown causes layout shift.

        // Let's stick to the 50ms debounce BUT ensure we don't hold back data.
        // Actually, if the user sees big chunks, it means the NETWORK is sending big chunks.
        // I will implement a visual smoother:
        // When new text arrives, we target it. We update the DOM *gradually*.
        // But invalid markdown (unclosed bold) looks bad.

        // BEST COMPROMISE:
        // Just render it. If it's chunky, it's chunky.
        // BUT, for "Thinking", it IS plain text. We can definitely typewriter that.
        // For main text, I will lower debounce to 10ms.
      }
      isRendering = false;
    };

    let lastRenderTime = 0;

    const update = async (response: import('../types').ChatResponse, isFinal: boolean = false) => {
      // 1. Tools
      if (response.actions && response.actions.length > 0) {
        toolContainer.empty(); // Simple clear/redraw for tools (usually low freq)
        await this.renderToolActions(toolContainer, response.actions);
      }

      // 2. Thinking - with LIVE TYPEWRITER effect
      if (response.isThinking || (response.thinkingText && response.thinkingText.length > 0)) {
        thinkingContainer.style.display = 'block';

        if (response.thinkingText && response.thinkingText.length > 0) {
          thinkingContent.style.display = 'block';
          dotsContainer.style.display = 'none';

          // LIVE TYPEWRITER: Queue-based character reveal
          const targetText = response.thinkingText;
          const currentDisplayed = thinkingContent.innerText.length;

          if (targetText.length > currentDisplayed) {
            // Start typewriter interval if not already running
            if (!typeWriterInterval) {
              typeWriterInterval = setInterval(() => {
                const current = thinkingContent.innerText;
                const target = fullThinkingText;

                if (current.length < target.length) {
                  // Add characters progressively (5 chars per tick for speed)
                  const charsToAdd = Math.min(5, target.length - current.length);
                  thinkingContent.innerText = target.substring(0, current.length + charsToAdd);
                  // Auto-scroll to bottom of thinking container
                  thinkingContent.scrollTop = thinkingContent.scrollHeight;
                } else {
                  // Caught up, clear interval
                  clearInterval(typeWriterInterval);
                  typeWriterInterval = null;
                }
              }, 20); // 20ms = 50 updates/sec, smooth feel
            }
          }

          // Update target text for the interval to chase
          fullThinkingText = targetText;
        } else {
          dotsContainer.style.display = 'flex';
        }

        if (!response.isThinking && response.thinkingText) {
          // Done thinking - ensure all text is displayed
          thinkingContent.innerText = response.thinkingText;
          if (typeWriterInterval) {
            clearInterval(typeWriterInterval);
            typeWriterInterval = null;
          }
          dotsContainer.style.display = 'none';
          thinkingContainer.addClass('thinking-code-block');
        }
      }

      // 3. Text (Debounced Markdown)
      // To fix "big chunks", we minimize debounce time.
      if (response.text && response.text !== fullTextToRender) {
        fullTextToRender = response.text;

        const now = Date.now();
        // Render if final OR > 20ms (Fast updates)
        if (isFinal || (now - lastRenderTime > 20)) {
          const tempContainer = createDiv();
          const component = new Component();
          component.load();
          await MarkdownRenderer.render(this.app, fullTextToRender, tempContainer, '', component);

          textContainer.empty();
          while (tempContainer.firstChild) {
            textContainer.appendChild(tempContainer.firstChild);
          }
          lastRenderTime = now;
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
