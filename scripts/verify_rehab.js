const { cleanResponse } = require('../agents/base-agent');
const path = require('node:path');
const fs = require('node:fs');

// 1. Test cleanResponse
console.log('--- Test 1: cleanResponse ---');
const dsInput = `<think>
Düşünüyorum... AuraPos için bir utils fonksiyonu yazmalıyım.
</think>
İşte kod:
\`\`\`javascript
function test() { return 1; }
\`\`\`
Başka bir şey?`;

const clean = cleanResponse(dsInput);
console.log('Cleaned Logic:', clean === 'function test() { return 1; }' ? 'PASS' : 'FAIL');
console.log('Result:', clean);

const glmInput = `<|thinking|>
Thinking about the file...
<|assistant|>
\`\`\`typescript
const x = 5;
\`\`\`
`;
const cleanGlm = cleanResponse(glmInput);
console.log('Cleaned GLM:', cleanGlm === 'const x = 5;' ? 'PASS' : 'FAIL');

// 2. Test Path Authority (from coder.js logic)
console.log('\n--- Test 2: Path Authority ---');
function getAuthorizedPath(projectPath, requestedPath) {
    const absolutePath = path.resolve(projectPath, requestedPath);
    if (!absolutePath.startsWith(path.resolve(projectPath))) {
        throw new Error(`🛡️ GÜVENLİK İHLALİ: Geçersiz dosya yolu: ${requestedPath}`);
    }
    return absolutePath;
}

const root = '/Users/trgysvc/Developer/AI Software Engineer Agents/src/Aurora';
try {
    getAuthorizedPath(root, 'workspaces/../../etc/passwd');
    console.log('Path Escape Check: FAIL (Should have thrown)');
} catch (e) {
    console.log('Path Escape Check: PASS (' + e.message + ')');
}

try {
    const p = getAuthorizedPath(root, 'components/button.js');
    console.log('Normal Path Check: PASS (' + p + ')');
} catch (e) {
    console.log('Normal Path Check: FAIL');
}

// 3. Test Policy Enforcer (from tester.js logic)
console.log('\n--- Test 3: Policy Enforcer ---');
function checkPolicy(code) {
    const forbidden = ['express', 'axios', 'mongoose', 'lodash', 'nodemon', 'dotenv'];
    const found = forbidden.filter(lib => code.includes(`require('${lib}')`) || code.includes(`require("${lib}")`) || code.includes(`from '${lib}'`) || code.includes(`from "${lib}"`));
    return found.length > 0 ? 'FAIL' : 'PASS';
}

console.log('Clean Code Policy:', checkPolicy('const fs = require("node:fs");') === 'PASS' ? 'PASS' : 'FAIL');
console.log('Forbidden Code Policy:', checkPolicy('const axios = require("axios");') === 'FAIL' ? 'PASS' : 'FAIL');

console.log('\n--- All Tests Completed ---');
