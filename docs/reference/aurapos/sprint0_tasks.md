# AuraPOS — Sprint 0 Geliştirici Görev Listesi
**Süre:** 12–14 Mart → +2 hafta  
**Hedef:** Geliştirici bilgisayarında `pnpm dev` komutu ile tüm sistem ayağa kalkar, mock cihazlar çalışır, Supabase bağlıdır, ElectricSQL sync döner.

> **Kural:** Her adım tamamlanmadan bir sonrakine geçilmez.  
> **Kabul kriteri:** Her adımın sonunda terminalde beklenen çıktı verilmiştir.

---

## AŞAMA 1 — Ortam Hazırlığı
*Süre tahmini: 2-3 saat*

### 1.1 — Sistem Gereksinimleri Kontrolü
```bash
node --version   # v20+ olmalı
pnpm --version   # v8+ olmalı
docker --version # v24+ olmalı
git --version
```
Eksikse kur:
- Node: https://nodejs.org (LTS)
- pnpm: `npm install -g pnpm`
- Docker Desktop: https://docker.com

---

### 1.2 — Repo Oluştur ve Turborepo Başlat
```bash
mkdir aurapos && cd aurapos
git init
pnpm dlx create-turbo@latest . --package-manager pnpm
```

Turborepo sorularına şu yanıtları ver:
- Where would you like to create your Turborepo? → `.` (mevcut klasör)
- Which package manager? → `pnpm`

Oluşan `apps/` ve `packages/` klasörlerini sil — kendi yapımızı kuracağız:
```bash
rm -rf apps/* packages/*
```

---

### 1.3 — Root Konfigürasyon Dosyaları

**`pnpm-workspace.yaml`** oluştur:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**`turbo.json`** güncelle:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":  { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev":    { "cache": false, "persistent": true },
    "test":   { "dependsOn": ["^build"] },
    "lint":   {}
  }
}
```

**`.env.example`** oluştur (gerçek değerler `.env`'e girilecek):
```env
# Supabase
SUPABASE_URL=https://PROJE_ID.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ElectricSQL
ELECTRIC_URL=http://localhost:3000

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=

# AI
AI_MODE=api
DEEPSEEK_API_KEY=

# Donanım
HARDWARE_MODE=mock
HARDWARE_DEVICE=ingenico-a910
DRAWER_MODE=escpos

# e-Fatura
EFATURA_PROVIDER=intermediary

# Ortam
NODE_ENV=development
```

```bash
cp .env.example .env
```

✅ **Kabul kriteri:** `ls` çıktısında `turbo.json`, `pnpm-workspace.yaml`, `.env` görünüyor.

---

## AŞAMA 2 — Supabase Kurulumu
*Süre tahmini: 1-2 saat*

### 2.1 — Supabase Projesi Oluştur
1. https://supabase.com → New Project
2. Proje adı: `aurapos-dev`
3. Bölge: `eu-central-1` (Frankfurt — Türkiye'ye en yakın)
4. Güçlü bir DB şifresi oluştur ve kaydet

Proje hazır olduktan sonra `.env` dosyasını doldur:
- `SUPABASE_URL` → Project Settings → API → Project URL
- `SUPABASE_ANON_KEY` → Project Settings → API → anon public
- `SUPABASE_SERVICE_ROLE_KEY` → Project Settings → API → service_role (**gizli tut**)

---

### 2.2 — Supabase CLI Kur ve Bağlan
```bash
pnpm add -g supabase
supabase login
supabase init          # supabase/ klasörü oluşur
supabase link --project-ref PROJE_ID
```

`PROJE_ID` → Supabase dashboard URL'sinden: `app.supabase.com/project/PROJE_ID`

---

### 2.3 — Migration Dosyalarını Oluştur
```bash
mkdir -p supabase/migrations
```

Daha önce hazırlanan 4 migration dosyasını oluştur:
```bash
touch supabase/migrations/001_init_schema.sql
touch supabase/migrations/002_rls_policies.sql
touch supabase/migrations/003_functions.sql
touch supabase/migrations/004_seed_data.sql
```

Her dosyaya PRD'deki Supabase Migration dokümanındaki SQL'i yapıştır.

---

### 2.4 — Migration'ları Çalıştır
```bash
supabase db push
```

✅ **Kabul kriteri:**
```
Applying migration 001_init_schema.sql...
Applying migration 002_rls_policies.sql...
Applying migration 003_functions.sql...
Applying migration 004_seed_data.sql...
Done.
```

Supabase dashboard → Table Editor'da şu tablolar görünmeli:
`businesses`, `branches`, `staff`, `roles`, `tables`, `orders`, `order_items`, `payments`, `products`, `categories`, `ingredients`

---

### 2.5 — Supabase Realtime Aktif Et
Dashboard → Database → Replication → şu tabloları aç:
- ✅ `orders`
- ✅ `order_items`
- ✅ `tables`

---

### 2.6 — Supabase Storage Bucket'larını Oluştur
Dashboard → Storage → New Bucket:

| Bucket Adı | Public? | Açıklama |
|---|---|---|
| `product-images` | ✅ Public | Menü ürün görselleri |
| `task-photos` | ❌ Private | Görev kanıt fotoğrafları |
| `receipts` | ❌ Private | Fiş/fatura PDF'leri |

✅ **Kabul kriteri:** 3 bucket oluşturuldu, `product-images` public.

---

## AŞAMA 3 — Docker Compose Kurulumu
*Süre tahmini: 1 saat*

### 3.1 — docker/docker-compose.yml Oluştur
```bash
mkdir docker
```

`docker/docker-compose.yml`:
```yaml
version: '3.9'

services:

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 5

  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: ${SUPABASE_DB_URL}   # Supabase DB direct connection URL
      ELECTRIC_WRITE_TO_PG_MODE: direct_writes
      AUTH_MODE: insecure                # Dev ortamı için
    ports:
      - "3000:3000"
    depends_on:
      - redis

  branch-server:
    build:
      context: ..
      dockerfile: docker/Dockerfile.branch-server
    env_file: ../.env
    environment:
      BRANCH_ID: ${BRANCH_ID:-00000000-0000-0000-0000-000000000010}
    ports:
      - "4000:4000"
    volumes:
      - branch_data:/data
    depends_on:
      redis:
        condition: service_healthy

volumes:
  redis_data:
  branch_data:
```

> **Not:** `pos`, `dashboard`, `kds` servisleri Docker'da değil, `pnpm dev` ile local çalışır. Docker sadece altyapı servislerini (Redis, Electric, branch-server) çalıştırır.

---

### 3.2 — Dockerfile.branch-server Oluştur
`docker/Dockerfile.branch-server`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/branch-server/package.json ./apps/branch-server/
COPY packages/ ./packages/
RUN corepack enable && pnpm install --frozen-lockfile
COPY apps/branch-server ./apps/branch-server
RUN pnpm --filter branch-server build
EXPOSE 4000
CMD ["pnpm", "--filter", "branch-server", "start"]
```

---

### 3.3 — Supabase DB Direct URL'i Al
Supabase Dashboard → Settings → Database → Connection string → **URI** (pooler değil, direct)

`.env`'e ekle:
```env
SUPABASE_DB_URL=postgresql://postgres:SIFRE@db.PROJE_ID.supabase.co:5432/postgres
```

---

### 3.4 — Docker Compose Başlat
```bash
cd docker
docker compose up -d
docker compose logs -f
```

✅ **Kabul kriteri:**
```
redis        | Ready to accept connections
electric     | ElectricSQL listening on :3000
branch-server| Fastify server running on :4000
```

---

## AŞAMA 4 — Paylaşılan Paketler
*Süre tahmini: 2-3 saat*

### 4.1 — shared-types Paketi

```bash
mkdir -p packages/shared-types/src
```

`packages/shared-types/package.json`:
```json
{
  "name": "@aurapos/shared-types",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev":   "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

`packages/shared-types/src/index.ts` oluştur ve PRD'deki tip tanımlarını (Order, Payment, Product vb.) ekle.

```bash
pnpm --filter @aurapos/shared-types build
```

✅ **Kabul kriteri:** `packages/shared-types/dist/index.d.ts` oluştu.

---

### 4.2 — hardware Paketi

```bash
mkdir -p packages/hardware/{payment-terminal,printer,drawer,display,barcode,scale}
```

Her cihaz klasörüne `mock-driver.ts` ve `index.ts` oluştur.

`packages/hardware/package.json`:
```json
{
  "name": "@aurapos/hardware",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "scripts": { "build": "tsc", "dev": "tsc --watch" },
  "dependencies": { "@aurapos/shared-types": "workspace:*" }
}
```

`packages/hardware/payment-terminal/mock-driver.ts`:
```typescript
import type { IPaymentTerminalDriver, ApprovalResponse } from '../IHardwareDriver'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

export const mockPaymentTerminal: IPaymentTerminalDriver = {
  async sale(amount) {
    await delay(1500)
    return {
      status: 'APPROVED',
      auth_code: 'A3F2K1',
      transaction_id: `mock-${Date.now()}`,
      amount,
      currency: 'TRY',
      card_last4: '4242',
      card_type: 'VISA'
    }
  },
  async cancel(tid)          { await delay(1000); return { status: 'CANCELLED', transaction_id: tid } },
  async refund(tid, amount)  { await delay(1500); return { status: 'REFUNDED', transaction_id: tid, amount } },
  async batchClose()         { await delay(2000); return { status: 'BATCH_CLOSED', batch_id: `batch-${Date.now()}` } },
  async addTip(tid, tip)     { await delay(800);  return { status: 'TIP_ADDED', transaction_id: tid, tip } },
  async partialPayment(amount, total) {
    await delay(1500)
    return { status: 'APPROVED', paid: amount, remaining: total - amount }
  },
  async healthCheck()        { return { online: true, model: 'MOCK-TERMINAL' } }
}
```

`packages/hardware/payment-terminal/index.ts`:
```typescript
// HARDWARE_MODE=mock  → mock driver
// HARDWARE_MODE=real  → HARDWARE_DEVICE'e göre gerçek driver
const mode   = process.env.HARDWARE_MODE   ?? 'mock'
const device = process.env.HARDWARE_DEVICE ?? 'ingenico-a910'

export const paymentTerminal = mode === 'mock'
  ? require('./mock-driver').mockPaymentTerminal
  : require(`./real-driver-${device}`).default
```

Diğer cihazlar için aynı pattern'ı uygula: `printer`, `drawer`, `display`.

```bash
pnpm --filter @aurapos/hardware build
```

✅ **Kabul kriteri:** Build hatasız tamamlandı.

---

### 4.3 — electric-config Paketi

```bash
mkdir -p packages/electric-config/src
```

PRD'deki ElectricSQL dokümanındaki `client.ts` ve `shapes.ts` dosyalarını oluştur.

```bash
pnpm --filter @aurapos/electric-config build
```

✅ **Kabul kriteri:** Build hatasız tamamlandı.

---

## AŞAMA 5 — branch-server Uygulaması
*Süre tahmini: 3-4 saat*

### 5.1 — Fastify Sunucu İskeleti

```bash
mkdir -p apps/branch-server/src/{routes,hardware,sync}
```

`apps/branch-server/package.json`:
```json
{
  "name": "branch-server",
  "version": "0.0.1",
  "scripts": {
    "dev":   "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@aurapos/hardware":      "workspace:*",
    "@aurapos/electric-config": "workspace:*",
    "@aurapos/shared-types":  "workspace:*",
    "fastify": "^4.0.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/websocket": "^8.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

`apps/branch-server/src/index.ts`:
```typescript
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { hardwareRoutes } from './routes/hardware'
import { orderRoutes }    from './routes/orders'

const app = Fastify({ logger: true })

app.register(cors, { origin: true })
app.register(hardwareRoutes, { prefix: '/api/hardware' })
app.register(orderRoutes,    { prefix: '/api/orders' })

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

app.listen({ port: 4000, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1) }
})
```

`apps/branch-server/src/routes/hardware.ts`:
```typescript
import type { FastifyPluginAsync } from 'fastify'
import { paymentTerminal } from '@aurapos/hardware/payment-terminal'
import { printer }         from '@aurapos/hardware/printer'
import { drawer }          from '@aurapos/hardware/drawer'

export const hardwareRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    terminal: await paymentTerminal.healthCheck(),
    printer:  await printer.healthCheck(),
  }))

  app.post<{ Body: { amount: number } }>('/payment/sale', async (req) => {
    return paymentTerminal.sale(req.body.amount)
  })

  app.post('/drawer/open', async () => {
    return drawer.open()
  })

  app.post<{ Body: import('@aurapos/shared-types').ReceiptObject }>('/print', async (req) => {
    return printer.print(req.body)
  })
}
```

```bash
pnpm install
pnpm --filter branch-server dev
```

✅ **Kabul kriteri:**
```
Server listening at http://0.0.0.0:4000
```

---

### 5.2 — Hardware Endpoint'lerini Test Et
```bash
# Health check
curl http://localhost:4000/health
# → {"status":"ok","timestamp":"..."}

# Ödeme testi
curl -X POST http://localhost:4000/api/hardware/payment/sale \
  -H "Content-Type: application/json" \
  -d '{"amount": 150}'
# → {"status":"APPROVED","auth_code":"A3F2K1",...}

# Para çekmecesi
curl -X POST http://localhost:4000/api/hardware/drawer/open
# → {"status":"OPENED","timestamp":"..."}
```

✅ **Kabul kriteri:** 3 endpoint de beklenen yanıtı döndürüyor.

---

## AŞAMA 6 — Mock Test Script'i
*Süre tahmini: 30 dakika*

`scripts/test-all-mocks.ts`:
```typescript
import { paymentTerminal } from '../packages/hardware/payment-terminal'
import { printer }         from '../packages/hardware/printer'
import { drawer }          from '../packages/hardware/drawer'
import { display }         from '../packages/hardware/display'

async function main() {
  console.log('=== MOCK SERVİS TESTİ ===\n')

  // Ödeme terminali
  const sale = await paymentTerminal.sale(390.00)
  console.assert(sale.status === 'APPROVED', 'Terminal sale FAILED')
  console.log('✅ Terminal sale:', sale.status)

  const cancel = await paymentTerminal.cancel(sale.transaction_id)
  console.assert(cancel.status === 'CANCELLED', 'Terminal cancel FAILED')
  console.log('✅ Terminal cancel:', cancel.status)

  // Yazıcı
  const print = await printer.print({
    order_id: 'TEST-001',
    table: 'Test Masa',
    total: 390.00,
    items: [{ name: 'Test Ürün', qty: 1, price: 390.00 }],
    payment_method: 'Kredi Kartı'
  })
  console.assert(print.status === 'PRINTED', 'Printer FAILED')
  console.log('✅ Printer:', print.status)

  // Para çekmecesi
  const open = await drawer.open()
  console.assert(open.status === 'OPENED', 'Drawer FAILED')
  console.log('✅ Drawer:', open.status)

  // Müşteri ekranı
  const show = await display.show(['Hoş Geldiniz', 'Toplam: 390.00 ₺'])
  console.assert(show.status === 'SHOWN', 'Display FAILED')
  console.log('✅ Display:', show.status)

  console.log('\n=== TÜM MOCK SERVİSLER ÇALIŞIYOR ===')
}

main().catch(e => { console.error('❌ HATA:', e); process.exit(1) })
```

```bash
npx tsx scripts/test-all-mocks.ts
```

✅ **Kabul kriteri:**
```
=== MOCK SERVİS TESTİ ===

✅ Terminal sale: APPROVED
✅ Terminal cancel: CANCELLED
✅ Printer: PRINTED
✅ Drawer: OPENED
✅ Display: SHOWN

=== TÜM MOCK SERVİSLER ÇALIŞIYOR ===
```

---

## AŞAMA 7 — POS ve Dashboard Uygulamaları İskeleti
*Süre tahmini: 2-3 saat*

### 7.1 — POS Uygulaması (Next.js PWA)
```bash
cd apps
pnpm create next-app@latest pos \
  --typescript --tailwind --app \
  --no-src-dir --import-alias "@/*"
cd pos
pnpm add @supabase/supabase-js @electric-sql/pglite next-pwa
pnpm add @aurapos/shared-types@workspace:* \
         @aurapos/hardware@workspace:* \
         @aurapos/electric-config@workspace:*
```

`apps/pos/next.config.js` — PWA aktif et:
```javascript
const withPWA = require('next-pwa')({ dest: 'public', register: true, skipWaiting: true })
module.exports = withPWA({ reactStrictMode: true })
```

---

### 7.2 — Dashboard Uygulaması (Next.js)
```bash
cd apps
pnpm create next-app@latest dashboard \
  --typescript --tailwind --app \
  --no-src-dir --import-alias "@/*"
cd dashboard
pnpm add @supabase/supabase-js
pnpm add @aurapos/shared-types@workspace:*
```

---

### 7.3 — İlk Sayfa: Supabase Bağlantı Testi
`apps/dashboard/app/page.tsx`:
```tsx
import { createClient } from '@supabase/supabase-js'

export default async function Home() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data, error } = await supabase.from('businesses').select('id, name').limit(1)

  return (
    <main style={{ padding: 32 }}>
      <h1>AuraPOS — Dev</h1>
      {error
        ? <p style={{ color: 'red' }}>DB Bağlantı Hatası: {error.message}</p>
        : <p style={{ color: 'green' }}>✅ Supabase bağlı — {JSON.stringify(data)}</p>
      }
    </main>
  )
}
```

`apps/dashboard/.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

```bash
cd apps/dashboard
pnpm dev
```

Tarayıcıda `http://localhost:3001` aç.

✅ **Kabul kriteri:** Yeşil "✅ Supabase bağlı" mesajı görünüyor.

---

## AŞAMA 8 — ElectricSQL Sync Testi
*Süre tahmini: 1-2 saat*

### 8.1 — Electric Servisinin Supabase'e Bağlandığını Doğrula
```bash
curl http://localhost:3000/v1/health
# → {"status":"ok"}
```

### 8.2 — İlk Sync Testi
`scripts/check-sync-status.ts`:
```typescript
import { getElectricClient } from '../packages/electric-config/src/client'
import { startBranchSync }   from '../packages/electric-config/src/shapes'

async function main() {
  console.log('ElectricSQL sync testi başlıyor...')

  const db = await getElectricClient()
  await startBranchSync({
    db,
    branchId:   '00000000-0000-0000-0000-000000000010',
    businessId: '00000000-0000-0000-0000-000000000001'
  })

  // Sync sonrası local DB'yi sorgula
  const result = await db.query('SELECT COUNT(*) FROM categories')
  console.log('Local categories count:', result.rows[0].count)
  console.log('✅ ElectricSQL sync çalışıyor')
}

main().catch(console.error)
```

```bash
npx tsx scripts/check-sync-status.ts
```

✅ **Kabul kriteri:** `Local categories count: 0` (seed yok, ama hata yok — sync çalışıyor)

---

## AŞAMA 9 — Tam Sistem Testi
*Süre tahmini: 30 dakika*

Tüm servislerin aynı anda ayakta olduğunu doğrula:

```bash
# Terminal 1 — Altyapı
cd docker && docker compose up

# Terminal 2 — Branch Server
pnpm --filter branch-server dev

# Terminal 3 — POS
pnpm --filter pos dev

# Terminal 4 — Dashboard
pnpm --filter dashboard dev

# Terminal 5 — Doğrulama
curl http://localhost:4000/health          # branch-server
curl http://localhost:3000/v1/health       # electric
curl http://localhost:6379/ping 2>/dev/null || redis-cli ping  # redis
```

✅ **Sprint 0 Tamamlanma Kriterleri (Hepsi geçmeli):**
```
□ supabase db push → tüm migration'lar başarılı
□ docker compose up → redis + electric + branch-server ayakta
□ npx tsx scripts/test-all-mocks.ts → "TÜM MOCK SERVİSLER ÇALIŞIYOR"
□ http://localhost:3001 → "✅ Supabase bağlı"
□ npx tsx scripts/check-sync-status.ts → "✅ ElectricSQL sync çalışıyor"
□ curl http://localhost:4000/api/hardware/payment/sale → APPROVED
```

---

## SPRINT 0 TAMAMLANDI — Sıradaki: Sprint 1

Sprint 0 çıktısı: **Çalışan bir geliştirme ortamı.**  
Sprint 1'de başlanacak konu: JWT auth, PIN girişi, rol bazlı yetki middleware'i.

Sprint 1 görev listesi için `sprint1_tasks.md` dokümanı Sprint 0 bitiminde üretilecek.
