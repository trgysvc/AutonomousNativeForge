# PROJECT: ANF Internal Documentation Wiki

## Objective
Generate a comprehensive, high-quality technical wiki for the Autonomous Native Forge system. The documentation must be based on the ACTUAL source code in the `agents/` directory and existing technical logs.

## Target Directory
`docs/manual/`

## Sprint Plan

### S1-1: ARCHITECTURE.md
**Agent:** DOCS
**Scope:** 
- Scanning `agents/base-agent.js`, `agents/bootstrap.js`.
- Explain the Inter-Process Communication (IPC) via `queue/inbox`.
- Explain Atomic Messaging Protocol (tmp -> json).
- Explain the Global Locking Mechanism (`withLock`).

### S1-2: SOVEREIGN_PROTOCOL.md
**Agent:** DOCS
**Scope:**
- Scanning `agents/watchdog.js` and `agents/architect.js`.
- Detail the Self-Healing loop: Crash detection -> Quarantine -> RCA -> Auto-Patching.
- Explain Context Overflow protection and restart logic.

### S1-3: USER_GUIDE.md
**Agent:** DOCS
**Scope:**
- Scanning `README.md`, `config/vault.json`.
- How to start the factory (`npm run forge`).
- How to drop a PRD for autonomous discovery.
- Best practices for task IDs and dependencies.

### S1-4: TELEMETRY_GUIDE.md
**Agent:** DOCS
**Scope:**
- Scanning `agents/telemetry.js` and `anf_system_report.md`.
- Explain the metrics: LoC/min, MTBF, GPU Efficiency.
- How to interpret the Real-Time Audit Trail.

## Mandatory Rules for DOCS Agent
1. Dökümanlar TEKNİK TÜRKÇE olmalıdır.
2. Koddan örnekler (snippet) içermelidir.
3. Her dosyanın başına "ANF INTERNAL SYSTEM DOCUMENTATION" ibaresini ekle.
