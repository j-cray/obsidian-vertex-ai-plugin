import { App } from 'obsidian';
// We will import these as we create them
// import { ActionBus } from './bus/ActionBus';
// import { TraceLogger } from './telemetry/TraceLogger';
import MastermindPlugin from '../main';
import { ToolRegistry } from './tools/ToolRegistry';
import { SessionManager } from './session/SessionManager';
import { ActionBus } from './bus/ActionBus';
import { TraceLogger } from './telemetry/TraceLogger';
import { VertexService } from '../services/vertex';
import { VaultService } from '../services/vault';
import { VectorStore } from '../services/vector';
import { VaultReader, VaultLister } from '../tools/VaultReader';
import { VaultSearch } from '../tools/VaultSearch';
import { VaultWriter } from '../tools/VaultWriter';




/**
 * The Central Nervous System of the Agent.
 * Replaces the monolithic Main/View logic with a modular Runtime.
 */
export class AgentRuntime {
  private static instance: AgentRuntime;

  public app: App;
  public plugin: MastermindPlugin;

  // Sub-systems
  public tools: ToolRegistry;
  public session: SessionManager;
  public bus: ActionBus;
  public telemetry: TraceLogger;

  // Services
  public vertex: VertexService;
  public vault: VaultService;
  public vector: VectorStore;


  private constructor(plugin: MastermindPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;

    // Initialize subsystems
    this.bus = new ActionBus(this);
    this.telemetry = new TraceLogger(this.bus);
    this.tools = new ToolRegistry(this);
    this.session = new SessionManager(this);

    // Initialize services
    this.vertex = new VertexService(plugin.settings);
    this.vault = new VaultService(plugin.app);
    this.vector = new VectorStore(this);

    // Register Tools
    this.tools.register(new VaultReader(this));
    this.tools.register(new VaultLister(this));
    this.tools.register(new VaultSearch(this));
    this.tools.register(new VaultWriter(this));




    // Listen for settings changes
    this.plugin.onSettingsChange(() => {
      this.vertex.updateSettings(this.plugin.settings);
    });

    console.log('Mastermind: Agent Runtime Initialized');
  }

  public static initialize(plugin: MastermindPlugin): AgentRuntime {
    if (!AgentRuntime.instance) {
      AgentRuntime.instance = new AgentRuntime(plugin);
    }
    return AgentRuntime.instance;
  }

  public static get(): AgentRuntime {
    if (!AgentRuntime.instance) {
      throw new Error("AgentRuntime not initialized");
    }
    return AgentRuntime.instance;
  }
}
