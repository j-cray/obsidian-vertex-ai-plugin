import { requestUrl } from 'obsidian';

export class VertexService {
  private apiKey!: string;
  private projectId!: string;
  private location!: string;
  private modelId!: string;

  constructor(settings: { apiKey: string, projectId: string, location: string, modelId: string }) {
    this.updateSettings(settings);
  }

  updateSettings(settings: { apiKey: string, projectId: string, location: string, modelId: string }) {
    this.apiKey = settings.apiKey;
    this.projectId = settings.projectId;
    this.location = settings.location;
    this.modelId = settings.modelId;
  }

  async chat(prompt: string, context: string, vaultService: any, history: any[] = [], images: { mimeType: string, data: string }[] = []): Promise<string> {
    if (!this.apiKey || !this.projectId) {
      throw new Error('Vertex AI (API Key and Project ID) not configured.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId || 'gemini-1.5-pro'}:generateContent?key=${this.apiKey}`;

    const systemInstruction = `You are "Mastermind", a highly capable AI assistant for Obsidian.
You have access to the user's notes and knowledge vault.
Be concise, professional, and insightful.
Always use the provided context to answer questions if available.
You can use tools to search, read, list, and create notes in the vault.`;

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
          }
        ]
      }
    ];

    // Combine history and current request
    let contents: any[] = [...history];

    const parts: any[] = [{ text: `Context from vault:\n${context}\n\nUser Question: ${prompt}` }];

    // Add images if available
    for (const img of images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data
        }
      });
    }

    contents.push({
      role: 'user',
      parts: parts
    });

    // Max 5 turns of tool use to prevent infinite loops
    for (let i = 0; i < 5; i++) {
      const body = {
        contents,
        system_instruction: { parts: [{ text: systemInstruction }] },
        tools,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      };

      const response = await requestUrl({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (response.status !== 200) {
        throw new Error(`API returned status ${response.status}: ${response.text}`);
      }

      const data = response.json;
      const candidate = data.candidates[0];
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
          }
        } catch (err: any) {
          result = { status: 'error', message: err.message };
        }

        contents.push(candidate.content); // Add the function call message
        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name,
                response: { name, content: result }
              }
            }
          ]
        });
      } else {
        return part.text;
      }
    }

    throw new Error('Maximum tool use iterations reached.');
  }
}
