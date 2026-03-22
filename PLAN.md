# Oracle — Plan

## Current Status
**Phase:** Phase 1 complete → Phase 2 — Tool Integrations
**Last session:** All Phase 1 milestones done. Oracle has: persistent history, context compaction, vector memory (episodic + semantic), personality system, user model, internal reasoning, and learning/feedback logging.

---

## Phase 1 — Foundation (Goal 1: Reasoning, Memory, Personality)

### Milestone 1.1 — Skeleton ✅
- [x] Project structure: `agent/`, `api/`, `ui/`
- [x] `package.json` with Express + cors dependencies
- [x] Basic Agent API server — GET /health, POST /message, GET /history, POST /reset
- [x] Stub Agent class with in-memory conversation history, wired to LLM endpoint
- [x] POST /message → returns LLM response and full history
- [x] Verified: Claude Code called the API and received a real LLM response

### Milestone 1.2 — Conversation & Context ✅
- [x] Persist conversation history to disk (JSON) so it survives restarts
- [x] Context window tracking (token estimation)
- [x] Summarization-based compaction when context exceeds threshold
- [x] Relevance scoring for message hiding

### Milestone 1.3 — Vector Memory ✅
- [x] Integrate Vectra local vector DB
- [x] Embed and store memories via local embedding endpoint
- [x] Retrieve relevant memories on each turn (injected into system prompt)
- [x] Memory types: episodic (events), semantic (facts about user/world)
- [x] Background extraction: LLM extracts semantic facts after each turn
- [x] Cross-session recall verified: fresh conversation remembers past facts

### Milestone 1.4 — Personality & User Model ✅
- [x] Persistent personality config (traits, tone, quirks) — data/personality.json
- [x] User model: structured profile (facts, interests, preferences) — data/usermodel.json
- [x] Relationship state: familiarity (logarithmic), trust, interactionCount, firstSeen/lastSeen
- [x] Personality + user model injected into system prompt dynamically
- [x] GET /state endpoint for inspection
- [x] User model updated via LLM extraction after each turn (background)

### Milestone 1.5 — Learning & Reasoning ✅
- [x] Multi-step reasoning: internal scratchpad before final response (reason() call, not shown to user)
- [x] Success/failure logging — data/learning.jsonl, turnId returned per response
- [x] Feedback mechanism: POST /feedback with turnId + "positive"/"negative"
- [x] getLearningStats() exposed via GET /state

### Milestone 1.6 — Web UI (basic) ✅
- [x] HTML/CSS/JS chat interface (ui/index.html)
- [x] Connects to Agent API
- [x] Displays conversation with basic styling (dark theme)

---

## Phase 2 — Tool Integrations (Goal 2)

### Milestone 2.1 — Core Dev Tools ✅
- [x] Tool calling via <tool>{...}</tool> directive pattern (works with any local LLM)
- [x] Tool execution loop with up to 5 rounds per turn
- [x] read_file, write_file, run_command (safety-filtered), list_dir, search_files
- [x] toolsUsed tracked per turn in contextStats and learning log
- [x] Tools injected into system prompt only when needed

### Milestone 2.2 — Tool Improvements ✅
- [x] Path normalization: /c/foo → C:/foo, /mnt/c/foo → C:/foo (agent/tools/utils.js)
- [x] Tool errors surfaced in contextStats.toolErrors per turn
- [x] Git tool: git status/log/diff/show/branch/commit etc. with blocked-ops list
- [x] Tools prompt tightened (~40% token reduction)

### Milestone 2.3 — Context Optimization & UI ✅
- [x] Memory: TOP_K 5→3, episodic format trimmed (200 chars/side), token drop 1897→1682 on "hi"
- [x] Tools prompt: conditional injection — only when query contains tool-relevant keywords
- [x] toolActivity returned in API response: [{tool, args, result}] per turn
- [x] UI: tool calls shown as collapsible <details> blocks above assistant reply (green ⚙ header)

### Milestone 2.4 — Streaming + Web Fetch ✅
- [x] SSE streaming: POST /message/stream endpoint; UI consumes with fetch + ReadableStream
- [x] chatCompletionStream async generator in llm.js (stream: true)
- [x] chatStream() method: tool rounds run blocking, final reply streams token by token
- [x] Tool activity emitted as SSE event before streaming reply begins
- [x] web_fetch tool: fetches via r.jina.ai, chunks content (3000 chars), caches to data/webcache/
- [x] web_read_chunk: read any cached chunk by index
- [x] web_search_page: search cached page for lines matching query terms
- [x] Context budget fix: reasoning note included in fullSystemContent before buildContext call
- [x] Tools prompt directive tightened: "call tools immediately without preamble"

### Milestone 2.5 — Personality Evolution ✅
- [x] agent/evolution.js: shouldEvolve (every 10 interactions), runEvolution (LLM analysis), applyEvolution
- [x] Observations injected into buildPersonalityPrompt — immediately influence behavior
- [x] Traits and tone update when LLM identifies clear patterns from feedback signals
- [x] POST /evolve endpoint for forced evolution (used in testing + evaluation)
- [x] Tested: 10 "too verbose" signals → trait added ("keep responses 1-2 sentences"), trait removed, baseline length 622→384→291 chars across two passes
- [x] test-evolution.js: full API-driven test harness (reset, signal, evolve, diff, compare)

### Milestone 2.6 — Polish + Correction ✅
- [x] UI reset button in header (confirm dialog, clears log + calls POST /reset)
- [x] Observation deduplication: deduplicate on personality load + new Set guard in applyEvolution
- [x] Vectra topK bug fixed: queryItems ignores limit — now sort+filter+slice manually
- [x] Multi-turn tool correction: CORRECTION_PATTERNS detect "wrong/retry/try again", append retry directive to user message, tool re-called with corrected args
- [x] lastToolActivity tracked per turn, cleared on reset

### Milestone 2.8 — Tool & Memory Quality (complete)
- [x] XML tool format: `<tool name="NAME"><arg>value</arg></tool>` — no JSON escaping, free-text values, auto coercion of numbers/booleans
- [x] Dangerous tool approval: write_file, edit_file, run_command, git (write ops) require user Allow/Deny before executing; SSE `approval_required` event + UI card + POST /approve/:id
- [x] Embedding-based tool retrieval: replaces keyword queryNeedsTools (done in 2.7), now also drives needsTools gate via max similarity threshold
- [x] Memory quality filter: two-gate extraction (category gate + score ≥ 4); dropped episodic copy-of-conversation; categories: USER_PREFERENCE, USER_FACT, BEHAVIORAL_CORRECTION, PROJECT_DECISION; memory panel shows category badges

### Milestone 2.7 — Dev Tool Enhancements ✅
- [x] File edit tool: replace old string → new string — agent/tools/edit_file.js
- [x] File chunk reading: read_file with offset+limit
- [x] Search tool: search_regex — file names + contents, maxDepth (cap 10), maxResults (cap 200)
- [x] Embedding-based tool retrieval: cosine similarity selects top-5 relevant tools, doubles as needsTools gate — agent/tools/tool_retrieval.js
- [x] Code comprehension: code_symbols — lists functions/classes/methods/interfaces with line numbers via web-tree-sitter (WASM, no native compilation). Supports JS/TS/Python.

---

## Notes / Decisions Log
- Endpoints run on separate PC at `192.168.0.208` (local network). Config in `config.json`.
- LLM: `:8080` — Qwen2.5-Coder-14B, context 4096, `--jinja`, OpenAI-compatible API
- Embedding: `:8081` — nomic-embed-text-v1.5, context 512, OpenAI-compatible API
- Vision (`:8082`) and image gen (`:8188` ComfyUI) — present in config but inactive until further notice
- UI: vanilla JS unless a specific need justifies a framework
- Evaluation method: Claude Code posts to Agent API and assesses responses directly
- Shell: PowerShell (`pwsh` / `powershell.exe` fallback). run_command detects which is available at startup.
- Tool set: read_file, write_file, edit_file, run_command, search_regex, web_fetch (6 total). list_dir/search_files/git removed — covered by run_command. web_read_chunk/web_search_page removed — web_fetch saves to a path, agent reads/searches via existing file tools.
