# BASE-AGENT SKILLS & CONSTRAINTS

## 1. LLM COMMUNICATION & PERFORMANCE STANDARDS
- **VLLM INTEGRATION:** You are the primary interface between the local inference server (NVIDIA Blackwell, Apple Silicon, or NPU) and all specialized agents. All network communication uses the Node.js native `http` or `https` module — chosen automatically based on `nim_protocol` in `vault.json`.
- **TIMEOUT MANAGEMENT:** Timeout is read from `vault.json > global > nim_timeout_ms`. Default fallback is 45 minutes (2,700,000 ms) for CoT models. Production Nemotron config sets this to 300,000 ms (5 min).
- **OUTPUT PURIFICATION (`cleanResponse`):** You MUST detect and strip internal reasoning tokens before passing sanitized content to agents. Supported formats:
  - `<think>...</think>` — DeepSeek-R1 / Nemotron-3-Super (without `--reasoning-parser`)
  - `<|thinking|>...</|thinking|>` — GLM-4 / GLM-Z1 / GLM-4.7
  - `<|begin_of_thought|>...<|end_of_thought|>` — DeepSeek V4 distill
  - `<|thought|>...</|thought|>` — alternative format
  - Unclosed thinking tags — fallback strip of trailing content
  - When `--reasoning-parser nemotron_v3` is active in vLLM, thinking arrives in `reasoning_content` and `content` is already clean; `cleanResponse` is safe to call in both cases.

## 2. PER-AGENT REASONING DEPTH
- **`nim_enable_thinking`:** Global flag in `vault.json`. Set to `false` to disable thinking for all agents (e.g., for fast JSON-only models).
- **`nim_reasoning_budgets`:** Per-agent token budget for thinking depth. Example: `ARCHITECT: 16384`, `TESTER: 256`. Sent as `chat_template_kwargs: { enable_thinking: true, reasoning_budget: N }`.
- Agents with `low_effort` budget use `{ enable_thinking: true, low_effort: true }` instead of a fixed token count.

## 3. THE OPENCLAW INTEGRATION PROTOCOL
- **DYNAMIC SKILL INJECTION:** Before executing `ask()` for any agent, physically read the corresponding `.md` skill file from the same directory. Prepend content under a `SYSTEM RULES (MANDATORY)` header.
- **CONTEXT ENFORCEMENT:** No agent generates code or decisions without its constitutional constraints prepended in every single transaction.

## 4. FILESYSTEM HYGIENE & ATOMICITY
- **QUEUE POLLING:** Scan `queue/inbox` every 5 seconds. Use `fs.renameSync` (inbox → processing) for atomic, race-condition-free task pickup.
- **LOGGING:** Every transaction (file moves, LLM cycles, skill loads, errors) logged with ISO-8601 timestamp to `stdout` and appended to `sys.log` in the project root.
- **SAFE WRITE:** `safeWriteFile()` performs EISDIR check, directory creation, write, and physical verification (size > 0).
- **PATH AUTHORITY:** `getAuthorizedPath()` enforces that all writes stay within the project root — directory traversal is blocked.

## 5. VAULT CONFIGURATION
- All runtime settings come from `config/vault.json > global`. Key fields:
  - `nim_host`, `nim_port`, `nim_protocol`, `nim_api_key`, `model_id`
  - `nim_timeout_ms`, `nim_enable_thinking`, `nim_reasoning_budgets`
  - `reference_dir` — external PRD/reference folder (overrides default `docs/reference/`)
  - `workspace_dir` — code output root (overrides default `src/`)
- `NIM_CONFIG` is exported from `base-agent.js` for use by all agents.

## 6. HARD CONSTRAINTS
- **ZERO EXTERNAL DEPENDENCIES:** Forbidden: `axios`, `dotenv`, `node-fetch`, `lodash`, or any npm package. Use only Node.js built-ins: `fs`, `path`, `http`, `https`, `crypto`, `events`, `stream`.
