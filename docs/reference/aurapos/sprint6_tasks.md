# Sprint 6 — Dashboard & AI Insights
**Önkoşul:** Sprint 5 tüm kabul testleri geçmiş olmalı  
**Süre:** 5 gün  
**Çıktı:** İşletme paneli canlı, ciro raporları, şube karşılaştırma, Excel export, AI insight kartları

---

## GÖREV S6-1 — Dashboard Ana Sayfa
*Süre: 3 saat*

`apps/dashboard/app/(panel)/page.tsx`

**Bileşen ağacı:**
```
DashboardPage
├── RevenueCards        — Günlük / Haftalık / Aylık ciro
├── BranchComparison    — Şube karşılaştırma tablosu
├── AiInsightCards      — AI proaktif uyarılar (DeepSeek R1)
├── RecentOrders        — Son 10 adisyon
└── ActiveShifts        — O an çalışan personel
```

**RevenueCards:**
```typescript
// apps/dashboard/components/RevenueCards/index.tsx
interface RevenuePeriod {
  label:       string   // 'Bugün' | 'Bu Hafta' | 'Bu Ay'
  total:       number
  card:        number
  cash:        number
  order_count: number
  vs_prev:     number   // Önceki periyoda göre % değişim
}

// Supabase'deki get_daily_revenue() fonksiyonunu çağır
// 3 kart: bugün (today), haftalık (date_trunc week), aylık (date_trunc month)
// vs_prev hesabı: (this - prev) / prev * 100
// vs_prev > 0 → yeşil ok yukarı | vs_prev < 0 → kırmızı ok aşağı
```

**Tablo — 768px altı kural (Referans Bölüm 5.4):**
```typescript
// RevenueCards: masaüstünde yan yana 3 kart, mobilede alt alta
// BranchComparison: masaüstünde tablo, mobilede her şube ayrı kart
```

---

## GÖREV S6-2 — Şube Ciro Raporu & Excel Export
*Süre: 2 saat*

`apps/dashboard/app/(panel)/reports/page.tsx`

**Tarih filtresi + şube tablosu:**
```typescript
// Başlangıç ve bitiş tarihi seçimi
// Supabase get_daily_revenue() → tarih aralığına adapte et
// Tablo başlıkları: Şube | Ciro | Nakit | Kart | Yemek Çeki | Mobil | İkram | İptal | İşlem Sayısı
```

**Excel export:**
```bash
cd apps/dashboard
pnpm add xlsx
```

```typescript
// apps/dashboard/lib/excel-export.ts
import * as XLSX from 'xlsx'

export function exportRevenueReport(data: BranchRevenue[], dateRange: DateRange) {
  const ws = XLSX.utils.json_to_sheet(
    data.map(row => ({
      'Şube':          row.branch_name,
      'Toplam Ciro':   row.total,
      'Nakit':         row.cash,
      'Kredi Kartı':   row.card,
      'Yemek Çeki':    row.meal_voucher,
      'Mobil':         row.mobile,
      'İşlem Sayısı':  row.order_count,
    }))
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ciro Raporu')

  const filename = `aurapos-ciro-${dateRange.from}-${dateRange.to}.xlsx`
  XLSX.writeFile(wb, filename)
}
```

✅ **Kabul kriteri:**
- Tarih filtresi çalışıyor
- Excel dosyası indiriliyor, veriler doğru
- Dashboard <2 saniyede yükleniyor (Referans Bölüm 5.6)

---

## GÖREV S6-3 — Supabase Edge Function: AI Insights
*Süre: 2 saat*

`supabase/functions/ai-insights/index.ts`

Bu Edge Function, AI insight kartları için DeepSeek R1'i çağırır.
Dashboard her açıldığında tetiklenir (veya 30 dk cache ile).

```typescript
import { createClient } from '@supabase/supabase-js'

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

Deno.serve(async (req) => {
  const { business_id } = await req.json()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Veri topla
  const [revenue, stock, topProducts] = await Promise.all([
    supabase.rpc('get_daily_revenue', { p_business_id: business_id }),
    supabase.rpc('get_critical_stock', { p_business_id: business_id }),
    supabase.from('order_items')
      .select('product_id, products(name), count')
      .eq('orders.business_id', business_id)
      .gte('created_at', new Date(Date.now() - 30*86400000).toISOString())
      .order('count', { ascending: false })
      .limit(5)
  ])

  // DeepSeek R1'e gönder
  const prompt = buildInsightPrompt({
    revenue:     revenue.data,
    criticalStock: stock.data,
    topProducts: topProducts.data
  })

  const aiRes = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('DEEPSEEK_API_KEY')}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      model:       'deepseek-reasoner',
      max_tokens:  500,
      messages: [
        {
          role:    'system',
          content: 'Sen bir restoran yönetim danışmanısın. Verilen verilere göre Türkçe, kısa ve eyleme geçirilebilir öneriler üret. JSON array olarak yanıtla.'
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    })
  })

  const aiData = await aiRes.json()
  const insights = JSON.parse(aiData.choices[0].message.content)

  return new Response(JSON.stringify({ insights }), {
    headers: { 'Content-Type': 'application/json' }
  })
})

function buildInsightPrompt(data: InsightData): string {
  return `
Aşağıdaki restoran verilerine bakarak insight üret:

BUGÜNKÜ CİRO:
${JSON.stringify(data.revenue, null, 2)}

KRİTİK STOK (critical_qty altında):
${JSON.stringify(data.criticalStock, null, 2)}

SON 30 GÜN EN ÇOK SATAN ÜRÜNLER:
${JSON.stringify(data.topProducts, null, 2)}

Yanıtı şu JSON formatında ver:
{
  "insights": [
    {
      "type": "revenue_drop" | "critical_stock" | "low_performer" | "peak_forecast",
      "severity": "info" | "warning" | "critical",
      "title": "kısa başlık",
      "message": "eyleme geçirilebilir Türkçe öneri",
      "action": "isteğe bağlı buton metni"
    }
  ]
}
`
}
```

Deploy:
```bash
supabase functions deploy ai-insights
```

✅ **Kabul kriteri:** `supabase functions invoke ai-insights --body '{"business_id":"..."}'` → insights array geliyor.

---

## GÖREV S6-4 — AI Insight Kartları (Dashboard UI)
*Süre: 1.5 saat*

`apps/dashboard/components/AiInsightCards/index.tsx`:

```typescript
interface Insight {
  type:     'revenue_drop' | 'critical_stock' | 'low_performer' | 'peak_forecast'
  severity: 'info' | 'warning' | 'critical'
  title:    string
  message:  string
  action?:  string
}

const severityStyle = {
  info:     'border-blue-200   bg-blue-50   text-blue-800',
  warning:  'border-yellow-200 bg-yellow-50 text-yellow-800',
  critical: 'border-red-200    bg-red-50    text-red-800'
}

const severityIcon = {
  info:     '💡',
  warning:  '⚠️',
  critical: '🚨'
}

export function AiInsightCards({ businessId }: { businessId: string }) {
  const [insights, setInsights]   = useState<Insight[]>([])
  const [loading,  setLoading]    = useState(true)

  useEffect(() => {
    supabase.functions.invoke('ai-insights', { body: { business_id: businessId } })
      .then(({ data }) => {
        setInsights(data.insights ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [businessId])

  if (loading) return <InsightCardSkeleton count={2} />
  if (!insights.length) return null

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">🤖 AI Önerileri</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {insights.map((insight, i) => (
          <div key={i} className={`border rounded-lg p-4 ${severityStyle[insight.severity]}`}>
            <div className="flex items-start gap-2">
              <span className="text-xl">{severityIcon[insight.severity]}</span>
              <div>
                <p className="font-medium">{insight.title}</p>
                <p className="text-sm mt-1">{insight.message}</p>
                {insight.action && (
                  <button className="mt-2 text-xs underline">{insight.action}</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

**Örnek AI insight çıktıları (hedef):**
```
🚨 Kritik  | "Süt stoğu bitiyor"
           | "Merkez Şube'de 1.2 kg süt kaldı.
              Bugünkü tüketim hızına göre 2 saate bitiyor."
           | [Tedarikçiyi Ara]

⚠️ Uyarı   | "Ciro düşüşü"
           | "Bu hafta cironuz 12.400 ₺ — geçen haftaya göre %15 düşük.
              Çarşamba ve Perşembe günleri en az satış yapılan günler."
           | [Raporu Gör]

💡 Bilgi   | "Düşük performanslı ürün"
           | "Fıstıklı Vanilyalı Latte 30 günde 2 kez satıldı.
              Menüden kaldırmayı veya fiyatını güncellemeyi düşünün."
           | [Menüyü Düzenle]
```

✅ **Kabul kriteri:** Dashboard açılınca AI kartları yükleniyor. Veri yoksa kart gösterilmiyor (null return).

---

## GÖREV S6-5 — Son Adisyonlar Tablosu
*Süre: 1 saat*

`apps/dashboard/components/RecentOrders/index.tsx`:

```typescript
// Supabase'den son 10 adisyon
const { data } = await supabase
  .from('orders')
  .select(`
    id, order_number, status, total, type, created_at, closed_at,
    tables(name),
    staff(name),
    payments(method, amount)
  `)
  .eq('business_id', businessId)
  .order('created_at', { ascending: false })
  .limit(10)

// Tablo başlıkları:
// Adisyon No | Masa | Kasiyer | Durum | Ödeme Yöntemi | Tutar | Saat
// Durum badge renkleri:
// open → sarı | closed → yeşil | cancelled → kırmızı | partial_paid → mavi
```

---

## GÖREV S6-6 — Aktif Mesailer
*Süre: 45 dk*

`apps/dashboard/components/ActiveShifts/index.tsx`:

```typescript
// Supabase'den bugün açık olan shiftler
const { data } = await supabase
  .from('shifts')
  .select('id, started_at, break_minutes, staff(name, role_name)')
  .eq('branch_id', branchId)
  .gte('started_at', new Date().toISOString().split('T')[0])
  .is('ended_at', null)

// Her personel için:
// Ad | Rol | Çalışma süresi (now - started_at - break_minutes) | Canlı sayaç
```

---

## GÖREV S6-7 — Ürün Bazlı Satış Raporu
*Süre: 1.5 saat*

`apps/dashboard/app/(panel)/reports/products/page.tsx`:

```typescript
// Tarih aralığı filtresi + şube filtresi
// Supabase sorgusu:
const { data } = await supabase
  .from('order_items')
  .select(`
    product_id,
    products(name, category_id, categories(name)),
    qty.sum(),
    total_price.sum()
  `)
  .eq('orders.business_id', businessId)
  .gte('orders.created_at', dateRange.from)
  .lte('orders.created_at', dateRange.to)
  .not('status', 'eq', 'cancelled')
  .order('qty', { ascending: false })

// Tablo: Ürün Adı | Kategori | Satış Adedi | Toplam Ciro | Ortalama Fiyat
// Excel export butonu
```

---

## GÖREV S6-8 — Supabase Realtime Dashboard Güncellemeleri
*Süre: 1 saat*

Dashboard canlı güncelleme — her yeni ödeme gelince ciro kartları otomatik güncellenir:

```typescript
// apps/dashboard/hooks/useLiveRevenue.ts
export function useLiveRevenue(businessId: string) {
  const [revenue, setRevenue] = useState<RevenueData | null>(null)

  useEffect(() => {
    // İlk yükleme
    fetchRevenue(businessId).then(setRevenue)

    // Supabase Realtime — payments tablosunu dinle
    const channel = supabase
      .channel('payments-live')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'payments',
        filter: `business_id=eq.${businessId}`
      }, () => {
        // Yeni ödeme gelince ciro verilerini yenile
        fetchRevenue(businessId).then(setRevenue)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [businessId])

  return revenue
}
```

✅ **Kabul kriteri:** POS'tan ödeme alınınca dashboard sayfası refresh olmadan ciro kartları güncelleniyor.

---

## GÖREV S6-9 — Sprint 6 Entegrasyon Testi
*Süre: 45 dk*

Tam akış testi:
```
1. Dashboard aç → RevenueCards yüklendi (<2 sn)
2. AI insight kartları yüklendi (DeepSeek R1 yanıtı)
3. POS'tan yeni ödeme al → dashboard ciro kartı güncellendi (Realtime)
4. Raporlar sayfası → tarih filtresi değiştir → tablo güncellendi
5. Excel export → dosya indirildi, veriler doğru
6. Ürün raporu → en çok satan ürün başta
7. Aktif mesailer → POS'ta giriş yapan personel görünüyor
8. Mobil (768px altı) → tablolar kart görünümüne geçti
```

✅ **Sprint 6 tamamlanma kriterleri:**
```
□ Dashboard <2 sn yükleniyor
□ AI insight kartları geliyor (en az 1 insight)
□ Realtime: ödeme → dashboard güncelleniyor
□ Excel export çalışıyor
□ Tarih filtresi doğru çalışıyor
□ Mobil responsive çalışıyor
□ Commit: "feat(dashboard): Sprint 6 tamamlandı — dashboard & AI insights"
```

---

## Sprint 6 Sonrası — V1.0'a Hazırlık

Sprint 6 bitince MVP tamamdır. V1.0 için sıradaki backlog:

| Sprint | Konu |
|---|---|
| 7 | Menü tam CRUD, ürün görseli, allerjen bilgisi |
| 8 | Stok yönetimi — reçete, otomatik düşüm, sayım |
| 9 | Personel yönetimi — mesai, vardiya, görev fotoğrafı |
| 10 | Müşteri CRM + puan sistemi |
| 11 | e-Fatura (GİB aracı) + muhasebe export |
| 12 | Çoklu şube HQ dashboard + merkezi menü dağıtımı |

**Sprint 7+ başlamadan önce:**
DeepSeek R1 ile tüm dokümanları revize et:
1. MVP'de öğrenilen gerçek kararları işle
2. Değişen API şemalarını güncelle
3. Açık soruların cevaplarını ekle
4. Sprint 7-12 görev listelerini üret
