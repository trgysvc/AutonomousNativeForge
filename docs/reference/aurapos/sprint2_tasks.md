# Sprint 2 — Masa & Sipariş Yönetimi
**Önkoşul:** Sprint 1 tüm kabul testleri geçmiş olmalı  
**Süre:** 5 gün  
**Çıktı:** Görsel masa planı, adisyon açma/kapama/bölme/taşıma, WebSocket ile canlı güncelleme

---

## GÖREV S2-0 — Optimistic Lock Middleware
*Süre: 45 dk*

Her order güncelleme isteğinde lock_version kontrolü yapan middleware:

`apps/branch-server/src/middleware/optimisticLock.ts`:
```typescript
export async function checkOptimisticLock(
  req: FastifyRequest<{ Params: { id: string }; Body: { lock_version: number } }>,
  reply: FastifyReply
) {
  const { id } = req.params
  const { lock_version } = req.body

  if (lock_version === undefined) {
    return reply.code(400).send({
      success: false, code: 'VALIDATION_ERROR',
      message: 'lock_version zorunlu'
    })
  }

  const result = await db.query<{ lock_version: number }>(
    'SELECT lock_version FROM orders WHERE id = $1', [id]
  )

  if (!result.rows[0]) {
    return reply.code(404).send({ success: false, code: 'ORDER_NOT_FOUND' })
  }

  if (result.rows[0].lock_version !== lock_version) {
    return reply.code(409).send({
      success: false,
      code:    'OPTIMISTIC_LOCK_FAILED',
      message: 'Adisyon başka bir cihaz tarafından güncellendi, lütfen yenileyin'
    })
  }
}

// Order güncellenince lock_version otomatik artar:
// UPDATE orders SET ..., lock_version = lock_version + 1 WHERE id = $1
```

PATCH /api/orders/:id/items endpoint'ine preHandler olarak ekle:
```typescript
app.patch('/orders/:id/items', {
  preHandler: [requirePermission('orders.create'), checkOptimisticLock]
}, updateOrderItemsHandler)
```

✅ **Kabul kriteri:** Aynı adisyona iki eşzamanlı istek → ikincisi 409 OPTIMISTIC_LOCK_FAILED alır.

---

## GÖREV S2-1b — Seat Number (Koltuk Bazlı Sipariş)
*Süre: 1 saat*

**order_items tablosuna seat_no eklendi** (migration'da mevcut).

POS sipariş ekranında koltuk seçimi:

`apps/pos/components/SeatSelector/index.tsx`:
```typescript
interface SeatSelectorProps {
  coverCount: number          // Masadaki kişi sayısı
  selected: number | null     // null = masa geneli
  onChange: (seat: number | null) => void
}

// coverCount kadar daire buton + "Masa Geneli" seçeneği
// Varsayılan: null (masa geneli)
// Seçili koltuk: mavi daire
// Ödeme ekranında: her koltuğun toplam tutarı yan yana gösterilir
```

**Koltuk bazlı toplam hesaplama:**
```typescript
// Order içinde koltuk özetini hesapla
function getSeatSummary(order: Order): SeatSummary[] {
  const seats = new Map<number | null, number>()
  for (const item of order.items.filter(i => i.status !== 'cancelled')) {
    const seat = item.seat_no ?? null
    seats.set(seat, (seats.get(seat) ?? 0) + item.total_price)
  }
  return Array.from(seats.entries()).map(([seat_no, total]) => ({ seat_no, total }))
}
// null key → "Masa Geneli" olarak gösterilir
```

**Ödeme ekranında koltuk seçimi:**
```typescript
// Alman usulü ödeme:
// 1. Ödeme ekranı açılır
// 2. Koltuk özetleri listelenir: "Koltuk 1: 185₺ | Koltuk 2: 210₺ | Masa Geneli: 95₺"
// 3. Müşteri koltuğunu seçer → sadece o koltuğun tutarı ödenir
// 4. Seçili koltuk items'ları paid olarak işaretlenir, diğerleri açık kalır
```

✅ **Kabul kriteri:**
- Ürün eklerken koltuk seçilebiliyor
- Koltuk bazlı toplam hesabı doğru
- Tek koltuk ödenince diğerleri masada açık kalıyor

---


*Süre: 2 saat*

`apps/branch-server/src/routes/tables.ts` oluştur.

Endpoint'ler (Referans Dokümanı Bölüm 4.6):
```
GET   /api/tables
PATCH /api/tables/:id/status   (requirePermission('orders.create'))
POST  /api/tables/:id/transfer (requirePermission('orders.create'))
```

**PATCH /api/tables/:id/status — Request:**
```typescript
{ status: 'empty' | 'occupied' | 'reserved' | 'blocked' }
```

**POST /api/tables/:id/transfer — Request:**
```typescript
{ target_table_id: string }
// Kurallar:
// 1. Kaynak masada açık order olmalı
// 2. Hedef masa 'empty' olmalı — değilse 409 TABLE_OCCUPIED
// 3. order.table_id güncellenir, kaynak masa 'empty', hedef 'occupied' olur
// 4. WebSocket: her iki masaya da 'table:status_changed' event'i
```

Her değişiklikte WebSocket event yayınla:
```typescript
// apps/branch-server/src/lib/websocket.ts
export function broadcastTableUpdate(tableId: string, status: string) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        event:     'table:status_changed',
        payload:   { table_id: tableId, new_status: status },
        branch_id: process.env.BRANCH_ID,
        timestamp: new Date().toISOString()
      }))
    }
  })
}
```

✅ **Kabul kriteri:**
```bash
# Masa listesi
curl http://localhost:4000/api/tables -b "pos_token=..."
# → data dizisinde tablolar, her birinde status ve current_order_id

# Masa taşıma — hedef dolu masa
curl -X POST http://localhost:4000/api/tables/ID/transfer \
  -d '{"target_table_id":"DOLU_MASA_ID"}' -b "pos_token=..."
# → 409 TABLE_OCCUPIED
```

---

## GÖREV S2-2 — Orders API (branch-server)
*Süre: 3 saat*

`apps/branch-server/src/routes/orders.ts` oluştur.

Tüm endpoint'ler Referans Dokümanı Bölüm 4.3'te tanımlıdır.

**Kritik iş kuralları — bunlar koda yansımalı:**

```typescript
// 1. Sipariş oluştururken masa kontrolü
const existing = await db.query(
  `SELECT id FROM orders WHERE table_id = $1 AND status NOT IN ('closed','cancelled')`,
  [table_id]
)
if (existing.rows.length > 0) throw new AppError('TABLE_OCCUPIED', 'Masada açık adisyon mevcut', 409)

// 2. Ürün eklenince total otomatik hesaplanır
async function recalculateOrder(orderId: string) {
  await db.query(`
    UPDATE orders SET
      subtotal = (SELECT COALESCE(SUM(total_price),0) FROM order_items
                  WHERE order_id = $1 AND status NOT IN ('cancelled')),
      total = subtotal + service_fee - discount,
      updated_at = NOW()
    WHERE id = $1
  `, [orderId])
}

// 3. İptal — not zorunlu
if (!reason || reason.trim() === '') {
  throw new AppError('REASON_REQUIRED', 'İptal nedeni zorunlu', 400)
}

// 4. Ödenmiş sipariş iptal edilemez
if (['paid','closed'].includes(order.status)) {
  throw new AppError('ORDER_ALREADY_PAID', 'Ödenmiş sipariş iptal edilemez', 422)
}

// 5. Ürün eklenince KDS'e gönder (sent_to_kds = false olanlar)
await sendToKds(newItems)
```

**Adisyon bölme mantığı:**
```typescript
// POST /api/orders/:id/split
// mode=by_person: N eşit parçaya böl (item'lar round-robin dağıtılır)
// mode=by_item: belirtilen item gruplarına göre böl
// Orijinal order kapatılır (status='closed'), yeni order'lar açılır
// Toplamlar kontrolü: yeni order'ların total'i = orijinal total (servis ücreti dahil)
```

✅ **Kabul kriteri:** Bölüm 8.3 T2-1'den T2-7'ye kadar tüm testler geçmeli.

---

## GÖREV S2-3 — WebSocket Sunucusu
*Süre: 1.5 saat*

```bash
cd apps/branch-server
pnpm add @fastify/websocket
```

`apps/branch-server/src/lib/websocket.ts`:
```typescript
import { WebSocket } from 'ws'

// Bağlı client'ları tut
const clients = new Set<WebSocket & { station?: string; branch_id?: string }>()

export function setupWebSocket(app: FastifyInstance) {
  app.register(require('@fastify/websocket'))

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket)

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        // KDS istasyon subscription
        if (msg.event === 'kds:subscribe') {
          socket.station = msg.payload.station
        }
      } catch { /* geçersiz mesaj, yoksay */ }
    })

    socket.on('close', () => clients.delete(socket))
  })
}

export function broadcast(event: string, payload: unknown, filter?: (c: typeof clients extends Set<infer T> ? T : never) => boolean) {
  const msg = JSON.stringify({
    event,
    payload,
    branch_id: process.env.BRANCH_ID,
    timestamp: new Date().toISOString()
  })
  clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN && (!filter || filter(c))) {
      c.send(msg)
    }
  })
}

// KDS için sadece ilgili istasyona gönder
export function broadcastKds(station: string, payload: unknown) {
  broadcast('order:item:status_changed', payload, c => !c.station || c.station === station)
}
```

✅ **Kabul kriteri:**
```javascript
// Browser console'da test:
const ws = new WebSocket('ws://localhost:4000/ws')
ws.onmessage = e => console.log(JSON.parse(e.data))
// Masa durumu değişince event gelmelı
```

---

## GÖREV S2-4 — KDS'e Sipariş Gönderme
*Süre: 1 saat*

`apps/branch-server/src/lib/kds.ts`:
```typescript
import { broadcastKds } from './websocket'

export async function sendNewItemsToKds(orderId: string, items: OrderItem[]) {
  // Henüz KDS'e gönderilmemiş item'ları gönder
  const unsent = items.filter(i => !i.sent_to_kds && i.status === 'pending')

  for (const item of unsent) {
    broadcastKds(item.kitchen_station, {
      order_id:   orderId,
      item_id:    item.id,
      product:    item.product_name,
      qty:        item.qty,
      note:       item.note,
      options:    item.options.map(o => o.option_item_name),
      table:      item.table_name,
      created_at: item.created_at
    })

    // sent_to_kds işaretle
    await db.query(
      'UPDATE order_items SET sent_to_kds = true WHERE id = $1',
      [item.id]
    )
  }
}
```

**Performans kuralı:** Sipariş kaydedilince KDS'de **<500ms** görünmeli (T4-1).

✅ **Kabul kriteri:** Sipariş eklenince WebSocket'e bağlı KDS client'ı <500ms içinde item'ı alır.

---

## GÖREV S2-5 — Masa Planı UI (POS)
*Süre: 3 saat*

`apps/pos/app/(pos)/tables/page.tsx`

**Bileşen ağacı:**
```
TablesPage
├── AreaTabs          — Bölge sekmeleri (İç Mekan, Bahçe, Teras...)
├── TableGrid         — CSS Grid ile masa yerleşimi
│   └── TableCard     — Tek masa kartı
└── QuickSaleButton   — Hızlı satış (masasız)
```

**TableCard davranışları:**
```typescript
interface TableCardProps {
  table: TableWithOrder
  onSelect: (tableId: string) => void
}

// Renk: Referans Dokümanı Bölüm 5.1'deki hex kodları
// Tıklayınca:
//   empty    → yeni adisyon aç (POST /api/orders)
//   occupied → mevcut adisyona git (/pos/order/[orderId])
//   reserved → modal: "Rezervasyon var, yine de aç?"
//   blocked  → hiçbir şey yapma, tooltip: "Masa kapalı"
```

**WebSocket subscription:**
```typescript
// apps/pos/hooks/useTableUpdates.ts
export function useTableUpdates() {
  const [tables, setTables] = useState<Table[]>([])

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:4000/ws`)
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.event === 'table:status_changed') {
        setTables(prev => prev.map(t =>
          t.id === msg.payload.table_id
            ? { ...t, status: msg.payload.new_status }
            : t
        ))
      }
    }
    return () => ws.close()
  }, [])

  return tables
}
```

**Mobil kural (Referans Bölüm 5.4):**
- 768px üstü: CSS Grid drag-drop
- 768px altı: tap-to-select, drag-drop yok

✅ **Kabul kriteri:** T2-1, T2-2, T2-6 testleri geçmeli. WebSocket event gelince masa rengi JS olmadan CSS transition ile değişmeli.

---

## GÖREV S2-6 — Sipariş / Adisyon Ekranı (POS)
*Süre: 3 saat*

`apps/pos/app/(pos)/order/[id]/page.tsx`

**Bileşen ağacı:**
```
OrderPage
├── OrderHeader       — Masa adı, adisyon no, süre sayacı
├── CategorySidebar   — Kategori ağacı (ElectricSQL'den)
├── ProductGrid       — Seçili kategorinin ürünleri
├── OrderItemList     — Mevcut adisyon kalemleri
│   └── OrderItemRow  — qty +/-, not ekle, sil
└── OrderFootbar      — Toplam, Öde butonu, Beklet, İptal
```

**Ürün seçilince:**
```typescript
// 1. Porsiyon seçimi varsa → PortionModal aç
// 2. Zorunlu option_group varsa → OptionsModal aç
// 3. Hepsi seçilince → PATCH /api/orders/:id/items (add)
// 4. Optimistic update: item'ı hemen listede göster, API yanıtı gelince teyit et
// 5. API hata dönerse: optimistic item'ı geri al + toast.error
```

**Not ekleme:**
```typescript
// OrderItemRow'da uzun basma (long press, 500ms) → NoteModal açar
// Kısa not input (max 100 karakter)
// Kaydet → PATCH /api/orders/:id/items (update, sadece note alanı)
```

✅ **Kabul kriteri:** T2-3, T2-4, T2-5, T2-7, T2-8 testleri geçmeli.

---

## GÖREV S2-7 — Race Condition Koruması
*Süre: 1 saat*

Aynı adisyona eşzamanlı iki istek gelirse veri tutarsızlığı oluşmamalı.

`apps/branch-server/src/lib/order-lock.ts`:
```typescript
// Redis ile order bazlı distributed lock
import { redis } from './redis'

export async function withOrderLock<T>(
  orderId: string,
  fn: () => Promise<T>,
  timeoutMs = 5000
): Promise<T> {
  const lockKey = `lock:order:${orderId}`
  const lockVal = `${Date.now()}-${Math.random()}`

  // Lock al (NX: yoksa set et, PX: ms cinsinden TTL)
  const acquired = await redis.set(lockKey, lockVal, 'NX', 'PX', timeoutMs)
  if (!acquired) {
    throw new AppError('ORDER_LOCKED', 'Sipariş başka bir işlem tarafından güncelleniyor', 409)
  }

  try {
    return await fn()
  } finally {
    // Sadece kendi lock'umuzu sil
    const current = await redis.get(lockKey)
    if (current === lockVal) await redis.del(lockKey)
  }
}

// Kullanım (PATCH /api/orders/:id/items içinde):
return withOrderLock(orderId, async () => {
  // ürün ekle/çıkar işlemleri
})
```

✅ **Kabul kriteri:** T2-8 — iki eşzamanlı istek, her iki item da kaydedilir, toplam doğru.

---

## GÖREV S2-8 — Sprint 2 Entegrasyon Testi
*Süre: 45 dk*

Tam akış testi:
```
1. PIN ile giriş yap
2. Masa planını aç → masalar renkli görünüyor
3. Boş masaya tıkla → adisyon açıldı
4. Ürün seç → adisyon listesine eklendi, toplam güncellendi
5. Adisyonu beklet → masa sarıya döndü (WebSocket)
6. Beklemeyi kaldır → masa kırmızıya döndü
7. Adisyonu 2'ye böl → 2 yeni adisyon, toplamlar eşit
8. Masayı başka masaya taşı → eski masa yeşil, yeni kırmızı
9. Adisyonu iptal et (not olmadan) → hata mesajı
10. Adisyonu iptal et (not ile) → masa yeşile döndü
```

✅ **Sprint 2 tamamlanma kriterleri:**
```
□ T2-1'den T2-8'e kadar tüm testler geçti
□ WebSocket event'leri <500ms geliyor
□ Race condition testi geçti
□ Mobil görünüm 768px altında çalışıyor
□ Commit: "feat(orders): Sprint 2 tamamlandı — masa & sipariş yönetimi"
```
