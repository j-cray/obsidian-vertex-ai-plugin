import { App, TFile, requestUrl, Notice } from 'obsidian';
import { ChatResponse, ToolAction } from '../types';
import { VertexAI } from '@google-cloud/vertexai';

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
      const client = this.getVertexClient();
      const projectId = this.getProjectId();
      const location = this.location || 'us-central1';

      // Use the SDK's list method (Google Cloud client libraries handle auth internally)
      // For now, we'll construct the request manually but let the SDK handle auth
      const response = await requestUrl({
        url: `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/models?pageSize=100`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        const data = response.json;
        if (data.models && data.models.length > 0) {
          const fetched: string[] = data.models
            .map((m: any) => m.displayName || m.name)
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
