import { Writable, writable } from '../store/Store';
import { ActionBus } from '../bus/ActionBus';

export interface TraceEntry {
  id: string;
  timestamp: number;
  type: 'thought' | 'action' | 'result' | 'error' | 'info';
  content: any;
  meta?: any;
}

export class TraceLogger {
  public traces: Writable<TraceEntry[]> = writable([]);
  private bus: ActionBus;
  private maxTraces: number = 100;

  constructor(bus: ActionBus) {
    this.bus = bus;
    this.setupListeners();
  }

  private setupListeners() {
    this.bus.on('agent:thinking', (content) => this.log('thought', content));
    this.bus.on('agent:action:start', (content) => this.log('action', content));
    this.bus.on('agent:action:end', (content) => this.log('result', content));
    this.bus.on('error', (content) => this.log('error', content));
  }

  public log(type: TraceEntry['type'], content: any, meta?: any) {
    const entry: TraceEntry = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      type,
      content,
      meta
    };

    this.traces.update((current: TraceEntry[]) => {
      const next = [...current, entry];
      if (next.length > this.maxTraces) {
        return next.slice(-this.maxTraces);
      }
      return next;
    });

    // Optional: Console log for development
    console.log(`[Trace:${type}]`, content);
  }

  public clear() {
    this.traces.set([]);
  }
}
