import { App, TFile, requestUrl, Notice } from 'obsidian';
import { exec as cpExec } from 'child_process';
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
  private permWeb: boolean = false;
  private permTerminal: boolean = false;
  private confirmTerminalDestructive: boolean = true;
  private modelTemperature: number = 0.5;

  private getApiHost(location: string): string {
    const loc = location || 'us-central1';
    return loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  }

  constructor(settings: any) {
    this.updateSettings(settings);
  }

  updateSettings(settings: { serviceAccountJson: string, aiStudioKey?: string, location: string, modelId: string, customContextPrompt: string, permWeb?: boolean, permTerminal?: boolean, confirmTerminalDestructive?: boolean, modelTemperature?: number }) {
    this.serviceAccountJson = settings.serviceAccountJson;
    this.aiStudioKey = settings.aiStudioKey || '';
    this.location = settings.location;
    this.modelId = settings.modelId;
    this.customContextPrompt = settings.customContextPrompt;
    this.permWeb = !!settings.permWeb;
    this.permTerminal = !!settings.permTerminal;
    this.confirmTerminalDestructive = settings.confirmTerminalDestructive ?? true;
    this.modelTemperature = settings.modelTemperature ?? 0.5;
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

    const apiHost = this.getApiHost(this.location || 'us-central1');

    // Disable GCE metadata server checks to avoid timeout
    // Set these before creating the client
    if (typeof process !== 'undefined' && process.env) {
      process.env.GCE_METADATA_HOST = 'metadata.google.internal.invalid';
      process.env.SUPPRESS_GCLOUD_CREDS_WARNING = 'true';
    }

    // Initialize Vertex AI client with service account credentials
    this.vertexClient = new VertexAI({
      project: credentials.project_id,
      location: this.location || 'us-central1',
      apiEndpoint: apiHost,
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

  async listModels(skipCache = false, includeDocs = false): Promise<string[]> {
    try {
      const projectId = this.getProjectId();
      const location = this.location || 'us-central1';
      const apiHost = this.getApiHost(location);

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
          apiEndpoint: apiHost,
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
      const publishersUrl = `https://${apiHost}/v1beta1/publishers/google/models`;
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
        } else {
          throw new Error(`Publishers API returned status ${response.status}`);
        }
      } catch (error: any) {
        const status = (error?.response as any)?.status;
        console.warn('Mastermind: Failed to fetch foundational models from Publishers API.', status ? `Status ${status}` : error, 'URL:', publishersUrl);
        if (modelNames.length === 0) {
          throw error;
        }
      }

      // Optionally merge docs scrape when requested (manual fetch button)
      if (includeDocs) {
        try {
          const docsModels = await this.fetchModelIdsFromDocs(skipCache);
          docsModels.forEach((m) => {
            if (!modelNames.includes(m)) {
              modelNames.push(m);
            }
          });
        } catch (error) {
          console.warn('Mastermind: Failed to scrape docs for models.', error);
        }
      }

      // Return combined list, deduplicated and sorted; fail hard if none
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

  private async fetchModelIdsFromDocs(skipCache = false): Promise<string[]> {
    const indexUrl = 'https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models';
    const ids = new Set<string>();
    const cacheKey = 'mastermind-model-scrape-cache';
    const cacheTtlMs = 24 * 60 * 60 * 1000; // 24h

    if (!skipCache) {
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
    }

    console.log(skipCache ? 'Mastermind DEBUG: Cache skipped; starting fresh docs scrape.' : 'Mastermind DEBUG: Cache miss or stale; starting docs scrape.');

    const scrapeStart = Date.now();
    const stillRunningTimer = window.setTimeout(() => {
      console.log('Mastermind DEBUG: Docs scrape still running...', 'elapsed(ms):', Date.now() - scrapeStart);
    }, 3000);

    try {
      console.log('Mastermind DEBUG: Fetching models page:', indexUrl);
      const response = await requestUrl({ url: indexUrl, method: 'GET' });
      
      if (response.status !== 200) {
        console.warn('Mastermind: Models page fetch non-200 status', response.status);
        window.clearTimeout(stillRunningTimer);
        return [];
      }

      const body = response.text || '';
      console.log('Mastermind DEBUG: Models page body length:', body.length, 'elapsed(ms):', Date.now() - scrapeStart);

      // Pattern 1: Look for links to model pages like /docs/models/gemini/2-5-pro
      const linkPattern = /href=["']([^"']*\/(?:gemini|imagen|veo|gemma)\/([^"'/#]+))["']/gi;
      let linkMatch: RegExpExecArray | null;
      let linkCount = 0;
      
      while ((linkMatch = linkPattern.exec(body)) !== null) {
        linkCount++;
        const path = linkMatch[2]?.trim();
        if (path && path.length >= 2) {
          // Convert URL path like "2-5-pro" or "3-flash" to model ID
          const segments = path.split('/').filter(s => s.length > 0);
          for (const segment of segments) {
            const normalized = segment.toLowerCase().replace(/_/g, '-');
            // Match segments that look like model identifiers
            if (normalized.length >= 2 && /[a-z0-9]/.test(normalized)) {
              // Try to construct full model names
              const fullPath = linkMatch[1];
              if (fullPath.includes('/gemini/')) {
                ids.add(`gemini-${normalized}`);
              } else if (fullPath.includes('/imagen/')) {
                ids.add(`imagen-${normalized}`);
              } else if (fullPath.includes('/veo/')) {
                ids.add(`veo-${normalized}`);
              } else if (fullPath.includes('/gemma')) {
                ids.add(normalized);
              }
            }
          }
        }
      }

      console.log('Mastermind DEBUG: Found', linkCount, 'model page links');

      // Pattern 2: Look for anchor text like "Gemini 2.5 Pro" in links
      const anchorPattern = /<a[^>]*href=["'][^"']*\/(?:gemini|imagen|veo|gemma)[^"']*["'][^>]*>([^<]+)<\/a>/gi;
      let anchorMatch: RegExpExecArray | null;
      let anchorCount = 0;
      
      while ((anchorMatch = anchorPattern.exec(body)) !== null) {
        anchorCount++;
        const text = anchorMatch[1]?.replace(/<[^>]+>/g, '').trim();
        if (text && text.length >= 3) {
          const normalized = text
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w.-]/g, '')
            .replace(/^-+|-+$/g, '');
          
          if (normalized.length >= 3 && /[a-z]/.test(normalized)) {
            ids.add(normalized);
          }
        }
      }

      console.log('Mastermind DEBUG: Found', anchorCount, 'model anchor texts');

      // Pattern 3: Direct model IDs in code blocks
      const codePattern = /<code[^>]*>([a-z][a-z0-9._-]{4,79})<\/code>/gi;
      let codeMatch: RegExpExecArray | null;
      let codeCount = 0;
      
      while ((codeMatch = codePattern.exec(body)) !== null) {
        codeCount++;
        const candidate = codeMatch[1]?.trim().toLowerCase();
        if (candidate && /[-.]/.test(candidate)) {
          ids.add(candidate);
        }
      }

      console.log('Mastermind DEBUG: Found', codeCount, 'model IDs in code blocks');

    } catch (err) {
      console.warn('Mastermind: Docs scrape error:', err);
    } finally {
      window.clearTimeout(stillRunningTimer);
    }

    const results = [...ids].sort();
    console.log('Mastermind DEBUG: Docs models extracted:', results.length, 'elapsed(ms):', Date.now() - scrapeStart);

    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), models: results }));
      console.log('Mastermind DEBUG: Docs models cached:', results.length, 'elapsed(ms):', Date.now() - scrapeStart);
    } catch (err) {
      console.warn('Mastermind: Failed to write model cache.', err);
    }

    return results;
  }

  async *chat(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = [], signal?: AbortSignal): AsyncGenerator<ChatResponse, void, unknown> {
    const projectId = this.getProjectId();
    const modelId = this.modelId || 'gemini-2.0-flash-exp';
    const location = this.location || 'us-central1';

    try {
      const client = this.getVertexClient();
      const generativeModel = client.getGenerativeModel({
        model: modelId,
      });

      const systemInstructionText = this.customContextPrompt || 'You are Mastermind, an AI assistant for Obsidian with access to the vault.';

      const functionDeclarations: any[] = [
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
      ];

      if (this.permWeb) {
        functionDeclarations.push({
          name: "fetch_url",
          description: "Fetches an HTTP/HTTPS URL and returns text content (truncated to 20KB).",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
            },
            required: ["url"],
          },
        });
      }

      if (this.permTerminal) {
        functionDeclarations.push({
          name: "run_shell_command",
          description: "Executes a shell command on the host and returns stdout/stderr (truncated).",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Command to execute." },
            },
            required: ["command"],
          },
        });
      }

      const tools = [{ function_declarations: functionDeclarations }];

      // Build request contents fresh to avoid leaking non-Vertex fields (e.g., actions) from history
      let contents: any[] = [];
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

      // Track recent tool calls for loop detection
      const recentToolCalls: { name: string; args: string }[] = [];

      for (let i = 0; i < 100; i++) {
        if (signal?.aborted) {
          return;
        }

        const generationConfig = {
          temperature: this.modelTemperature,
          maxOutputTokens: 2048,
        };

        const requestConfig: any = {
          contents,
          tools,
          generationConfig,
        };

        if (systemInstructionText && systemInstructionText.trim()) {
          requestConfig.systemInstruction = systemInstructionText;
        }

        const response = await generativeModel.generateContent(requestConfig);

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
          
          // --- Loop Detection Start ---
          const currentCallSignature = JSON.stringify({ name, args });
          recentToolCalls.push({ name, args: JSON.stringify(args) });
          
          // Keep only the last 3 calls
          if (recentToolCalls.length > 5) {
            recentToolCalls.shift();
          }

          // Check if the last 3 calls are identical
          // We need at least 3 calls to detect a "loop" of 3 repetitions
          let isLooping = false;
          if (recentToolCalls.length >= 3) {
             const last = recentToolCalls[recentToolCalls.length - 1];
             const secondLast = recentToolCalls[recentToolCalls.length - 2];
             const thirdLast = recentToolCalls[recentToolCalls.length - 3];
             
             if (last.name === secondLast.name && last.name === thirdLast.name &&
                 last.args === secondLast.args && last.args === thirdLast.args) {
                 isLooping = true;
             }
          }

          if (isLooping) {
             console.warn('Mastermind: Loop detected. Terminating tool use.');
             yield {
                text: '\n\n**Loop Detected:** I seem to be stuck repeating the same action. I will stop here to avoid an infinite loop.',
                actions: [],
                isThinking: false
             };
             return;
          }
          // --- Loop Detection End ---

          let result: any;
          let status: 'success' | 'error' | 'pending' = 'pending';

          // Yield immediately to show the tool is being called
          yield {
            text: '',
            actions: [{
              tool: name,
              input: args,
              status: 'pending'
            }],
            isThinking: true
          };

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
            } else if (name === 'fetch_url') {
              if (!this.permWeb) {
                throw new Error('Web access is disabled in settings. Enable "Web Access" to allow fetch_url.');
              }
              result = await this.fetchUrl(args.url);
            } else if (name === 'run_shell_command') {
              if (!this.permTerminal) {
                throw new Error('Terminal access is disabled in settings. Enable "Terminal Access" to allow commands.');
              }
              if (this.confirmTerminalDestructive) {
                result = { status: 'error', message: 'Terminal commands require disabling "Confirm Terminal Commands" in settings.' };
              } else {
                result = await this.runShellCommand(String(args.command || ''));
              }
            }
            status = result?.status === 'error' ? 'error' : 'success';
          } catch (err: any) {
            result = { status: 'error', message: err.message };
            status = 'error';
          }

          // Yield again with result
          yield {
            text: '',
            actions: [{
              tool: name,
              input: args,
              output: result,
              status: status
            }],
            isThinking: true
          };

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
          // Extract thinking blocks and main text
          const fullText = part.text || '';
          console.log('DEBUG: Full response text:', fullText.substring(0, 200));
          
          const thinkingMatch = fullText.match(/```thinking\n([\s\S]*?)\n```/);
          console.log('DEBUG: Thinking match found:', !!thinkingMatch);
          
          if (thinkingMatch) {
            const thinkingText = thinkingMatch[1].trim();
            const mainText = fullText.replace(/```thinking\n[\s\S]*?\n```\n?/, '').trim();
            
            console.log('DEBUG: Thinking text:', thinkingText.substring(0, 100));
            console.log('DEBUG: Main text:', mainText.substring(0, 100));
            
            // Yield thinking block first with streaming indicator
            yield {
              text: mainText,
              actions: [],
              isThinking: true,
              thinkingText: thinkingText
            };
          } else {
            console.log('DEBUG: No thinking block found, yielding full text');
            yield {
              text: fullText,
              actions: []
            };
          }
          return;
        }
      }

      throw new Error('Maximum tool use iterations reached.');
    } catch (error) {
      console.error('Mastermind Chat Error:', error);
      throw error;
    }
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

  private async fetchUrl(rawUrl: string): Promise<{ status: string; url: string; statusCode: number; headers: Record<string, string>; body: string; truncated: boolean }> {
    const url = (rawUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only http/https URLs are allowed.');
    }

    const response = await requestUrl({ url, method: 'GET' });
    const maxLen = 20000;
    const bodyText = response.text || '';
    const truncated = bodyText.length > maxLen;

    return {
      status: 'success',
      url,
      statusCode: response.status,
      headers: response.headers || {},
      body: truncated ? bodyText.substring(0, maxLen) : bodyText,
      truncated,
    };
  }

  private async runShellCommand(command: string): Promise<{ status: string; stdout: string; stderr: string; exitCode: number; truncated: boolean }> {
    const cmd = command.trim();
    if (!cmd) {
      throw new Error('Command is empty.');
    }

    const maxLen = 20000;

    const execPromise = () => new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      const child = cpExec(cmd, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const code = (error as any)?.code ?? 0;
        if (error && (error as any).killed) {
          reject(new Error('Command timed out.'));
          return;
        }
        resolve({ stdout, stderr, code });
      });

      child.on('error', (err) => reject(err));
    });

    const { stdout, stderr, code } = await execPromise();
    const out = stdout || '';
    const err = stderr || '';
    const combinedLen = out.length + err.length;
    const truncated = combinedLen > maxLen;

    const trimmedStdout = truncated ? out.substring(0, Math.max(0, maxLen - err.length)) : out;
    const trimmedStderr = truncated ? err.substring(0, Math.max(0, maxLen - trimmedStdout.length)) : err;

    return {
      status: code === 0 ? 'success' : 'error',
      stdout: trimmedStdout,
      stderr: trimmedStderr,
      exitCode: code,
      truncated,
    };
  }
}
