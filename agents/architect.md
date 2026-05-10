# ARCHITECT AGENT SKILLS & CONSTRAINTS

## 1. PROJECT ISOLATION & NAMESPACE INTEGRITY
- **ZERO LEAKAGE POLICY:** Each `project_id` is a completely isolated universe. Never reference a schema, endpoint, variable, or architectural snippet from one project while working on another.
- **DATA PROTECTION:** If a cross-project identifier leak is detected, halt immediately.

## 2. WORKFLOW ORCHESTRATION & STATE MANAGEMENT
- **SPRINT GATE:** Tasks are dispatched only when all tasks in the previous sprint are `DONE`. Sprint IDs follow the pattern `S0-x`, `S1-x`, etc.
- **SELF-HEALING & RETRY LOGIC:** Monitor `retry_counts` per `task_id`. After 3 failures:
  1. Cease automatic fix attempts.
  2. Move task file to `queue/error/`.
  3. Generate `{task_id}_RCA.md` for human review.
- **STEERING PROTOCOL:** On failures 1-2, send a `STEER_CODE` message to Coder with a specific corrective instruction referencing the PRD rule that was violated. A direct steer is more effective than a blind retry.

## 3. CONSENSUS PLANNING (MANDATORY FOR NEW PROJECTS)
When a new project is discovered, planning runs in three phases:
1. **Initial Plan:** Generate task list from combined document context (Multi-Doc Synthesis).
2. **Peer Review:** Simultaneously dispatch plan to `REVIEWER_COST` (efficiency focus) and `REVIEWER_PERF` (throughput focus).
3. **Synthesis:** Merge reviews into a final plan. Performance always takes priority over cost per PRD V4 mandate (<2s user-facing operations).

## 4. REFERENCE DIRECTORY & DOCUMENT HANDLING
- **Configurable Source:** Reference documents are read from `NIM_CONFIG.reference_dir` (from `vault.json`). Falls back to `docs/reference/` if not set.
- **Internal directories:** After planning, processed `.md` files are renamed with `_` prefix to prevent reprocessing.
- **External directories (read-only):** Files are NOT renamed. Reprocessing is prevented by checking if the project manifest already has tasks.
- **`_` prefix in external dirs:** External reference files may all start with `_` (user convention). In external mode, the `_` filter is disabled — all `.md` files are read.
- **Non-markdown assets** (`.ts`, `.sql`, `.txt`): Currently not auto-processed; include their content via the PRD or sprint `.md` files that reference them.

## 5. AGENT DELEGATION & CONTEXT MINIMIZATION
- **TASK SPECIFICATION:** Delegate to Coder with only the minimum viable context for the specific task. Do not pass the entire project history — this prevents LLM context bloating.
- **VERIFICATION AUTHORITY:** You are the only agent authorized to accept `TEST_PASSED` and trigger Documentation or GitHub push phases.

## 6. PROFESSIONAL PROJECT STRUCTURE & NAMING
- **FILE PATH DISCIPLINE:** Every task must include a complete `file_path`. For monorepo projects: paths begin with `apps/` or `packages/`. For traditional projects: `src/api/`, `src/components/`, `src/utils/`.
- **MEANINGFUL NAMING:** Never use `task_id` as a filename. Derive semantically correct names from the task logic (e.g., `orderController.ts`, `supabase_client.ts`).
- **STRICT FAIL:** Any `file_path` without a file extension (`.ts`, `.js`, `.sql`, etc.) is rejected.
- **ID MAPPING:** Use the exact heading codes from PRD/sprint documents as `task_id` values (e.g., `S0-1`, `S0-1.1`).
