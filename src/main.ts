import { Plugin, App, PluginSettingTab, Setting } from 'obsidian';
import { MastermindChatView, VIEW_TYPE_MASTERMIND } from './views/ChatView';

interface MastermindSettings {
  serviceAccountJson: string;
  location: string;
  modelId: string;
  history: any[];
}

const DEFAULT_SETTINGS: MastermindSettings = {
  serviceAccountJson: '',
  location: 'us-central1',
  modelId: 'gemini-1.5-pro-preview-0409',
  history: []
}

export default class MastermindPlugin extends Plugin {
  settings!: MastermindSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_MASTERMIND,
      (leaf) => new MastermindChatView(leaf, this)
    );

    this.addRibbonIcon('brain-circuit', 'Mastermind AI', () => {
      this.activateView();
    });

    this.addSettingTab(new MastermindSettingTab(this.app, this));

    this.addCommand({
      id: 'chat-active-note',
      name: 'Chat with Active Note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          if (!checking) {
            this.activateView();
            // Send a hidden signal or just open chat. Ideally we'd trigger a message.
            // For now, we just open the view.
          }
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: 'explain-selection',
      name: 'Explain Selection',
      editorCallback: async (editor, view) => {
        const selection = editor.getSelection();
        if (selection) {
          await this.activateView();
          // We need a way to pass this message to the view
          const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MASTERMIND);
          if (leaves.length > 0) {
            const view = leaves[0].view as MastermindChatView;
            if (view) {
              // Manually set input and trigger send
              view.inputEl.value = `Explain this:\n> ${selection}`;
              view.handleSendMessage();
            }
          }
        }
      }
    });
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_MASTERMIND)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({
          type: VIEW_TYPE_MASTERMIND,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class MastermindSettingTab extends PluginSettingTab {
  plugin: MastermindPlugin;

  constructor(app: App, plugin: MastermindPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl('h2', { text: 'Vertex AI Settings' });

    new Setting(containerEl)
      .setName('Service Account JSON')
      .setDesc('Paste the full content of your Google Cloud Service Account JSON key file.')
      .addTextArea(text => text
        .setPlaceholder('{"type": "service_account", ...}')
        .setValue(this.plugin.settings.serviceAccountJson)
        .onChange(async (value) => {
          this.plugin.settings.serviceAccountJson = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Location')
      .setDesc('Vertex AI Location (e.g., us-central1)')
      .addText(text => text
        .setPlaceholder('us-central1')
        .setValue(this.plugin.settings.location)
        .onChange(async (value) => {
          this.plugin.settings.location = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Model ID')
      .setDesc('Vertex AI Model ID')
      .addText(text => text
        .setPlaceholder('gemini-1.5-pro-preview-0409')
        .setValue(this.plugin.settings.modelId)
        .onChange(async (value) => {
          this.plugin.settings.modelId = value;
          await this.plugin.saveSettings();
        }));
  }
}
