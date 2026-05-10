# ANF — Autonomous Native Forge: Detaylı Sistem Analizi

Bu döküman, **Autonomous Native Forge (GB10)** sisteminin otonom yazılım fabrikası mimarisini, dinamik yapılandırma süreçlerini ve güvenlik protokollerini detaylandırmak için hazırlanmıştır.

---

## 1. Mimari Temeller (Software Factory Model)
Sistemin kalbi, tamamen **Native Node.js** çekirdek modülleri üzerine inşa edilmiş, dinamik olarak genişleyebilen bir **Multi-Agent System (MAS)** yapısıdır.

- **Proje Bazlı Dinamik Yapı:** Sistem, projeleri kod içine gömmek yerine `config/vault.json` dosyasından dinamik olarak okur (Single Source of Truth).
- **Otonom Orkestrasyon (Bootstrap):** `bootstrap.js`, sistemin kurulum, mühürleme ve ajan uyandırma süreçlerini tek başına yönetir.
- **Kuyruk ve Log Tabanlı Haberleşme:** Ajanlar `queue/inbox` dizinleri üzerinden JSON dosyaları ile haberleşir.
- **Düşük Gecikme:** NVIDIA Blackwell GB10 (128GB Unified Memory) için optimize edilmiş, kütüphanesiz (library-free) iletişim protokolleri kullanılır.

---

## 2. Sistem Bileşenleri ve Ajan Rolleri

### 2.1. Dynamic Vault (`config/vault.json`)
Sistemin "Kimlik Kasası"dır.
- LLM bağlantı parametreleri (host, port, model_id, timeout).
- Per-agent `reasoning_budget` (Architect: 16384 token, Tester: 256 token gibi).
- `reference_dir`: PRD dökümanlarının okunacağı dizin (ANF dışında harici bir yol olabilir).
- `workspace_dir`: Üretilen kodun yazılacağı kök dizin.
- Proje bazlı GitHub ve Supabase bilgileri.

### 2.2. Bootstrap (Fabrika Yöneticisi)
Sistemi ayağa kaldıran ana mekanizmadır.
- **Mühürleme:** Her projenin `src` klasörüne `.env` ve `config.json` dosyalarını fiziksel olarak yazar.
- **Otomatik Spawning:** İşletim sistemini (Linux/macOS) algılar ve 4 ana ajanı ayrı terminal pencerelerinde otonom olarak başlatır.
- **Sistem Sağlığı:** Gerekli tüm klasör hiyerarşisini (`queue`, `docs`, `src`, `logs`) otomatik inşa eder.

### 2.3. Uzman Ajanlar
1. **Architect (Baş Mimar):** `vault.json > reference_dir` altındaki dökümanları tarar, **Nemotron-3-Super-120B-NVFP4** ile **Consensus Planlama** yapar (REVIEWER_COST × REVIEWER_PERF → Synthesis). Dahili dizinde dosyaları `_` prefix ile mühürler. Harici dizinde manifest tabanlı tekrar işleme engeli kullanır.
2. **Coder (Geliştirici):** Architect'ten gelen görevleri ve PRD kısıtlamalarını alır. Proje'nin onaylı stack'ini (TypeScript strict, Next.js, Fastify, vb.) kullanarak kod üretir. Active Recall ile geçmiş hata dersleri prompt'a enjekte edilir.
3. **Tester (Denetçi):** Üretilen kodu PRD-approved stack kontrolü, güvenlik taraması ve type-safety denetimine tabi tutar. Hata varsa `BUG_REPORT` → Architect → `STEER_CODE` → Coder döngüsünü başlatır.
4. **Docs (Arşivci):** Başarılı süreçleri dökümante eder. Kök `DEVLOG.md` ve proje bazlı `SYSTEM_STATE.md` dosyalarını günceller.

---

## 3. İş Akışı (Process Flow)

1. **Tanımlama:** `vault.json`'a proje eklenir veya `reference_dir` harici yola işaret eder.
2. **Uyandırma:** `node agents/bootstrap.js` veya `npm run forge` ile tüm klasörler hazırlanır ve 4 ajan başlatılır.
3. **Keşif:** Architect, `reference_dir/[proje_id]` içindeki `.md` dökümanları tespit eder ve Consensus Planlama çalıştırır.
4. **Üretim Döngüsü:**
   - Coder kodu yazar → `queue/inbox/tester/`
   - Tester denetler → PASSED veya BUG_REPORT
   - PASSED: Architect GitHub'a push eder → Docs arşivler.
   - FAILED: Architect steer yapar → Coder düzeltir (max 3 deneme).
5. **İzleme:** `sys.log` (proje kökü), `queue/done/`, `queue/error/` ve `src/[proje_id]/manifest.json`.

---

## 4. Güvenlik ve İzolasyon Protokolleri

- **Credential Isolation:** Ajanlar hiçbir zaman vault.json'a doğrudan erişmez. Bootstrap tarafından mühürlenen izole `.env` ve `config.json` dosyalarını kullanır.
- **Secret Blacklist:** `pushToGithub()` fonksiyonu `.env`, `vault.json`, `config.json`, `node_modules` içeren yolları GitHub'a göndermez.
- **Path Authority:** `getAuthorizedPath()` dizin dışına çıkma girişimlerini engeller.
- **Mühürlü Kaynaklar:** İşlenen PRD dökümanları `_` prefix ile işaretlenir (dahili dizin) veya manifest ile takip edilir (harici dizin).
- **Strict Stack Policy:** Coder yalnızca PRD'de onaylanan bağımlılıkları kullanır. Tester PRD stack dışı modülleri raporlar.
- **Log Şeffaflığı:** Her ajan çıktısı `stdout` ve `sys.log` dosyasına mühürlenir (proje kökünde, `logs/` değil).
