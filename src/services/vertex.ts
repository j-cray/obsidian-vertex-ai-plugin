import { requestUrl } from 'obsidian';

export class VertexService {
  private serviceAccountJson!: string;
  private location!: string;
  private modelId!: string;
  private customContextPrompt: string = '';
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

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

  async listModels(): Promise<string[]> {
    const accessToken = await this.getAccessToken();
    const projectId = JSON.parse(this.serviceAccountJson).project_id;
    const location = this.location || 'us-central1';

    // Vertex AI Model List Endpoint
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models`;

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (response.status !== 200) {
        console.error('Failed to list models', response);
        return [];
      }

      const data = response.json;
      // Filter for Gemini models
      return data.models
        ?.filter((m: any) => m.name.includes('gemini') && !m.name.includes('vision')) // Basic filter
        ?.map((m: any) => m.name.split('/').pop()) || [];
    } catch (e) {
      console.error('Error listing models:', e);
      return [];
    }
  }

  async chat(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = []): Promise<string> {
    const accessToken = await this.getAccessToken();
    const projectId = JSON.parse(this.serviceAccountJson).project_id;

    // Use default if not set
    const model = this.modelId || 'gemini-1.5-pro-preview-0409';
    const location = this.location || 'us-central1';

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

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

      if (part.functionCall) {
        const { name, args } = part.functionCall;
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
