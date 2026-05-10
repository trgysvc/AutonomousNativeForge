# CODER AGENT SKILLS & CONSTRAINTS

## 1. STACK COMPLIANCE (PROJECT-FIRST)
- **PRD-APPROVED STACK ONLY:** Use exclusively the libraries and frameworks listed in the project's PRD or master system prompt. Do not introduce any dependency not explicitly approved.
- **DEFAULT PREFERENCE — NATIVE:** When the PRD does not specify a library, prefer the platform's native capabilities (Node.js built-ins, native SQL, standard library). No `npm install` without PRD authority.
- **FORBIDDEN PATTERNS (unless PRD explicitly permits):** `eval()`, `localStorage`, `Dexie.js`, `any` TypeScript type, deprecated APIs flagged in project docs.
- **TYPESCRIPT STRICT MODE:** For TypeScript projects, all code must compile under `strict: true`. No `any`, no `// @ts-ignore`, no implicit `any` return types.

## 2. UI, LOCALIZATION & SECURITY STANDARDS
- **LOCALIZATION DISCIPLINE:** In `.json` localization files, use `\n` for line breaks — never HTML tags like `<br/>`.
- **NEXT.JS RENDERING:** Apply Tailwind `whitespace-pre-line` to any container rendering localized multiline text. Preserves `\n` rendering while maintaining React XSS protection.
- **SECURITY:** Never hardcode secrets, tokens, or credentials. Always use `process.env` references. `eval()` is forbidden.

## 3. SELF-HEALING & REFACTORING PROTOCOL
- **BUG ANALYSIS:** On `FIX_CODE` or `STEER_CODE`, first parse the `BUG_REPORT`. Explain internally why the previous iteration failed. Never resubmit the same logic twice.
- **ROOT CAUSE RESOLUTION:** Fix the underlying cause, not the symptom. Adhere to the project's PRD constraints in every fix.
- **ACTIVE RECALL:** Respect injected lessons (prefixed with `🧠 GEÇMİŞ DENEYİM`) — these are confirmed failure patterns from prior tasks. Do not repeat them.

## 4. FILE PATH DISCIPLINE & NAMING
- **STRUCTURAL INTEGRITY:** Always respect the `file_path` provided by Architect. Do not flatten the directory structure.
- **NAMING CONVENTIONS:**
  - TypeScript / JavaScript: `camelCase` for variables/functions, `PascalCase` for classes/components
  - SQL: `snake_case` for table and column names
  - File names: match the dominant convention of the project (e.g., `kebab-case` for Next.js routes, `PascalCase` for React components)
- **OUTPUT:** Return only the file content. No markdown code fences, no explanation, no preamble — just the code.
- **WORKSPACE:** Code is written to `workspace_dir` (configured in `vault.json`) / `project_id` / `file_path`. Respect the full path hierarchy.
