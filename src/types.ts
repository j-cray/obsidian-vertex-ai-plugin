export interface ToolAction {
  tool: string;
  input: any;
  output: any;
  status: 'success' | 'error';
}

export interface ChatResponse {
  text: string;
  actions: ToolAction[];
  usage?: { input: number; output: number };
}
