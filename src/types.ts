export interface ToolAction {
  tool: string;
  input: any;
  output?: any;
  status: 'success' | 'error' | 'pending';
}

export interface ChatResponse {
  text: string;
  actions: ToolAction[];
  isThinking?: boolean; // True if currently generating thought process
  thinkingText?: string; // The content of the thinking block
  usage?: { input: number; output: number };
  acceptedModelId?: string; // The actual model used (e.g. for Auto mode)
}

export interface ChatMessage {
  role: string;
  parts: { text: string }[];
  actions?: ToolAction[];
  thinking?: string;
  model?: string;
}

export interface Subagent {
  id: string;
  name: string;
  systemPrompt: string;
  triggers: string[]; // Keywords to activate this subagent
  preferredModel?: string; // Optional override
}


