import { AgentRuntime } from '../Runtime';

export interface IAgentTool {
  /** Unique name of the tool (a-z, 0-9, _, -) */
  name: string;

  /** Human readable description for the LLM */
  description: string;

  /** JSON Schema for the tool arguments */
  schema: Record<string, any>;

  /**
   * Execution logic for the tool.
   * @param args Arguments parsed from the LLM JSON
   * @param runtime Access to the agent runtime (vault, session, etc.)
   */
  execute(args: any, runtime: AgentRuntime): Promise<any>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}
