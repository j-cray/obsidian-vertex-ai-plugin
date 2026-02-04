import { App, Modal, Setting, Notice, DropdownComponent } from 'obsidian';
import MastermindPlugin from '../main';
import { AgentRuntime } from '../runtime/Runtime';

interface HistoryFile {
  path: string;
  filename: string;
  date: Date;
  keywords: string;
  year: number;
}

export class HistoryModal extends Modal {
  plugin: MastermindPlugin;
  runtime: AgentRuntime;
  files: HistoryFile[] = [];
  selectedYear: number;
  years: number[] = [];

  constructor(app: App, plugin: MastermindPlugin) {
    super(app);
    this.plugin = plugin;
    this.runtime = AgentRuntime.get();
    this.selectedYear = new Date().getFullYear();
  }

  async onOpen() {
    await this.loadHistoryFiles();
    this.render();
  }

  async loadHistoryFiles() {
    try {
      const paths = await this.runtime.vault.listFolder('Mastermind/History');
      this.files = paths
        .filter(p => p.endsWith('.md'))
        .map(p => {
          const filename = p.split('/').pop() || '';
          // Expected: YYYY-MM-DD-HH-mm-keywords.md
          // Parse loosely
          const parts = filename.replace('.md', '').split('-');
          let date = new Date();
          let keywords = 'Unknown';
          let valid = false;

          if (parts.length >= 5) {
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const day = parseInt(parts[2]);
            const hour = parseInt(parts[3]);
            const minute = parseInt(parts[4]);

            if (!isNaN(year) && !isNaN(month)) {
              date = new Date(year, month, day, hour, minute);
              keywords = parts.slice(5).join(' ');
              valid = true;
            }
          }

          if (!valid) {
            // Fallback for non-standard names
            keywords = filename.replace('.md', '');
            // Try to get stat mtime? Or just assume current?
            // For simplicity, skip date parsing if failing
          }

          return {
            path: p,
            filename: filename.replace('.md', ''),
            date: date,
            keywords: keywords || 'Conversation',
            year: date.getFullYear()
          };
        })
        .sort((a, b) => b.date.getTime() - a.date.getTime()); // Newest first

      this.years = [...new Set(this.files.map(f => f.year))].sort((a, b) => b - a);
      if (!this.years.includes(this.selectedYear) && this.years.length > 0) {
        this.selectedYear = this.years[0];
      }

    } catch (e) {
      console.warn('Mastermind: No history folder found or error listing.', e);
      this.files = [];
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mastermind-history-modal');

    contentEl.createEl('h2', { text: 'Conversation History' });

    // Controls
    const controls = contentEl.createDiv('history-controls');

    // Year Dropdown
    const yearContainer = controls.createDiv('year-filter');
    yearContainer.createSpan({ text: 'Year: ' });
    const yearSelect = new DropdownComponent(yearContainer);
    this.years.forEach(y => yearSelect.addOption(y.toString(), y.toString()));
    yearSelect.setValue(this.selectedYear.toString());
    yearSelect.onChange(val => {
      this.selectedYear = parseInt(val);
      this.renderGrid(grid);
    });

    // Grid
    const grid = contentEl.createDiv('history-grid');
    this.renderGrid(grid);
  }

  renderGrid(container: HTMLElement) {
    container.empty();

    const filtered = this.files.filter(f => f.year === this.selectedYear);

    if (filtered.length === 0) {
      container.createDiv({ text: 'No conversations found for this year.', cls: 'no-history' });
      return;
    }

    filtered.forEach(file => {
      const card = container.createDiv('history-card');

      // Date format: Mon, Oct 27
      const dateStr = file.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      card.createDiv({ text: dateStr, cls: 'history-date' });
      card.createDiv({ text: file.keywords, cls: 'history-keywords' });

      card.onclick = async () => {
        this.close();
        await this.restoreSession(file);
      };
    });
  }

  async restoreSession(file: HistoryFile) {
    new Notice(`Restoring: ${file.keywords}...`);
    try {
      const content = await this.runtime.vault.readNote(file.path);
      const messages = await this.runtime.vault.parseHistoryNote(content);
      // @ts-ignore
      this.runtime.session.loadSession(messages, file.filename);
      new Notice('Conversation restored.');
    } catch (e) {
      new Notice('Failed to restore conversation.');
      console.error(e);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
