# Sprint 5 — Offline-First & PWA
**Önkoşul:** Sprint 4 tüm kabul testleri geçmiş olmalı  
**Süre:** 5 gün  
**Çıktı:** POS internet kesilince tam çalışır, sync engine aktif, PWA kurulabilir

---

## GÖREV S5-1 — PGlite Şema Kurulumu
*Süre: 2 saat*

PGlite'ın local DB şeması Supabase şemasının **çalışan alt kümesidir**.
Tüm tabloları değil, offline'da gerekli olanları içerir.

`packages/electric-config/src/local-schema.sql`:
```sql
-- Bu şema PGlite'a uygulanır (branch-server başlangıcında ve POS ilk açılışında)

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY, business_id UUID, parent_id UUID,
  name TEXT NOT NULL, sort_order INT DEFAULT 0, is_active BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY, category_id UUID, name TEXT NOT NULL,
  base_price NUMERIC(10,2), vat_rate NUMERIC(5,2), kitchen_station TEXT,
  is_active BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS portions (
  id UUID PRIMARY KEY, product_id UUID, name TEXT, price_modifier NUMERIC(10,2) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS option_groups (
  id UUID PRIMARY KEY, product_id UUID, name TEXT, is_required BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS option_items (
  id UUID PRIMARY KEY, group_id UUID, name TEXT, price_modifier NUMERIC(10,2) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY, area_id UUID, branch_id UUID, name TEXT,
  status TEXT DEFAULT 'empty', current_order_id UUID, pos_x FLOAT, pos_y FLOAT
);
CREATE TABLE IF NOT EXISTS table_areas (
  id UUID PRIMARY KEY, branch_id UUID, name TEXT, sort_order INT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY, branch_id UUID, name TEXT, pin_hash TEXT,
  role_name TEXT, permissions JSONB, is_active BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY, branch_id UUID, table_id UUID, staff_id UUID,
  order_number INT, status TEXT DEFAULT 'open', type TEXT DEFAULT 'dine_in',
  note TEXT, total NUMERIC(10,2) DEFAULT 0, subtotal NUMERIC(10,2) DEFAULT 0,
  service_fee NUMERIC(10,2) DEFAULT 0, discount NUMERIC(10,2) DEFAULT 0,
  created_at TEXT, updated_at TEXT, closed_at TEXT,
  synced BOOLEAN DEFAULT FALSE  -- ← offline sync takibi için
);
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY, order_id UUID, product_id UUID, product_name TEXT,
  portion_id UUID, portion_name TEXT, qty INT, unit_price NUMERIC(10,2),
  total_price NUMERIC(10,2), note TEXT, status TEXT DEFAULT 'pending',
  kitchen_station TEXT, sent_to_kds BOOLEAN DEFAULT FALSE,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY, order_id UUID, method TEXT, amount NUMERIC(10,2),
  tip_amount NUMERIC(10,2) DEFAULT 0, cash_given NUMERIC(10,2),
  change_given NUMERIC(10,2), ingenico_tid TEXT, status TEXT DEFAULT 'completed',
  staff_id UUID, created_at TEXT,
  synced BOOLEAN DEFAULT FALSE  -- ← offline sync takibi için
);

-- Sync kuyruğu — offline'da yapılan işlemleri tutar
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,  -- 'INSERT' | 'UPDATE' | 'DELETE'
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  payload TEXT NOT NULL,    -- JSON
  created_at TEXT NOT NULL,
  attempts INT DEFAULT 0,
  last_error TEXT
);
```

`packages/electric-config/src/client.ts`'e şema uygulama ekle:
```typescript
import localSchema from './local-schema.sql'

export async function getElectricClient(): Promise<PGlite> {
  // ... mevcut kod ...
  // Şemayı uygula (IF NOT EXISTS ile idempotent)
  await _client.exec(localSchema)
  return _client
}
```

✅ **Kabul kriteri:** Branch-server başlayınca `branch.db` oluşuyor, tablolar var.

---

## GÖREV S5-2 — Sync Queue Engine
*Süre: 3 saat*

`apps/branch-server/src/sync/engine.ts`

```typescript
import { getElectricClient } from '@aurapos/electric-config'
import { createClient }      from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Branch-server service role kullanır
)

export class SyncEngine {
  private online = false
  private syncInterval: NodeJS.Timeout | null = null

  async start() {
    // Online/offline durumu dinle
    this.checkConnectivity()
    // Her 30 sn sync dene
    this.syncInterval = setInterval(() => this.syncPending(), 30_000)
  }

  private async checkConnectivity() {
    try {
      await fetch(`${process.env.SUPABASE_URL}/health`)
      if (!this.online) {
        this.online = true
        broadcast('sync:status', { online: true, pending_count: await this.getPendingCount() })
        await this.syncPending() // Bağlantı gelince hemen sync
      }
    } catch {
      if (this.online) {
        this.online = false
        broadcast('sync:status', { online: false, pending_count: await this.getPendingCount() })
      }
    }
    setTimeout(() => this.checkConnectivity(), 5_000) // 5sn'de bir kontrol
  }

  async enqueue(operation: 'INSERT' | 'UPDATE' | 'DELETE', table: string, recordId: string, payload: unknown) {
    const db = await getElectricClient()
    await db.query(`
      INSERT INTO sync_queue (operation, table_name, record_id, payload, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [operation, table, recordId, JSON.stringify(payload), new Date().toISOString()])
  }

  async syncPending() {
    if (!this.online) return
    const db = await getElectricClient()

    const pending = await db.query<SyncQueueItem>(
      `SELECT * FROM sync_queue WHERE attempts < 3 ORDER BY created_at LIMIT 50`
    )

    let synced = 0
    for (const item of pending.rows) {
      try {
        await this.applyToSupabase(item)
        await db.query(`DELETE FROM sync_queue WHERE id = $1`, [item.id])
        synced++
      } catch (err) {
        await db.query(
          `UPDATE sync_queue SET attempts = attempts + 1, last_error = $1 WHERE id = $2`,
          [String(err), item.id]
        )
      }
    }

    if (synced > 0) {
      broadcast('sync:status', { online: true, synced_count: synced, pending_count: await this.getPendingCount() })
    }
  }

  private async applyToSupabase(item: SyncQueueItem) {
    const payload = JSON.parse(item.payload)
    switch (item.operation) {
      case 'INSERT':
        await supabase.from(item.table_name).insert(payload)
        break
      case 'UPDATE':
        await supabase.from(item.table_name).update(payload).eq('id', item.record_id)
        break
      case 'DELETE':
        await supabase.from(item.table_name).delete().eq('id', item.record_id)
        break
    }
  }

  private async getPendingCount(): Promise<number> {
    const db = await getElectricClient()
    const r = await db.query<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue`)
    return r.rows[0].count
  }
}

export const syncEngine = new SyncEngine()
```

---

## GÖREV S5-3 — Branch-Server Tüm Yazmaları Queue'ya Ekle
*Süre: 1.5 saat*

Her `INSERT`/`UPDATE`/`DELETE` işleminden sonra sync queue'ya ekle:

```typescript
// apps/branch-server/src/routes/orders.ts — örnek
const order = await db.query(`INSERT INTO orders (...) VALUES (...) RETURNING *`)
await syncEngine.enqueue('INSERT', 'orders', order.rows[0].id, order.rows[0])

// payment kaydında
const payment = await db.query(`INSERT INTO payments (...) VALUES (...) RETURNING *`)
await syncEngine.enqueue('INSERT', 'payments', payment.rows[0].id, payment.rows[0])
```

**Kurallar:**
- `syncEngine.enqueue()` her zaman try/catch dışında — hata sync'i engellememeli, asıl işlem her zaman önce
- Online ise enqueue yerine doğrudan Supabase'e yaz (optimizasyon):
```typescript
if (syncEngine.isOnline()) {
  await supabase.from('orders').insert(orderData) // doğrudan
} else {
  await db.query(`INSERT INTO orders ...`)        // local
  await syncEngine.enqueue('INSERT', 'orders', id, orderData)
}
```

✅ **Kabul kriteri:** T5-1, T5-2 testleri geçmeli.

---

## GÖREV S5-4 — Conflict Resolution Entegrasyonu
*Süre: 1 saat*

`apps/branch-server/src/sync/conflict.ts` — ElectricSQL Config dokümanındaki implementasyonu branch-server'a entegre et.

Sync engine'de conflict durumu:
```typescript
// applyToSupabase başarısız olursa:
// 1. HTTP 409 gelirse → conflict resolution çalıştır
// 2. resolveConflict() → 'local' | 'cloud' | 'merge'
// 3. 'cloud' ise → local kaydı cloud'dan gelen ile güncelle
// 4. Her conflict → audit log (console.warn yeterli — Supabase'e log atma yoksa)
```

✅ **Kabul kriteri:** T5-5 testi geçmeli — conflict audit log'a düşüyor.

---

## GÖREV S5-5 — Service Worker & PWA Kurulumu
*Süre: 2 saat*

```bash
cd apps/pos
pnpm add next-pwa workbox-window
```

`apps/pos/next.config.js`:
```javascript
const withPWA = require('next-pwa')({
  dest:           'public',
  register:       true,
  skipWaiting:    true,
  disable:        process.env.NODE_ENV === 'development', // dev'de kapalı
  runtimeCaching: [
    {
      // API istekleri → NetworkFirst (online tercih et, offline'da cache kullan)
      urlPattern: /^http:\/\/localhost:4000\/api\//,
      handler:    'NetworkFirst',
      options: {
        cacheName:        'api-cache',
        expiration:       { maxEntries: 200, maxAgeSeconds: 3600 },
        networkTimeoutSeconds: 3
      }
    },
    {
      // Statik asset'ler → CacheFirst
      urlPattern: /\.(js|css|png|jpg|svg|woff2)$/,
      handler:    'CacheFirst',
      options: { cacheName: 'static-cache', expiration: { maxAgeSeconds: 86400 } }
    }
  ]
})

module.exports = withPWA({ reactStrictMode: true })
```

**PWA manifest** `apps/pos/public/manifest.json`:
```json
{
  "name": "AuraPOS",
  "short_name": "AuraPOS",
  "description": "AuraPOS Satış Ekranı",
  "start_url": "/pin",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#1a1a2e",
  "orientation": "landscape",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

✅ **Kabul kriteri:** Chrome → Adres çubuğunda install ikonu görünüyor. Kurulunca masaüstü uygulaması gibi açılıyor.

---

## GÖREV S5-6 — Offline Banner & Sync UI
*Süre: 1.5 saat*

`apps/pos/components/OfflineBanner/index.tsx`:
```typescript
export function OfflineBanner() {
  const { online, pendingCount, syncedCount } = useSyncStatus()

  if (online && pendingCount === 0) return null

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm text-white text-center
      ${online ? 'bg-blue-600' : 'bg-orange-600'}`}>
      {!online && '📡 Çevrimdışı mod — değişiklikler kaydediliyor'}
      {online && pendingCount > 0 && `🔄 ${pendingCount} kayıt senkronize ediliyor...`}
      {syncedCount > 0 && `✅ ${syncedCount} kayıt senkronize edildi`}
    </div>
  )
}
```

`apps/pos/hooks/useSyncStatus.ts`:
```typescript
export function useSyncStatus() {
  const [state, setState] = useState({ online: true, pendingCount: 0, syncedCount: 0 })

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:4000/ws')
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.event === 'sync:status') {
        setState({
          online:       msg.payload.online,
          pendingCount: msg.payload.pending_count ?? 0,
          syncedCount:  msg.payload.synced_count ?? 0
        })
        // "X kayıt senkronize edildi" toast (Referans Bölüm 5.3)
        if (msg.payload.synced_count > 0) {
          toast.success(`${msg.payload.synced_count} kayıt senkronize edildi`, { duration: 2000 })
        }
      }
    }
    return () => ws.close()
  }, [])

  return state
}
```

`apps/pos/app/layout.tsx`'e ekle:
```tsx
import { OfflineBanner } from '@/components/OfflineBanner'
// ...
<OfflineBanner />
{children}
```

✅ **Kabul kriteri:** T5-6 testi geçmeli.

---

## GÖREV S5-7 — PGlite Browser Entegrasyonu (POS)
*Süre: 2 saat*

`apps/pos/lib/electric.ts`:
```typescript
import { PGlite }      from '@electric-sql/pglite'
import { electricSync } from '@electric-sql/pglite/sync'
import { startBranchSync } from '@aurapos/electric-config'

let _db: PGlite | null = null

export async function getPosDb(): Promise<PGlite> {
  if (_db) return _db

  _db = await PGlite.create('idb://aurapos-pos', {
    extensions: { electric: electricSync() }
  })

  await _db.electric.connect(process.env.NEXT_PUBLIC_ELECTRIC_URL!)

  await startBranchSync({
    db:         _db,
    branchId:   process.env.NEXT_PUBLIC_BRANCH_ID!,
    businessId: process.env.NEXT_PUBLIC_BUSINESS_ID!
  })

  return _db
}
```

Mevcut hook'ları PGlite'tan okuyacak şekilde güncelle:
```typescript
// apps/pos/hooks/useStaffList.ts — güncelle
import { getPosDb } from '@/lib/electric'

export function useStaffList(branchId: string) {
  const [staff, setStaff] = useState<StaffListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPosDb().then(async db => {
      const result = await db.query<StaffListItem>(
        `SELECT id, name, role_name as role FROM staff
         WHERE branch_id = $1 AND is_active = true ORDER BY name`,
        [branchId]
      )
      setStaff(result.rows)
      setLoading(false)
    })
  }, [branchId])

  return { staff, loading }
}
```

✅ **Kabul kriteri:** T5-1 — network disabled, staff listesi görünüyor.

---

## GÖREV S5-8 — Sprint 5 Entegrasyon Testi
*Süre: 1 saat*

```bash
# Offline test hazırlığı
# Chrome DevTools → Network → Offline
```

Tam offline akış testi:
```
1. Normal: sipariş al, ödeme al → sync_queue'ya girdi
2. Chrome DevTools → Network → Offline
3. Offline banner çıktı (turuncu)
4. Sipariş oluştur → yerel kaydedildi, hata yok
5. Nakit ödeme al → yerel kaydedildi
6. Chrome DevTools → Network → Online
7. Banner mavi: "X kayıt senkronize ediliyor..."
8. Banner kayboldu + toast: "X kayıt senkronize edildi"
9. Supabase dashboard → yeni kayıtlar görünüyor
```

✅ **Sprint 5 tamamlanma kriterleri:**
```
□ T5-1'den T5-6'ya kadar tüm testler geçti
□ PWA install butonu görünüyor
□ Offline sipariş + ödeme → online gelince Supabase'de
□ Conflict test → audit log'a düştü
□ Sync queue 3 denemede başarısız → stuck olmuyor (attempts < 3 kuralı)
□ Commit: "feat(offline): Sprint 5 tamamlandı — offline-first & PWA"
```
