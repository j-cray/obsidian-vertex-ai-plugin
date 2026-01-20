import { App, TFile, requestUrl, Notice } from 'obsidian';
import { ChatResponse, ToolAction } from '../types';
import { VertexAI } from '@google-cloud/vertexai';
import { ModelServiceClient } from '@google-cloud/aiplatform';

export class VertexService {
  private serviceAccountJson!: string;
  private aiStudioKey!: string;
  private location!: string;
  private modelId!: string;
  private customContextPrompt: string = '';
  private vertexClient: VertexAI | null = null;

  constructor(settings: any) {
    this.updateSettings(settings);
  }

  updateSettings(settings: { serviceAccountJson: string, location: string, modelId: string, customContextPrompt: string }) {
    this.serviceAccountJson = settings.serviceAccountJson;
    this.location = settings.location;
    this.modelId = settings.modelId;
    this.customContextPrompt = settings.customContextPrompt;
    this.vertexClient = null; // Reset client on settings change
  }

  private getVertexClient(): VertexAI {
    if (this.vertexClient) {
      return this.vertexClient;
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

    if (!credentials.project_id) {
      throw new Error('Service Account JSON missing project_id.');
    }

    // Initialize Vertex AI client with service account credentials
    this.vertexClient = new VertexAI({
      project: credentials.project_id,
      location: this.location || 'us-central1',
      googleAuth: {
        credentials: {
          type: 'service_account',
          project_id: credentials.project_id,
          private_key_id: credentials.private_key_id,
          private_key: credentials.private_key,
          client_email: credentials.client_email,
          client_id: credentials.client_id,
          auth_uri: credentials.auth_uri,
          token_uri: credentials.token_uri,
          auth_provider_x509_cert_url: credentials.auth_provider_x509_cert_url,
          client_x509_cert_url: credentials.client_x509_cert_url,
        }
      }
    });

    return this.vertexClient;
  }

  private getProjectId(): string {
    try {
      return JSON.parse(this.serviceAccountJson).project_id;
    } catch (e) {
      return '';
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const projectId = this.getProjectId();
      const location = this.location || 'us-central1';

      // Parse credentials once
      let credentials;
      try {
        credentials = JSON.parse(this.serviceAccountJson);
      } catch (e) {
        throw new Error('Invalid Service Account JSON format.');
      }

      const credentialsObj = {
        type: 'service_account',
        project_id: credentials.project_id,
        private_key_id: credentials.private_key_id,
        private_key: credentials.private_key,
        client_email: credentials.client_email,
        client_id: credentials.client_id,
        auth_uri: credentials.auth_uri,
        token_uri: credentials.token_uri,
        auth_provider_x509_cert_url: credentials.auth_provider_x509_cert_url,
        client_x509_cert_url: credentials.client_x509_cert_url,
      };

      const modelNames: string[] = [];

      // 1. Try to fetch custom-deployed models from Model Registry
      try {
        const modelClient = new ModelServiceClient({
          apiEndpoint: `${location}-aiplatform.googleapis.com`,
          credentials: credentialsObj
        });

        const parent = `projects/${projectId}/locations/${location}`;
        const [customModels] = await modelClient.listModels({ parent });

        if (customModels && customModels.length > 0) {
          customModels.forEach((model: any) => {
            const name = model.displayName || model.name;
            if (typeof name === 'string' && !modelNames.includes(name)) {
              modelNames.push(name);
            }
          });
        }
      } catch (error) {
        console.warn('Mastermind: Failed to fetch custom models from Model Registry.', error);
      }

      // 2. Try to fetch foundational models from Google Publishers
      const publishersUrl = `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models`;
      try {
        const credentialsObj = {
          type: 'service_account',
          project_id: credentials.project_id,
          private_key_id: credentials.private_key_id,
          private_key: credentials.private_key,
          client_email: credentials.client_email,
          client_id: credentials.client_id,
          auth_uri: credentials.auth_uri,
          token_uri: credentials.token_uri,
          auth_provider_x509_cert_url: credentials.auth_provider_x509_cert_url,
          client_x509_cert_url: credentials.client_x509_cert_url,
        };

        const accessToken = await this.getAccessTokenForPublishers(credentialsObj);

        console.log('Mastermind DEBUG: Fetching models from (v1beta1):', publishersUrl);
        console.log('Mastermind DEBUG: Project ID:', projectId);
        console.log('Mastermind DEBUG: Location:', location);
        console.log('Mastermind DEBUG: Service Account:', credentials.client_email);

        // Use v1beta1 API with specific google publisher and x-goog-user-project header
        const response = await requestUrl({
          url: publishersUrl,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'x-goog-user-project': projectId
          }
        });

        console.log('Mastermind DEBUG: Response status:', response.status);

        if (response.status === 200) {
          const data = response.json as { models?: Array<{ displayName?: string; name?: string; model?: string }> };
          if (data.models && data.models.length > 0) {
            data.models.forEach((model: any) => {
              // Extract model ID from resource name (e.g., "publishers/google/models/gemini-pro")
              let name = model.displayName || model.model || model.name;
              if (typeof name === 'string') {
                // If it's a full resource path, extract just the model name
                if (name.includes('/')) {
                  const parts = name.split('/');
                  name = parts[parts.length - 1];
                }
                if (!modelNames.includes(name)) {
                  modelNames.push(name);
                }
              }
            });
          }
        }
      } catch (error: any) {
        const status = (error?.response as any)?.status;
        console.warn('Mastermind: Failed to fetch foundational models from Publishers API.', status ? `Status ${status}` : error, 'URL:', publishersUrl);
      }

      // 3. Scrape the public docs page for published model IDs as a last-mile source
      try {
        const docsModels = await this.fetchModelIdsFromDocs();
        docsModels.forEach((m) => {
          if (!modelNames.includes(m)) {
            modelNames.push(m);
          }
        });
      } catch (error) {
        console.warn('Mastermind: Failed to scrape docs for models.', error);
      }

      // Return combined list, deduplicated and sorted
      const unique = [...new Set(modelNames)].sort();
      
      if (unique.length > 0) {
        return unique;
      }
      
      throw new Error('Vertex AI returned no models from custom registry or publishers.');
    } catch (error) {
      console.error('Mastermind: Failed to list models.', error);
      throw error;
    }
  }

  private async getAccessTokenForPublishers(credentials: any): Promise<string> {
    const jwt = await this.createJWT(credentials);

    const response = await requestUrl({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get access token: ${response.text}`);
    }

    const data = response.json as { access_token: string };
    return data.access_token;
  }

  private async createJWT(credentials: any): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedClaim = this.base64url(JSON.stringify(claim));
    const unsignedToken = `${encodedHeader}.${encodedClaim}`;
    const signature = await this.sign(unsignedToken, credentials.private_key);
    return `${unsignedToken}.${signature}`;
  }

  private base64url(source: string | ArrayBuffer): string {
    let input: Uint8Array;
    if (typeof source === 'string') {
      input = new TextEncoder().encode(source);
    } else {
      input = new Uint8Array(source);
    }
    const base64 = window.btoa(String.fromCharCode(...input));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

  private async fetchModelIdsFromDocs(): Promise<string[]> {
    const indexUrl = 'https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models';
    const ids = new Set<string>();
    const cacheKey = 'mastermind-model-scrape-cache';
    const cacheTtlMs = 24 * 60 * 60 * 1000; // 24h

    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { ts: number; models: string[] };
        if (parsed?.models && Array.isArray(parsed.models) && parsed.ts && Date.now() - parsed.ts < cacheTtlMs) {
          console.log('Mastermind DEBUG: Using cached docs models:', parsed.models.length, 'age(ms):', Date.now() - parsed.ts);
          return parsed.models;
        }
      }
    } catch (err) {
      console.warn('Mastermind: Failed to read model cache.', err);
    }

    console.log('Mastermind DEBUG: Cache miss or stale; starting docs scrape.');

    const scrapeStart = Date.now();
    const stillRunningTimer = window.setTimeout(() => {
      console.log('Mastermind DEBUG: Docs scrape still running...', 'elapsed(ms):', Date.now() - scrapeStart);
    }, 3000);

    try {
      // Fetch index page
      console.log('Mastermind DEBUG: Fetching index page:', indexUrl);
      const indexResponse = await requestUrl({ url: indexUrl, method: 'GET' });
      
      if (indexResponse.status !== 200) {
        console.warn('Mastermind: Index fetch non-200 status', indexResponse.status);
        window.clearTimeout(stillRunningTimer);
        return [];
      }

      const indexBody = indexResponse.text || '';
      console.log('Mastermind DEBUG: Index page body length:', indexBody.length, 'elapsed(ms):', Date.now() - scrapeStart);

      // Find model page links
      const modelPageLinks = new Set<string>();
      const linkPattern = /href=["']([^"']*\/vertex-ai\/generative-ai\/docs\/(?:learn\/)?models\/[^"'#]+)["']/gi;
      let linkMatch: RegExpExecArray | null;
      
      while ((linkMatch = linkPattern.exec(indexBody)) !== null) {
        let url = linkMatch[1];
        // Normalize URL
        if (url.startsWith('/')) {
          url = 'https://cloud.google.com' + url;
        } else if (!url.startsWith('http')) {
          url = 'https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models/' + url;
        }
        
        // Skip the index page itself
        if (!url.endsWith('/models') && !url.endsWith('/learn/models')) {
          modelPageLinks.add(url);
        }
      }

      console.log('Mastermind DEBUG: Found model page links:', modelPageLinks.size);

      // Fetch each model page and extract IDs
      let fetchedPages = 0;
      for (const pageUrl of Array.from(modelPageLinks).slice(0, 50)) { // Limit to 50 pages
        try {
          const pageResponse = await requestUrl({ url: pageUrl, method: 'GET', throw: false });
          if (pageResponse.status === 200) {
            const pageBody = pageResponse.text || '';
            fetchedPages++;
            
            // Extract model IDs from page - look for patterns like gemini-2.0-flash, gemini-1.5-pro, etc.
            const modelIdPatterns = [
              // Match code blocks with model IDs
              /<code[^>]*>([a-z0-9]+(?:[-\.][a-z0-9]+)+(?:-(?:preview|exp|experimental|latest))?)<\/code>/gi,
              // Match in model: property
              /["']?model["']?\s*[:=]\s*["']([a-z0-9]+(?:[-\.][a-z0-9]+)+(?:-(?:preview|exp|experimental|latest))?)["']/gi,
              // Match publishers path format
              /publishers\/google\/models\/([a-z0-9]+(?:[-\.][a-z0-9]+)+(?:-(?:preview|exp|experimental|latest))?)/gi,
            ];

            for (const pattern of modelIdPatterns) {
              let match: RegExpExecArray | null;
              while ((match = pattern.exec(pageBody)) !== null) {
                const candidate = match[1]?.trim();
                if (candidate && candidate.length >= 5 && candidate.length <= 80) {
                  // Must contain at least one hyphen or dot and start with letter
                  if (/^[a-z]/.test(candidate) && /[-.]/.test(candidate)) {
                    ids.add(candidate);
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn('Mastermind: Failed to fetch model page:', pageUrl, err);
        }
      }

      console.log('Mastermind DEBUG: Fetched', fetchedPages, 'model pages');

    } catch (err) {
      console.warn('Mastermind: Docs scrape error:', err);
    } finally {
      window.clearTimeout(stillRunningTimer);
    }

    const results = [...ids];
    console.log('Mastermind DEBUG: Docs models extracted:', results.length, 'elapsed(ms):', Date.now() - scrapeStart);

    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), models: results }));
      console.log('Mastermind DEBUG: Docs models cached:', results.length, 'elapsed(ms):', Date.now() - scrapeStart);
    } catch (err) {
      console.warn('Mastermind: Failed to write model cache.', err);
    }

    return results;
  }

  async chat(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = [], signal?: AbortSignal): Promise<AsyncGenerator<ChatResponse, void, unknown>> {
    const self = this;
    const projectId = this.getProjectId();
    const modelId = this.modelId || 'gemini-2.0-flash-exp';
    const location = this.location || 'us-central1';

    return (async function* () {
      try {
        const client = self.getVertexClient();
        const generativeModel = client.getGenerativeModel({
          model: modelId,
        });

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

        if (self.customContextPrompt) {
          systemInstructionText += `\n\nUSER CUSTOM INSTRUCTIONS:\n${self.customContextPrompt}`;
        }

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
          if (signal?.aborted) {
            return;
          }

          const generationConfig = {
            temperature: 0.7,
            maxOutputTokens: 2048,
          };

          const response = await generativeModel.generateContent({
            contents,
            systemInstruction: systemInstructionText,
            tools,
            generationConfig,
          });

          const result = response.response;

          if (!result.candidates || result.candidates.length === 0) {
            if (result.promptFeedback?.blockReason) {
              throw new Error(`Blocked: ${result.promptFeedback.blockReason}`);
            }
            throw new Error('No candidates returned from Vertex AI.');
          }

          const candidate = result.candidates[0];

          if (candidate.finishReason === 'SAFETY') {
            throw new Error('Response blocked due to safety settings.');
          }

          if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            throw new Error('Received empty content from Vertex AI.');
          }

          const part = candidate.content.parts[0];

          if ('functionCall' in part && part.functionCall) {
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
          } else if ('text' in part) {
            yield {
              text: part.text || '',
              actions: []
            };
            return;
          }
        }

        throw new Error('Maximum tool use iterations reached.');
      } catch (error) {
        console.error('Mastermind Chat Error:', error);
        throw error;
      }
    })();
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
