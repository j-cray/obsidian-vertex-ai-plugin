# Mastermind Capability Enhancement Plan

## UI/UX Improvements
- [ ] **Model Picker**: UI to show all available Vertex AI models (fix potential `gemini-3-pro` naming issue).
- [ ] **Thinking Animation**: Smooth visual indicator when different models are processing.
- [ ] **Toolbar Widget**:
    - Embedded Model Switcher.
    - Quick Options/Info panel.
    - Direct "Settings" button.
- [ ] **Chat Interface Enhancements**:
    - **Selectable Text**: Ensure all conversation text is easily selectable.
    - **Profile Pictures**: Avatars for User and Mastermind in chat.
        - *Settings*: Add ability to customize both avatars.
    - **Input Bar Overhaul**:
        - Move icons *inside* the text input bar.
        - Add buttons: File 📂, Photo 🖼️, Camera 📷, Mic 🎤.
        - Change Send icon to Paper Airplane ✈️.

## Agentic Capabilities (Maximum Power)
- [ ] **Full Vault Access**:
    - Unrestricted ability to Create, Read, Update, and Delete files.
    - **Destructive Actions**: Default to *no confirmation required* for deletion.
    - *Setting*: Add optional "Ask to confirm destructive actions" toggle.
- [ ] **Output & File Management**:
    - **Visible Storage**: Store everything in a dedicated, visible root folder (e.g., `Mastermind_AI/`).
    - **Planning**: Generate frequent `.md` files for plans and thoughts.
    - **History**: Save full conversation history as organized Markdown files.
    - **Organization**: Use subfolders (e.g., `/Conversations`, `/Images`, `/Plans`).

## Integrations
- [ ] **GitHub**: Deep integration (TBD: commit/push/pull capabilities).
- [ ] **Nextcloud**: Integration for file sync/access (TBD).

## Context & Optimization
- [ ] **Context Configuration**:
    - **Hardcoded**: "You are an assistant for this Obsidian Vault."
    - **Customizable**: Add "Custom Context Prompt" field in settings.
- [ ] **Token Efficiency**: Implement stateless/lossless methods to minimize context usage while maintaining high intelligence.
