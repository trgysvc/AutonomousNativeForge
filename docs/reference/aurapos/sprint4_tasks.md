# Sprint 4 — KDS & Yazdırma
**Önkoşul:** Sprint 3 tüm kabul testleri geçmiş olmalı  
**Süre:** 4 gün  
**Çıktı:** Gerçek zamanlı mutfak ekranı, istasyon ayrımı, otomatik yazdırma, müşteri ekranı

---

## GÖREV S4-0 — mDNS Service Discovery
*Süre: 2 saat*

Statik IP yerine mDNS ile yazıcı keşfi. İnternet olmadan LAN'da çalışır.

```bash
cd apps/branch-server
pnpm add mdns-js
```

`packages/hardware/printer/mdns-discovery.ts`:
```typescript
import mdns from 'mdns-js'

export interface DiscoveredPrinter {
  name:       string    // 'kitchen-printer-1'
  mdns_name:  string    // 'kitchen-printer-1.local'
  ip:         string    // '192.168.1.45'
  port:       number    // 9100
}

export async function discoverPrinters(timeoutMs = 5000): Promise<DiscoveredPrinter[]> {
  return new Promise((resolve) => {
    const printers: DiscoveredPrinter[] = []
    const browser = mdns.createBrowser(mdns.tcp('pdl-datastream')) // ESC/POS servisi

    browser.on('ready', () => browser.discover())

    browser.on('update', (data) => {
      if (data.addresses?.length && data.port) {
        printers.push({
          name:      data.fullname?.split('.')[0] ?? 'unknown',
          mdns_name: data.fullname ?? '',
          ip:        data.addresses[0],
          port:      data.port
        })
      }
    })

    setTimeout(() => {
      browser.stop()
      resolve(printers)
    }, timeoutMs)
  })
}

// Bağlantı önceliği:
// 1. mdns_name varsa → mDNS ile çöz (dinamik IP)
// 2. ip_address varsa → statik IP kullan
// 3. İkisi de yoksa → PRINTER_OFFLINE
export async function resolvePrinterAddress(printer: Printer): Promise<string> {
  if (printer.mdns_name) {
    const discovered = await discoverPrinters(2000)
    const found = discovered.find(d => d.mdns_name === printer.mdns_name)
    if (found) return `${found.ip}:${found.port}`
  }
  if (printer.ip_address) return `${printer.ip_address}:${printer.port}`
  throw new AppError('PRINTER_OFFLINE', 'Yazıcı bulunamadı', 503)
}
```

**Printer Routing Rules Engine:**

`apps/branch-server/src/lib/printer-router.ts`:
```typescript
export async function resolveItemPrinter(
  item: OrderItem,
  orderType: string,
  branchId: string
): Promise<Printer> {
  // Aktif kuralları öncelik sırasına göre çek
  const rules = await db.query<PrinterRoutingRule>(`
    SELECT r.*, p.* FROM printer_routing_rules r
    JOIN printers p ON p.id = r.printer_id
    WHERE r.branch_id = $1 AND r.is_active = true
    ORDER BY r.priority ASC
  `, [branchId])

  for (const rule of rules.rows) {
    if (matchesRule(rule, item, orderType)) {
      return rule as Printer
    }
  }

  // Hiçbir kural eşleşmezse varsayılan yazıcı
  const defaultPrinter = await db.query<Printer>(
    `SELECT * FROM printers WHERE branch_id = $1 AND type = $2 AND is_active = true LIMIT 1`,
    [branchId, item.kitchen_station]
  )
  return defaultPrinter.rows[0]
}

function matchesRule(rule: PrinterRoutingRule, item: OrderItem, orderType: string): boolean {
  switch (rule.condition_type) {
    case 'station':     return item.kitchen_station === rule.condition_value
    case 'order_type':  return orderType === rule.condition_value
    case 'category':    return item.category_id === rule.condition_value
    case 'is_fryer':    return String(item.is_fryer) === rule.condition_value
    case 'product':     return item.product_id === rule.condition_value
    default:            return false
  }
}
```

**Endpoint — Yazıcı Keşfi:**
```
GET /api/hardware/printers/discover   → LAN'daki yazıcıları tara
POST /api/hardware/printers/register  → Bulunan yazıcıyı kaydet
```

✅ **Kabul kriteri:**
```bash
# mDNS keşfi
curl http://localhost:4000/api/hardware/printers/discover
# → [{ "name": "kitchen-printer-1", "mdns_name": "...", "ip": "192.168.1.45", "port": 9100 }]

# Routing testi — paket sipariş → paket yazıcısı
# order_type=delivery → printer.type='packaging'
```

---


*Süre: 3 saat*

`apps/kds/app/page.tsx` — TV/tablet'te açık kalır, tek sayfa.

**Bileşen ağacı:**
```
KdsPage
├── StationFilter       — Mutfak | Bar | Soğuk Büfe sekmeleri
├── KdsHeader           — Şube adı, saat, açık ticket sayısı
└── KdsBoard            — CSS Grid, sıralı ticket kartları
    └── KdsTicketCard   — Tek sipariş kartı
        ├── TicketHeader — Masa, adisyon no, geçen süre
        ├── ItemList     — Ürünler + notlar + opsiyonlar
        └── ActionButtons — Hazırla | Hazır | İptal
```

**KdsTicketCard renk/süre mantığı:**
```typescript
// Geçen süreye göre kart kenarlık rengi:
// 0-5 dk  → border-green-500  (taze)
// 5-10 dk → border-yellow-500 (dikkat)
// 10+ dk  → border-red-500 + animasyon (gecikmiş)

function getTicketUrgency(createdAt: string): 'fresh' | 'warning' | 'urgent' {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60000
  if (mins < 5)  return 'fresh'
  if (mins < 10) return 'warning'
  return 'urgent'
}
```

**WebSocket bağlantısı:**
```typescript
// apps/kds/hooks/useKdsOrders.ts
export function useKdsOrders(station: KdsStation) {
  const [tickets, setTickets] = useState<KdsTicket[]>([])

  useEffect(() => {
    // İlk yükleme: mevcut pending item'ları çek
    fetchPendingItems(station).then(setTickets)

    // Yeni siparişleri dinle
    const ws = new WebSocket('ws://localhost:4000/ws')
    ws.onopen = () => {
      ws.send(JSON.stringify({ event: 'kds:subscribe', payload: { station } }))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.event === 'order:created' || msg.event === 'order:updated') {
        // Sadece bu istasyona ait item'lar
        const relevant = filterByStation(msg.payload, station)
        if (relevant.length) setTickets(prev => mergeTickets(prev, relevant))
      }
      if (msg.event === 'order:item:status_changed') {
        setTickets(prev => updateItemStatus(prev, msg.payload))
      }
    }
    return () => ws.close()
  }, [station])

  return { tickets, setTickets }
}
```

**"Hazır" butonu davranışı:**
```typescript
// item status: pending → preparing → ready
// "Hazır" basılınca:
// 1. PATCH /api/orders/:orderId/items (update: { item_id, status: 'ready' })
// 2. WebSocket: order:item:status_changed yayınla (POS masa ekranı da güncellenir)
// 3. Tüm item'lar ready ise ticket KDS'den kaybolur
```

✅ **Kabul kriteri:** T4-1, T4-2, T4-3, T4-4 testleri geçmeli.

---

## GÖREV S4-2 — KDS Süresi Sayacı
*Süre: 30 dk*

Her ticket'ta canlı süre sayacı:
```typescript
// apps/kds/components/KdsTicketCard/TimerBadge.tsx
export function TimerBadge({ createdAt }: { createdAt: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [createdAt])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const urgency = mins >= 10 ? 'urgent' : mins >= 5 ? 'warning' : 'fresh'

  return (
    <span className={urgencyClass[urgency]}>
      {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
    </span>
  )
}

const urgencyClass = {
  fresh:   'text-green-400 font-mono',
  warning: 'text-yellow-400 font-mono animate-pulse',
  urgent:  'text-red-400 font-mono animate-pulse font-bold'
}
```

✅ **Kabul kriteri:** Sayaç saniyede güncelleniyor, 5dk'da sarı, 10dk'da kırmızı+pulse.

---

## GÖREV S4-3 — Otomatik Yazdırma Sistemi
*Süre: 2 saat*

`apps/branch-server/src/lib/auto-print.ts`

**İki otomatik yazdırma tetikleyicisi:**

```typescript
// 1. Sipariş girilince → mutfak fişi (KDS olmayan kurulumlar için)
export async function printKitchenTicket(order: Order, newItems: OrderItem[]) {
  // Ayar: "Sipariş girilince otomatik yazdır" aktifse
  if (!await getSetting('auto_print_on_order')) return

  // İstasyon bazlı grupla
  const byStation = groupBy(newItems, i => i.kitchen_station)

  for (const [station, items] of Object.entries(byStation)) {
    await printer.printKitchenTicket({
      order_id:   order.id,
      table:      order.table_name ?? undefined,
      station:    station as KdsStation,
      items:      items.map(i => ({
        name:    i.product_name,
        qty:     i.qty,
        note:    i.note ?? undefined,
        options: i.options.map(o => o.option_item_name)
      })),
      created_at: new Date().toISOString()
    }).catch(err => {
      // Yazdırma hatası sipariş kaydını bloklamaz
      console.error('[AUTO-PRINT] Mutfak fişi yazdırılamadı:', err)
      broadcast('hardware:status', { device: 'printer', online: false })
    })
  }
}

// 2. Ödeme tamamlanınca → müşteri fişi
export async function printReceipt(order: Order, payment: Payment) {
  await printer.print({
    business_name:  order.business_name,
    order_id:       String(order.order_number),
    table:          order.table_name ?? undefined,
    cashier:        order.staff_name,
    items:          order.items
                      .filter(i => !['cancelled'].includes(i.status))
                      .map(i => ({ name: i.product_name, qty: i.qty, price: i.unit_price })),
    total:          order.total,
    payment_method: formatPaymentMethod(payment.method),
    tip_amount:     payment.tip_amount || undefined,
    change_given:   payment.change_given || undefined
  }).catch(err => {
    console.error('[AUTO-PRINT] Müşteri fişi yazdırılamadı:', err)
    broadcast('hardware:status', { device: 'printer', online: false })
  })
}
```

✅ **Kabul kriteri:** T4-5, T4-6 testleri geçmeli. Yazıcı offline → `hardware:status` WebSocket event'i POS'ta toast gösteriyor.

---

## GÖREV S4-4 — Fiş Yeniden Yazdırma
*Süre: 30 dk*

`apps/branch-server/src/routes/payments.ts`'e ekle:

```
POST /api/payments/:id/reprint
```

```typescript
// 1. payment kaydını çek
// 2. order'ı çek
// 3. printReceipt() çağır
// 4. Yazıcı offline → 503 PRINTER_OFFLINE (ama spesifik mesaj)
```

POS'ta ödeme sonrası "Fişi Yeniden Yazdır" butonu:
```typescript
// Sadece son ödemenin yanında görünür
// Tıklanınca POST /api/payments/:id/reprint
// Loading state + toast (başarı/hata)
```

✅ **Kabul kriteri:** Ödeme sonrası "Yeniden Yazdır" butonu çalışıyor.

---

## GÖREV S4-5 — Mutfak Fişi Şablonu
*Süre: 45 dk*

`packages/hardware/printer/mock-driver.ts`'e `printKitchenTicket` ekle:

```typescript
async printKitchenTicket(ticket: KitchenTicket): Promise<PrintResponse> {
  const stationLabel = { kitchen: 'MUTFAK', bar: 'BAR', cold: 'SOĞUK BÜFE' }
  const lines = [
    '================================',
    `  *** ${stationLabel[ticket.station]} ***`,
    '================================',
    `Masa    : ${ticket.table ?? 'Hızlı Satış'}`,
    `Adisyon : #${ticket.order_id.slice(-6).toUpperCase()}`,
    `Saat    : ${new Date(ticket.created_at).toLocaleTimeString('tr-TR')}`,
    '--------------------------------',
    ...ticket.items.map(i => {
      const lines = [`${i.qty}x ${i.name}`]
      if (i.options?.length) lines.push(`   → ${i.options.join(', ')}`)
      if (i.note) lines.push(`   NOT: ${i.note}`)
      return lines.join('\n')
    }),
    '================================',
  ]

  const content = lines.join('\n')
  const filename = `kitchen_${ticket.station}_${Date.now()}.txt`
  const filepath = path.join(RECEIPTS_DIR, filename)
  await fs.writeFile(filepath, content, 'utf-8')

  console.log(`[MOCK-PRINTER] → ${filename}`)
  return { status: 'PRINTED', file: filepath }
}
```

✅ **Kabul kriteri:** `receipts/` klasöründe `kitchen_mutfak_*.txt` dosyaları oluşuyor.

---

## GÖREV S4-6 — Müşteri Ekranı Entegrasyonu
*Süre: 45 dk*

`apps/branch-server/src/lib/display-manager.ts`:

```typescript
export class DisplayManager {
  // Sipariş devam ederken ürün eklenince
  async showOrderTotal(order: Order) {
    await display.show([
      order.table_name ? `Masa: ${order.table_name}` : 'Hızlı Satış',
      `Toplam: ${formatCurrency(order.total)}`
    ]).catch(() => {})
  }

  // Ödeme beklenirken
  async showPaymentWaiting(amount: number) {
    await display.show([
      'Ödeme Bekleniyor...',
      formatCurrency(amount)
    ]).catch(() => {})
  }

  // Ödeme tamamlanınca
  async showThankYou(change?: number) {
    const lines = change && change > 0
      ? ['Teşekkür Ederiz!', `Para Üstü: ${formatCurrency(change)}`]
      : ['Teşekkür Ederiz!', 'İyi Günler!']
    await display.show(lines).catch(() => {})
    // 3 sn sonra temizle
    setTimeout(() => display.clear().catch(() => {}), 3000)
  }
}
```

Entegrasyon noktaları:
- Ürün eklenince → `showOrderTotal()`
- Ödeme başlatılınca → `showPaymentWaiting()`
- Ödeme tamamlanınca → `showThankYou(change)`

✅ **Kabul kriteri:** Mock display logları doğru sırayla görünüyor.

---

## GÖREV S4-7 — Sprint 4 Entegrasyon Testi
*Süre: 45 dk*

İki terminal aç: biri POS, biri KDS (`http://localhost:3002`).

Tam akış testi:
```
1. POS'ta sipariş oluştur (2 mutfak, 1 bar ürünü)
2. KDS'de Mutfak sekmesinde 2 ürün görünüyor (<500ms)
3. KDS'de Bar sekmesinde 1 ürün görünüyor
4. Mutfak'ta 1 ürünü "Hazırlanıyor" → sarı
5. Mutfak'ta 1 ürünü "Hazır" → ticket'tan kaybolur
6. Tüm item'lar hazır → ticket tamamen kaybolur
7. POS'ta ödeme al → fiş receipts/ klasörüne yazıldı
8. Yazıcı mock offline yap → ödeme tamamlanır, toast çıkar
9. "Yeniden Yazdır" → fiş yeniden yazıldı
10. Display mock logları: showOrderTotal → showPaymentWaiting → showThankYou
```

✅ **Sprint 4 tamamlanma kriterleri:**
```
□ T4-1'den T4-6'ya kadar tüm testler geçti
□ KDS sayacı doğru renk geçişleri yapıyor
□ İstasyon filtresi çalışıyor
□ Yazıcı offline → ödeme bloklanmıyor
□ Müşteri ekranı doğru sırayla güncelleniyor
□ Commit: "feat(kds): Sprint 4 tamamlandı — KDS & yazdırma"
```
