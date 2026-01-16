import { App, Plugin, PluginSettingTab, Setting, Notice, DropdownComponent } from 'obsidian';
import { MastermindChatView, VIEW_TYPE_MASTERMIND } from './views/ChatView';
import { VertexService } from './services/vertex';

interface MastermindSettings {
  serviceAccountJson: string;
  location: string;
  modelId: string;
  history: any[];
  // Mastermind 2.0
  profilePictureUser: string;
  profilePictureAI: string;
  customContextPrompt: string;
  confirmDestructive: boolean;
  defaultModel: string;
  availableModels: string[]; // Cache fetched models
}

const DEFAULT_SETTINGS: MastermindSettings = {
  serviceAccountJson: '',
  location: 'us-central1',
  modelId: 'gemini-1.5-pro-preview-0409',
  history: [],
  profilePictureUser: 'https://api.dicebear.com/7.x/notionists/svg?seed=User', // Default avatars
  profilePictureAI: 'https://api.dicebear.com/7.x/bottts/svg?seed=Mastermind',
  customContextPrompt: '',
  confirmDestructive: false,
  defaultModel: 'gemini-1.5-pro-preview-0409',
  availableModels: []
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
              // Assuming view.inputEl exists, but we need to check
              if (view.inputEl) {
                view.inputEl.value = `Explain this:\n> ${selection}`;
                view.handleSendMessage();
              }
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
  // @ts-ignore
  private modelDropdown: DropdownComponent;

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

    const locations: Record<string, string[]> = {
      'US': ['us-central1', 'us-east1', 'us-east4', 'us-west1', 'us-west4'],
      'Europe': ['europe-west1', 'europe-west2', 'europe-west3', 'europe-west4', 'europe-north1'],
      'Asia': ['asia-east1', 'asia-northeast1', 'asia-southeast1']
    };

    new Setting(containerEl)
      .setName('Vertex AI Region')
      .setDesc('Select the Google Cloud region for API calls.')
      .addDropdown(dropdown => {
        for (const region in locations) {
          // @ts-ignore
          const locs = locations[region];
          locs.forEach((loc: string) => dropdown.addOption(loc, `${region} - ${loc}`));
        }
        dropdown.setValue(this.plugin.settings.location)
          .onChange(async (value) => {
            this.plugin.settings.location = value;
            await this.plugin.saveSettings();
          });
      });

    // Model Picker with Fetch
    new Setting(containerEl)
      .setName('Gemini Model')
      .setDesc('Select the Vertex AI model to use. Click refresh to fetch from permissions.')
      .addDropdown(dropdown => {
        // Use cached models if available, else just current or default
        const options = this.plugin.settings.availableModels.length > 0
          ? this.plugin.settings.availableModels
          : [this.plugin.settings.modelId, 'gemini-1.5-pro', 'gemini-1.5-flash'];

        // Deduplicate
        const uniqueOptions = [...new Set(options)];

        uniqueOptions.forEach(m => dropdown.addOption(m, m));

        dropdown.setValue(this.plugin.settings.modelId)
          .onChange(async (value) => {
            this.plugin.settings.modelId = value;
            await this.plugin.saveSettings();
          });
        this.modelDropdown = dropdown;
      })
      .addExtraButton(btn => btn
        .setIcon('refresh-cw')
        .setTooltip('Fetch accessible models')
        .onClick(async () => {
          const vertex = new VertexService(this.plugin.settings);
          try {
            new Notice('Fetching models...');
            const models = await vertex.listModels();
            if (models.length > 0) {
              const dd = this.modelDropdown;
              // Clear options
              // @ts-ignore
              dd.selectEl.innerHTML = '';
              models.forEach(m => dd.addOption(m, m));
              dd.setValue(models[0]);

              this.plugin.settings.modelId = models[0];
              this.plugin.settings.availableModels = models;
              await this.plugin.saveSettings();
              new Notice(`Fetched ${models.length} models.`);
            } else {
              new Notice('No Gemini models found. Using defaults.');
              // Fallback
              const defaults = ['gemini-1.5-pro', 'gemini-1.5-flash'];
              this.plugin.settings.availableModels = defaults;
              await this.plugin.saveSettings();
              // @ts-ignore
              const dd = this.modelDropdown;
              // @ts-ignore
              dd.selectEl.innerHTML = '';
              defaults.forEach(m => dd.addOption(m, m));
              dd.setValue(defaults[0]);
            }
          } catch (e) {
            new Notice('Failed to fetch models. Check JSON/Region.');
            console.error(e);
          }
        }));

    new Setting(containerEl)
      .setName('Profile Picture (User)')
      .setDesc('URL for your avatar.')
      .addText(text => text
        .setPlaceholder('https://...')
        .setValue(this.plugin.settings.profilePictureUser)
        .onChange(async (value) => {
          this.plugin.settings.profilePictureUser = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Profile Picture (AI)')
      .setDesc('URL for Mastermind\'s avatar.')
      .addText(text => text
        .setPlaceholder('https://...')
        .setValue(this.plugin.settings.profilePictureAI)
        .onChange(async (value) => {
          this.plugin.settings.profilePictureAI = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Custom Context Prompt')
      .setDesc('Additional instructions for the AI (e.g., "Be concise", "Answer in French").')
      .addTextArea(text => text
        .setPlaceholder('You are an expert coder...')
        .setValue(this.plugin.settings.customContextPrompt)
        .onChange(async (value) => {
          this.plugin.settings.customContextPrompt = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Confirm Destructive Actions')
      .setDesc('If enabled, Mastermind will ask before deleting files. Default is OFF (Maximum Power).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.confirmDestructive)
        .onChange(async (value) => {
          this.plugin.settings.confirmDestructive = value;
          await this.plugin.saveSettings();
        }));
  }
}
