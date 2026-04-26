'use strict';

/**
 * 🕵️ Shadow Tester - Security Guardrail (Static Analysis)
 * No-dependency, regex-based security scanner for ANF V4.
 */

const SECURITY_RULES = [
    {
        id: "SEC_HARDCODED_SECRET",
        regex: /(key|secret|token|password|auth|api_key|private_key)\s*[:=]\s*['"][a-zA-Z0-9_\-\.\/]{16,}['"]/gi,
        severity: "CRITICAL",
        reason: "Hardcoded secret detected. Never expose keys in source code.",
        steer: "Bu gizli anahtarı (secret) koddan kaldır. Lütfen bir .env dosyası kullan ve 'process.env.VARIABLE_NAME' üzerinden eriş."
    },
    {
        id: "SEC_DANGEROUS_EVAL",
        regex: /\beval\s*\(/g,
        severity: "CRITICAL",
        reason: "Dangerous use of 'eval()' function.",
        steer: "eval() kullanımı güvenlik riski taşır. Lütfen JSON.parse() veya güvenli bir alternatif kullan."
    },
    {
        id: "SEC_INSECURE_REGEX",
        regex: /\/\.\*\+\//g,
        severity: "HIGH",
        reason: "Potential ReDoS (Regular Expression Denial of Service) pattern detected.",
        steer: "Düzenli ifade (regex) çok geniş/açık. Lütfen daha spesifik bir desen kullan."
    },
    {
        id: "SEC_EXEC_OS_COMMAND",
        regex: /child_process\.exec\s*\(/g,
        severity: "MEDIUM",
        reason: "Direct shell execution detected.",
        steer: "Kabuk komutu (shell command) çalıştırmak risklidir. Mümkünse native kütüphaneleri kullan veya girdileri sanitize et."
    },
    {
        id: "FORBIDDEN_NIM_SDK",
        regex: /require\s*\(\s*['"]openai['"]\s*\)|from\s+['"]openai['"]/gi,
        severity: "CRITICAL",
        reason: "OpenAI/NIM SDK kullanımı tespit edildi. Native HTTP zorunludur.",
        steer: "'openai' paketini kaldır. NIM ile iletişim için base-agent.js içindeki ask() fonksiyonunu kullan — bu fonksiyon zaten native node:https üzerinden NIM endpoint'ine bağlanıyor."
    },
    {
        id: "FORBIDDEN_NVIDIA_SDK",
        regex: /require\s*\(\s*['"]@nvidia\/[^'"]+['"]\s*\)|from\s+['"]@nvidia\//gi,
        severity: "CRITICAL",
        reason: "@nvidia/* SDK paketi tespit edildi. Native HTTP zorunludur.",
        steer: "@nvidia/* paketini kaldır. NIM endpoint'ine doğrudan node:https ile bağlan. base-agent.js ask() fonksiyonu bu işi yapıyor."
    }
];

function scanCode(code) {
    const findings = [];
    
    SECURITY_RULES.forEach(rule => {
        let match;
        // Reset regex state for global searches
        rule.regex.lastIndex = 0;
        while ((match = rule.regex.exec(code)) !== null) {
            findings.push({
                id: rule.id,
                line: code.substring(0, match.index).split('\n').length,
                reason: rule.reason,
                steer: rule.steer,
                severity: rule.severity
            });
        }
    });

    return findings;
}

module.exports = { scanCode };
