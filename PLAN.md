# Oracle — Plan

## Current Status
**Phase:** Phase 3 — Intelligence & Partnership (ongoing)
**Model:** Qwen3-8B-Q8_0 @ 192.168.0.208:8080 — context 8192, `--jinja --reasoning-budget 0`
**Last session:** Deep eval of Qwen2.5-7B revealed critical failures (tools never firing, epistemic capitulation, personality non-compliance). Root cause of tool invocation fixed. Worker+Voice architecture trialled and abandoned. Migrated to Qwen3-8B with native thinking mode and simplified single-pass architecture. 153 tests green.

---

## Phase 3 — Intelligence & Partnership

### Milestone 3.1 — Personality & User Model Evaluation ✅
- [x] Persona: Maya Chen — senior backend engineer, Go/Python, distributed systems, hates over-explanation
- [x] 8-turn structured session: intro, preference signal, technical task, correction, casual, follow-up, length correction, closing
- [x] Bugs found and fixed:
  - Memory extractor was storing Oracle's knowledge statements instead of user facts
  - User model didn't capture `name` field
  - Preferences too vague — improved extraction prompt + hard directive
  - `updateUserModel` was fire-and-forget — made synchronous so preferences are live next turn
- [x] tests/eval_persona.js: 8 graded checks (8/8 pass)

### Milestone 3.2 — Self-Reflection / Validation Loop ✅ (superseded)
- [x] agent/reflection.js: post-reply LLM pass to validate tool output fidelity
- Removed in Qwen3 migration — thinking mode on tool loop round 0 covers this natively

### Milestone 3.3 — Cross-Context Awareness ✅
- [x] agent/context_awareness.js: buildSituationalContext() — git branch/commits, recent files, focus file
- [x] 30s cache, depth-3 walk, skips node_modules/.git/dist
- [x] config.json: contextAwareness.{enabled, recentFileHours, maxRecentFiles}

### Milestone 3.4b — Codebase Analyzer ✅
- [x] agent/codebase_analyzer.js: two-pass strategy (per-file micro-analysis + synthesis)
- [x] Overlapping chunk strategy for large files (CHUNK_SIZE=5500, CHUNK_OVERLAP=500)
- [x] Incremental: mtime diffing — only re-analyzes changed files
- [x] Output: .oracle/CODEBASE.md with Architecture, File Summaries, Issues sections
- [x] POST /analyze endpoint + GET /analyze/status + GET /analyze/log
- [x] Startup deferred analysis (5s after boot)

### Milestone 3.4c — Workspace Isolation ✅
- [x] agent/workspace.js: discovers workspace by walking up from CWD for .oracle/ (like .git/)
- [x] Per-project data isolation: memories, personality, history all in <project>/.oracle/data/
- [x] DATA_DIR env var bypass for test isolation
- [x] config.json: hardcoded paths removed, only global defaults remain
- [x] UI: persistent analysis log panel (all runs with timestamps, file counts, issues)

### Milestone 3.6 — Goal Tracking & Autonomous Execution ✅
- [x] agent/goals.js: persistent goals model (goals.json), CRUD + background extraction
- [x] agent/executor.js: autonomous multi-step execution loop with tool access, [DONE] signal, 10-step cap
- [x] API: GET/POST/PATCH/DELETE /goals + POST /goals/:id/execute (SSE stream)
- [x] UI: Goals panel (amber theme) — status badges, execute/cancel/delete, live step streaming

### Milestone 3.0 — Native Function Calling ✅
- [x] Removed XML tool parser entirely
- [x] llm.js: tools/tool_choice:'auto' passed to API, returns {content, tool_calls, finish_reason}
- [x] TOOLS_SCHEMA: OpenAI function definitions for all 7 tools
- [x] _runToolLoop: iterates tool_calls, injects results as {role:'tool', tool_call_id, content}

### Milestone 3.X — Tool Invocation Bug Fix ✅
- [x] Root cause: reasoning note ended with "Now give your actual reply:" which suppressed tool_calls
- [x] Fix: changed to "Now respond — call tools if needed, then reply."
- [x] Verified: read_file, write_file called correctly after fix

### Milestone 3.Y — Qwen3 Migration & Architecture Simplification ✅
- [x] **Evaluation findings (Qwen2.5-7B, 46-turn + 48-turn evals):**
  - Tools: 0/10 → 2/10 (still unreliable, phantom success failure mode)
  - Epistemic stability: 2/10 → 1/10 (capitulation poisoning memory store)
  - Personality: 3/10 (sycophancy not overridable via system prompt at 7B)
  - Worker+Voice architecture: added latency without measurable quality improvement
- [x] **Root cause analysis:** 7B model cannot hold personality + tool use + epistemic integrity simultaneously; RLHF sycophancy overpowers instruction tuning at this scale
- [x] **Decision:** Migrate to Qwen3-8B-Q8_0 — generational step up, per-request thinking mode
- [x] **Architecture simplified:**
  - Single-pass: full Oracle identity + personality + user model + memories in one system prompt
  - Tool loop round 0: thinking mode (`/think` prefix, 2048 token budget) — Qwen3 plans before acting
  - Tool loop rounds 1+: fast mode (`--reasoning-budget 0` default)
  - Removed: separate reason() pass, Voice agent (agent/voice.js), reflection pass
  - Restored: buildPersonalityPrompt, buildUserModelPrompt in main system prompt
  - Added: epistemic stability directive, phantom success guard in BASE_SYSTEM_PROMPT
- [x] llm.js: thinking option — prepends /think to system message per-request
- [x] 153 tests green

### Milestone 3.5 — Text-to-Speech (local agent voice)
Give Oracle a voice while keeping everything local.
- [ ] Evaluate local TTS options: Kokoro, Piper, Coqui
- [ ] Add TTS endpoint or sidecar process
- [ ] UI: auto-play assistant responses, toggle on/off

### Milestone 3.7 — Vision / Multi-Modal Input (low priority)
- [ ] Wire up existing vision endpoint (:8082, already configured)
- [ ] UI: image upload/paste → description injected as context

---

## Phase 4 — TBD
Milestones to be defined after Qwen3 evaluation results.

---

## Phase 1 — Foundation ✅

### Milestone 1.1 — Skeleton ✅
- [x] Project structure: agent/, api/, ui/
- [x] Basic Agent API: GET /health, POST /message, GET /history, POST /reset
- [x] Stub Agent class with in-memory history, wired to LLM

### Milestone 1.2 — Conversation & Context ✅
- [x] Persistent history (JSON), token estimation, summarization-based compaction, relevance scoring

### Milestone 1.3 — Vector Memory ✅
- [x] Vectra local vector DB, local embedding endpoint (:8081)
- [x] Memory types: episodic/semantic, background extraction, cross-session recall verified

### Milestone 1.4 — Personality & User Model ✅
- [x] personality.json: traits, tone, relationship state (familiarity, trust, interactionCount)
- [x] usermodel.json: facts, interests, preferences — LLM-extracted per turn
- [x] GET /state for inspection

### Milestone 1.5 — Learning & Reasoning ✅
- [x] Internal reasoning scratchpad (reason() — now superseded by Qwen3 thinking mode)
- [x] learning.jsonl: per-turn logging, POST /feedback mechanism

### Milestone 1.6 — Web UI ✅
- [x] Dark-theme chat interface, connects to Agent API

---

## Phase 2 — Tool Integrations ✅

### Milestone 2.1-2.4 — Core Tools + Streaming ✅
- [x] read_file (with offset/limit), write_file, edit_file, run_command, search_regex, web_fetch, code_symbols
- [x] SSE streaming: POST /message/stream, chatCompletionStream generator
- [x] Approval gating for dangerous ops (write_file, edit_file, run_command, git write)
- [x] Tool activity shown in UI as collapsible blocks

### Milestone 2.5-2.8 — Polish + Quality ✅
- [x] Personality evolution: shouldEvolve (every 10 interactions), runEvolution, applyEvolution
- [x] Memory quality filter: two-gate extraction (category + score ≥ 4)
- [x] Embedding-based tool retrieval: cosine similarity selects relevant tools
- [x] Multi-turn tool correction: CORRECTION_PATTERNS + retry directive

---

## Notes / Decisions Log
- LLM: `:8080` — Qwen3-8B-Q8_0, context 8192, `--jinja --reasoning-budget 0`
- Embedding: `:8081` — nomic-embed-text-v1.5.Q8_0, context 512
- Vision (`:8082`) and image gen (`:8188`) — present in config, inactive
- Ports: 3000 = production, 3001 = tests, 3002 = eval
- Shell: PowerShell (pwsh / powershell.exe fallback)
- Tool set: read_file, write_file, edit_file, run_command, search_regex, web_fetch, code_symbols
- Sandbox project at C:/sandbox/ — mock Node.js/Express CRUD API for testing
- Evaluation reports: EVAL_REPORT.md (Qwen2.5-7B v1), EVAL_REPORT_V2.md (Qwen2.5-7B v2 Worker+Voice)
