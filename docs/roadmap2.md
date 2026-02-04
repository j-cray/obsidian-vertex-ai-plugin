# Mastermind: Production-Ready Agentic AI Roadmap

**Document:** `roadmap2.md`
**Status:** Draft
**Last Updated:** 2026-02-04
**Aligns With:** Google Gen AI Agent SDK (Vertex AI)

## Overview

This roadmap outlines the evolution of the Mastermind Obsidian plugin into a fully-featured, production-ready AI Agent Operating System. The strategy aligns with Google's **Agent Development Kit (ADK)** principles: **Modularity**, **Tool-Use**, **Orchestration**, and **Memory**.

The goal is to transition from a simple "Chat Integration" to a true **Agentic Architecture** capable of autonomous multi-step reasoning, vault-wide refactoring, and multimodal interaction.

## Work Packages (OpenProject Import Ready)

### Phase 1: Foundation - The Agent Runtime

**Type:** Phase
**Description:** Establishing the core architecture required to support advanced agentic behaviors, mirroring the "Runtime" and "Orchestrator" concepts from the Google Agent SDK.
**Assignee:** Jake Wray

| Task ID | Task Name | Description | Estimate | Start Date | Due Date |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1.1** | **State Management Overhaul** | Migrate from ad-hoc state to a centralized, reactive store (e.g., Signal-based or Svelte Store) to handle complex agent states (Thinking, Executing, Awaiting Input). | 16h | TBD | TBD |
| **1.2** | **Tool Registry Implementation** | specific interface `IAgentTool` (schema, execute, description) compatible with Gemini Function Calling. Implement a dynamic registry to register/unregister tools at runtime. | 12h | TBD | TBD |
| **1.3** | **Vertex AI Session Manager** | Refactor current API calls into a persistent `SessionManager` that handles history pruning, context caching (Google ADK style), and multi-turn durability. | 20h | TBD | TBD |
| **1.4** | **Async Action Bus** | Create an event bus for asynchronous agent actions (e.g., "Agent requested file read" -> "UI shows spinner" -> "System reads file" -> "Agent receives content"). | 8h | TBD | TBD |
| **1.5** | **Telemetry & Tracing** | Implement "Thought Tracing" logs visible in a debug panel. Trace every LLM decision, tool call, and result for debugging agent loops. | 12h | TBD | TBD |

---

### Phase 2: Core Capabilities - The Toolset

**Type:** Phase
**Description:** Equipping the agent with the fundamental tools to interact with the Obsidian Vault and the outside world, following the "Tools" pattern of the SDK.
**Assignee:** Jake Wray

| Task ID | Task Name | Description | Estimate | Start Date | Due Date |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **2.1** | **Vault Reader Tool** | Implement `read_file(path)` and `list_dir(path)` with strict permission scopes (e.g., allow-list folders). | 6h | TBD | TBD |
| **2.2** | **Semantic Search Tool** | Integrate a local vector store (or Vertex AI Vector Search) to allow the agent to perform `search_knowledge(query)` against the user's vault. | 24h | TBD | TBD |
| **2.3** | **Vault Writer Tool** | Implement `create_file` and `update_file` (diff-based). crucial for "Refactor this note" workflows. Include an "Approve Diff" UI step for safety. | 18h | TBD | TBD |
| **2.4** | **Web Research Tool** | Implement a `google_search` tool using Google's Programmable Search Engine API or Serper to allow the agent to fetch outside context. | 10h | TBD | TBD |
| **2.5** | **Graph Analysis Tool** | Allow the agent to query the Obsidian Link Graph (`get_linked_notes(path)`, `get_backlinks(path)`) for structure-aware reasoning. | 8h | TBD | TBD |

---

### Phase 3: Intelligence - The "Mastermind" Orchestrator

**Type:** Phase
**Description:** Implementing the high-level cognitive architecture. Moving from "ReAct" loops to simpler or more complex routing as defined in Google's agent patterns.
**Assignee:** Jake Wray

| Task ID | Task Name | Description | Estimate | Start Date | Due Date |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **3.1** | **Orchestrator Logic** | Implement the "Router" agent. It decides whether to answer directly, use a tool, or delegate to a specialized sub-agent (e.g., "Coder", "Writer"). | 24h | TBD | TBD |
| **3.2** | **Plan-and-Execute Pattern** | Implement a specific mode where the agent generates a TODO list (Plan) before executing steps, allowing user feedback on the plan before execution matches. | 20h | TBD | TBD |
| **3.3** | **Thinking Mode (CoT) UI** | Visualize the agent's "internal monologue" or "Chain of Thought" in a collapsible UI block, separate from the final answer. | 12h | TBD | TBD |
| **3.4** | **Memory & Personalization** | Implement a "User Profile" system (Google ADK Memory) that learns user preferences (tone, format) and injects them into the system prompt dynamicallly. | 16h | TBD | TBD |

---

### Phase 4: Production Polish & Multimodal

**Type:** Phase
**Description:** Ensuring the plugin is robust, beautiful, and leverages the full multimodal capabilities of Gemini 1.5/2.0 Pro.
**Assignee:** Jake Wray

| Task ID | Task Name | Description | Estimate | Start Date | Due Date |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **4.1** | **Multimodal Input Support** | Allow dragging and dropping images/audio into the chat. Agent uses `gemini-pro-vision` capabilities to analyze assets. | 14h | TBD | TBD |
| **4.2** | **Streaming UI Refinement** | Smooth "Typewriter" effect, robust error handling for network drops, and Markdown rendering optimization for large responses. | 10h | TBD | TBD |
| **4.3** | **Security & Guardrails** | Implement "Safety Settings" (Hate speech, dangerous content) and a "Prompt Injection" defense layer (Model Armor concepts). | 8h | TBD | TBD |
| **4.4** | **Onboarding Experience** | Create an interactive "Welcome" tour that helps users set up their Google Cloud Project credentials and choose their first model. | 12h | TBD | TBD |

---

## Milestones

### Milestone 1: The "Runtime" Alpha

**Components:** Phase 1 Complete
**Goal:** A stable plugin where the "Agent" can receive a message and trace its own internal state, even if it has no tools yet.
**Target Estimate:** ~2 Weeks

### Milestone 2: The "Vault Scholar" Beta

**Components:** Phase 2 Complete (Reader/Search Tools)
**Goal:** The agent can answer questions by actually reading and searching the vault. "Chat with your notes" is fully realized.
**Target Estimate:** ~4 Weeks

### Milestone 3: The "Active Agent" Release

**Components:** Phase 2 (Writer Tasks) + Phase 3 (Orchestrator)
**Goal:** The Agent can DO things (write files, refactor notes) and PLAN complex tasks.
**Target Estimate:** ~6 Weeks

### Milestone 4: Production V1.0

**Components:** All Phases Complete
**Goal:** Full public release. Multimodal, polished, secure, and fully documented.
**Target Estimate:** ~8 Weeks
