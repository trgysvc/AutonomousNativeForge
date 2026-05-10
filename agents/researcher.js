'use strict';
const https = require('node:https');
const http = require('node:http');
const { log } = require('./base-agent');

const FETCH_TIMEOUT_MS = 15000;
const MAX_CONTENT_CHARS = 5000; // per URL, after HTML stripping
const MAX_URLS = 5;             // max URLs fetched per planning call

/**
 * Minimal HTML → plain text. No external deps.
 * Strips scripts, styles, tags, and common HTML entities.
 */
function stripHtml(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s{3,}/g, '\n\n')
        .trim()
        .substring(0, MAX_CONTENT_CHARS);
}

/**
 * Extracts unique https URLs from markdown/plain text.
 * Skips binary assets (images, fonts, PDFs, archives).
 */
function extractUrls(text) {
    const matches = text.match(/https?:\/\/[^\s)"'\]>]+/g) || [];
    return [...new Set(matches)]
        .filter(u => !/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|pdf|zip|tar\.gz)(\?.*)?$/i.test(u))
        .slice(0, MAX_URLS);
}

/**
 * Fetches a URL and returns { url, content } or { url, error }.
 * Follows one redirect level. Never throws.
 */
function fetchUrl(url, depth = 0) {
    return new Promise((resolve) => {
        let parsed;
        try { parsed = new URL(url); } catch (e) {
            return resolve({ url, error: `Geçersiz URL: ${e.message}` });
        }

        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
            if (depth < 2 && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(fetchUrl(res.headers.location, depth + 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return resolve({ url, error: `HTTP ${res.statusCode}` });
            }

            const contentType = res.headers['content-type'] || '';
            if (!contentType.includes('text/') && !contentType.includes('application/json')) {
                res.resume();
                return resolve({ url, error: `Binary content-type atlandı: ${contentType}` });
            }

            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                body += chunk;
                if (body.length > MAX_CONTENT_CHARS * 4) res.destroy(); // early cut
            });
            res.on('end', () => resolve({ url, content: stripHtml(body) }));
            res.on('error', e => resolve({ url, error: e.message }));
        });

        req.on('error', e => resolve({ url, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ url, error: `Timeout (${FETCH_TIMEOUT_MS / 1000}s)` }); });
    });
}

/**
 * research(prdContent)
 *
 * Extracts URLs from PRD content, fetches them in parallel,
 * and returns a formatted context block ready to inject into the planning prompt.
 *
 * Returns '' if no URLs found or all fetches fail — always safe to concat.
 */
async function research(prdContent) {
    const urls = extractUrls(prdContent);
    if (urls.length === 0) return '';

    log(`🔬 RESEARCHER: ${urls.length} URL taranıyor: ${urls.join(', ')}`);
    const results = await Promise.all(urls.map(u => fetchUrl(u)));

    const successful = results.filter(r => r.content && r.content.length > 80);
    const failed = results.filter(r => r.error);

    if (failed.length > 0) {
        log(`⚠️ RESEARCHER: ${failed.length} URL başarısız → ${failed.map(r => `${r.url}: ${r.error}`).join(' | ')}`);
    }
    if (successful.length === 0) return '';

    log(`🔬 RESEARCHER: ${successful.length} kaynak hazır.`);
    const blocks = successful.map(r => `\n--- KAYNAK: ${r.url} ---\n${r.content}`);
    return `\n\nDIŞ KAYNAKLAR (Planlama sırasında referans al — API sözleşmeleri ve sürüm bilgileri önceliklidir):\n${blocks.join('\n')}`;
}

module.exports = { research, extractUrls, fetchUrl };
