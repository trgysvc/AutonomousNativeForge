# PRD: Hello World — Pipeline Test Projesi

## Proje Kimliği
`hello_world`

## Amaç
ANF pipeline'ının uçtan uca çalıştığını doğrulamak için minimal bir Node.js HTTP sunucusu.

## Teknik Kısıtlar
- **Dil:** Node.js (native `http` modülü, sıfır npm bağımlılığı)
- **Dosya:** `apps/server/index.js`
- **Platform:** GB10 Blackwell / macOS / Linux
- **Kural:** `require('express')` yasak. Sadece `require('node:http')` kullanılabilir.

## Sprint Planı

### S0-1: HTTP Sunucu Çekirdeği
**Dosya:** `apps/server/index.js`

Aşağıdaki endpointleri içeren bir Node.js HTTP sunucusu yaz:

- `GET /` → `{ "status": "ok", "forge": "ANF", "version": "4.0" }` döner
- `GET /health` → `{ "status": "healthy", "uptime": <process.uptime()> }` döner
- Diğer tüm istekler → `404` ile `{ "error": "not found" }` döner

**Teknik Detaylar:**
- Port: `process.env.PORT || 3000`
- `Content-Type: application/json` header zorunlu
- Hata durumunda süreç çökmemeli (uncaughtException handler)
- Başarılı başlatmada `console.log` ile port numarasını yaz

**Bağımlılıklar:** Yok (bu ilk ve tek görev)
