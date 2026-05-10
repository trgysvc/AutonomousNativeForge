# ANF — Autonomous Native Forge

> *PRD dosyası bırak. Çalışan yazılım al. Arada ne olduğunu da göster.*

[![Node.js v22+](https://img.shields.io/badge/Node.js-v22%2B-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hardware](https://img.shields.io/badge/Hardware-GB10%20Blackwell%20%7C%20ASUS%20Ascent-76B900)](https://www.nvidia.com)
[![Status](https://img.shields.io/badge/Status-V4.5%20Active-brightgreen)]()

**Autonomous Native Forge**, teknik dökümanları (PRD, Sprint, Spec) okuyup çalışan yazılım üreten, **tamamen yerel çalışan**, **sıfır npm bağımlılığı** olan 4-agent bir yazılım fabrikasıdır.

- Bulut yok. Vendor lock-in yok. API anahtarı zorunluluğu yok.
- Saf Node.js. Sadece `node:http`, `node:fs`, `node:path`, `node:events`.
- Her LLM hatası, her retry, her steering kararı DEVLOG.md'ye yazılır.

---

## Hızlı Başlangıç

```bash
# 1. NIM/LLM bağlantısını doğrula
npm run test-nim

# 2. Fabrikayı başlat (tüm 4 agent spawn edilir)
npm run forge

# 3. Başka terminalde dashboard'u aç
npm run dashboard
# → http://localhost:3000  (5 saniyede bir otomatik güncellenir)

# 4. Projenin PRD'sini bırak → Architect otomatik keşfeder
mkdir -p docs/reference/PROJE_ADINIZ
# prd.md dosyasını oraya koyun

# Alternatif: Harici dizinden okuma (vault.json > reference_dir)
# "reference_dir": "/harici/yol/docs/reference"  ← bu satırı vault.json'a ekleyin
```

---

## Hangi LLM Çalışır?

ANF, **OpenAI-uyumlu** `/v1/chat/completions` API'sini kullanır. Thinking formatları otomatik temizlenir.

### GB10 (128GB) — Neden Nemotron?

| Metrik | Nemotron-3-Super-120B | GLM-4-32B | Llama-Nemotron-49B |
|---|---|---|---|
| **PinchBench** (agentic kodlama) | **%85.6** | — | — |
| SWE-bench | %60.5 | çok güçlü | güçlü |
| Hız | **~329 tok/s** | ~200 tok/s | ~150 tok/s |
| Aktif parametre (MoE) | **12B** | 32B (dense) | 49B (dense) |
| Context window | **1M token** | 32K | 128K |
| Reasoning budget kontrolü | **✅ per-call** | ✅ | ❌ |
| 128GB kullanımı | ~60GB ağırlık + 68GB KV | ~64GB + 64GB | ~98GB + 30GB |

> **PinchBench vs SWE-bench farkı:** SWE-bench tek seferlik kod üretimini ölçer. PinchBench bir agent olarak oturup gerçek projeyi çözmeyi ölçer — ANF tam olarak bu ikincisini yapıyor.

> **Reasoning budget:** Her agent çağrısında LLM'e kaç token "düşünmesi" gerektiğini söylüyoruz. Architect 16384, Coder 4096, Tester sadece 256. Hem kalite hem hız optimize edilmiş oluyor.

### Diğer Platformlar

| Platform | Model | Port | Timeout |
|---|---|---|---|
| Ollama (macOS/Linux) | `deepseek-r1:7b`, `llama3.2`, `qwen2.5-coder:7b` | 11434 | 2dk |
| LM Studio | herhangi | 1234 | 5dk |
| NVIDIA NIM Cloud | `nvidia/nemotron-3-super-120b-a12b` | 443 (https) | 2dk |
| OpenAI API | `gpt-4o` | 443 (https) | 2dk |

### Yapılandırma — `config/vault.json`

```json
{
  "global": {
    "nim_host": "localhost",
    "nim_port": 8000,
    "nim_protocol": "http",
    "nim_api_key": "",
    "model_id": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
    "nim_timeout_ms": 300000,
    "nim_enable_thinking": true,
    "nim_reasoning_budgets": {
      "ARCHITECT": 16384,
      "REVIEWER_COST": 2048,
      "REVIEWER_PERF": 2048,
      "CODER": 4096,
      "TESTER": 256,
      "DOCS": 1024
    },
    "reference_dir": "/opsiyonel/harici/docs/reference",
    "workspace_dir": "/opsiyonel/harici/src",
    "researcher_enabled": true,
    "dashboard_port": 3000,
    "webhooks": {
      "urls": [],
      "events": ["TASK_FAILED", "SPRINT_COMPLETE", "PR_OPENED"]
    },
    "concurrency": {
      "ARCHITECT": 1,
      "CODER": 3,
      "TESTER": 2,
      "DOCS": 2
    }
  }
}
```

| Alan | Açıklama |
|---|---|
| `nim_enable_thinking` | `false` → thinking kapatılır (hızlı JSON modellerde kullanın) |
| `reference_dir` | PRD'lerin okunacağı kök. Harici yol verilirse dosyalar salt okunur, manifest ile takip edilir |
| `workspace_dir` | Üretilen kodun yazılacağı kök. Belirtilmezse `src/` |
| `researcher_enabled` | `false` yapılırsa URL fetch atlanır (tam offline ortamlar için) |
| `dashboard_port` | Web dashboard portu. `node dashboard/server.js` ile başlatın |
| `webhooks.urls` | Boş bırakılırsa webhook devre dışı. Endpoint ekleyin → pipeline olaylarında POST alırsınız |
| `webhooks.events` | `TASK_DONE`, `TASK_FAILED`, `SPRINT_COMPLETE`, `PR_OPENED` desteklenir |
| `concurrency` | Her agent için eş zamanlı görev limiti. ARCHITECT=1 zorunlu |

### vLLM Serve Komutları

**Nemotron-3-Super-120B-NVFP4 (önerilen):**
```bash
# GB10 128GB — NVFP4 (~60GB) + FP8 KV cache + 65K context
vllm serve nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4 \
  --quantization nvfp4 \
  --kv-cache-dtype fp8 \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.95 \
  --reasoning-parser nemotron_v3 \
  --enable-auto-tool-choice \
  --port 8000

# 1M context için (deneysel, daha fazla KV cache gerekir):
# VLLM_ALLOW_LONG_MAX_MODEL_LEN=1 vllm serve ... --max-model-len 1048576
```

**GLM-4-32B-0414 (alternatif, en hızlı küçük model):**
```bash
vllm serve THUDM/GLM-4-32B-0414 \
  --dtype bfloat16 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.55 \
  --enable-auto-tool-choice \
  --port 8000
```

Tüm seçenekler için `config/vault.example.json` dosyasına bakın.

---

## Pipeline — Ne Olur Adım Adım?

```
docs/reference/{proje_id}/prd.md
          │
          │  [Her 60 saniyede bir Architect tarar]
          ▼
┌─────────────────────────────────────────────────────┐
│  RESEARCHER  —  Dış Kaynak Tarayıcı (opsiyonel)     │
│  1. PRD içindeki https:// URL'lerini çıkarır        │
│  2. Hepsini paralel fetch eder (15s timeout)         │
│  3. HTML strip → bağlam bloğu olarak döner           │
└──────────────────────────┬──────────────────────────┘
                           │ researchContext
                           ▼
┌─────────────────────────────────────────────────────┐
│  ARCHITECT  —  Consensus Planlama                   │
│  Phase 1: Multi-Doc Synthesis (combinedContent      │
│           + researchContext → NIM → task JSON)      │
│  Phase 2: Peer Review (Cost-Reviewer × Perf)        │
│  Phase 3: Synthesis (performance-weighted plan)     │
│  Phase 4: Stack Rules (PRD → manifest.stack_rules)  │
│  → manifest.json oluşturur, sprint sırasına koyar   │
└──────────────────────────┬──────────────────────────┘
                           │ WRITE_CODE × N (paralel, vault.concurrency)
                    ┌──────┴──────┐
                    ▼             ▼
┌──────────────┐  ┌──────────────┐
│  CODER  #1   │  │  CODER  #2   │   (max 3 eş zamanlı)
│ Active Recall│  │ Context Inj. │
│ LANG_MAP     │  │ LANG_MAP     │
└──────┬───────┘  └──────┬───────┘
       └────────┬─────────┘
                │ CODE_FINISHED
                ▼
┌─────────────────────────────────────────────────────┐
│  TESTER  —  5 Katmanlı Kalite Kapısı                │
│  1. Native Syntax Check (node --check / tsc)        │
│  2. Docker Sandbox (--network none, read-only mount)│
│  3. Governance Guardrails (manifest.stack_rules)    │
│  4. Shadow Tester (secret / eval() / ReDoS)         │
│  5. AI Review (PRD uyumluluk denetimi)              │
└──────────────────────────┬──────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │ TEST_PASSED             │ BUG_REPORT
              ▼                         ▼
  ┌───────────────────────┐   ┌───────────────────────┐
  │  ensureBranch         │   │  ARCHITECT Steering   │
  │  pushToGithub         │   │  Retry ≤ 3            │
  │  (feature/sprint-sN)  │   │  3+ → FAILED + RCA.md │
  │  DONE → DOCS          │   │  notify(TASK_FAILED)  │
  │  checkSprintCompletion│   └───────────────────────┘
  │  → PR açılır          │
  │  notify(SPRINT/PR)    │
  └──────────┬────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│  DOCS  —  Arşivci                                   │
│  1. Modül teknik dökümanı üretir                    │
│  2. DEVLOG.md'ye timestamped entry ekler            │
│  3. SYSTEM_STATE.md günceller (technical debt)      │
└─────────────────────────────────────────────────────┘

        [Her an] http://localhost:3000 — Web Dashboard
                 (manifest.json + sys.log → 5s refresh)
```

**Mesajlaşma:** Her agent, `queue/inbox/{agent}/` klasöründe JSON dosyalarını 5 saniyede bir okur. Crash-safe: yetim görevler bootstrap ile kurtarılır. PROCESSING dosyaları `{agentName}-{file}` formatında — iki process aynı görevi alamaz.

---

## V4.5 — Yeni Özellikler

### Sprint Branch Workflow & Otonom PR
Her görev test geçtikten sonra `feature/sprint-s0`, `feature/sprint-s1` gibi bir branch'a push edilir. Sprint'teki tüm görevler DONE olduğunda ANF otomatik olarak `main`'e PR açar. GitHub config opsiyoneldir — `src/{proje_id}/config.json` yoksa tüm Git işlemleri sessizce atlanır.

```json
// src/{proje_id}/config.json  (gitignored)
{ "github": { "token": "ghp_...", "repo": "https://github.com/owner/repo.git" } }
```

### Paralel Coder
Bağımsız görevler artık eş zamanlı işlenir. `vault.concurrency.CODER = 3` → 3 NIM API çağrısı aynı anda uçar. ARCHITECT = 1 (manifest race condition önlenir). `fs.renameSync` atomic claim — iki process aynı görevi alamaz.

### Docker Sandbox
Tester'ın Step 2'si: kod izole bir Alpine container'da çalıştırılır. `--network none` — test sırasında dış API çağrısı yapılamaz. Docker yoksa veya proje dili desteklenmiyorsa sessizce atlanır.

### Webhook Bildirimleri
`vault.json > webhooks.urls`'ye endpoint ekleyin → pipeline olaylarında HTTP POST alırsınız:

| Event | Ne Zaman |
|---|---|
| `TASK_FAILED` | MAX_RETRIES aşıldığında |
| `SPRINT_COMPLETE` | Sprintteki tüm görevler DONE olduğunda |
| `PR_OPENED` | GitHub PR başarıyla oluşturulduğunda |
| `TASK_DONE` | Her görev tamamlandığında (opt-in, varsayılan kapalı) |

### Researcher Agent
Architect, planlama öncesinde PRD içindeki `https://` URL'lerini otomatik fetch eder. Bu sayede API referansları, SDK dökümanları ve changelog'lar plana dahil edilir — model, güncel olmayan eğitim verisine güvenmek zorunda kalmaz.

### Web Dashboard
```bash
npm run dashboard  # http://localhost:3000
```
Her proje için sprint progress bar, renk kodlu task durumları, canlı sayaçlar, otomatik güncellenen log paneli. Sıfır dış bağımlılık — native `node:http`.

---

## Agent Dosyaları ve Ne Yaptıklarını Biliyorlar mı?

| Agent / Modül | Kod Dosyası | Skill/Prompt | Rolü |
|---|---|---|---|
| **Architect** | `agents/architect.js` | `agents/architect.md` | Orchestrator: synthesis, consensus, sprint gate, steering |
| **Coder** | `agents/coder.js` | `agents/coder.md` | Kod üretici: active recall, context injection, LANG_MAP |
| **Tester** | `agents/tester.js` | `agents/tester.md` | 5 katmanlı kalite kapısı: syntax → sandbox → guardrail → security → AI |
| **Docs** | `agents/docs.js` | `agents/docs.md` | DEVLOG + SYSTEM_STATE arşivci |
| **Reviewer Cost** | *(architect içi)* | `agents/reviewer_cost.md` | Gereksiz adım tespiti, sadelik savunuculuğu |
| **Reviewer Perf** | *(architect içi)* | `agents/reviewer_perf.md` | Bottleneck tespiti, <2s yanıt kuralı |
| **Security Guard** | `agents/security_guardrail.js` | *(kodlanmış kurallar)* | Secret, eval(), ReDoS, SDK yasağı |
| **Docker Sandbox** | `agents/docker_sandbox.js` | — | İzole test ortamı (Alpine, --network none) |
| **Notifier** | `agents/notifier.js` | — | Webhook dispatcher: 4 event tipi, parallel POST |
| **Researcher** | `agents/researcher.js` | — | PRD URL fetch, HTML strip, bağlam enjeksiyonu |
| **Dashboard** | `dashboard/server.js` | — | Web UI: manifest + log → http://localhost:3000 |

Her agent başlangıçta kendi `.md` skill dosyasını okur ve NIM'e system prompt olarak gönderir. Bu sayede LLM'in "kim olduğunu" ve "ne yapması gerektiğini" her call'da biliyor.

---

## Çalışma Zamanında Optimizasyon Gerekiyor mu?

### Hayır gerekmeyenler
- Agent koordinasyonu otomatik (manifest + sprint gate)
- Retry mantığı (max 3) hazır ve çalışıyor
- Security guardrail statik regex, sıfır gecikme
- Crash recovery (orphan tasks) bootstrap'ta

### Evet, bunlara dikkat edin

**Token Limiti** — `agents/architect.js:TOKEN_LIMIT = 50000`

Nemotron'un 1M context'i ve vLLM'in `--max-model-len 65536` ayarı ile 50K token güvenle işlenir. Limiti aşan projeler `_overlimit_` prefix ile işaretlenip sonsuz döngü korunur.

```js
// agents/architect.js, satır 13
const TOKEN_LIMIT = 50000; // Nemotron NVFP4 için güvenli sınır
```

**Timeout** — `config/vault.json:nim_timeout_ms`

| Model | Önerilen Timeout |
|---|---|
| Nemotron-3-Super-120B-NVFP4 (GB10) | 300000 (5dk) — MoE, 12B aktif param |
| GLM-4-32B (GB10) | 120000 (2dk) |
| DeepSeek-R1-7B (Ollama) | 300000 (5dk) |
| GPT-4o (OpenAI) | 120000 (2dk) |

**vLLM Ayarları (GB10) — Nemotron NVFP4**

```bash
vllm serve nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4 \
  --quantization nvfp4 \
  --kv-cache-dtype fp8 \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.92 \
  --reasoning-parser nemotron_v3 \
  --enable-auto-tool-choice \
  --port 8000
```

- `--quantization nvfp4` + `--kv-cache-dtype fp8` → ~60GB model, 68GB KV cache
- `--reasoning-parser nemotron_v3` → thinking `reasoning_content`'a ayrılır, `content` temiz
- `--enforce-eager` KULLANMAYIN — CUDA graph'ları kapatır, 2-3x throughput kaybı

---

## Proje Yapısı

```
AutonomousNativeForge/
│
├── agents/                    # Tüm agent kodları
│   ├── bootstrap.js           # Fabrika ignition — başlatma noktası
│   ├── base-agent.js          # NIM API, queue, GitHub, paralel start(), utils
│   ├── architect.js           # Orchestrator: synthesis, consensus, sprint gate
│   ├── coder.js               # Kod üretici: active recall, context injection
│   ├── tester.js              # 5 katmanlı QA: syntax→sandbox→guardrail→sec→AI
│   ├── docs.js                # DEVLOG + SYSTEM_STATE arşivci
│   ├── security_guardrail.js  # Statik regex güvenlik tarayıcı
│   ├── docker_sandbox.js      # İzole test ortamı (Alpine, --network none) [V4.5]
│   ├── notifier.js            # Webhook dispatcher (4 event tipi)           [V4.5]
│   ├── researcher.js          # PRD URL fetch + HTML strip + bağlam inj.    [V4.5]
│   │
│   ├── architect.md           # Architect system prompt (skill)
│   ├── coder.md               # Coder system prompt (skill)
│   ├── tester.md              # Tester system prompt (skill)
│   ├── docs.md                # Docs system prompt (skill)
│   ├── reviewer_cost.md       # Cost reviewer prompt (consensus)
│   └── reviewer_perf.md       # Perf reviewer prompt (consensus)
│
├── dashboard/
│   └── server.js              # Web UI: /api/status + /api/logs [V4.5]
│
├── core/
│   └── agentBus.js            # EventEmitter altyapısı (gelecek geliştirme)
│
├── config/
│   ├── vault.json             # LLM endpoint + tüm config [gitignored]
│   └── vault.example.json     # Referans şablonu
│
├── docs/
│   └── reference/             # ← PRD'lerinizi buraya bırakın
│       └── {proje_id}/
│           └── *.md
│
├── src/                       # Agent çıktıları — üretilen kodlar
│   └── {proje_id}/
│       ├── manifest.json      # Görev durumu + stack_rules (pipeline state)
│       ├── config.json        # GitHub token + repo URL [gitignored, opsiyonel]
│       ├── SYSTEM_STATE.md    # Teknik borç + özellik haritası
│       └── {üretilen kodlar}
│
├── queue/                     # Agent mesajlaşma sistemi
│   ├── inbox/{agent}/         # Gelen görevler (JSON)
│   ├── processing/            # İşlenmekte: {agentName}-{file} formatı
│   ├── done/                  # Tamamlananlar
│   └── error/                 # {task_id}_RCA.md ile başarısızlar
│
├── sys.log                    # Tüm agent logları (dashboard okur)
├── common_lessons.json        # Global active recall (tüm projeler için)
│
└── scripts/
    ├── status.js              # Pipeline durum monitörü (CLI)
    └── test-nim-connection.js # LLM bağlantı + inference testi
```

---

## Komutlar

```bash
npm run forge       # Fabrikayı başlat (tüm ajanlar)
npm run architect   # Sadece architect'i başlat (tekil proje testi)
npm run dashboard   # Web dashboard → http://localhost:3000
npm run status      # Pipeline durumu — anlık fotoğraf (CLI)
npm run watch       # Pipeline durumu — 3s'de bir güncellenir (CLI)
npm run test-nim    # LLM bağlantı + tek-token inference testi
```

---

## PRD Format Rehberi

Architect şunları arar:

```markdown
# Proje Başlığı

## Sprint Planı

### S0-1: Modül Adı
**Dosya:** `apps/server/index.js`

Burada ne yapılacağını açıkla...

**Bağımlılıklar:** Yok  ← veya S0-2 gibi task_id
```

**Kurallar:**
- Task ID'leri `S0-1`, `S0-1.1`, `S1-2` formatında olsun (Sprint-No.Alt-No)
- `file_path` uzantılı olsun: `.js`, `.ts`, `.tsx`, `.sql`, `.md`, `.yml`
- Dosya yolu `apps/` veya `packages/` ile başlasın (monorepo standardı)
- Toplam token < 50000 olsun (Nemotron için güvenli sınır; aşılırsa bölün)

---

## Sistem Başladığında Ne Olur?

`npm run forge` → `node agents/bootstrap.js` çalışır:

```
[BOOTSTRAP] Klasör hiyerarşisi inşa ediliyor...
[BOOTSTRAP] Yetim görevler kurtarılıyor (Recovery)...
[BOOTSTRAP] Proje credential'ları mühürleniyor...
[BOOTSTRAP] Ajan dosyaları kontrol ediliyor...
[BOOTSTRAP] vLLM (http://localhost:8000) bekleniyor...
[BOOTSTRAP] ✅ vLLM Hazır!
[BOOTSTRAP] 🚀 Ajanlar başlatılıyor...
  + [ARCHITECT] macOS Terminal başlatıldı.
  + [CODER]     macOS Terminal başlatıldı.
  + [TESTER]    macOS Terminal başlatıldı.
  + [DOCS]      macOS Terminal başlatıldı.
```

Sonra:
1. Her agent kendi Terminal penceresinde (macOS) veya systemd service (Linux/GB10) olarak başlar
2. Architect her 60 saniyede `docs/reference/` tarar
3. Yeni PRD bulunca → Synthesis → Manifest → İlk görevi Coder'a gönderir
4. Pipeline otomatik akar: Coder → Tester → [Retry veya GitHub Push] → Docs
5. `npm run watch` ile gerçek zamanlı izleyebilirsiniz

**Not:** bootstrap.js vLLM hazır olmadan agent'ları başlatmaz. Sonsuz döngüyle bekler. GB10 soğuk başlatmada vLLM'nin yüklenmesi 2-5 dakika alabilir.

---

## Donanım Desteği

| Platform | Durum | Model | Notlar |
|---|---|---|---|
| **NVIDIA GB10 Blackwell** | ✅ Aktif | Nemotron-3-Super-120B-NVFP4 | vLLM + CUDA 13.2 + cu132 nightly PyTorch |
| **ASUS Ascent GX10** | ✅ Aynı hw | Aynı | GB10 Superchip, 128GB unified mem |
| **Apple Silicon** | ✅ Çalışır | Ollama (llama3, deepseek-r1:7b) | MLX backend roadmap |
| **Herhangi Linux x86** | ✅ Çalışır | Ollama veya vLLM | GPU opsiyonel |

GB10 kurulum scripti: `./GB10_installation_script.sh` (v4.3.0 — NVFP4 + FP8 KV + Marlin)

GB10 detaylı rehber: `docs/GB10 system installation procedures/`

---

## Güvenlik Kuralları

`security_guardrail.js` şunları otomatik engeller:

| Kural | Şiddet | Örnek |
|---|---|---|
| Hardcoded secret | CRITICAL | `apiKey = "sk-abc..."` |
| eval() kullanımı | CRITICAL | `eval(userInput)` |
| ReDoS regex | HIGH | `/.*/+/` |
| Doğrudan shell exec | MEDIUM | `child_process.exec(...)` |
| openai SDK | CRITICAL | `require('openai')` |
| @nvidia/* SDK | CRITICAL | `require('@nvidia/nim')` |

---

## Roadmap

**V4.0 → V4.5 (Tamamlandı)**
- [x] 4-agent pipeline (Architect, Coder, Tester, Docs)
- [x] Dosya tabanlı crash-safe mesaj kuyruğu
- [x] Active Recall — hata derslerini bağlamsal enjekte etme
- [x] Shadow Tester — statik güvenlik taraması (secret, eval, ReDoS)
- [x] Peer Review Consensus — Cost × Performance diyalektiği
- [x] SYSTEM_STATE.md — teknik borç takibi
- [x] vLLM + Nemotron-3-Super-120B-NVFP4 GB10 kararlı (CUDA 13.2, NVFP4, FP8 KV)
- [x] Harici `reference_dir` desteği (salt okunur, manifest ile tekrar işleme koruması)
- [x] Agent skill dosyaları güncel sistem davranışıyla senkronize
- [x] Generic PRD desteği — manifest.stack_rules ile her proje tipi desteklenir
- [x] Context File Injection — Coder bağımlı dosyaları okuyarak yazar
- [x] Sprint Branch Git entegrasyonu — her sprint `feature/sprint-sN`'a push edilir
- [x] Otonom PR açma — sprint tamamlandığında GitHub PR oluşturulur
- [x] Docker Sandbox — `--network none` izole test ortamı
- [x] Webhook bildirim sistemi — 4 event tipi, paralel POST, non-fatal
- [x] Paralel Coder — vault.concurrency ile eş zamanlı görev desteği
- [x] Orphan recovery bug düzeltildi (PROCESSING prefix ile doğru eşleşme)
- [x] Researcher agent — PRD URL fetch ile dış kaynak zenginleştirmesi
- [x] Web Dashboard — `http://localhost:3000`, 5s refresh, dark theme

**Devam Eden / Planlanan**
- [ ] Step 11: Multi-file task — tek görev birden fazla dosya üretsin
- [ ] Step 12: Diff/patch update — STEER sırasında tüm dosya yerine patch üret
- [ ] Step 13: Knowledge graph — semantik lesson linkage (keyword yerine embedding)
- [ ] ASUS Ascent NPU inference adaptörü (Mayıs 2026 driver bekleniyor)
- [ ] Apple Silicon MLX backend
- [ ] Otonom Refactoring Sprint (teknik borç silme)

---

## Yazar

**Turgay Savacı** — Yazılım Geliştirici, 15+ yıl IT, son 5 yılı yazılım mühendisliğinde.

*Bulut kullanışlıdır. Yerel olan özgürdür.*
