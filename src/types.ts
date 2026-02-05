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
  routingReason?: string; // Explanation for why the model/strategy was chosen
}

export interface ChatAttachment {
  type: 'image' | 'text' | 'file';
  data: string; // Base64 for image, text content for text/file
  mimeType?: string;
  name?: string;
}

export interface ChatMessage {
  role: string;
  parts: { text: string }[];
  actions?: ToolAction[];
  thinking?: string;
  model?: string;
  routingReason?: string;
  attachments?: ChatAttachment[]; // Persisted attachments
}

export interface Subagent {
  id: string;
  name: string;
  systemPrompt: string;
  triggers: string[]; // Keywords to activate this subagent
  preferredModel?: string; // Optional override
}


