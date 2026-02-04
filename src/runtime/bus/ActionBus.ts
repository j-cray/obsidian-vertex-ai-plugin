import { Events } from 'obsidian';
import { AgentRuntime } from '../Runtime';

/**
 * Event bus for decoupled communication between Agent and UI.
 * Wraps Obsidian's Events class for type safety if needed,
 * or just provides a central hub.
 */
export class ActionBus {
  private events: Events;
  private runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
    this.events = new Events();
  }

  public on(name: string, callback: (...data: any) => any) {
    this.events.on(name, callback);
  }

  public off(name: string, callback: (...data: any) => any) {
    this.events.off(name, callback);
  }

  public trigger(name: string, ...data: any) {
    this.events.trigger(name, ...data);
  }
}
