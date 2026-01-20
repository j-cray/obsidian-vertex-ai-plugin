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
}
