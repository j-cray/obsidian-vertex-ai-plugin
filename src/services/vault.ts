import { App, TFile, requestUrl } from 'obsidian';

export class VaultService {
  app: App;

  constructor(app: App) {
    this.app = app;
  }

  async getRelevantContext(query: string): Promise<string> {
    const activeFile = this.app.workspace.getActiveFile();
    let context = '';

    if (activeFile) {
      const content = await this.app.vault.read(activeFile);
      context += `--- ACTIVE FILE: ${activeFile.path} ---\n${content}\n\n`;
    }

    // Advanced content-based search for relevant notes
    const files = this.app.vault.getMarkdownFiles();
    const queryLower = query.toLowerCase();

    const scores = await Promise.all(files.map(async file => {
      let score = 0;
      if (file.name.toLowerCase().includes(queryLower)) score += 10;
      if (file.path.toLowerCase().includes(queryLower)) score += 5;

      // Basic content relevance check (first 5000 chars for speed)
      const content = await this.app.vault.read(file);
      const contentSnippet = content.substring(0, 5000).toLowerCase();
      if (contentSnippet.includes(queryLower)) score += 20;

      return { file, score };
    }));

    const relevantFiles = scores
      .filter(item => item.score > 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    for (const item of relevantFiles) {
      if (item.file.path === activeFile?.path) continue;
      const content = await this.app.vault.read(item.file);
      context += `--- RELEVANT FILE: ${item.file.path} ---\n${content.substring(0, 2000)}...\n\n`;
    }

    return context || 'No immediate relevant context found. Mastermind may need to search the vault.';
  }

  async listMarkdownFiles(): Promise<string[]> {
    return this.app.vault.getMarkdownFiles().map(f => f.path);
  }

  async getFileContent(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    throw new Error(`File not found or not a markdown file: ${path}`);
  }

  async getActiveNoteImages(): Promise<{ mimeType: string, data: string }[]> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return [];

    const content = await this.app.vault.read(activeFile);
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    const images: { mimeType: string, data: string }[] = [];

    // Regex for ![[image.png]] or ![](image.png)
    const wikilinkRegex = /!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp))\]\]/gi;
    const mdlinkRegex = /!\[(?:[^\]]*)\]\(([^)]+\.(?:png|jpg|jpeg|gif|webp))\)/gi;

    const findImages = async (regex: RegExp, content: string) => {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const link = match[1];
        const file = this.app.metadataCache.getFirstLinkpathDest(link, activeFile.path);
        if (file instanceof TFile && imageExtensions.includes(file.extension.toLowerCase())) {
          const buffer = await this.app.vault.readBinary(file);
          const base64 = this.arrayBufferToBase64(buffer);
          const mimeType = `image/${file.extension === 'jpg' ? 'jpeg' : file.extension}`;
          images.push({ mimeType, data: base64 });
        }
      }
    };

    await findImages(wikilinkRegex, content);
    await findImages(mdlinkRegex, content);

    return images;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  async searchVault(query: string): Promise<string[]> {
    const queryLower = query.toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    const results: string[] = [];

    for (const file of files) {
      const content = await this.app.vault.read(file);
      if (content.toLowerCase().includes(queryLower) || file.path.toLowerCase().includes(queryLower)) {
        results.push(file.path);
      }
      if (results.length >= 20) break; // Limit results
    }

    return results;
  }

  async createFolder(path: string): Promise<void> {
    if (!await this.app.vault.adapter.exists(path)) {
      await this.app.vault.createFolder(path);
    }
  }

  async createNote(path: string, content: string): Promise<void> {
    const normalizedPath = path.endsWith('.md') ? path : `${path}.md`;

    // Ensure parent directory exists
    const folders = normalizedPath.split('/').slice(0, -1);
    if (folders.length > 0) {
      const folderPath = folders.join('/');
      // Recursive folder creation is a bit manual in Obsidian API versions,
      // but adapter.exists check helps.
      // For simplicity, we assume one level or try to create.
      // Better: Recursively create.
      await this.ensureFoldersExist(folderPath);
    }

    // Check if exists, if so, we might want to update or error.
    // Agentic behavior: Overwrite? Or Unique name?
    // "Mastermind should generate a lot of md files... and minimize token usage"
    // Let's safe create for now to avoid accidental overwrites of user data unless asked.
    // Actually, "Maximum capabilities including deleting files" -> Permission to overwrite!

    if (await this.app.vault.adapter.exists(normalizedPath)) {
      // Update existing
      const file = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (file instanceof TFile) {
        await this.app.vault.modify(file, content);
        return;
      }
    }

    await this.app.vault.create(normalizedPath, content);
  }

  async ensureFoldersExist(path: string) {
    const dirs = path.split('/');
    let currentPath = '';
    for (const dir of dirs) {
      currentPath = currentPath === '' ? dir : `${currentPath}/${dir}`;
      if (!await this.app.vault.adapter.exists(currentPath)) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  async deleteFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      await this.app.vault.delete(file, true); // true = force (bypass trash)
    } else {
      throw new Error(`File to delete not found: ${path}`);
    }
  }

  async getAllFileNames(): Promise<Set<string>> {
    const files = this.app.vault.getMarkdownFiles();
    const fileNames = new Set<string>();
    for (const file of files) {
      if (file.basename) {
        fileNames.add(file.basename);
      }
    }
    return fileNames;
  }
  async writeHistory(history: { role: string, parts: any[] }[], sessionId?: string): Promise<string> {
    const historyFolder = 'Mastermind/History';
    await this.ensureFoldersExist(historyFolder);

    // If no session ID, generate a new one based on timestamp
    let filename = sessionId;
    if (!filename) {
      const now = new Date();
      filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    }

    // Ensure .md extension
    if (!filename.endsWith('.md')) filename += '.md';

    const path = `${historyFolder}/${filename}`;

    // Format Content
    let content = '# Mastermind Conversation\n\n';
    history.forEach(msg => {
      const role = msg.role === 'user' ? 'User' : 'Mastermind';
      const text = msg.parts.map(p => p.text).join('\n');
      content += `> **${role}**\n${text}\n\n`;
    });
    content += `\n*Auto-saved at ${new Date().toISOString()}*`;

    // Write file (overwrite to update full history)
    await this.createOrUpdateNote(path, content);

    return filename.replace('.md', ''); // Return ID for persistence
  }

  async listFolder(path: string): Promise<string[]> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder || !(folder as any).children) {
      throw new Error(`Folder not found: ${path}`);
    }
    return (folder as any).children.map((child: any) => child.path);
  }

  async moveFile(oldPath: string, newPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(oldPath);
    if (!file) {
      throw new Error(`File or folder not found: ${oldPath}`);
    }

    // Ensure parent directory of newPath exists
    const folders = newPath.split('/').slice(0, -1);
    if (folders.length > 0) {
      await this.ensureFoldersExist(folders.join('/'));
    }

    if (await this.app.vault.adapter.exists(newPath)) {
      throw new Error(`A file or folder already exists at the destination path: ${newPath}`);
    }

    await this.app.vault.rename(file, newPath);
  }

  // Improved Implementation: createOrUpdateNote
  async createOrUpdateNote(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      // Ensure folders
      const lastSlash = path.lastIndexOf('/');
      if (lastSlash !== -1) {
        await this.ensureFoldersExist(path.substring(0, lastSlash));
      }
      await this.app.vault.create(path, content);
    }
  }

  async writeLog(message: string): Promise<void> {
    const logPath = 'Mastermind/Logs/debug.md';
    let currentContent = '';
    try {
      currentContent = await this.getFileContent(logPath);
    } catch {
      currentContent = '# Mastermind Debug Logs\n\n';
    }
    const timestamp = new Date().toISOString();
    const newContent = `${currentContent}\n[${timestamp}] ${message}\n`;
    await this.createOrUpdateNote(logPath, newContent);
  }

  async saveImage(base64Data: string): Promise<string> {
    const folder = 'Mastermind_Images';
    await this.ensureFoldersExist(folder);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `Generated-${timestamp}.png`;
    const filepath = `${folder}/${filename}`;

    const buffer = this.base64ToArrayBuffer(base64Data);

    // Check if file exists (unlikely with timestamp)
    if (await this.app.vault.adapter.exists(filepath)) {
      // Logic to handle overwrite/rename if needed, but timestamp should be unique enough
    }

    await this.app.vault.createBinary(filepath, buffer);

    // Return markdown link
    return `![Generated Image](${filepath})`;
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
