# ⚡ ANF — Autonomous Native Forge

> *Drop a PRD. Get working software. See what happens in between.*

[![Node.js v22+](https://img.shields.io/badge/Node.js-v22%2B-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hardware](https://img.shields.io/badge/Hardware-GB10%20Blackwell%20%7C%20ASUS%20Ascent-76B900)](https://www.nvidia.com)
[![Status](https://img.shields.io/badge/Status-V4.5%20Active-brightgreen)]()

**Autonomous Native Forge (ANF)** is a 5-agent software factory that reads technical documents (PRD, Sprint, Spec) and autonomously produces working, production-ready software. It runs **entirely locally** and has **zero npm dependencies** in its core architecture.

- No cloud. No vendor lock-in. No mandatory API keys.
- Pure Node.js. Only `node:http`, `node:fs`, `node:path`, `node:events`.
- Every LLM error, every retry, and every steering decision is recorded in `DEVLOG.md` and `llm_communication.log`.
- 24/7 Autonomous Telemetry tracking performance, cost, and progress in `anf_system_report.md`.

---

## 🚀 Quick Start

```bash
# 1. Verify NIM/LLM connection
npm run test-nim

# 2. Start the factory (spawns all agents + telemetry)
npm run forge

# 3. Open the dashboard in another terminal
npm run dashboard
# → http://localhost:3000 (auto-refreshes every 5 seconds)

# 4. Drop your project's PRD → Architect will discover it automatically
mkdir -p docs/reference/YOUR_PROJECT_NAME
# Place your prd.md file there

# Alternative: Read from an external directory (vault.json > reference_dir)
# Add this line to vault.json: "reference_dir": "/external/path/docs/reference"
```

---

## 🧠 LLM Architecture & Compatibility

ANF natively integrates with the **NVIDIA NIM OpenAPI** format (`/v1/chat/completions`), specifically optimized for handling massive reasoning models.

### GB10 (128GB) — Why Nemotron-3-Super-120B?

| Metric | Nemotron-3-Super-120B | Llama-Nemotron-49B |
|---|---|---|
| **PinchBench** (agentic coding) | **85.6%** | — |
| SWE-bench | 60.5% | Strong |
| Speed | **~13.5 - 25 tok/s** (Active) | ~150 tok/s |
| Active parameters (MoE) | **12B** | 49B (dense) |
| Context window | **1M tokens** | 128K |
| Reasoning budget control | **✅ per-call (thinking_token_budget)** | ❌ |
| 128GB usage | ~60GB weights + 68GB KV | ~98GB + 30GB |

> **Reasoning Budgeting (`thinking_token_budget`):** In every API call, we dictate exactly how many tokens the LLM is allowed to spend "thinking" via NIM parameters. Architect gets 16,384, Coder 4,096, and Tester only 256. This prevents context exhaustion and API 400 errors.

### Other Supported Platforms

| Platform | Model | Port | Timeout |
|---|---|---|---|
| Ollama (macOS/Linux) | `deepseek-r1:7b`, `llama3.2`, `qwen2.5-coder:7b` | 11434 | 2min |
| LM Studio | any | 1234 | 5min |
| NVIDIA NIM Cloud | `nvidia/nemotron-3-super-120b-a12b` | 443 (https) | 2min |
| OpenAI API | `gpt-4o` | 443 (https) | 2min |

### Configuration — `config/vault.json`

```json
{
  "global": {
    "nim_host": "localhost",
    "nim_port": 8000,
    "nim_protocol": "http",
    "nim_api_key": "",
    "model_id": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
    "nim_timeout_ms": 300000,
    "nim_enable_thinking": true,
    "nim_reasoning_budgets": {
      "ARCHITECT": 16384,
      "REVIEWER_COST": 2048,
      "REVIEWER_PERF": 2048,
      "CODER": 4096,
      "TESTER": 256,
      "DOCS": 1024
    },
    "reference_dir": "/optional/external/docs/reference",
    "workspace_dir": "/optional/external/src",
    "researcher_enabled": true,
    "dashboard_port": 3000,
    "webhooks": {
      "urls": [],
      "events": ["TASK_FAILED", "SPRINT_COMPLETE", "PR_OPENED"]
    },
    "concurrency": {
      "ARCHITECT": 1,
      "CODER": 3,
      "TESTER": 2,
      "DOCS": 2
    }
  }
}
```

| Field | Description |
|---|---|
| `nim_enable_thinking` | `false` → disables thinking (use for fast JSON models) |
| `reference_dir` | Root for reading PRDs. If an external path is given, files are read-only and tracked via manifest |
| `workspace_dir` | Root for writing generated code. Defaults to `src/` |
| `researcher_enabled` | Set to `false` to skip URL fetching (for fully offline environments) |
| `dashboard_port` | Web dashboard port. Start with `node dashboard/server.js` |
| `webhooks.urls` | Add endpoints to receive POST requests on pipeline events |
| `webhooks.events` | Supports `TASK_DONE`, `TASK_FAILED`, `SPRINT_COMPLETE`, `PR_OPENED` |
| `concurrency` | Concurrent task limit for each agent. ARCHITECT=1 is required |

### LLM Startup Command

**Nemotron-3-Super-120B-NVFP4 (Recommended on GB10):**
```bash
# GB10 128GB — NVFP4 (~60GB) + FP8 KV cache + 65K context
vllm serve nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4 \
  --quantization nvfp4 \
  --kv-cache-dtype fp8 \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.95 \
  --reasoning-parser nemotron_v3 \
  --enable-auto-tool-choice \
  --port 8000
```
*(Refer to `config/vault.example.json` for additional tuning options.)*

---

## ⚙️ The Pipeline — Step-by-Step

```mermaid
graph TD
    PRD[docs/reference/{project_id}/prd.md] -->|Scans every 60s| ARCHITECT
    
    subgraph Planning Phase
    RESEARCHER[RESEARCHER<br/>Fetches PRD URLs & extracts HTML context] --> ARCHITECT
    ARCHITECT[ARCHITECT<br/>Synthesizes PRD + Context → manifest.json]
    end
    
    ARCHITECT -->|Queues Tasks| CODER_QUEUE((Task Queue))
    
    subgraph Execution Phase
    CODER_QUEUE -->|Parallel up to vault.concurrency| CODER1[CODER #1]
    CODER_QUEUE --> CODER2[CODER #2]
    CODER_QUEUE --> CODER3[CODER #3]
    end
    
    CODER1 --> TESTER
    CODER2 --> TESTER
    CODER3 --> TESTER
    
    subgraph QA Phase
    TESTER[TESTER<br/>5-Layer Quality Gate: Syntax, Docker, Guardrails, AI Review]
    end
    
    TESTER -->|FAIL| STEER[ARCHITECT Steering<br/>Retry <= 3 or FAILED RCA.md]
    STEER --> CODER_QUEUE
    
    TESTER -->|PASS| DOCS
    
    subgraph Documentation & Git
    DOCS[DOCS<br/>Writes DEVLOG.md & SYSTEM_STATE.md]
    GIT[Git Module<br/>Pushes feature/sprint-sN & Opens PR]
    end
    
    DOCS -.-> GIT
```

**Messaging Protocol:** Agents communicate asynchronously via the `queue/inbox/` file system. Files in `queue/processing/` use a locking mechanism (`{agentName}-{timestamp}.json`) to guarantee thread-safe parallel execution.

---

## ✨ V4.5 New Features & Stabilization

### 1. Autonomous Telemetry Daemon
A new `telemetry.js` daemon runs 24/7 in the background, updating `anf_system_report.md` every 15 seconds. It calculates Net Coding Speed (LoC/min), GPU power draw, MTBF, and provides fully auditable Proof-of-Work logs.

### 2. Sprint Branch Workflow & Autonomous PR
After tasks pass testing, they are pushed to `feature/sprint-s0`, etc. Upon sprint completion, ANF automatically opens a PR to `main`. 
*Git operations are silently skipped if `src/{project_id}/config.json` is missing.*

### 3. High-Concurrency Coder
Tasks are processed concurrently. If `vault.concurrency.CODER = 3`, 3 NIM API calls execute simultaneously, maximizing GPU batching efficiency.

### 4. NIM Token Limit Stabilization
LLM parameters (`max_completion_tokens` and `thinking_token_budget`) are now strictly enforced via the NIM API wrapper, preventing the previously encountered infinite loops and 400 Bad Request errors.

### 5. Docker Sandbox & Webhooks
Tester validates code in an isolated Alpine container (`--network none`). Webhooks fire for events like `TASK_FAILED` or `SPRINT_COMPLETE`.

---

## 📁 Project Structure

```text
AutonomousNativeForge/
├── agents/                    # Core AI Logic
│   ├── bootstrap.js           # Factory ignition & queue recovery
│   ├── base-agent.js          # NIM API wrapper & parallel execution core
│   ├── architect.js           # Orchestrator & Task Planner
│   ├── coder.js               # Code generator
│   ├── tester.js              # 5-layer QA Gate
│   ├── docs.js                # Archivist (DEVLOG)
│   ├── telemetry.js           # 24/7 System Telemetry Daemon
│   ├── security_guardrail.js  # Static security scanner
│   ├── docker_sandbox.js      # Isolated testing environment
│   ├── notifier.js            # Webhook dispatcher
│   └── researcher.js          # External URL fetcher
├── dashboard/
│   └── server.js              # Web UI: http://localhost:3000
├── config/
│   └── vault.json             # LLM settings & concurrency logic [Gitignored]
├── docs/
│   └── reference/             # ← Drop your PRDs here
├── src/                       
│   └── aurapos/               # Generated Source Code & Manifests
│       ├── manifest.json      # Master Task List
│       └── SYSTEM_STATE.md    # Technical Debt tracking
├── queue/                     # IPC Messaging System
│   ├── inbox/                 # Incoming tasks per agent
│   ├── processing/            # Locked active tasks
│   ├── done/                  # Completed JSON payloads
│   └── error/                 # Failed tasks & RCA reports
├── anf_system_report.md       # Live 15s Telemetry Report
├── DEVLOG.md                  # Human-readable completion logs
├── llm_communication.log      # Raw token output & API tracing
├── sys.log                    # Master Event Tracker
└── GB10_installation_script.sh # Environment setup script
```

---

## ⌨️ CLI Commands

```bash
npm run forge       # Start the factory (all agents)
npm run architect   # Start only the architect (single project test)
npm run dashboard   # Web dashboard → http://localhost:3000
npm run status      # Pipeline status snapshot
npm run test-nim    # LLM connection + token inference test
```

---

## 🏗️ PRD Format Guide

The Architect parses Markdown PRDs perfectly when structured like this:

```markdown
# Project Title

## Sprint Plan

### S0-1: Module Name
**File:** `apps/server/index.js`

Explain the business logic here.

**Dependencies:** None  (or task ID like S0-2)
```

**Rules:**
- Task IDs must be `S0-1`, `S1-2` (Sprint-No.Sub-No)
- `file_path` must have an extension: `.ts`, `.tsx`, `.sql`, etc.
- Monorepo standards apply (`apps/`, `packages/`).

---

## ⚙️ Hardware Support & Setup

| Platform | Status | Recommended Model | Notes |
|---|---|---|---|
| **NVIDIA GB10 Blackwell** | ✅ Active | Nemotron-3-Super-120B-NVFP4 | vLLM + CUDA 13.2 |
| **ASUS Ascent GX10** | ✅ Active | Same | GB10 Superchip, 128GB unified mem |
| **Apple Silicon / Linux** | ✅ Works | Ollama / vLLM | GPU optional, MLX planned |

**Installation Script:**
Execute `./GB10_installation_script.sh` to configure the NVFP4 + FP8 KV environment. Detailed procedures are available in `docs/GB10 system installation procedures/`.

---

## 🛡️ Security Guardrails

`security_guardrail.js` statically blocks unsafe patterns before testing:

| Rule | Severity | Example |
|---|---|---|
| Hardcoded secret | CRITICAL | `apiKey = "sk-abc..."` |
| eval() usage | CRITICAL | `eval(userInput)` |
| ReDoS regex | HIGH | `/.*/+/` |
| Direct shell exec | MEDIUM | `child_process.exec(...)` |
| Banned SDKs | CRITICAL | `require('openai')` |

---

## 🛣️ Roadmap

**V4.0 → V4.5 (Completed)**
- [x] 4-agent pipeline with parallel Coder support
- [x] Autonomous Telemetry Daemon (Net Speed & Cost tracking)
- [x] NIM Token Stabilization (thinking_token_budget enforcement)
- [x] Crash-safe JSON message queue with orphan recovery
- [x] 5-Layer Testing with Docker Sandbox and Security Guardrails
- [x] Autonomous PR Opening & Branch Workflow
- [x] Peer Review Consensus (Cost vs. Performance)
- [x] Web Dashboard (`http://localhost:3000`)
- [x] Full English Localization of Logs and Architecture

**In Progress / Planned**
- [ ] Multi-file tasks: Single prompt generating interdependent files
- [ ] Diff/patch updating: `replace_file_content` instead of full file rewrites
- [ ] Vector Knowledge Graph: Semantic lesson linkage via embeddings
- [ ] Autonomous Refactoring Sprints

---

## 👨‍💻 Author

**Turgay Savacı** — Software Developer, 15+ years in IT, specializing in Software Engineering & Autonomous Systems.

> *Cloud is convenient. Local is free.*
