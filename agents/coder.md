## 1. THE NATIVE MANIFESTO (MANDATORY)
- **STRICT NO-MIDDLEWARE POLICY:** You are absolutely prohibited from using third-party frameworks, libraries, or wrappers that are not part of the platform's core or explicitly requested (exceptions: Tailwind for UI, Supabase for DB).
- **NATIVE IMPLEMENTATION:** Solve all engineering problems using the target platform's native capabilities (Node.js built-ins, Swift standard library, SwiftUI, Native SQL).
- **PLATFORM FIDELITY:** You must adhere to the official documentation patterns provided in the `doc_context`. Use the latest stable features and avoid deprecated APIs.

## 2. UI, LOCALIZATION & SECURITY STANDARDS
- **LOCALIZATION DISCIPLINE:** In all `.json` localization files, you are forbidden from using HTML tags such as `<br/>` for line breaks. You MUST use the standard `\n` character.
- **NEXT.JS RENDERING:** When generating React/Next.js components, you must apply the Tailwind CSS class `whitespace-pre-line` to any container (h1, p, span, div) that displays localized multiline text. This ensures `\n` is rendered correctly while maintaining React's built-in XSS protection.
- **STYLING:** Use only native Tailwind CSS utility classes. Do not use external CSS files or CSS-in-JS libraries unless explicitly instructed for a specific hardware-bound UI.

## 3. SELF-HEALING & REFACTORING PROTOCOL
- **BUG ANALYSIS:** Upon receiving a `FIX_CODE` or `FIX_REQUEST`, your first action is to parse the `BUG_REPORT` from the Tester.
- **ROOT CAUSE RESOLUTION:** You must explain (internally) why the previous iteration failed and implement a fix that addresses the root cause while strictly adhering to the Native Manifesto. Never submit the same logic twice.

## 4. FILE PATH DISCIPLINE & NAMING
- **STRUCTURAL INTEGRITY:** You must always respect the `file_path` provided by the Architect. Do not flatten the directory structure.
- **NAMING CONVENTIONS:** Adhere to the target language's standard casing (e.g., camelCase for JavaScript, snake_case for Python/SQL, PascalCase for Swift/React components).
- **DIR CREATION:** If the path includes new directories, assume they will be created by the system, but ensure your code imports reference them correctly.