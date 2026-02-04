export interface ModelDefinition {
  id: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextWindow: number;
  isModern: boolean; // Favored for Auto selection
  provider: 'google' | 'other';
}

export const PRECACHED_MODELS: ModelDefinition[] = [
  // --- GEMINI 3 SERIES (Modern) ---
  {
    id: 'gemini-3-pro',
    maxInputTokens: 2097152,
    maxOutputTokens: 8192,
    contextWindow: 2097152,
    isModern: true,
    provider: 'google'
  },
  {
    id: 'gemini-3-flash',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    contextWindow: 1048576,
    isModern: true,
    provider: 'google'
  },
  {
    id: 'gemini-3-pro-preview',
    maxInputTokens: 2097152,
    maxOutputTokens: 8192,
    contextWindow: 2097152,
    isModern: true,
    provider: 'google'
  },
  {
    id: 'gemini-3-flash-preview',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    contextWindow: 1048576,
    isModern: true,
    provider: 'google'
  },

  // --- GEMINI 2.5 SERIES (Legacy Modern) ---
  {
    id: 'gemini-2.5-pro',
    maxInputTokens: 2097152,
    maxOutputTokens: 8192,
    contextWindow: 2097152,
    isModern: false,
    provider: 'google'
  },
  {
    id: 'gemini-2.5-flash',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    contextWindow: 1048576,
    isModern: false,
    provider: 'google'
  },
  {
    id: 'gemini-2.5-flash-lite',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    contextWindow: 1048576,
    isModern: false,
    provider: 'google'
  },

  // --- GEMINI 2.0 SERIES ---
  {
    id: 'gemini-2.0-flash',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    contextWindow: 1048576,
    isModern: false,
    provider: 'google'
  },
  {
    id: 'gemini-2.0-flash-lite',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    contextWindow: 1048576,
    isModern: false,
    provider: 'google'
  },

  // --- GEMINI 1.5 SERIES (Legacy) ---
  {
    id: 'gemini-1.5-pro',
    maxInputTokens: 2097152,
    maxOutputTokens: 8192,
    contextWindow: 2097152,
    isModern: false,
    provider: 'google'
  },
  {
    id: 'gemini-1.5-flash',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    contextWindow: 1048576,
    isModern: false,
    provider: 'google'
  },

  // --- SPECIALTY ---
  {
    id: 'text-embedding-004',
    maxInputTokens: 2048,
    maxOutputTokens: 0, // Embedding only
    contextWindow: 2048,
    isModern: false,
    provider: 'google'
  }
];

export function getModelDefinition(id: string): ModelDefinition | undefined {
  return PRECACHED_MODELS.find(m => m.id === id);
}
