import { App, TFile, requestUrl, Notice } from 'obsidian';

export class VertexService {
  private serviceAccountJson!: string;
  private location!: string;
  private modelId!: string;
  private customContextPrompt: string = '';
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private isRefreshingToken: boolean = false;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(settings: { serviceAccountJson: string, location: string, modelId: string, customContextPrompt: string }) {
    this.updateSettings(settings);
  }

  updateSettings(settings: { serviceAccountJson: string, location: string, modelId: string, customContextPrompt: string }) {
    this.serviceAccountJson = settings.serviceAccountJson;
    this.location = settings.location;
    this.modelId = settings.modelId;
    this.customContextPrompt = settings.customContextPrompt;
    this.accessToken = null; // Reset token on settings change
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (this.isRefreshingToken && this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.isRefreshingToken = true;
    this.tokenRefreshPromise = (async () => {
      try {
        if (!this.serviceAccountJson) {
          throw new Error('Service Account JSON not configured.');
        }

        let credentials;
        try {
          credentials = JSON.parse(this.serviceAccountJson);
        } catch (e) {
          throw new Error('Invalid Service Account JSON format.');
        }

        if (!credentials.client_email || !credentials.private_key) {
          throw new Error('Service Account JSON missing client_email or private_key.');
        }

        const token = await this.createSignedJWT(credentials.client_email, credentials.private_key);

        // Exchange JWT for Access Token
        const response = await requestUrl({
          url: 'https://oauth2.googleapis.com/token',
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`
        });

        if (response.status !== 200) {
          throw new Error(`Failed to refresh token: ${response.text}`);
        }

        const data = response.json;
        this.accessToken = data.access_token;
        // Set expiry to slightly less than 3600s to be safe
        this.tokenExpiry = Date.now() + (data.expires_in - 120) * 1000;

        return this.accessToken!;
      } finally {
        this.isRefreshingToken = false;
        this.tokenRefreshPromise = null;
      }
    })();

    return this.tokenRefreshPromise;
  }

  private async createSignedJWT(email: string, privateKeyPem: string): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedClaim = this.base64url(JSON.stringify(claim));
    const unsignedToken = `${encodedHeader}.${encodedClaim}`;

    const signature = await this.sign(unsignedToken, privateKeyPem);
    return `${unsignedToken}.${signature}`;
  }

  private base64url(source: string | ArrayBuffer): string {
    let encodedSource: string;
    if (typeof source === 'string') {
      const bytes = new TextEncoder().encode(source);
      encodedSource = this.arrayBufferToBase64(bytes);
    } else {
      encodedSource = this.arrayBufferToBase64(source);
    }

    return encodedSource.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private async sign(data: string, privateKeyPem: string): Promise<string> {
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const pemContents = privateKeyPem.substring(
      privateKeyPem.indexOf(pemHeader) + pemHeader.length,
      privateKeyPem.indexOf(pemFooter)
    ).replace(/\s/g, '');

    const binaryDerString = window.atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
      binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    const crypto = window.crypto.subtle;
    const key = await crypto.importKey(
      "pkcs8",
      binaryDer.buffer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    const signature = await crypto.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      dataBytes
    );

    return this.base64url(signature);
  }

  private getProjectId(): string {
    try {
      return JSON.parse(this.serviceAccountJson).project_id;
    } catch (e) {
      return '';
    }
  }

  private getBaseUrl(location: string): string {
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${this.getProjectId()}/locations/${location}`;
  }

  async listModels(): Promise<string[]> {
    const accessToken = await this.getAccessToken();
    const projectId = this.getProjectId();

    // Default discovery location to us-central1 if global/undefined, as Model Garden is centralized there
    const discoveryLocation = this.location === 'global' || !this.location ? 'us-central1' : this.location;

    new Notice(`Mastermind: Discovering models... (Project: ${projectId}, Location: ${discoveryLocation})`);

    const FALLBACK_MODELS = [
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-001',
      'gemini-2.0-pro-exp-02-05',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro-002',
      'gemini-1.5-flash-002',
      'gemini-1.0-pro'
    ];

    const foundModels: Set<string> = new Set();

    // Helper: Safe Fetch
    const safeFetch = async (url: string, label: string): Promise<any[]> => {
      try {
        console.log(`Mastermind: Fetching ${label} from ${url}`);
        const response = await requestUrl({
          url,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.status === 200 && response.json.models) {
          return response.json.models;
        } else if (response.status === 200 && response.json.publisherModels) {
          return response.json.publisherModels;
        } else {
          console.warn(`Mastermind: ${label} returned status ${response.status}`);
          return [];
        }
      } catch (error) {
        console.error(`Mastermind: Error fetching ${label}:`, error);
        return [];
      }
    };

    // 1. Fetch Publisher Models (Google / Gemini)
    // Endpoint: https://{LOCATION}-aiplatform.googleapis.com/v1beta1/projects/{PROJECT}/locations/{LOCATION}/publishers/google/models
    // Note: Use v1beta1 for ListPublisherModels as it is more reliable for new models and supported by documentation.
    const publisherUrl = `https://${discoveryLocation}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${discoveryLocation}/publishers/google/models`;
    const publisherModels = await safeFetch(publisherUrl, 'Publisher Models');

    publisherModels.forEach((m: any) => {
      // Filter for relevant models (Gemini, PaLM, Codey) to avoid noise
      const name = m.name.split('/').pop();
      if (name.includes('gemini') || name.includes('bison') || name.includes('unicorn')) {
        foundModels.add(name);
      }
    });

    // 2. Fetch Project Models (Custom / Tuned)
    // Endpoint: https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{LOCATION}/models
    if (projectId) {
      const projectUrl = `https://${discoveryLocation}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${discoveryLocation}/models`;
      const projectModels = await safeFetch(projectUrl, 'Project Models');

      projectModels.forEach((m: any) => {
        const name = m.name.split('/').pop();
        foundModels.add(name); // Add all custom models
      });
    }

    // 3. Fallback / Merge
    if (foundModels.size === 0) {
      new Notice(`Mastermind: No models found via API. Using fallback list.`);
      return FALLBACK_MODELS;
    }

    // Ensure our "known good" models are present if they weren't discovered (e.g. if region is weird)
    // Actually, let's just return what we found, plus the fallbacks if the execution region allows?
    // User preference: Trust the API, but if API returns nothing useful, assume connectivity issue.
    // Let's merge found models with fallback models to ensure the user always has a choice,
    // but put found models first? Or just sort them?
    // Best UX: Show what is definitely available + known fallbacks.

    // Add defaults to the set to ensure they are available selections
    FALLBACK_MODELS.forEach(m => foundModels.add(m));

    const finalList = Array.from(foundModels).sort();
    new Notice(`Mastermind: Discovery complete. Available models: ${finalList.length}`);
    return finalList;
  }



  async chat(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = []): Promise<string> {
    const accessToken = await this.getAccessToken();
    const projectId = JSON.parse(this.serviceAccountJson).project_id;
    const location = this.location || 'us-central1';

    try {
      return await this.chatInternal(prompt, context, vaultService, history, images, accessToken, projectId, location);
    } catch (error: any) {
      // Automatic Fallback to us-central1 for 404 or certain model errors
      if (location !== 'us-central1' && (error.message.includes('404') || error.message.includes('not found'))) {
        console.log(`Mastermind: Chat failed in ${location}, falling back to us-central1...`);
        return await this.chatInternal(prompt, context, vaultService, history, images, accessToken, projectId, 'us-central1');
      }
      throw error;
    }
  }

  private async chatInternal(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = [], accessToken: string, projectId: string, location: string): Promise<string> {

    // Model Selection
    const modelId = this.modelId || 'gemini-2.0-flash-exp';
    const isClaude = modelId.startsWith('claude');
    const isEndpoint = /^\d+$/.test(modelId) || modelId.includes('/endpoints/'); // Numeric ID or full resource path
    const effectiveLocation = location || 'us-central1';

    // 1. CUSTOM ENDPOINT (Mistral, Llama, Fine-tunes deployed in Garden)
    if (isEndpoint) {
      // Support for Resource Path: projects/123/locations/us-central1/endpoints/456...
      // Or simple ID: 1234567890 (assumed in current project/location)
      const endpointResource = modelId.includes('/') ? modelId : `projects/${projectId}/locations/${effectiveLocation}/endpoints/${modelId}`;
      const host = effectiveLocation === 'global' ? 'aiplatform.googleapis.com' : `${effectiveLocation}-aiplatform.googleapis.com`;
      const url = `https://${host}/v1/${endpointResource}:predict`;

      // Standard MaaS Payload (Mistral/Llama usually accept: { instances: [{ prompt: "..." }], parameters: {...} })
      // or OpenAI-compatible format if deployed with vLLM (check documentation).
      // Let's implement the standard Vertex AI "Raw Prediction" or "Predict" format for text generation.
      // Most Model Garden text models expect: { instances: [ { prompt: ... } ], parameters: { maxOutputTokens: ... } }

      const body = {
        instances: [
          {
            prompt: `System: You are Mastermind.\nContext: ${context}\n\nUser: ${prompt}\nAssistant:`,
            // Some models treat "messages" list differently.
            // For broad compatibility with raw endpoints, we construct a single prompt string.
            // Ideally, we'd detect the model type, but for "generic endpoint" support, text completion is safest default.
          }
        ],
        parameters: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          topP: 0.95
        }
      };

      const response = await requestUrl({
        url,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (response.status !== 200) {
        throw new Error(`Endpoint Error ${response.status}: ${response.text}`);
      }

      const data = response.json;
      // Standard Vertex Predict Response: { predictions: [ "text" ] } or { predictions: [ { content: "text" } ] }
      const pred = data.predictions[0];
      if (typeof pred === 'string') return pred;
      if (pred.content) return pred.content;
      return JSON.stringify(pred); // Fallback
    }

    // 2. ANTHROPIC CLAUDE (via Vertex AI)
    if (isClaude) {
      // Claude typically uses `streamRawPredict` or `rawPredict` on a specific endpoint
      // e.g. https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/anthropic/models/claude-3-5-sonnet-v2@20241022:streamRawPredict
      const url = `${this.getBaseUrl(effectiveLocation)}/publishers/anthropic/models/${modelId}:streamRawPredict`;

      // Construct Claude-specific payload
      const messages = history.map(h => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: h.parts[0].text // Simplify: previous parts usually just text
      }));
      // Add current prompt
      messages.push({ role: "user", content: `Context:\n${context}\n\nQuestion: ${prompt}` });

      const body = {
        anthropic_version: "vertex-2023-10-16",
        messages: messages,
        system: `You are Mastermind. ${this.customContextPrompt || ''} Be concise.`,
        max_tokens: 4096,
        stream: false
      };

      const response = await requestUrl({
        url,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(body)
      });

      if (response.status !== 200) {
        throw new Error(`Claude API Error ${response.status}: ${response.text}`);
      }

      // Parse Claude Response (streamRawPredict returns NDJSON-like lines if streamed, but we falsed it?
      // Actually streamRawPredict might return a stream. Let's try `rawPredict` if available, or just parse carefully.)
      // Vertex Claude often returns a JSON list if not streaming.
      // Let's assume standard response for now. If it fails, we fall back.
      const data = response.json;
      // Adjust based on actual shape (often data.content[0].text)
      return data.content ? data.content[0].text : JSON.stringify(data);
    }

    // 2. GOOGLE GEMINI (Default)
    // Use v1beta1 for preview/experimental models (like Gemini 3.0), v1 for stable.
    const isGemini3 = modelId.includes('gemini-3');
    const apiVersion = (isGemini3 || modelId.includes('preview') || modelId.includes('exp') || modelId.includes('beta')) ? 'v1beta1' : 'v1';

    // Gemini 3 Preview is often strictly us-central1 or global. Force us-central1 if user is elsewhere.
    const runLocation = isGemini3 ? 'us-central1' : effectiveLocation;

    const url = `${this.getBaseUrl(runLocation).replace('/v1/', `/${apiVersion}/`)}/publishers/google/models/${modelId}:generateContent`;

    let systemInstructionText = `You are "Mastermind", a highly capable AI assistant for Obsidian.
You have access to the user's notes and knowledge vault.
Be concise, professional, and insightful.
Always use the provided context to answer questions if available.
You can use tools to search, read, list, create, and delete notes/folders in the vault.`;

    if (this.customContextPrompt) {
      systemInstructionText += `\n\nUSER CUSTOM INSTRUCTIONS:\n${this.customContextPrompt}`;
    }

    const tools = [
      {
        function_declarations: [
          {
            name: 'list_files',
            description: 'Lists all markdown files in the vault.',
            parameters: { type: 'object', properties: {} }
          },
          {
            name: 'list_directory',
            description: 'Lists the contents of a specific directory/folder.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'The path of the folder to list.' }
              },
              required: ['path']
            }
          },
          {
            name: 'read_file',
            description: 'Reads the full content of a specified markdown file.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'The absolute path of the file to read.' }
              },
              required: ['path']
            }
          },
          {
            name: 'search_content',
            description: 'Searches for a keyword or phrase within all markdown files in the vault.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'The search term.' }
              },
              required: ['query']
            }
          },
          {
            name: 'create_note',
            description: 'Creates a new markdown note with the specified content.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'The path for the new note (e.g., "Summaries/MyNote.md").' },
                content: { type: 'string', description: 'The content of the note.' }
              },
              required: ['path', 'content']
            }
          },
          {
            name: 'create_folder',
            description: 'Creates a new folder.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'The path for the new folder.' }
              },
              required: ['path']
            }
          },
          {
            name: 'delete_file',
            description: 'Deletes a file or folder. Use with caution.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'The path of the file to delete.' }
              },
              required: ['path']
            }
          },
          {
            name: 'move_file',
            description: 'Moves or renames a file or folder.',
            parameters: {
              type: 'object',
              properties: {
                oldPath: { type: 'string', description: 'The current path.' },
                newPath: { type: 'string', description: 'The new path.' }
              },
              required: ['oldPath', 'newPath']
            }
          }
        ]
      }
    ];

    let contents: any[] = [...history];
    const parts: any[] = [{ text: `Context from vault:\n${context}\n\nUser Question: ${prompt}` }];

    for (const img of images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data
        }
      });
    }

    contents.push({ role: 'user', parts });

    for (let i = 0; i < 15; i++) {
      const body = {
        contents,
        system_instruction: { parts: [{ text: systemInstructionText }] },
        tools,
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      };

      const response = await requestUrl({
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(body)
      });

      if (response.status !== 200) {
        const errorMsg = `Vertex AI Error ${response.status}: ${response.text}`;
        await vaultService.writeLog(`CHAT ERROR: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const data = response.json;
      if (!data.candidates || data.candidates.length === 0) {
        // Check if blocked
        if (data.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${data.promptFeedback.blockReason}`);
        }
        throw new Error('No candidates returned from Vertex AI.');
      }

      const candidate = data.candidates[0];

      if (candidate.finishReason === 'SAFETY') {
        throw new Error('Response blocked due to safety settings.');
      }

      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        throw new Error('Received empty content from Vertex AI.');
      }

      // Handle MULTI-PART responses (Gemini 2.0 often sends text + function call)
      const parts = candidate.content.parts;
      const functionCalls = parts.filter((p: any) => p.functionCall);
      const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n');

      if (functionCalls.length > 0) {
        // Record the model's turn (containing functionCalls)
        contents.push(candidate.content);

        const functionResponseParts: any[] = [];

        for (const part of functionCalls) {
          const { name, args } = part.functionCall;
          let result: any;

          try {
            console.log(`Mastermind: Executing tool ${name}`, args);
            if (name === 'list_files') {
              result = await vaultService.listMarkdownFiles();
            } else if (name === 'read_file') {
              result = await vaultService.getFileContent(args.path);
            } else if (name === 'search_content') {
              result = await vaultService.searchVault(args.query);
            } else if (name === 'create_note') {
              await vaultService.createNote(args.path, args.content);
              result = { status: 'success', message: `Note created at ${args.path}` };
            } else if (name === 'list_directory') {
              result = await vaultService.listFolder(args.path);
            } else if (name === 'move_file') {
              await vaultService.moveFile(args.oldPath, args.newPath);
              result = { status: 'success', message: `Moved ${args.oldPath} to ${args.newPath}` };
            } else if (name === 'delete_file') {
              await vaultService.deleteFile(args.path);
              result = { status: 'success', message: `File deleted at ${args.path}` };
            }
          } catch (err: any) {
            console.error(`Mastermind: Tool ${name} error`, err);
            result = { status: 'error', message: err.message };
          }

          functionResponseParts.push({
            functionResponse: {
              name,
              response: { content: result }
            }
          });
        }

        // IMPORTANT: Vertex AI REST API requires the role for functionResponse messages to be 'user'
        contents.push({
          role: 'user',
          parts: functionResponseParts
        });

        // After processing all function calls in this turn, loop to get next model turn
        continue;
      } else {
        // No function calls, return the text
        return textParts || 'Empty response from model.';
      }
    }

    throw new Error('Maximum tool use iterations reached.');
  }

  // Helper method to validate JSON
  validateJSON(json: string): boolean {
    try {
      JSON.parse(json);
      return true;
    } catch {
      return false;
    }
  }
}
