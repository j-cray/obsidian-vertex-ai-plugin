import { Plugin, App, PluginSettingTab, Setting } from 'obsidian';
import { MastermindChatView, VIEW_TYPE_MASTERMIND } from './views/ChatView';

interface MastermindSettings {
  apiKey: string;
  projectId: string;
  location: string;
  modelId: string;
  history: any[];
}

const DEFAULT_SETTINGS: MastermindSettings = {
  apiKey: '',
  projectId: '',
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
      .setName('API Key')
      .setDesc('Your Google Cloud API Key')
      .addText(text => text
        .setPlaceholder('Enter your API key')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Project ID')
      .setDesc('Your Google Cloud Project ID')
      .addText(text => text
        .setPlaceholder('Enter your project ID')
        .setValue(this.plugin.settings.projectId)
        .onChange(async (value) => {
          this.plugin.settings.projectId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Location')
      .setDesc('Vertex AI Location')
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
