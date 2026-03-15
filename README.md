# ⚒️ ANF — Autonomous Native Forge

> *"We don't promise a perfect product. We promise an autonomous architecture that learns from its mistakes — and shares every single one of them."*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js v22+](https://img.shields.io/badge/Node.js-v22%2B-green)](https://nodejs.org)

> [!IMPORTANT]
> This is a **purely native** implementation. No Express, no Axios, no high-level SDKs. Direct Node.js `http`/`https` modules only.

[![Hardware](https://img.shields.io/badge/Hardware-NVIDIA%20Blackwell%20GB10-76B900)](https://www.nvidia.com)
[![Model](https://img.shields.io/badge/Model-DeepSeek--R1--Distill--32B-blue)](https://huggingface.co/deepseek-ai)
[![Framework](https://img.shields.io/badge/Framework-Native%20Node.js-green)](https://nodejs.org)
[![Status](https://img.shields.io/badge/Status-Active%20Development-orange)]()

---

## What Is This?

**Autonomous Native Forge** is a **cloud-free, fully local, 4-agent autonomous software production factory** built entirely on Node.js native capabilities — no middleware, no heavy frameworks, no vendor lock-in.

Runs on local hardware: **NVIDIA GPU (Blackwell)**, **Apple Silicon (Unified Memory)**, and **NPU-accelerated devices**. Local LLM inference only.

| Agent | Role | Responsibility |
|---|---|---|
| 🎯 **PM Agent** | The Composer | Breaks user requests into atomic technical tasks |
| 🏗️ **Architect Agent** | The Sound Engineer | Designs file structure, selects native modules |
| ⚙️ **Coder Agent** | The Performer | Writes code — native modules only, zero `npm install` |
| 🔍 **Reviewer Agent** | The Critic | Audits for security, performance, and dependency violations |

---

## The Honest Part (Why This README Is Different)

Most open-source projects show you the finish line. We show you **the entire race** — including the falls.

This project started with **4 days of continuous failure** on NVIDIA Blackwell GB10:
- vLLM wouldn't compile against CUDA 13.0
- PyTorch binaries were incompatible with SM_100 architecture
- 70B model caused OOM Killer to terminate the process at 132GB > 120GB VRAM
- `pyproject.toml` metadata format broke the entire build pipeline

Every single one of these failures is **documented, timestamped, and publicly available** in this repository. Because the next developer who hits the same wall deserves a door, not another wall.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   USER REQUEST                      │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              PM AGENT (Decomposition)               │
│         Breaks request into atomic JSON tasks       │
└───────────────────────┬─────────────────────────────┘
                        │ EventEmitter Bus
                        ▼
┌─────────────────────────────────────────────────────┐
│           ARCHITECT AGENT (System Design)           │
│    Scans docs/reference/ → DeepSeek-R1 reasoning    │
│         Produces file structure + task plan         │
└───────────────────────┬─────────────────────────────┘
                        │ queue/inbox/[project_id]/
                        ▼
┌─────────────────────────────────────────────────────┐
│             CODER AGENT (Production)                │
│   Native Node.js only • Zero external dependencies  │
│      45min deep reasoning via vLLM endpoint         │
└───────────────────────┬─────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              │                   │
              ▼                   ▼
        TEST PASSED           TEST FAILED
              │                   │
              ▼                   ▼
    GitHub Auto-Push        Self-Healing Loop
    (Native HTTPS)          (Max 3 retries →
                             ERROR_REPORT)
```

**Communication:** Native `EventEmitter` — no message brokers, no Redis, no Kafka.  
**State Management:** In-memory `MemoryState` object per session — no external databases.  
**Security:** Credential isolation via `bootstrap.js` — agents never touch raw tokens.

---

## The "Native Only" Philosophy

This project enforces a strict rule: **if Node.js can do it natively, we don't install a package for it.**

```javascript
// ❌ What we DON'T do
const axios = require('axios');
const express = require('express');
const _ = require('lodash');

// ✅ What we DO
const https = require('https');
const fs = require('fs/promises');
const { EventEmitter } = require('events');
```

This isn't dogma — it's a deliberate architectural choice:
- **Zero supply-chain attack surface** from third-party packages
- **Maximum performance** — no abstraction layer overhead
- **Portability** — runs on any Node.js v22+ environment, no `npm install` required
- **Forced understanding** — if you write it native, you understand what it actually does

---

## Hardware & Infrastructure

### Hardware Support
- **NVIDIA GPU**: Optimized for Blackwell GB10 (120GB VRAM) and CUDA-enabled architectures.
- **Apple Silicon**: Fully compatible with M-series chips utilizing **Unified Memory** for large context windows.
- **NPU Engines**: Support for local AI accelerators (NPU) in modern mobile/desktop workstations.
- **Model:DeepSeek-R1-Distill-Qwen-32B (bfloat16 — ~64GB VRAM)

### TEST SYSTEM
Server:  vLLM OpenAI-compatible API (port 8000)
Runtime: Node.js v22+
OS:      Linux (aarch64)

### Why 32B and Not 70B?
Simple math: 70B in bfloat16 requires ~132GB VRAM. GB10 has 120GB. The OOM Killer doesn't negotiate.  
32B at ~64GB leaves 56GB for KV Cache — which actually makes the system **faster** for long reasoning chains.

### Target Hardware (Roadmap)
- **Apple Silicon** — M4 Ultra (192GB Unified Memory) for macOS-native agent deployment
- **ASUS Ascend** — NPU-accelerated edge inference for sub-100ms agent response times

---

## Project Structure

```
/AutonomousNativeForge/
├── agents/
│   ├── architect.js      # Document scanner + task decomposer
│   ├── coder.js          # Native code producer
│   ├── tester.js         # Security + dependency auditor
│   └── docs.js           # DEVLOG writer + archivist
├── core/
│   └── agentBus.js       # EventEmitter communication layer
├── config/
│   └── vault.json        # Multi-tenant credential store (gitignored)
├── docs/
│   └── reference/        # Drop .md files here → Architect auto-discovers
├── workspace/            # Agent-generated code output
├── queue/
│   └── inbox/            # Inter-agent JSON task files
├── logs/
│   └── system.log        # Unified timestamped log
├── bootstrap.js          # Factory ignition — starts all 4 agents
├── DEVLOG.md             # Autonomous development journal
└── main.js               # Orchestration entry point
```

---

## Getting Started

### Prerequisites
- Node.js v22+
- vLLM running locally (see [Blackwell Setup Guide](./blackwell_setup.md))
- DeepSeek-R1-Distill-Qwen-32B downloaded via `huggingface-cli`

### Launch
```bash
# 1. Clone the repo
git clone https://github.com/trgysvc/AutonomousNativeForge.git
cd AutonomousNativeForge

# 2. Configure your projects
cp config/vault.example.json config/vault.json
# Edit vault.json with your GitHub tokens and project info

# 3. Drop a spec document into the discovery folder
cp your-spec.md docs/reference/[project_id]/

# 4. Start the factory
node bootstrap.js
```

The factory wakes up. Architect discovers your spec. The pipeline runs.

---

## The Transparency Manifesto

This repository is not just code — it's a **public engineering journal**.

Every session produces entries in three places:

**`DEVLOG.md`** — What was attempted, what broke, what was learned.  
**GitHub Issues** — Real failure reports: *"Session #4 — CoT <think> blocks polluting output, solved with regex strip"*  
**GitHub Discussions** — Architecture decisions, trade-off debates, community questions.

We specifically track:
- 🔴 **Prompt failures** — Which prompt caused hallucination and why
- 🟡 **Hardware bottlenecks** — Where the GPU/NPU stalled and for how long  
- 🟢 **Self-healing events** — How many retries it took and what the fix was

---

## Roadmap

- [x] vLLM + DeepSeek-R1 32B stable on Blackwell GB10
- [x] 4-agent pipeline with EventEmitter bus
- [x] Multi-tenant credential isolation
- [x] Self-healing loop (3 retries → ERROR_REPORT)
- [x] Autonomous GitHub push via native HTTPS
- [ ] Apple Silicon port (MLX backend)
- [ ] ASUS Ascend NPU inference integration
- [ ] Web UI for real-time agent monitoring
- [ ] Multi-model routing (small model for simple tasks, 32B for deep reasoning)
- [ ] Community plugin system for custom agents

---

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR. The one hard rule: **no middleware dependencies**. If you're adding a feature that requires an npm package, open a Discussion first and make the case.

Bug reports are especially welcome — the more specific, the better. *"It broke"* is not a bug report. *"Coder agent produced CommonJS require() instead of ESM import on Node.js v22.3.0, here's the exact prompt and output"* is a bug report.

---

## License

MIT — Use it, fork it, build on it. If you do something interesting, open a Discussion and tell us about it.

---

## Author

**Turgay Savacı** — Software Developer, 15+ years in IT, last 5 years deep in software engineering.  
Building things that shouldn't exist yet, documenting every failure along the way.

*The cloud is convenient. Local is sovereign.*