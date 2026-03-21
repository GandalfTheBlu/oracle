# Oracle — Plan

## Current Status
**Phase:** Phase 1 — Foundation
**Last session:** Milestone 1.1 complete. Agent API running, LLM responding end-to-end.

---

## Phase 1 — Foundation (Goal 1: Reasoning, Memory, Personality)

### Milestone 1.1 — Skeleton ✅
- [x] Project structure: `agent/`, `api/`, `ui/`
- [x] `package.json` with Express + cors dependencies
- [x] Basic Agent API server — GET /health, POST /message, GET /history, POST /reset
- [x] Stub Agent class with in-memory conversation history, wired to LLM endpoint
- [x] POST /message → returns LLM response and full history
- [x] Verified: Claude Code called the API and received a real LLM response

### Milestone 1.2 — Conversation & Context (next)

### Milestone 1.2 — Conversation & Context
- [ ] Persist conversation history to disk (JSON) so it survives restarts
- [ ] Conversation history management (in-memory, then persistent)
- [ ] Context window tracking (token estimation)
- [ ] Summarization-based compaction when context exceeds threshold
- [ ] Relevance scoring for message hiding

### Milestone 1.3 — Vector Memory
- [ ] Integrate Vectra local vector DB
- [ ] Embed and store memories via local embedding endpoint
- [ ] Retrieve relevant memories on each turn
- [ ] Memory types: episodic (events), semantic (facts about user/world)

### Milestone 1.4 — Personality & User Model
- [ ] Persistent personality config (traits, tone, quirks)
- [ ] User model: structured profile built from interactions
- [ ] Relationship state: familiarity, trust, history summary
- [ ] Personality injected into system prompt dynamically

### Milestone 1.5 — Learning & Reasoning
- [ ] Multi-step reasoning: internal scratchpad before final response
- [ ] Success/failure logging
- [ ] Feedback mechanism to adjust behavior

### Milestone 1.6 — Web UI (basic)
- [ ] HTML/CSS/JS chat interface
- [ ] Connects to Agent API
- [ ] Displays conversation with basic styling

---

## Phase 2 — Tool Integrations (Goal 2)

*(Not started. Begins after Phase 1 milestones are solid.)*

- [ ] Evaluate tool-calling approaches
- [ ] Sub-agent architecture design
- [ ] Software development tools (file read/write, shell, search)
- [ ] Feedback loop for tool corrections

---

## Notes / Decisions Log
- Endpoints run on separate PC at `192.168.0.208` (local network). Config in `config.json`.
- LLM: `:8080` — Qwen2.5-Coder-14B, context 4096, `--jinja`, OpenAI-compatible API
- Embedding: `:8081` — nomic-embed-text-v1.5, context 512, OpenAI-compatible API
- Vision (`:8082`) and image gen (`:8188` ComfyUI) — present in config but inactive until further notice
- UI: vanilla JS unless a specific need justifies a framework
- Evaluation method: Claude Code posts to Agent API and assesses responses directly
