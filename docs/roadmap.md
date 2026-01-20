# Mastermind Plugin Roadmap & Architecture

This document outlines the long-term vision and technical architecture for the Obsidian Vertex AI Mastermind plugin.

## 1. Core Philosophy
Mastermind aims to be the unified "AI Operating System" for your Obsidian vault, not just a chat window. It should seamlessly blend reasoning, creation (text/code/images), and vault manipulation.

## 2. Model Strategy
We support a "Batteries Included" approach with extensive customization options.

### Built-in Models (Authoritative List)
We maintain a curated list of Google's latest state-of-the-art models (Gemini 3, Imagen 3). This list is updated frequently to ensure users always have access to the bleeding edge without configuration.

### Custom Models & Model Garden
To bring in other models (e.g., Llama 3, Mistral, Claude 3.5 Sonnet) via Vertex AI:
1.  **Deploy**: Deploy the model to a Vertex AI Endpoint in your Google Cloud Project.
2.  **ID**: Copy the **Endpoint ID** (numeric) or full resource path.
3.  **Use**: Paste this ID into the "Model ID" field in Mastermind settings. The plugin automatically detects numeric IDs as custom endpoints and switches to the `predict` API.

**Future Feature**: A "Add Custom Model" UI in settings to save and alias these endpoints (e.g., "My Llama 3").

## 3. Advanced Capabilities (Roadmap)
*   **Multimodal RAG**: Currently, we read text files. Future state will index images and PDFs in your vault for visual Q&A.
*   **Agentic Workflows**: Implementation of true "Agent" mode where Mastermind can chain multiple steps (Plan -> Code -> Critique -> Fix) without user intervention.
*   **Local Models**: Integration with Ollama for a hybrid Cloud/Local workflow (privacy-sensitive notes stay local).

## 4. Technical Debt & Refactoring
*   **Chat View Separation**: The `ChatView.ts` is becoming monolithic. We plan to componentize the message rendering (especially with new Image/Thinking blocks).
*   **State Management**: Move from ad-hoc state to a dedicated state manager (e.g., Svelte store or React Context if we migrate UI frameworks).
