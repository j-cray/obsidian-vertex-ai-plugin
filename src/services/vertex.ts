import { App, TFile, requestUrl, Notice } from 'obsidian';
import { ChatResponse, ToolAction } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class VertexService {
  private serviceAccountJson!: string;
  private aiStudioKey!: string;
  private location!: string;
  private modelId!: string;
  private customContextPrompt: string = '';
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private isRefreshingToken: boolean = false;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(settings: any) {
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
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    return this.accessToken!;
  }

  private async createSignedJWT(
    email: string,
    privateKeyPem: string,
  ): Promise<string> {
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedClaim = this.base64url(JSON.stringify(claim));
    const unsignedToken = `${encodedHeader}.${encodedClaim}`;

    const signature = await this.sign(unsignedToken, privateKeyPem);
    return `${unsignedToken}.${signature}`;
  }

  private base64url(source: string | ArrayBuffer): string {
    let encodedSource: string;
    if (typeof source === "string") {
      const bytes = new TextEncoder().encode(source);
      encodedSource = this.arrayBufferToBase64(bytes);
    } else {
      encodedSource = this.arrayBufferToBase64(source);
    }

    return encodedSource
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    let binary = "";
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
    const pemContents = privateKeyPem
      .substring(
        privateKeyPem.indexOf(pemHeader) + pemHeader.length,
        privateKeyPem.indexOf(pemFooter),
      )
      .replace(/\s/g, "");

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
        hash: "SHA-256",
      },
      false,
      ["sign"],
    );

    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    const signature = await crypto.sign("RSASSA-PKCS1-v1_5", key, dataBytes);

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
    const projectId = JSON.parse(this.serviceAccountJson).project_id;
    const location = this.location || 'us-central1';

    try {
      const response = await requestUrl({
        url: `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/models?filter=labels.google-cloud-model-garden=true&pageSize=100`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        const data = response.json;
        if (data.models && data.models.length > 0) {
          const fetched: string[] = data.models
            .map((m: any) => m.displayName)
            .filter((name: string | undefined): name is string => typeof name === 'string');
          const unique = [...new Set(fetched)].sort();
          if (unique.length > 0) {
            return unique;
          }
          throw new Error('Vertex AI returned no models.');
        }
        throw new Error('Vertex AI returned no models.');
      }
      throw new Error(`Vertex AI listModels failed with status ${response.status}`);
    } catch (error) {
      console.error('Mastermind: Failed to list models via API.', error);
      throw error;
    }
  }

  async chat(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = []): Promise<string> {
    const accessToken = await this.getAccessToken();
    const projectId = JSON.parse(this.serviceAccountJson).project_id;

    // Model Selection
    const modelId = this.modelId || 'gemini-2.0-flash-exp';
    const isClaude = modelId.startsWith('claude');
    const isEndpoint = /^\d+$/.test(modelId) || modelId.includes('/endpoints/'); // Numeric ID or full resource path
    const location = this.location || 'us-central1';

    // 1. CUSTOM ENDPOINT (Mistral, Llama, Fine-tunes deployed in Garden)
    if (isEndpoint) {
      // Support for Resource Path: projects/123/locations/us-central1/endpoints/456...
      // Or simple ID: 1234567890 (assumed in current project/location)
      const endpointResource = modelId.includes('/') ? modelId : `projects/${projectId}/locations/${location}/endpoints/${modelId}`;
      const url = `https://${location}-aiplatform.googleapis.com/v1/${endpointResource}:predict`;

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
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/anthropic/models/${modelId}:streamRawPredict`;

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
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

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
        function_declarations: [
          {
            name: "list_files",
            description: "Lists all markdown files in the vault.",
            parameters: { type: "object", properties: {} },
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
            name: "list_directory",
            description: "Lists the contents of a specific directory/folder.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "The path of the folder to list.",
                },
              },
              required: ["path"],
            },
          },
          {
            name: "read_file",
            description: "Reads the full content of a specified markdown file.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "The absolute path of the file to read.",
                },
              },
              required: ["path"],
            },
          },
          {
            name: "search_content",
            description:
              "Searches for a keyword or phrase within all markdown files in the vault.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search term." },
              },
              required: ["query"],
            },
          },
          {
            name: "create_note",
            description:
              "Creates a new markdown note with the specified content.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description:
                    'The path for the new note (e.g., "Summaries/MyNote.md").',
                },
                content: {
                  type: "string",
                  description: "The content of the note.",
                },
              },
              required: ["path", "content"],
            },
          },
          {
            name: "create_folder",
            description: "Creates a new folder.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "The path for the new folder.",
                },
              },
              required: ["path"],
            },
          },
          {
            name: "delete_file",
            description: "Deletes a file or folder. Use with caution.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "The path of the file to delete.",
                },
              },
              required: ['path']
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

    for (let i = 0; i < 5; i++) {
      const body = {
        contents,
        system_instruction: { parts: [{ text: systemInstructionText }] },
        tools,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
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
        throw new Error(`Vertex AI Error ${response.status}: ${response.text}`);
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

      const part = candidate.content.parts[0];

      // Check if there are tool use calls
      if (part.functionCall) {
        const funcCall = part.functionCall;
        const { name, args } = funcCall;
        let result: any;

        try {
          if (name === 'list_files') {
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
          } else if (name === 'delete_file') {
            await vaultService.deleteFile(args.path);
            result = { status: 'success', message: `File deleted at ${args.path}` };
          } else if (name === 'list_directory') {
            result = await vaultService.listDirectory(args.path);
          }
        } catch (err: any) {
          result = { status: 'error', message: err.message };
        }

        contents.push(candidate.content);

        contents.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name,
              response: { name, content: result }
            }
          }]
        });
      } else {
        return part.text;
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
