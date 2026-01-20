import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  DropdownComponent,
} from "obsidian";
import { MastermindChatView, VIEW_TYPE_MASTERMIND } from "./views/ChatView";
import { VertexService } from "./services/vertex";

interface MastermindSettings {
  // Authentication
  authProvider: 'vertex' | 'aistudio';
  serviceAccountJson: string;
  aiStudioKey: string;
  location: string;
  modelId: string;
  history: any[];
  // Permissions
  permVaultRead: boolean;
  permVaultWrite: boolean;
  permVaultDelete: boolean;
  permWeb: boolean;
  permTerminal: boolean;
  // Destructive Confirmations
  confirmVaultDestructive: boolean;
  confirmTerminalDestructive: boolean;
  // Appearance
  profilePictureUser: string;
  profilePictureAI: string;
  customContextPrompt: string;
  defaultModel: string;
  availableModels: string[];
  // Generation Params
  maxOutputTokens: number;
  temperature: number;
}

const DEFAULT_SETTINGS: MastermindSettings = {
  authProvider: 'vertex',
  serviceAccountJson: '',
  aiStudioKey: '',
  location: 'us-central1',
  modelId: 'gemini-2.0-flash-exp',
  history: [],
  permVaultRead: true,
  permVaultWrite: true,
  permVaultDelete: false,
  permWeb: true,
  permTerminal: false,
  confirmVaultDestructive: true,
  confirmTerminalDestructive: true,
  profilePictureUser: 'https://api.dicebear.com/7.x/notionists/svg?seed=User',
  profilePictureAI: 'https://api.dicebear.com/7.x/bottts/svg?seed=Mastermind',
  customContextPrompt: '',
  defaultModel: 'gemini-2.0-flash-exp',
  availableModels: [],
  maxOutputTokens: 8192,
  temperature: 0.7
}

export default class MastermindPlugin extends Plugin {
  settings!: MastermindSettings;
  private settingsCallbacks: (() => void)[] = [];

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_MASTERMIND,
      (leaf) => new MastermindChatView(leaf, this),
    );

    this.addRibbonIcon("brain-circuit", "Mastermind AI", () => {
      this.activateView();
    });

    this.addSettingTab(new MastermindSettingTab(this.app, this));

    this.addCommand({
      id: "chat-active-note",
      name: "Chat with Active Note",
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
      },
    });

    this.addCommand({
      id: "explain-selection",
      name: "Explain Selection",
      editorCallback: async (editor, view) => {
        const selection = editor.getSelection();
        if (selection) {
          await this.activateView();
          // We need a way to pass this message to the view
          const leaves =
            this.app.workspace.getLeavesOfType(VIEW_TYPE_MASTERMIND);
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
      },
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

    const canListModels =
      this.settings.availableModels.length === 0 &&
      ((this.settings.authProvider === "vertex" &&
        !!this.settings.serviceAccountJson) ||
        (this.settings.authProvider === "aistudio" &&
          !!this.settings.aiStudioKey));

    if (canListModels) {
      // Run in background to not block startup
      setTimeout(async () => {
        const vertex = new VertexService(this.settings);
        try {
          const models = await vertex.listModels();
          if (models.length > 0) {
            this.settings.availableModels = models;
            if (!models.includes(this.settings.modelId)) {
              this.settings.modelId = models[0];
            }
            await this.saveSettings();
            const providerLabel =
              this.settings.authProvider === "aistudio"
                ? "AI Studio"
                : "Vertex AI";
            new Notice(
              `Mastermind: Auto-fetched ${models.length} ${providerLabel} models.`,
            );
          }
        } catch (e) {
          console.log("Mastermind: Auto-fetch failed silently.");
        }
      }, 2000);
    } else if (this.settings.availableModels.length === 0) {
      const fallback = VertexService.getFallbackModelsFor(
        this.settings.authProvider ?? "vertex",
      );
      this.settings.availableModels = fallback;
      if (!fallback.includes(this.settings.modelId) && fallback.length > 0) {
        this.settings.modelId = fallback[0];
      }
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.notifySettingsChanged();
  }

  onSettingsChange(callback: () => void) {
    this.settingsCallbacks.push(callback);
  }

  notifySettingsChanged() {
    this.settingsCallbacks.forEach(cb => cb());
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

  async display(): Promise<void> {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Mastermind Settings' });

    // ===== AUTHENTICATION =====
    containerEl.createEl('h3', { text: 'Authentication' });

    new Setting(containerEl)
      .setName('Authentication Provider')
      .setDesc('Choose between Vertex AI (GCP Service Account) or AI Studio (API Key).')
      .addDropdown(dropdown => dropdown
        .addOption('vertex', 'Vertex AI (GCP)')
        .addOption('aistudio', 'AI Studio (API Key)')
        .setValue(this.plugin.settings.authProvider)
        .onChange(async (value: string) => {
          this.plugin.settings.authProvider = value as 'vertex' | 'aistudio';
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide relevant fields
        }));

    if (this.plugin.settings.authProvider === 'vertex') {
      // Auto-fetch models if credentials exist
      if (this.plugin.settings.serviceAccountJson && this.plugin.settings.availableModels.length === 0) {
        const vertex = new VertexService(this.plugin.settings);
        try {
          const models = await vertex.listModels();
          if (models.length > 0) {
            this.plugin.settings.availableModels = models;
          }
        } catch (e) {
          console.error('Mastermind: Display auto-fetch failed', e);
        }
      }

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
        'Global': ['global'],
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
    } else {
      new Setting(containerEl)
        .setName('AI Studio API Key')
        .setDesc('Enter your Google AI Studio API key.')
        .addText(text => text
          .setPlaceholder('AIza...')
          .setValue(this.plugin.settings.aiStudioKey)
          .onChange(async (value) => {
            this.plugin.settings.aiStudioKey = value;
            await this.plugin.saveSettings();
          }));
    }

    // ===== MODEL SELECTION =====
    containerEl.createEl('h3', { text: 'Model Selection' });

    new Setting(containerEl)
      .setName('Gemini Model')
      .setDesc('Select a supported Gemini model.')
      .addDropdown(dropdown => {
        const options = this.plugin.settings.availableModels.length > 0
          ? this.plugin.settings.availableModels
          : [this.plugin.settings.modelId, 'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'];

        const uniqueOptions = [...new Set(options)];
        uniqueOptions.forEach(m => dropdown.addOption(m, m));

        dropdown.setValue(this.plugin.settings.modelId);
        dropdown.onChange(async (value) => {
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
            const btnEl = btn.extraSettingsEl;
            btnEl.addClass('is-loading');
            new Notice('Fetching models...');

            const models = await vertex.listModels();
            if (models.length > 0) {
              const dd = this.modelDropdown;
              // @ts-ignore
              dd.selectEl.innerHTML = '';
              models.forEach(m => dd.addOption(m, m));
              dd.setValue(models[0]);

              this.plugin.settings.modelId = models[0];
              this.plugin.settings.availableModels = models;
              await this.plugin.saveSettings();
              new Notice(`Fetched ${models.length} models.`);
            } else {
              new Notice('No additional models found.');
            }
          } catch (e) {
            new Notice('Failed to fetch models.');
            console.error('Fetch error:', e);
          }
        }));

    containerEl.createEl('h3', { text: 'Generation Parameters' });

    new Setting(containerEl)
      .setName('Max Output Tokens')
      .setDesc('Maximum number of tokens to generate (e.g., 8192).')
      .addText(text => text
        .setValue(String(this.plugin.settings.maxOutputTokens))
        .onChange(async (value) => {
          const numeric = parseInt(value);
          if (!isNaN(numeric)) {
            this.plugin.settings.maxOutputTokens = numeric;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('Creativity (0.0 - 2.0). Higher values = more creative.')
      .addSlider(slider => slider
        .setLimits(0.0, 2.0, 0.1)
        .setValue(this.plugin.settings.temperature)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.temperature = value;
          await this.plugin.saveSettings();
        }));

    // ===== TOOL PERMISSIONS =====
    containerEl.createEl('h3', { text: 'Tool Permissions' });

    new Setting(containerEl)
      .setName('Vault Read Access')
      .setDesc('Allow AI to read files, search vault, list directories.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.permVaultRead)
        .onChange(async (value) => {
          this.plugin.settings.permVaultRead = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Vault Write Access')
      .setDesc('Allow AI to create notes, update sections, append content.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.permVaultWrite)
        .onChange(async (value) => {
          this.plugin.settings.permVaultWrite = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Vault Delete Access')
      .setDesc('Allow AI to delete files and folders.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.permVaultDelete)
        .onChange(async (value) => {
          this.plugin.settings.permVaultDelete = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Web Access')
      .setDesc('Allow AI to fetch URLs from the internet.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.permWeb)
        .onChange(async (value) => {
          this.plugin.settings.permWeb = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Terminal Access')
      .setDesc('Allow AI to run shell commands on your system.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.permTerminal)
        .onChange(async (value) => {
          this.plugin.settings.permTerminal = value;
          await this.plugin.saveSettings();
        }));

    // ===== DESTRUCTIVE CONFIRMATIONS =====
    containerEl.createEl('h3', { text: 'Safety Confirmations' });

    new Setting(containerEl)
      .setName('Confirm Vault Deletions')
      .setDesc('Ask before AI deletes files in your vault.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.confirmVaultDestructive)
        .onChange(async (value) => {
          this.plugin.settings.confirmVaultDestructive = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Confirm Terminal Commands')
      .setDesc('Ask before AI runs potentially destructive shell commands.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.confirmTerminalDestructive)
        .onChange(async (value) => {
          this.plugin.settings.confirmTerminalDestructive = value;
          await this.plugin.saveSettings();
        }));

    // ===== APPEARANCE =====
    containerEl.createEl('h3', { text: 'Appearance & Behavior' });

    new Setting(containerEl)
      .setName("Vault Read Access")
      .setDesc("Allow AI to read files, search vault, list directories.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.permVaultRead)
          .onChange(async (value) => {
            this.plugin.settings.permVaultRead = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Vault Write Access")
      .setDesc("Allow AI to create notes, update sections, append content.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.permVaultWrite)
          .onChange(async (value) => {
            this.plugin.settings.permVaultWrite = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Custom Context Prompt')
      .setDesc('Additional instructions for the AI (e.g., "Be concise").')
      .addTextArea(text => text
        .setPlaceholder('You are an expert coder...')
        .setValue(this.plugin.settings.customContextPrompt)
        .onChange(async (value) => {
          this.plugin.settings.customContextPrompt = value;
          await this.plugin.saveSettings();
        }));
  }

}
