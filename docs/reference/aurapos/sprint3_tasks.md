# Sprint 3 — Ödeme & Ingenico Entegrasyonu
**Önkoşul:** Sprint 2 tüm kabul testleri geçmiş olmalı  
**Süre:** 5 gün  
**Çıktı:** Nakit/kart/karma ödeme, tam Ingenico akışı, kasa yönetimi, gün sonu kapanış

---

## GÖREV S3-0 — Cari Hesap (Customer Ledger)
*Süre: 1 saat*

`apps/branch-server/src/routes/payments.ts`'e cari ödeme ekle:

```typescript
// method = 'account' ise PaymentOrchestrator'da:
async processAccountPayment(req: PaymentRequest, order: Order) {
  if (!req.customer_id) {
    throw new AppError('VALIDATION_ERROR', 'Cari ödeme için müşteri seçimi zorunlu', 400)
  }

  // customer_ledgers tablosuna borç kaydı
  await db.query(`
    INSERT INTO customer_ledgers
      (business_id, customer_id, branch_id, order_id, type, amount, description, due_date)
    VALUES ($1, $2, $3, $4, 'debit', $5, $6, $7)
  `, [
    order.business_id, req.customer_id, order.branch_id, order.id,
    order.total,
    req.note ?? 'Cari satış',
    req.due_date ?? null
  ])

  // Order'ı kapat
  await this.updateOrderStatus(order, { method: 'account', amount: order.total } as Payment)
}
```

**Cari bakiye endpoint'i:**
```
GET /api/customers/:id/ledger   → Müşterinin borç/alacak geçmişi
POST /api/customers/:id/ledger/pay → Cari ödeme al (bakiyeyi kapat)
```

✅ **Kabul kriteri:**
```bash
# Cari ödeme
curl -X POST http://localhost:4000/api/payments \
  -d '{"order_id":"...","method":"account","amount":250,"customer_id":"..."}' \
  -b "pos_token=..."
# → customer_ledgers'a debit kaydı oluştu
# → order.status = 'closed'
```

---

## GÖREV S3-0b — Check Fragmentation (Kesirli Bölme)
*Süre: 1 saat*

Paylaşılan ürünlerin kişi sayısına bölünmesi:

```typescript
// POST /api/orders/:id/split endpoint'ine fractional mod ekle
// mode=fractional: Seçili item'ları N kişiye böl

// Örnek: 4 kişi meze paylaşıyor (1 adet, 80₺)
// fractional split → 4 adet order_item, qty=0.25, total_price=20₺ her biri
// Her biri farklı seat_no'ya atanır

interface FractionalSplitRequest {
  mode:       'fractional'
  item_ids:   string[]     // Bölünecek item'lar
  seat_count: number       // Kaç kişiye bölünecek
}

// Kuruş yuvarlama kuralı:
// Toplam = 80.00₺, 3 kişi → 26.67 + 26.67 + 26.66
// Son kişiye kalan cent farkı yansır
function distributeWithRounding(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 100) / 100
  const remainder = Math.round((total - base * count) * 100)
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? base + remainder / 100 : base
  )
}
```

✅ **Kabul kriteri:** 3 kişiye bölünen 100₺ → 33.34 + 33.33 + 33.33 (toplam = 100.00).

---


*Süre: 2 saat*

`apps/branch-server/src/lib/payment-orchestrator.ts`

Tüm ödeme akışlarını koordine eden merkezi servis:

```typescript
import { paymentTerminal } from '@aurapos/hardware/payment-terminal'
import { printer }         from '@aurapos/hardware/printer'
import { drawer }          from '@aurapos/hardware/drawer'
import { display }         from '@aurapos/hardware/display'

export class PaymentOrchestrator {

  async processPayment(req: PaymentRequest): Promise<PaymentResult> {
    const order = await this.getOrder(req.order_id)
    this.validatePaymentAmount(req, order)

    // Müşteri ekranına toplam göster
    await display.show([
      order.table_name ?? 'Hızlı Satış',
      `Toplam: ${formatCurrency(req.amount)}`
    ]).catch(() => {}) // display hatası ödemeyi bloklamaz

    let terminalResult = null

    // Kart ödemesi → terminal
    if (['card', 'mixed'].includes(req.method)) {
      const cardAmount = req.method === 'mixed'
        ? req.splits!.find(s => s.method === 'card')!.amount
        : req.amount

      try {
        terminalResult = await paymentTerminal.sale(cardAmount + (req.tip_amount ?? 0))
        if (terminalResult.status !== 'APPROVED') {
          throw new AppError('TERMINAL_DECLINED', 'Kart reddedildi', 402)
        }
      } catch (err) {
        if (err instanceof AppError) throw err
        throw new AppError('TERMINAL_OFFLINE', 'Ödeme terminali bağlı değil', 503)
      }
    }

    // DB'ye kaydet
    const payment = await this.savePayment(req, order, terminalResult)

    // Order güncelle
    const updatedOrder = await this.updateOrderStatus(order, payment)

    // Para çekmecesi — sadece nakit ödemede
    if (['cash', 'mixed'].includes(req.method)) {
      await drawer.open().catch(() => {}) // drawer hatası ödemeyi bloklamaz
    }

    // Fiş yazdır
    await printer.print(this.buildReceipt(updatedOrder, payment))
      .catch(() => {}) // yazıcı hatası ödemeyi bloklamaz

    // Müşteri ekranını temizle
    await display.clear().catch(() => {})

    return {
      payment,
      order:        updatedOrder,
      change_given: req.cash_given ? req.cash_given - req.amount : 0
    }
  }

  private validatePaymentAmount(req: PaymentRequest, order: Order) {
    if (req.amount < order.total) {
      throw new AppError('INSUFFICIENT_AMOUNT', 'Ödeme tutarı yetersiz', 402)
    }
    if (req.method === 'mixed') {
      const splitTotal = req.splits!.reduce((s, p) => s + p.amount, 0)
      if (Math.abs(splitTotal - req.amount) > 0.01) { // floating point tolerans
        throw new AppError('VALIDATION_ERROR', 'Karma ödeme toplamı eşleşmiyor', 400)
      }
    }
    if (req.method === 'cash' && !req.cash_given) {
      throw new AppError('VALIDATION_ERROR', 'Nakit ödeme tutarı gerekli', 400)
    }
  }

  private async updateOrderStatus(order: Order, payment: Payment): Promise<Order> {
    const totalPaid = await this.getTotalPaid(order.id)
    const newStatus = totalPaid >= order.total ? 'paid' : 'partial_paid'

    await db.query(
      `UPDATE orders SET status = $1, closed_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE NULL END
       WHERE id = $2`,
      [newStatus, order.id]
    )

    // Ayar: ödeme tamamlanınca masa otomatik kapat
    if (newStatus === 'paid' && await this.getAutoCloseTable()) {
      await db.query(
        `UPDATE tables SET status = 'empty', current_order_id = NULL WHERE id = $1`,
        [order.table_id]
      )
      broadcast('table:status_changed', { table_id: order.table_id, new_status: 'empty' })
    }

    return this.getOrder(order.id)
  }
}
```

---

## GÖREV S3-2 — Payment API Endpoint'leri
*Süre: 1.5 saat*

`apps/branch-server/src/routes/payments.ts`

Tüm endpoint'ler Referans Dokümanı Bölüm 4.4'te tanımlıdır.

**POST /api/payments** — PaymentOrchestrator.processPayment() çağırır.

**POST /api/payments/:id/refund** *(payments.refund gerektirir)*:
```typescript
// 1. payment kaydını çek
// 2. status 'completed' değilse → 422
// 3. Kart ödemesiyse terminal.refund() çağır
// 4. payment.status = 'refunded' güncelle
// 5. order.status = 'open' geri al (müşteri tekrar ödeyebilsin)
// 6. Stok geri ekle (reçete varsa)
```

**GET /api/payments/summary** — günlük kasa özeti:
```typescript
// Supabase'deki get_daily_revenue() fonksiyonunu çağır
// BRANCH_ID ve bugünün tarihi ile
```

**POST /api/payments/batch-close** *(cash_register.close gerektirir)*:
```typescript
// 1. paymentTerminal.batchClose() çağır
// 2. Günün tüm kart işlemlerini raporla
// 3. cash_registers kaydını kapat
// 4. Supabase'e sync zorla (ElectricSQL flush)
```

✅ **Kabul kriteri:** T3-1'den T3-8'e kadar tüm testler geçmeli.

---

## GÖREV S3-3 — Ingenico Tam Fonksiyon Testi
*Süre: 1 saat*

Mock terminal üzerinde tüm 6 fonksiyonu test et:

`scripts/test-ingenico-full.ts`:
```typescript
import { paymentTerminal } from '../packages/hardware/payment-terminal'

async function main() {
  console.log('=== INGENİCO TAM FONKSİYON TESTİ ===\n')

  // 1. Satış
  const sale = await paymentTerminal.sale(390.00, 'TRY')
  console.assert(sale.status === 'APPROVED', 'sale FAILED')
  console.log('✅ sale:', sale.status, '| auth:', sale.auth_code)

  // 2. Bahşiş
  const tip = await paymentTerminal.addTip(sale.transaction_id, 50.00)
  console.assert(tip.status === 'TIP_ADDED')
  console.log('✅ addTip:', tip.status, '| tip:', tip.tip)

  // 3. Kısmi ödeme
  const partial = await paymentTerminal.partialPayment(200.00, 390.00)
  console.assert(partial.status === 'APPROVED')
  console.assert(partial.remaining === 190.00)
  console.log('✅ partialPayment: paid', partial.paid, '| remaining', partial.remaining)

  // 4. İade
  const refund = await paymentTerminal.refund(sale.transaction_id, 390.00)
  console.assert(refund.status === 'REFUNDED')
  console.log('✅ refund:', refund.status)

  // 5. İptal
  const sale2 = await paymentTerminal.sale(100.00, 'TRY')
  const cancel = await paymentTerminal.cancel(sale2.transaction_id)
  console.assert(cancel.status === 'CANCELLED')
  console.log('✅ cancel:', cancel.status)

  // 6. Batch close
  const batch = await paymentTerminal.batchClose()
  console.assert(batch.status === 'BATCH_CLOSED')
  console.log('✅ batchClose:', batch.status)

  console.log('\n=== TÜM INGENİCO FONKSİYONLARI ÇALIŞIYOR ===')
}
main().catch(e => { console.error('❌', e); process.exit(1) })
```

✅ **Kabul kriteri:** Script hatasız tamamlanıyor.

---

## GÖREV S3-4 — Kasa Yönetimi
*Süre: 1.5 saat*

`apps/branch-server/src/routes/cash-register.ts`

**POST /api/cash-register/open** *(cash_register.open gerektirir)*:
```typescript
// 1. Açık kasa var mı kontrol et → varsa 409
// 2. cash_registers INSERT (opening_amount zorunlu)
// 3. Para çekmecesi aç
// 4. Supabase'e sync
```

**POST /api/cash-register/close** *(cash_register.close gerektirir)*:
```typescript
// Request: { closing_amount: number, note?: string }
// 1. Açık kasayı bul
// 2. Sistemin beklediği tutarı hesapla (opening + cash sales - cash out + cash in)
// 3. Farkı kaydet (closing_amount - expected_amount)
// 4. cash_registers güncelle (closed_at, closing_amount, difference)
// 5. Batch close trigger et
```

**POST /api/cash-movements** *(cash_register.open gerektirir)*:
```typescript
// Request: { type: 'in'|'out', amount: number, reason: string }
// reason boş olamaz — REASON_REQUIRED
```

✅ **Kabul kriteri:**
```bash
# Kasa aç
curl -X POST http://localhost:4000/api/cash-register/open \
  -d '{"opening_amount": 500}' -b "pos_token=..."
# → success: true

# Çift açma
curl -X POST http://localhost:4000/api/cash-register/open \
  -d '{"opening_amount": 500}' -b "pos_token=..."
# → 409 REGISTER_ALREADY_OPEN
```

---

## GÖREV S3-5 — Ödeme Ekranı (POS)
*Süre: 3 saat*

`apps/pos/app/(pos)/payment/[orderId]/page.tsx`

**Bileşen ağacı:**
```
PaymentPage
├── OrderSummary        — Sipariş özeti (salt okunur)
├── PaymentMethodTabs   — Nakit | Kart | Yemek Çeki | Karma
├── CashPaymentForm     — cash_given input, para üstü hesap
├── CardPaymentForm     — tutar + bahşiş, terminal bekleme animasyonu
├── MixedPaymentForm    — her method için tutar girişi
└── PaymentFootbar      — Öde butonu (form valid olana kadar disabled)
```

**Terminal bekleme animasyonu:**
```typescript
// Kart Öde butonuna basılınca:
// 1. Button disabled + spinner
// 2. "Terminal bekleniyor..." overlay (iptal butonu ile)
// 3. POST /api/payments başlat (1500ms mock gecikme)
// 4. APPROVED → başarı animasyonu → /pos/tables'a dön
// 5. DECLINED → "Kart reddedildi" toast → form aktif
// 6. TERMINAL_OFFLINE → sadece nakit/diğer seçenekler aktif
```

**Para üstü hesabı (anlık):**
```typescript
// cash_given değişince:
const change = cashGiven - order.total
// change < 0 → kırmızı "Yetersiz" göster
// change >= 0 → yeşil "Para üstü: X TL" göster
// Öde butonu sadece change >= 0 iken aktif
```

**Karma ödeme validasyonu:**
```typescript
// splits toplamı order.total'e eşit olana kadar Öde butonu disabled
// Her method için min 1 TL zorunlu
```

✅ **Kabul kriteri:** T3-1'den T3-7'ye kadar tüm testler geçmeli.

---

## GÖREV S3-6 — Yemek Çeki (Mock)
*Süre: 1 saat*

Mock driver'a yemek çeki tipi ekle:

`packages/hardware/payment-terminal/mock-driver.ts`'e:
```typescript
async mealVoucherSale(amount: number, voucherType: 'multinet' | 'sodexo' | 'ticket') {
  await delay(1500)
  return {
    status: 'APPROVED' as const,
    auth_code: `MV${Date.now()}`,
    transaction_id: `meal-${Date.now()}`,
    amount,
    voucher_type: voucherType
  }
}
```

`IHardwareDriver.ts`'e interface ekle:
```typescript
mealVoucherSale(amount: number, voucherType: 'multinet' | 'sodexo' | 'ticket'): Promise<MealVoucherResponse>
```

✅ **Kabul kriteri:** Yemek çeki seçilince mock terminal çağrılıyor, ödeme kaydediliyor.

---

## GÖREV S3-7 — Sprint 3 Entegrasyon Testi
*Süre: 45 dk*

Tam akış testi:
```
1. Kasa aç (500 TL açılış)
2. Sipariş oluştur (toplam: 390 TL)
3. Nakit ödeme (500 TL verilen) → para üstü 110 TL, çekmece açılır
4. Yeni sipariş (toplam: 200 TL)
5. Kart ödeme → mock terminal 1500ms bekle → APPROVED
6. Yeni sipariş (toplam: 300 TL)
7. Karma: 100 TL nakit + 200 TL kart → her ikisi işlendi
8. Kart ödemesini iade et → payment.status = 'refunded'
9. Gün sonu: batch close → kasa kapat
10. Kasa özeti → günün toplam cirosu doğru
```

✅ **Sprint 3 tamamlanma kriterleri:**
```
□ T3-1'den T3-8'e kadar tüm testler geçti
□ test-ingenico-full.ts hatasız tamamlandı
□ Terminal offline → sadece nakit seçeneği aktif
□ Yazıcı offline → ödeme bloklanmıyor
□ Para çekmecesi nakit ödemede otomatik açılıyor (mock log)
□ Commit: "feat(payments): Sprint 3 tamamlandı — ödeme & Ingenico"
```
