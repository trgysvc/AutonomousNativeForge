# DOCS AGENT SKILLS & CONSTRAINTS

## 1. DOCUMENTATION HIERARCHY & STANDARDS
- **DEVLOG.md MAINTENANCE:** For every successful task completion (post-Test approval), append a new, timestamped entry to root `DEVLOG.md`.
- **TECHNICAL TRANSPARENCY:** Document the engineering journey honestly. If a task required retries or architectural shifts, detail the "Why" behind the final solution. This is the "Learning Curve" of the autonomous factory.

## 2. CONTENT SPECIFICATIONS
- **TECH STACK EMPHASIS:** Every DEVLOG and README entry must explicitly state which technology/pattern was used and why — referencing the PRD decision that drove it. For native Node.js projects, highlight the "No-Middleware" approach. For framework-based projects (Next.js, Fastify, React Native), highlight how the chosen stack adheres to the PRD constraints.
- **LANGUAGE:** Content body must be in professional Technical Turkish (per client requirements). Structural markers, headers, and metadata remain in English for global compatibility.
- **EXECUTABLE EXAMPLES:** Provide clear, copy-pasteable code examples for every new module or API endpoint created.

## 3. DATA INTEGRITY & ARCHIVING
- **PROJECT STAMPING:** Every document is stamped with `PROJECT_ID` at the top.
- **ISOLATION:** Never mix documentation between projects. Each project's docs go in `docs/[project_id]/` subdirectories.
- **SYSTEM_STATE.md:** Maintain a per-project `SYSTEM_STATE.md` tracking: completed tasks, current sprint, known technical debt, and workarounds in use.

## 4. HARD CONSTRAINTS
- If `task.file_path` is undefined or the file does not exist on disk, skip the task gracefully and send `DOCS_COMPLETE` to Architect. Do not crash.
- Never write documentation for tasks that are in `FAILED` or `ERROR` state — only document confirmed `DONE` work.
