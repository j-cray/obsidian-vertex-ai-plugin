import { IAgentTool, ToolDefinition } from './types';
import { AgentRuntime } from '../Runtime';

export class ToolRegistry {
  private tools: Map<string, IAgentTool> = new Map();
  public runtime: AgentRuntime;


  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  /**
   * Register a new tool. Throws if name already exists.
   */
  public register(tool: IAgentTool) {
    if (this.tools.has(tool.name)) {
      console.warn(`ToolRegistry: Overwriting tool '${tool.name}'`);
    }
    this.tools.set(tool.name, tool);
    console.log(`ToolRegistry: Registered '${tool.name}'`);
  }

  /**
   * Unregister a tool by name.
   */
  public unregister(name: string) {
    this.tools.delete(name);
  }

  /**
   * Get a tool instance.
   */
  public get(name: string): IAgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools.
   */
  public list(): IAgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool exists
   */
  public has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Convert registered tools to Google Vertex/Gemini Tool format.
   */
  public toGeminiTools(): { function_declarations: ToolDefinition[] }[] {
    const declarations: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      declarations.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.schema
      });
    }

    if (declarations.length === 0) return [];

    return [{
      function_declarations: declarations
    }];
  }
}
