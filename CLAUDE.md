# Oracle — Project Bible

## Vision
Build a personal AI agent in the spirit of JARVIS from Iron Man: a system that reasons, learns, remembers, and develops a genuine personality and partnership with the user across sessions. This is not a chatbot — it is a long-term intelligent companion that grows over time.

## Architecture: Three Layers

### Layer 1 — Agent System (the core)
All intelligence lives here. This layer is responsible for:
- Orchestrating LLM calls (text, vision, image generation, embeddings)
- Managing context: compaction via summarization, relevance-based message hiding
- Memory: vector DB (Vectra + local embedding endpoint) for long-term recall
- Personality structures: persistent traits, relationship model, user understanding
- Learning: logging successes/failures, updating behavior over time
- Multi-step reasoning: internal reasoning loops before responding

### Layer 2 — Agent API
A Node.js HTTP API that exposes the agent system. Key constraint: **this API must be usable by Claude Code itself** to have conversations with the agent and evaluate it autonomously. Endpoints at minimum:
- POST a message → receive full conversation state/response
- GET conversation history
- Any memory/state inspection endpoints useful for evaluation

### Layer 3 — Web UI
HTML/CSS/JS frontend (no heavy framework unless justified). Chat interface + workspace. Consumes the Agent API.

## Local LLM Endpoints
Already running and tested. The agent must use these — never external LLM APIs unless explicitly decided otherwise:
- **Text generation** — general responses
- **Vision** — image interpretation
- **Image generation** — create images
- **Embeddings** — for vector memory

## Goal 1: Reasoning, Memory, Personality, Partnership
The first milestone. Solve:
1. **Context management** — summarization-based compaction, relevance scoring to hide/show messages
2. **Vector memory** — embed and store memories, retrieve by semantic similarity (Vectra)
3. **Personality system** — persistent traits, tone, preferences that evolve
4. **User model** — structured understanding of who the user is, what they care about
5. **Relationship tracking** — history of interactions, trust, familiarity
6. **Learning** — record what worked/failed, adjust future behavior
7. **Multi-step reasoning** — internal scratchpad/chain-of-thought before final response

## Goal 2: Tool Integrations (after Goal 1 foundation is solid)
Make the agent actually useful. Approaches to evaluate:
- Specialized sub-agents (avoid polluting main system prompt)
- JSON tool-calling directives
- Special directive syntax + free text
- Feedback loops for correction

Priority tool: **software development assistance**.

## Principles
- Node.js backend, vanilla HTML/CSS/JS frontend
- Local-first: all inference runs locally
- The API is the evaluation harness — Claude Code uses it to test the agent
- Incremental: each session should leave the system in a better, working state
- No over-engineering. Build what's needed for the current milestone.
- Commit working state frequently.

## Working Method
At the start of each session: read this file + `PLAN.md`.
At the end of each session or milestone: update `PLAN.md`.
Use the Agent API to have conversations with Oracle and evaluate behavior.
