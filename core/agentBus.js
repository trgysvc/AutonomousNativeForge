'use strict';
/**
 * agentBus.js — ANF Mesajlaşma Altyapısı
 *
 * ANF iki mod destekler:
 *
 * MOD A (varsayılan, aktif): Dosya Tabanlı Queue
 *   - queue/inbox/{agent}/ klasörüne JSON dosyası yazılır
 *   - Her agent kendi inbox'ını 5 saniyede bir tarar (base-agent.js: start())
 *   - Crash-safe: orphan recovery ile yetim görevler kurtarılır
 *   - GB10 uzun işlemleri için ideal (45dk timeout)
 *
 * MOD B (gelecek): EventEmitter Bus
 *   - In-process, düşük gecikme
 *   - Tek process'te tüm agents — test ve geliştirme için
 *
 * Mevcut implementasyon MOD A'dır (base-agent.js::sendMessage).
 * Bu dosya mimari dokümantasyon ve gelecekteki MOD B için rezerve edilmiştir.
 */

const EventEmitter = require('node:events');

class AgentBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(20);
    }

    dispatch(target, type, data) {
        this.emit(`${target}:${type}`, { ...data, type, _target: target, _ts: Date.now() });
    }

    subscribe(agentName, handler) {
        this.on(`${agentName}:*`, handler);
        // Wildcard pattern — tüm mesajları al
        this.on('message', (msg) => {
            if (msg._target === agentName) handler(msg);
        });
    }

    send(target, type, data) {
        const msg = { ...data, type, _target: target, _ts: Date.now() };
        this.emit('message', msg);
        this.emit(`${target}:${type}`, msg);
    }
}

// Singleton instance
const bus = new AgentBus();

module.exports = { AgentBus, bus };
