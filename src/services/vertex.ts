import { App, TFile, requestUrl, Notice } from 'obsidian';
import { ChatResponse, ToolAction } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
      // GEMINI 3 (Preview - Global Only)
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',

      // GEMINI 2.0 (Latest)
      'gemini-2.0-flash-001',
      'gemini-2.0-flash-lite-preview-02-05',
      'gemini-2.0-pro-exp-02-05',
      'gemini-2.0-flash-thinking-exp-01-21', // Reasoning model

      // GEMINI 1.5 (Stable)
      'gemini-1.5-pro',
      'gemini-1.5-flash',

      // IMAGEN 3 (Image Generation)
      'imagen-3.0-generate-001',
      'imagen-3.0-fast-generate-001'
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
    // Add defaults to the set to ensure they are available selections
    FALLBACK_MODELS.forEach(m => foundModels.add(m));

    const finalList = Array.from(foundModels).sort();
    new Notice(`Mastermind: Discovery complete. Available models: ${finalList.length}`);
    return finalList;
  }



  async *chat(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = []): AsyncGenerator<ChatResponse> {
    console.log('Mastermind: Service - chat called');
    const accessToken = await this.getAccessToken();
    console.log('Mastermind: Service - token retrieved');
    const projectId = JSON.parse(this.serviceAccountJson).project_id;
    const location = this.location || 'us-central1';

    try {
      yield* this.chatInternal(prompt, context, vaultService, history, images, accessToken, projectId, location);
    } catch (error: any) {
      // Automatic Fallback to us-central1 for 404/400 or certain model errors
      const isConfigError = error.message.includes('404') || error.message.includes('not found') || error.message.includes('400');

      if (location !== 'us-central1' && isConfigError) {
        console.log(`Mastermind: Chat failed in ${location} (Error: ${error.message}). Falling back to us-central1 + Safe Model...`);
        // Override model to a known good one for fallback
        this.modelId = 'gemini-2.0-flash-exp';
        yield* this.chatInternal(prompt, context, vaultService, history, images, accessToken, projectId, 'us-central1');
      } else if (error.message.includes('400') && this.modelId !== 'gemini-2.0-flash-exp') {
        // Fallback for bad model name even if in us-central1
        console.log('Mastermind: 400 Bad Request. Retrying with gemini-2.0-flash-exp...');
        this.modelId = 'gemini-2.0-flash-exp';
        yield* this.chatInternal(prompt, context, vaultService, history, images, accessToken, projectId, location);
      } else {
        throw error;
      }
    }
  }

  private async *chatInternal(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = [], accessToken: string, projectId: string, location: string, initialText: string = '', initialThinking: string = ''): AsyncGenerator<ChatResponse> {

    // Model Selection
    const modelId = this.modelId || 'gemini-2.0-flash-exp';
    const isClaude = modelId.startsWith('claude');
    const isEndpoint = /^\d+$/.test(modelId) || modelId.includes('/endpoints/'); // Numeric ID or full resource path
    const effectiveLocation = location || 'us-central1';

    // --- NON-STREAMING MODELS (Legacy/Other Providers) ---
    if (isEndpoint || isClaude || modelId.includes('imagen')) {
      // Reuse existing logic but return a single yield
      // Note: We need to copy-paste the logic for these or refactor them out.
      // For brevity, I'm refactoring the requestUrl calls here to just yield the final result.

      let url = '';
      let body: any = {};

      if (isEndpoint) {
        const endpointResource = modelId.includes('/') ? modelId : `projects/${projectId}/locations/${effectiveLocation}/endpoints/${modelId}`;
        const host = effectiveLocation === 'global' ? 'aiplatform.googleapis.com' : `${effectiveLocation}-aiplatform.googleapis.com`;

        // Use SSE for streaming models
        const useSSE = !isEndpoint;
        url = `https://${host}/v1/${endpointResource}:${isEndpoint ? 'predict' : 'streamGenerateContent'}${useSSE ? '?alt=sse' : ''}`;

        body = {
          instances: [{ prompt: `System: You are Mastermind.\nContext: ${context}\n\nUser: ${prompt}\nAssistant:` }],
          parameters: { temperature: 0.7, maxOutputTokens: 2048, topP: 0.95 }
        };
      } else if (isClaude) {
        url = `${this.getBaseUrl(effectiveLocation)}/publishers/anthropic/models/${modelId}:streamRawPredict`;
        const messages = history.map(h => ({
          role: h.role === 'model' ? 'assistant' : 'user',
          content: h.parts[0].text
        }));
        messages.push({ role: "user", content: `Context:\n${context}\n\nQuestion: ${prompt}` });
        body = {
          anthropic_version: "vertex-2023-10-16",
          messages: messages,
          system: `You are Mastermind. ${this.customContextPrompt || ''} Be concise.`,
          max_tokens: 4096,
          stream: false
        };
      } else { // Imagen
        url = `${this.getBaseUrl(effectiveLocation)}/publishers/google/models/${modelId}:predict`;
        body = { instances: [{ prompt: prompt }], parameters: { sampleCount: 1 } };
        new Notice('Mastermind: Generating image...');
      }

      const response = await requestUrl({
        url,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (response.status !== 200) throw new Error(`API Error ${response.status}: ${response.text}`);
      const data = response.json;

      if (modelId.includes('imagen')) {
        if (data.predictions?.[0]?.bytesBase64Encoded) {
          const link = await vaultService.saveImage(data.predictions[0].bytesBase64Encoded);
          yield { text: `Here is your generated image:\n\n${link}`, actions: [] };
          return;
        }
        throw new Error('No image data returned.');
      }

      const text = isEndpoint ? data.predictions[0].content : (data.content ? data.content[0].text : JSON.stringify(data));
      yield { text, actions: [] };
      return;
    }

    // --- GEMINI STREAMING ---
    const isGemini3 = modelId.includes('gemini-3');
    const apiVersion = (isGemini3 || modelId.includes('preview') || modelId.includes('exp') || modelId.includes('beta')) ? 'v1beta1' : 'v1';
    const runLocation = isGemini3 ? 'global' : effectiveLocation;

    // Use streamGenerateContent
    const url = `${this.getBaseUrl(runLocation).replace('/v1/', `/${apiVersion}/`)}/publishers/google/models/${modelId}:streamGenerateContent?alt=sse`;

    let systemInstructionText = `You are "Mastermind", a highly capable AI assistant for Obsidian.
You have access to the user's notes and knowledge vault.
Be concise, professional, and insightful.
Always use the provided context to answer questions if available.
You can use tools to search, read, list, create, and delete notes/folders in the vault.

IMPORTANT: If you need to reason through a complex problem, show your work by wrapping your thought process in a "thinking" code block, like this:
\`\`\`thinking
My reasoning process...
\`\`\`
Then provide your final answer.`;

    if (this.customContextPrompt) {
      systemInstructionText += `\n\nUSER CUSTOM INSTRUCTIONS:\n${this.customContextPrompt}`;
    }

    // Tools definition (Reuse existing)
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'generate_image',
            description: 'Generates an image based on a prompt using Imagen 3. Use this when the user asks to draw, paint, or create an image.',
            parameters: {
              type: 'object',
              properties: {
                prompt: { type: 'string', description: 'The visual description of the image to generate.' }
              },
              required: ['prompt']
            }
          },
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
          },

          {
            name: 'run_terminal_command',
            description: 'Executes a shell command on the host OS. Use with caution.',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'The shell command to execute.' }
              },
              required: ['command']
            }
          },
          {
            name: 'fetch_url',
            description: 'Fetches the content of a URL. Useful for reading documentation or articles.',
            parameters: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'The absolute URL to fetch.' }
              },
              required: ['url']
            }
          },
          {
            name: 'append_to_note',
            description: 'Appends content to the end of a note.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['path', 'content']
            }
          },
          {
            name: 'prepend_to_note',
            description: 'Prepends content to the start of a note (after frontmatter if present).',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['path', 'content']
            }
          },
          {
            name: 'update_section',
            description: 'Updates a specific section of a note under a given header.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                header: { type: 'string', description: 'The exact header text (without #)' },
                content: { type: 'string', description: 'The new content for the section' }
              },
              required: ['path', 'header', 'content']
            }
          },
          {
            name: 'get_tags',
            description: 'Gets all unique tags in the vault.',
            parameters: { type: 'object', properties: {} }
          },
          {
            name: 'get_links',
            description: 'Gets all outgoing links from a specific note.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path']
            }
          }
        ],
        googleSearchRetrieval: {}
      }
    ];

    let contents: any[] = [...history];

    // Process images
    const pParts: any[] = [{ text: `Context from vault:\n${context}\n\nUser Question: ${prompt}` }];
    for (const img of images) {
      pParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
    contents.push({ role: 'user', parts: pParts });

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

    // --- NODE JS HTTPS STREAMING ---
    console.log(`Mastermind: Starting stream request to ${url}`);

    let stream;
    try {
      stream = this.streamRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.error("Mastermind: Failed to initiate stream", e);
      throw e;
    }

    let buffer = '';
    let accumulatedText = initialText;
    let accumulatedThinking = initialThinking;
    let isThinking = false;
    let accumulatedFunctions: any[] = [];
    let chunkCount = 0;

    // STREAMING LOOP
    try {
      for await (const chunk of stream) {
        console.log(`Mastermind: HTTPS chunk yielded (${chunk.length} bytes)`);
        chunkCount++;

        // Handle SSE format "data: JSON\n\n"
        const lines = (buffer + chunk).split('\n');
        buffer = lines.pop() || ''; // Keep partial line

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue; // skip comments/empty
          const jsonStr = line.replace(/^data:\s*/, '').trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            const candidates = data.candidates;
            if (candidates && candidates[0]) {
              const candidate = candidates[0];
              if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                  if (part.text) {
                    // THINKING PARSER
                    let textPart = part.text;

                    // Check for thinking block transitions
                    // Simple regex split is not enough for streaming.
                    // Logic: Scan textPart. If we hit ```thinking, switch state. If we hit ``` in thinking, switch back.

                    let remaining = textPart;
                    while (remaining.length > 0) {
                      if (!isThinking) {
                        const startIdx = remaining.indexOf('```thinking');
                        if (startIdx !== -1) {
                          // Found start
                          accumulatedText += remaining.substring(0, startIdx);
                          remaining = remaining.substring(startIdx + 11); // Skip marker
                          isThinking = true;
                        } else {
                          accumulatedText += remaining;
                          remaining = '';
                        }
                      } else {
                        // inside thinking
                        const endIdx = remaining.indexOf('```');
                        if (endIdx !== -1) {
                          // Found end
                          accumulatedThinking += remaining.substring(0, endIdx);
                          remaining = remaining.substring(endIdx + 3);
                          isThinking = false;
                        } else {
                          accumulatedThinking += remaining;
                          remaining = '';
                        }
                      }
                    }

                    // Yield Update
                    yield {
                      text: accumulatedText,
                      isThinking: isThinking,
                      thinkingText: accumulatedThinking,
                      actions: []
                    };

                  } else if (part.functionCall) {
                    // Buffer function calls (they might span chunks? Vertex usually acts politely and sends full objects in SSE, but let's be safe and just push)
                    accumulatedFunctions.push(part.functionCall);
                  }
                }
              }
            }
          } catch (e) {
            console.error("JSON Parse Error in Stream", e);
          }
        }
      }

      // END OF STREAM ACTIONS
      if (accumulatedFunctions.length > 0) {
        // Execute Tools
        const executedActions: ToolAction[] = [];

        // Add model's thinking so far to history
        contents.push({
          role: 'model',
          parts: [{ text: accumulatedText || ' ', functionCall: accumulatedFunctions[0] }] // Simplified history push
        });

        const functionResponseParts: any[] = [];

        for (const funcCall of accumulatedFunctions) {
          const { name, args } = funcCall;
          let result: any;

          // EXECUTE TOOL (Copied logic)
          yield { text: accumulatedText, thinkingText: accumulatedThinking, actions: [{ tool: name, input: args, status: 'pending' }] };

          try {
            console.log(`Mastermind: Executing tool ${name}`, args);

            if (name === 'generate_image') {
              new Notice(`Mastermind: Switching to Imagen 3 for "${args.prompt}"...`);
              console.log(`Mastermind: Auto-switching to Imagen 3 for prompt: ${args.prompt}`);
              const imagenLink = await this.generateImageInternal(args.prompt, accessToken, projectId, location, vaultService);
              result = { status: 'success', image_link: imagenLink, message: 'Image generated successfully. Embed this link in your response.' };
            } else if (name === 'list_files') {
              result = await vaultService.listMarkdownFiles();
            } else if (name === 'read_file') {
              result = await vaultService.getFileContent(args.path);
            } else if (name === 'search_content') {
              result = await vaultService.searchVault(args.query);
            } else if (name === 'create_note') {
              await vaultService.createNote(args.path, args.content);
              result = { status: 'success', message: `Note created at ${args.path}` };
            } else if (name === 'create_folder') {
              await vaultService.createFolder(args.path);
              result = { status: 'success', message: `Folder created at ${args.path}` };
            } else if (name === 'list_directory') {
              result = await vaultService.listFolder(args.path);
            } else if (name === 'move_file') {
              await vaultService.moveFile(args.oldPath, args.newPath);
              result = { status: 'success', message: `Moved ${args.oldPath} to ${args.newPath}` };
            } else if (name === 'delete_file') {
              await vaultService.deleteFile(args.path);
              result = { status: 'success', message: `File deleted at ${args.path}` };
            } else if (name === 'append_to_note') {
              await vaultService.appendToNote(args.path, args.content);
              result = { status: 'success', message: `Appended content to ${args.path}` };
            } else if (name === 'prepend_to_note') {
              await vaultService.prependToNote(args.path, args.content);
              result = { status: 'success', message: `Prepended content to ${args.path}` };
            } else if (name === 'update_section') {
              await vaultService.updateNoteSection(args.path, args.header, args.content);
              result = { status: 'success', message: `Updated section "${args.header}" in ${args.path}` };
            } else if (name === 'get_tags') {
              const tags = await vaultService.getTags();
              result = { status: 'success', tags: tags };
            } else if (name === 'get_links') {
              const links = await vaultService.getLinks(args.path);
              result = { status: 'success', links: links };
            } else if (name === 'run_terminal_command') {
              // Security Check
              // @ts-ignore
              if (vaultService.app.plugins.getPlugin('obsidian-vertex-ai-plugin').settings.confirmDestructive) {
                throw new Error("Terminal commands are blocked because 'Confirm Destructive Actions' is enabled. Please disable it in settings to use this feature.");
              }

              try {
                const { stdout, stderr } = await execAsync(args.command);
                result = { status: 'success', stdout: stdout, stderr: stderr };
              } catch (e: any) {
                result = { status: 'error', message: e.message, stderr: e.stderr };
              }
            } else if (name === 'fetch_url') {
              try {
                const response = await requestUrl({ url: args.url });
                // Limit size to avoid context overflow
                const text = response.text.substring(0, 10000);
                result = { status: 'success', content_snippet: text, full_length: response.text.length };
              } catch (e: any) {
                result = { status: 'error', message: e.message };
              }
            } else {
              result = { status: 'error', message: `Unknown tool: ${name}` };
            }

          } catch (e: any) {
            result = { status: 'error', message: e.message };
          }

          executedActions.push({ tool: name, input: args, output: result, status: result.status });
          functionResponseParts.push({ functionResponse: { name, response: { content: result } } });
        }

        // RECURSIVE CALL with Tool Outputs
        contents.push({ role: 'user', parts: functionResponseParts });

        // Yield * chatInternal (Recursive)
        // We need to pass the updated 'contents' as 'history' but carefully.
        // Actually, to avoid infinite recursion complexity in this single step,
        // I will just yield the final result for now or rely on the fact that existing flow expects text.
        // Recursion:
        yield* this.chatInternal(prompt, context, vaultService, contents, [], accessToken, projectId, location, accumulatedText, accumulatedThinking);
      }
    } catch (e) {
      console.error("Mastermind: Streaming Loop Error", e);
      throw e;
    }
  }

  // Helper: Generate Image (Imagen 3)
  private async generateImageInternal(prompt: string, accessToken: string, projectId: string, location: string, vaultService: any): Promise<string> {
    // Use 'imagen-3.0-generate-001' as default for auto-switching
    const modelId = 'imagen-3.0-generate-001';
    const url = `${this.getBaseUrl(location)}/publishers/google/models/${modelId}:predict`;

    const body = {
      instances: [
        { prompt: prompt }
      ],
      parameters: {
        sampleCount: 1,
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
      throw new Error(`Imagen Error ${response.status}: ${response.text}`);
    }

    const data = response.json;
    if (data.predictions && data.predictions.length > 0 && data.predictions[0].bytesBase64Encoded) {
      const base64 = data.predictions[0].bytesBase64Encoded;
      return await vaultService.saveImage(base64);
    }
    throw new Error('No image data returned from Imagen.');
  }

  // Node.js HTTPS Streaming Helper
  private async *streamRequest(urlStr: string, options: any): AsyncGenerator<string> {
    const https = require('https');
    const { URL } = require('url');
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: options.method,
      headers: options.headers
    };

    const queue = new AsyncQueue<string>();

    const req = https.request(reqOptions, (res: any) => {
      if (res.statusCode && res.statusCode >= 300) {
        let errorBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { errorBody += chunk; });
        res.on('end', () => {
          console.error(`Mastermind: HTTPS Error ${res.statusCode} Body:`, errorBody);
          queue.fail(new Error(`HTTP Error ${res.statusCode}: ${errorBody}`));
        });
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        console.log(`Mastermind: HTTPS chunk received (${chunk.length} bytes)`);
        queue.push(chunk);
      });
      res.on('end', () => {
        console.log('Mastermind: HTTPS stream ended');
        queue.close();
      });
      res.on('error', (err: Error) => {
        console.error('Mastermind: HTTPS stream error', err);
        queue.fail(err);
      });
    });

    req.on('error', (err: any) => queue.fail(err));
    req.write(options.body);
    req.end();

    yield* queue;
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
  // End of class
}

// Simple Async Queue for buffering stream events
class AsyncQueue<T> {
  private queue: T[] = [];
  private resolveNext: ((value: IteratorResult<T>) => void) | null = null;
  private rejectNext: ((reason?: any) => void) | null = null;
  private closed = false;
  private error: Error | null = null;

  push(value: T) {
    if (this.closed) return;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      this.rejectNext = null;
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  close() {
    this.closed = true;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      this.rejectNext = null;
      resolve({ value: undefined as any, done: true });
    }
  }

  fail(err: Error) {
    this.error = err;
    if (this.rejectNext) {
      const reject = this.rejectNext;
      this.resolveNext = null;
      this.rejectNext = null;
      reject(err);
    }
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.error) return Promise.reject(this.error);
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.resolveNext = resolve;
          this.rejectNext = reject;
        });
      }
    };
  }
}
