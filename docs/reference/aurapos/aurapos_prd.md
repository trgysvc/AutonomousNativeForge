# AuraPOS — Kapsamlı Proje Tasarım Dokümanı
**Versiyon:** 0.1-draft  
**Son Güncelleme:** 14 Mart 2026  
**Durum:** 🔴 MVP Geliştirme Aktif  
**Hedef Kitle:** Geliştirici Ekip  

---

> ⚠️ **HALLÜSINASYON ENGEL PROTOKOLÜ**  
> Bu doküman ground-truth kaynaktır. Herhangi bir AI ajanı veya geliştirici bu dokümanda **açıkça tanımlanmayan** hiçbir özelliği varsayım yaparak implemente edemez. Belirsiz bir durum için önce bu doküman güncellenmeli, sonra kod yazılmalıdır.  
> **Kural:** "Muhtemelen şöyle çalışır" → geçersiz. "Dokümanda X satırında yazıyor" → geçerli.

---

## İÇİNDEKİLER

1. [Proje Vizyonu & Hedefler](#1-proje-vizyonu--hedefler)
2. [Rekabet Analizi Özeti](#2-rekabet-analizi-özeti)
3. [Sistem Mimarisi](#3-sistem-mimarisi)
4. [Teknik Stack](#4-teknik-stack)
5. [Donanım Katmanı & Driver Swap Sistemi](#5-donanım-katmanı--driver-swap-sistemi)
6. [Modül Tanımları & API Sözleşmeleri](#6-modül-tanımları--api-sözleşmeleri)
7. [Veritabanı Şeması (Taslak)](#7-veritabanı-şeması-taslak)
8. [Offline-First Mimari](#8-offline-first-mimari)
9. [AI Agent Sistemi](#9-ai-agent-sistemi)
10. [MVP Yol Haritası & Takvim](#10-mvp-yol-haritası--takvim)
11. [Tam Özellik Matrisi](#11-tam-özellik-matrisi)
12. [Test Stratejisi](#12-test-stratejisi)
13. [Deployment & DevOps](#13-deployment--devops)
14. [Açık Sorular & Kararlar Bekleyen Konular](#14-açık-sorular--kararlar-bekleyen-konular)

---

## 1. Proje Vizyonu & Hedefler

### 1.1 Misyon
AuraPOS, Türkiye'deki restoran, kafe ve F&B işletmelerine yönelik **offline-first, AI-destekli, açık mimari** bir POS + işletme yönetim platformudur. Mevcut rakiplerin (Kardo, Samba, Kelem, Menulux) tespit edilen zayıf noktaları üzerine inşa edilmiştir.

### 1.2 Temel Fark Yaratıcı Özellikler
| # | Özellik | Rakip Durumu |
|---|---|---|
| 1 | **Offline-First PWA** — internet kesilince sıfır kesinti | Kardo'da YOK |
| 2 | **AI Proaktif Uyarılar** — "Cironuz %15 düştü, süt stoğu bitiyor" | Hiçbirinde YOK |
| 3 | **Tam Ingenico Entegrasyonu** — bahşiş, kısmi, iptal, batch close | Kardo'da eksik |
| 4 | **Fotoğraf Kanıtlı Görev Yönetimi** | Hiçbirinde YOK |
| 5 | **Driver Swap Donanım Katmanı** — mock→gerçek sıfır kod değişikliği | Hiçbirinde YOK |

### 1.3 Kapsam Dışı (v1.0 için)
- Kripto ödeme
- Yüz tanıma girişi
- ERP entegrasyonu (Logo, Mikro)
- Franchise yönetimi
- Çok dilli menü

---

## 2. Rekabet Analizi Özeti

### 2.1 KardoPOS Güçlü Yönleri (Korumamız Gerekenler)
- Detaylı operasyonel checklist sistemi (zamanlanmış görevler)
- Kapsamlı konfigürasyon esnekliği (yazdırma, şifre ekranı, servis ücreti vb.)
- Hiyerarşik menü yapısı (Ana Kategori → Alt Kategori → Ürün)
- Merkezi çoklu şube yönetimi + şube ciro kıyaslaması
- Dashboard: Günlük/Haftalık/Aylık ciro kartları, son faturalar, mesai özeti

### 2.2 KardoPOS Zayıf Yönleri (AuraPOS'un Çözeceği)
| Sorun | AuraPOS Çözümü |
|---|---|
| Navigasyon derinliği (ödeme yöntemleri için 3 seviye) | Max 2 seviye navigasyon kuralı |
| 404/Boş sayfa hataları state değişimlerinde | Robust routing + error boundaries |
| Mobil tablo deneyimi kötü | Responsive tablo → kart dönüşümü (breakpoint: 768px) |
| Sadece veri gösteriyor, öneri yok | AI Insight Engine |
| Internet kesilince çalışmıyor | Offline-First Service Worker |

### 2.3 Diğer Rakiplerden Alınan En İyi Pratikler
- **Samba:** Masa taşıma/birleştirme/bölme, koltuk bazlı sipariş, karma ödeme, kural tabanlı kampanya
- **Kelem:** Reçete + yarı mamul yönetimi, veresiye/cari, e-Fatura, merkezi HQ, üretim planlaması
- **Menulux:** QR menü & self-order, garson tablet uygulaması, dijital menü board, rezervasyon

---

## 3. Sistem Mimarisi

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND KATMANI                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  POS Ekranı │  │ İşletme     │  │  Garson Tablet      │  │
│  │  (PWA)      │  │ Paneli      │  │  Uygulaması         │  │
│  │  Offline ✓  │  │ (Web)       │  │  (PWA/Mobile)       │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼─────────────────────┼─────────────┘
          │                │                     │
┌─────────▼────────────────▼─────────────────────▼─────────────┐
│                      API GATEWAY (REST + WS)                  │
│              Auth (JWT) · Rate Limit · Logging                │
└────────────────────────────┬──────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────┐
│                      BACKEND SERVİSLERİ                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Order   │ │ Payment  │ │  Menu    │ │  AI Insight      │ │
│  │  Service │ │ Service  │ │  Service │ │  Engine          │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Staff   │ │  Stock   │ │  Report  │ │  Hardware        │ │
│  │  Service │ │  Service │ │  Service │ │  Bridge Service  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└────────────────────────────┬──────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────┐
│                        VERİ KATMANI                            │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────┐ │
│  │  PostgreSQL  │  │  Redis Cache  │  │  Local SQLite       │ │
│  │  (Ana DB)    │  │  (Session/PQ) │  │  (Offline Store)    │ │
│  └──────────────┘  └───────────────┘  └─────────────────────┘ │
└────────────────────────────┬──────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────┐
│                     DONANIM KATMANI                            │
│         Driver Swap Sistemi (mock-driver / real-driver)        │
│  [Ingenico] [Termal Yazıcı] [Para Çekmecesi] [Müşteri Ekranı] │
└───────────────────────────────────────────────────────────────┘
```

### 3.1 Servis İletişim Kuralları
- Servisler arası iletişim: **REST (sync)** veya **Event Bus (async, Redis Pub/Sub)**
- Frontend ↔ Backend: **REST API + WebSocket** (canlı masa durumu, KDS güncellemeleri)
- Offline sync: **IndexedDB (client) ↔ SQLite (local server) ↔ PostgreSQL (cloud)**

---

## 4. Teknik Stack

### 4.1 Onaylı Stack (Değiştirilmeden Uygulanacak)

| Katman | Teknoloji | Versiyon | Notlar |
|---|---|---|---|
| **Frontend Framework** | Next.js | 14+ (App Router) | PWA desteği için |
| **Mobil (Garson)** | React Native | 0.73+ | `/apps/waiter-app`, iOS + Android |
| **UI Library** | React | 18+ | |
| **Styling** | Tailwind CSS | 3+ | |
| **State Management** | Zustand | latest | Server state için TanStack Query |
| **BaaS (Cloud)** | Supabase | latest | PostgreSQL + Auth + Realtime + Storage |
| **Offline DB (Browser)** | PGlite (ElectricSQL) | latest | IndexedDB üzerinde çalışır, browser'da tam Postgres |
| **Offline DB (Şube Sunucu)** | PGlite (ElectricSQL) | latest | Node.js'te SQLite — aynı API, iki ortam |
| **Offline Sync Engine** | ElectricSQL | latest | Postgres→SQLite otomatik sync, conflict resolution dahil |
| **Backend Runtime** | Node.js | 20 LTS | |
| **Backend Framework** | Fastify | 4+ | Express'e göre ~2x hız |
| **Cache / Queue** | Redis | 7+ | Session, pub/sub, background jobs |
| **AI Modeli** | DeepSeek R1 | — | `AI_MODE=api` veya `local` |
| **Konteyner** | Docker + Docker Compose | latest | |
| **Hardware Abstraction** | Driver Swap sistemi | — | Bkz. Bölüm 5 |

### 4.2 Supabase Kullanım Haritası

| Supabase Servisi | AuraPOS'ta Kullanım Yeri |
|---|---|
| **PostgreSQL** | Ana bulut veritabanı — tüm işletme verileri, multi-tenant RLS ile izole |
| **Auth** | İşletme sahibi / yönetici girişi (email+şifre, magic link). Şube personeli PIN auth (custom — Supabase Auth bypass) |
| **Realtime** | Masa durumu, KDS güncellemeleri, çevrimiçi cihazlar arası anlık sync |
| **Storage** | Menü ürün görselleri, günlük görev fotoğraf kanıtları, fiş/fatura PDF'leri |

### 4.3 Multi-Tenant Güvenlik Modeli (Row Level Security)

Her tablo `business_id` kolonuna sahip olacak. Supabase RLS policy'leri:

```sql
-- Örnek: orders tablosu için RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "İşletme kendi siparişlerini görür"
ON orders FOR ALL
USING (business_id = auth.jwt() ->> 'business_id');
```

Bu sayede tek Supabase instance'ında yüzlerce işletme güvenle barındırılır. Bir işletme başkasının verisine erişemez.

### 4.4 ElectricSQL Sync Mimarisi

```
[Supabase PostgreSQL — Cloud]
         ↕ ElectricSQL Sync Engine
[PGlite — Şube Node Sunucu]   ← İnternet kesilince burası devralır
         ↕ ElectricSQL Local Sync
[PGlite — POS Browser (PWA)]  ← Şube sunucu da kesilirse burası devralır
```

**Sync kapsam kuralı:** Her şube sadece kendi verisini çeker:
```typescript
// Şube sadece kendi siparişlerini sync eder
const shape = await electric.db.orders.sync({
  where: { branch_id: currentBranchId }
});
```

**Conflict resolution:** ElectricSQL'in varsayılan `last-write-wins` stratejisi kullanılır. Ödeme kayıtları için ek kural: cloud kaydı her zaman kazanır (Bölüm 8.4).

### 4.5 Yasaklı Teknolojiler (Gerekçesiz Kullanılamaz)
- `localStorage` / `sessionStorage` — PGlite/IndexedDB kullanılacak
- jQuery — React kullanılıyor
- MongoDB — Supabase PostgreSQL şeması tercih edildi
- Class component'lar — functional + hooks
- Dexie.js — ElectricSQL/PGlite ile çakışır, kaldırıldı

---

## 5. Donanım Katmanı & Driver Swap Sistemi

### 5.2 Cihaz Genişletilebilirlik Prensibi

AuraPOS donanım katmanı **her cihaza ve teknolojik yeniliğe açık** olacak şekilde tasarlanmıştır. Yeni bir cihaz markası/modeli eklemek için gereken tek şey o cihaza ait bir `real-driver-{marka}.js` dosyası yazmaktır — sistemin geri kalanında tek satır değişiklik olmaz.

**Dosya yapısı:**
```
/workspace/aurapos/hardware/{cihaz_tipi}/
├── mock-driver.js              ← Her ortamda test için
├── real-driver-ingenico-a910.js
├── real-driver-ingenico-move5000.js
├── real-driver-beko.js         ← Sonraki yazarkasa
├── real-driver-{marka}.js      ← Gelecekteki her marka buraya
└── index.js                    ← HARDWARE_DEVICE env'e göre doğru driver'ı yükler
```

**`index.js` yükleme mantığı:**
```javascript
const driver = process.env.HARDWARE_MODE === 'mock'
  ? require('./mock-driver')
  : require(`./real-driver-${process.env.HARDWARE_DEVICE}`);
// HARDWARE_DEVICE=ingenico-a910 | ingenico-move5000 | beko | ...
module.exports = driver;
```

**Desteklenen / Planlanan Cihazlar:**

### 5.2 Ingenico Mock — Fonksiyon Sözleşmesi

| Fonksiyon | Parametreler | Dönüş Tipi | Simüle Gecikme |
|---|---|---|---|
| `sale(amount, currency)` | `number, string` | `ApprovalResponse` | 1500ms |
| `cancel(transaction_id)` | `string` | `CancelResponse` | 1000ms |
| `refund(transaction_id, amount)` | `string, number` | `RefundResponse` | 1500ms |
| `batchClose()` | — | `BatchResponse` | 2000ms |
| `addTip(transaction_id, tip_amount)` | `string, number` | `TipResponse` | 800ms |
| `partialPayment(amount, total)` | `number, number` | `PartialResponse` | 1500ms |

**ApprovalResponse şeması:**
```typescript
{
  status: 'APPROVED' | 'DECLINED' | 'ERROR',
  auth_code: string,
  transaction_id: string,
  amount: number,
  currency: string,
  card_last4: string,
  card_type: 'VISA' | 'MASTERCARD' | 'AMEX' | 'TROY'
}
```

### 5.3 Termal Yazıcı Mock
- Çıktı: `/workspace/aurapos/mock/printer/receipts/*.txt`
- Gerçek cihaz: USB (`/dev/usb/lp0`) veya Network

**ReceiptObject şeması:**
```typescript
{
  business_name?: string,
  order_id: string,
  table?: string,
  cashier?: string,
  items: Array<{ name: string, qty: number, price: number }>,
  total: number,
  payment_method?: 'Nakit' | 'Kredi Kartı' | 'Yemek Çeki' | 'Mobil Ödeme'
}
```

### 5.4 Diğer Cihazlar

| Cihaz | Mock Durumu | Gerçek Driver Planı |
|---|---|---|
| Para Çekmecesi | ✅ Hazır | ESC/POS komutu (yazıcı üzerinden) |
| Müşteri Ekranı | ✅ Hazır | Serial port / USB HID |
| Barkod Okuyucu | ⏳ Planlandı | HID keyboard emulation |
| Terazi | ⏳ Planlandı | Serial RS-232 |

### 5.5 Tüm Mock'ları Test Etme
```bash
cd /workspace/aurapos
node scripts/test-all-mocks.js
```
Beklenen çıktı: `=== TÜM MOCK SERVİSLER ÇALIŞIYOR ===`

---

## 6. Modül Tanımları & API Sözleşmeleri

### 6.1 Order Service

**Sorumluluk:** Masa yönetimi, adisyon açma/kapama, sipariş CRUD, KDS iletişimi

**Temel Endpoint'ler:**
```
POST   /api/orders              → Yeni adisyon aç
GET    /api/orders/:id          → Adisyon detayı
PATCH  /api/orders/:id          → Güncelle (ürün ekle/çıkar, not ekle)
POST   /api/orders/:id/split    → Adisyon böl
POST   /api/orders/:id/merge    → Adisyon birleştir
POST   /api/orders/:id/transfer → Masa taşı
DELETE /api/orders/:id          → İptal (not zorunlu, audit log)
```

**Order Status State Machine:**
```
OPEN → PARTIAL_PAID → PAID → CLOSED
OPEN → CANCELLED (not zorunlu)
OPEN → ON_HOLD (bekletme)
```

### 6.2 Payment Service

**Sorumluluk:** Ödeme orchestration, Ingenico bridge, para üstü hesabı, kasa sayımı

**Temel Endpoint'ler:**
```
POST /api/payments              → Ödeme başlat
POST /api/payments/:id/confirm  → Onayla
POST /api/payments/:id/refund   → İade
GET  /api/payments/session      → Günlük kasa özeti
POST /api/payments/batch-close  → Gün sonu kapanış
```

**PaymentRequest şeması:**
```typescript
{
  order_id: string,
  method: 'CASH' | 'CARD' | 'MEAL_VOUCHER' | 'MOBILE' | 'MIXED',
  amount: number,
  tip_amount?: number,
  cash_given?: number,        // Nakit ödemede
  partial_amounts?: Array<{   // Karma ödemede
    method: string,
    amount: number
  }>
}
```

### 6.3 Menu Service

**Sorumluluk:** Kategori ağacı, ürün CRUD, opsiyon/ekstra, fiyat yönetimi

**Kategori Hiyerarşisi:**
```
Ana Kategori (ör: SICAK İÇECEKLER)
  └── Alt Kategori (ör: KLASİKLER)
        └── Ürün (ör: Americano)
              ├── Porsiyonlar (Küçük/Büyük)
              └── Opsiyonlar (Sütlü/Sütsüz, Şekerli/Şekersiz)
```

### 6.4 Hardware Bridge Service

**Sorumluluk:** Driver swap yönetimi, cihaz health-check, event routing

```
POST /api/hardware/print        → Yazdır
POST /api/hardware/payment/sale → Ingenico satış
POST /api/hardware/drawer/open  → Para çekmecesi aç
POST /api/hardware/display/show → Müşteri ekranı güncelle
GET  /api/hardware/health       → Tüm cihaz durumu
```

---

## 7. Veritabanı Şeması (Taslak)

> ⚠️ Bu şema taslaktır. Migration öncesi onay gerekir.

### 7.1 Core Tablolar

```sql
-- İşletme ve Şubeler
businesses (id, name, vkn, tax_office, address, created_at)
branches   (id, business_id, name, is_active)

-- Personel
staff      (id, branch_id, name, email, phone, role, pin_hash, is_active)
roles      (id, name, permissions JSONB)

-- Masa Planı
table_areas (id, branch_id, name)
tables      (id, area_id, name, capacity, position_x, position_y, status)

-- Menü
categories  (id, branch_id, parent_id, name, sort_order, is_active)
products    (id, category_id, name, price, vat_rate, unit, is_active)
portions    (id, product_id, name, price_modifier)
options     (id, product_id, name, is_required)
option_items(id, option_id, name, price_modifier)

-- Siparişler
orders      (id, branch_id, table_id, staff_id, status, note, created_at, closed_at)
order_items (id, order_id, product_id, portion_id, qty, unit_price, note, status)
order_item_options (id, order_item_id, option_item_id)

-- Ödemeler
payments       (id, order_id, method, amount, tip_amount, status, ingenico_tid, created_at)
cash_registers (id, branch_id, staff_id, opened_at, closed_at, opening_amount, closing_amount)

-- Stok
ingredients    (id, branch_id, name, unit, current_qty, critical_qty)
recipes        (id, product_id, ingredient_id, qty_per_unit)
stock_movements(id, ingredient_id, type, qty, note, staff_id, created_at)

-- Görevler
tasks          (id, branch_id, title, scheduled_time, requires_photo, is_recurring)
task_logs      (id, task_id, staff_id, completed_at, photo_url, note)

-- Ciro İstatistikleri (Materialized View)
-- ciro_gunluk, ciro_haftalik, ciro_aylik → orders + payments join'den hesaplanır
```

### 7.2 Önemli İndeksler
```sql
CREATE INDEX idx_orders_branch_status ON orders(branch_id, status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_payments_order ON payments(order_id);
```

---

## 8. Offline-First Mimari

### 8.1 Prensip
POS ekranı internet bağlantısı olmadan **tam fonksiyonlu** çalışmalıdır.

### 8.2 Sync Katmanları

```
[Supabase PostgreSQL — Cloud]
         ↕ ElectricSQL Sync Engine (otomatik, conflict resolution dahil)
[PGlite — Şube Node Sunucu (LAN)]
         ↕ ElectricSQL Local Sync
[PGlite — POS Browser (PWA / IndexedDB)]
```

**Katman görevleri:**
- **Cloud (Supabase):** Ground-truth, raporlama, çoklu şube HQ
- **Şube Node Sunucu:** İnternet kesilince tüm şube bu katmandan çalışır; yazıcı, KDS, Ingenico bu sunucuya bağlıdır
- **Browser PGlite:** Şube sunucu da ulaşılamazsa (tam izolasyon) POS çalışmaya devam eder

### 8.3 Offline Sırasında Yapılabilecekler
✅ Sipariş alma ve güncelleme  
✅ Ödeme alma (nakit) — kart için terminal offline moda geçer  
✅ Menü görüntüleme (cache'den)  
✅ Yazdırma (local network yazıcı)  
✅ KDS güncelleme (local network)  
❌ Bulut rapor senkronizasyonu  
❌ Merkezi menü güncellemesi alma  

### 8.4 Conflict Resolution Kuralları
1. **Sipariş çakışması:** `last-write-wins` + audit log
2. **Ödeme çakışması:** Cloud'daki kayıt kazanır, local kayıt audit'e taşınır
3. **Stok çakışması:** Her iki hareketi de uygula, negatif stoka düş + uyarı ver
4. Sync tamamlandığında UI'da "X kayıt senkronize edildi" bildirimi göster

### 8.5 Service Worker Stratejisi
```javascript
// Önbellek stratejileri:
// - Menü, ürün, masa planı → Cache First (günlük invalidate)
// - API POST/PATCH → Background Sync Queue
// - Statik asset'ler → Cache First (build hash ile)
```

---

## 9. AI Agent Sistemi

### 9.1 Model
**DeepSeek R1** — ajan koordinasyonu ve analitik tahminleme

### 9.2 AI Insight Engine (V1 Kapsamı)

Proaktif uyarılar — dashboard'da kart olarak gösterilir:

| Uyarı Tipi | Tetikleyici | Örnek Mesaj |
|---|---|---|
| Ciro düşüşü | Geçen haftaya göre >%10 düşüş | "Bu hafta cironuz ₺2.400 — geçen haftaya göre %15 düşük." |
| Kritik stok | `current_qty < critical_qty` | "Sütünüz 2 kg kaldı, bugünkü tüketim hızına göre 3 saate bitiyor." |
| Yoğunluk tahmini | Geçmiş veri + gün/saat | "Yarın 12:00-14:00 arası yoğun bekleniyor, 2 ekstra personel öneririz." |
| Düşük performanslı ürün | 30 günde <3 satış | "Fıstıklı Vanilyalı Latte 30 günde 2 kez satıldı, menüden kaldırmayı düşünün." |

### 9.3 AI Agent Yapısı (TESTER → CODER)
```
Orchestrator (DeepSeek R1)
├── TESTER Agent   → Hata tespiti, regresyon testi
├── CODER Agent    → Fix üretimi
├── STOCK Agent    → Stok tahmin modeli
└── INSIGHT Agent  → Dashboard uyarıları
```

> ⚠️ V2.0+ kapsamındaki self-healing deployment MVP'ye dahil değildir.

---

## 10. MVP Yol Haritası & Takvim

### 10.1 Faz Tanımları

| Faz | Kod Adı | Hedef | Süre |
|---|---|---|---|
| 🔴 **MVP** | `CORE` | Satış + Ödeme + KDS + Offline altyapı | 12–14 Mart (altyapı), +2 hafta |
| 🟡 **V1.0** | `FULL` | Raporlama, stok, e-Fatura, çoklu şube | +6 hafta |
| 🟢 **V2.0+** | `AI` | AI analytics, self-healing, 3. taraf entegrasyonlar | +12 hafta |

---

### 10.2 MVP Sprint Planı

#### 🔴 Sprint 0 — Altyapı Kurulumu (12–14 Mart) ✅ BAŞLADI
**Teslim edilecekler:**
- [ ] Docker Compose ortamı ayakta (PostgreSQL, Redis, Node)
- [ ] Tüm mock servisler çalışıyor (`test-all-mocks.js` geçiyor)
- [ ] DeepSeek R1 agent'ları bağlı ve test edildi
- [ ] Monorepo yapısı kuruldu (`/apps/pos`, `/apps/dashboard`, `/packages/shared`)
- [ ] CI/CD pipeline (GitHub Actions) ilk hali

**Kabul Kriterleri:**
```bash
node scripts/test-all-mocks.js  
# Çıktı: "=== TÜM MOCK SERVİSLER ÇALIŞIYOR ===" olmalı
```

---

#### 🔴 Sprint 1 — Temel Veri Modeli & Auth (15–18 Mart)
**Teslim edilecekler:**
- [ ] PostgreSQL migration'ları (Bölüm 7 şeması)
- [ ] JWT tabanlı auth (login, refresh token, PIN girişi)
- [ ] Rol bazlı yetki middleware'i (İşletme Sahibi / Yönetici / Personel / Barista)
- [ ] Branch seçimi ve session yönetimi
- [ ] Temel API health-check endpoint'leri

**Kabul Kriterleri:**
- Personel PIN ile giriş yapabilmeli
- Rol bazlı endpoint erişim kısıtlaması çalışmalı
- Migration'lar `npm run db:migrate` ile sorunsuz çalışmalı

---

#### 🔴 Sprint 2 — Masa & Sipariş Yönetimi (19–24 Mart)
**Teslim edilecekler:**
- [ ] Masa planı UI (görsel, drag-drop)
- [ ] Adisyon açma / kapama / bekletme
- [ ] Ürün arama + kategori filtreleme
- [ ] Sipariş notu / özel istek
- [ ] Adisyon bölme (kişi/ürün bazlı)
- [ ] Masa taşıma / birleştirme
- [ ] WebSocket ile canlı masa durumu güncellemesi

**Kabul Kriterleri:**
- 2 garson aynı anda farklı masalara sipariş girebilmeli (race condition yok)
- Masa renk durumları: Boş (yeşil) / Dolu (kırmızı) / Beklemede (sarı)
- Adisyon bölme sonrası toplam tutar korunmalı

---

#### 🔴 Sprint 3 — Ödeme & Ingenico Entegrasyonu (25–29 Mart)
**Teslim edilecekler:**
- [ ] Nakit ödeme + para üstü hesabı
- [ ] Ingenico mock entegrasyonu (sale, cancel, refund, addTip, partialPayment, batchClose)
- [ ] Karma ödeme (nakit + kart)
- [ ] Yemek çeki (Multinet, Sodexo, Ticket) — mock
- [ ] Para çekmecesi açma (nakit ödemede otomatik)
- [ ] Kasa hareketleri (giriş/çıkış kaydı)
- [ ] Gün sonu kasa sayımı & batch close

**Kabul Kriterleri:**
- Kart ödemesinde mock terminal gecikmesi (1500ms) simüle edilmeli
- Kısmi ödeme sonrası kalan tutar doğru hesaplanmalı
- İptal işlemi audit log'a düşmeli

---

#### 🔴 Sprint 4 — KDS & Yazdırma (30 Mart – 3 Nisan)
**Teslim edilecekler:**
- [ ] KDS (Mutfak Ekranı) — WebSocket ile gerçek zamanlı
- [ ] Bar / mutfak / soğuk büfe istasyon ayrımı
- [ ] Sipariş tamamlandı / iptal akışı (KDS'den)
- [ ] Termal yazıcı mock entegrasyonu
- [ ] Otomatik yazdırma (sipariş girilince + ödeme sonrası fiş)
- [ ] Müşteri ekranı güncelleme (ödeme sırasında toplam göster)

**Kabul Kriterleri:**
- Sipariş kaydedilince KDS'de <500ms görünmeli
- Fiş formatı Bölüm 5.3'teki şablona uymalı
- İstasyon bazlı filtreleme çalışmalı (mutfak sadece mutfak siparişlerini görür)

---

#### 🔴 Sprint 5 — Offline-First & PWA (4–8 Nisan)
**Teslim edilecekler:**
- [ ] Service Worker kurulumu (Workbox)
- [ ] IndexedDB şeması (Dexie.js)
- [ ] Local SQLite sync engine
- [ ] Background Sync Queue (POST işlemleri için)
- [ ] Conflict resolution implementasyonu (Bölüm 8.4 kuralları)
- [ ] "Çevrimdışı modu" UI indikatörü
- [ ] İnternet gelince otomatik sync + bildirim

**Kabul Kriterleri:**
- Network tab'ı disabled iken sipariş alınabilmeli
- Bağlantı geri gelince queue'daki işlemler otomatik gönderilmeli
- Conflict durumunda audit log'a kayıt düşmeli

---

#### 🔴 Sprint 6 — Dashboard & Temel Raporlar (9–13 Nisan)
**Teslim edilecekler:**
- [ ] Dashboard: Günlük/Haftalık/Aylık ciro kartları
- [ ] Günlük mesai özeti (personel bazlı)
- [ ] Son faturalar tablosu
- [ ] Şube ciro karşılaştırma tablosu
- [ ] Ürün bazlı satış raporu
- [ ] Excel export (ciro raporu)
- [ ] AI Insight kartları (Bölüm 9.2 — ilk 2 kural)

**Kabul Kriterleri:**
- Dashboard verileri <2 saniyede yüklenmeli
- Tarih filtresi çalışmalı
- Mobil (768px altı) tablo → kart görünümüne geçmeli

---

### 10.3 V1.0 Backlog (Sprint 7–12)

| Sprint | Konu | Öncelik |
|---|---|---|
| 7 | Menü yönetimi (tam CRUD, görsel, allerjen) | 🟡 |
| 8 | Stok yönetimi (reçete + otomatik düşüm + sayım) | 🟡 |
| 9 | Personel yönetimi (mesai, vardiya, görev fotoğrafı) | 🟡 |
| 10 | Müşteri CRM + puan sistemi | 🟡 |
| 11 | e-Fatura (GİB entegrasyonu) + muhasebe export | 🟡 |
| 12 | Çoklu şube HQ dashboard + merkezi menü dağıtımı | 🟡 |

---

### 10.4 V2.0+ Backlog

| Konu | Öncelik |
|---|---|
| AI stok tahmini (hava durumu + geçmiş veri) | 🟢 |
| Yemeksepeti / Getir / Trendyol entegrasyonu | 🟢 |
| AI shift optimizasyonu | 🟢 |
| Self-healing sistem (TESTER→CODER agent loop) | 🟢 |
| QR ödeme (masadan direkt ödeme talebi) | 🟢 |
| WhatsApp sipariş botu | 🟢 |

---

## 11. Tam Özellik Matrisi

### Öncelik: 🔴 MVP | 🟡 V1.0 | 🟢 V2.0+

| Modül | Özellik | Öncelik | Sprint |
|---|---|---|---|
| **Satış** | Masa planı görsel | 🔴 | 2 |
| | Adisyon açma/kapama/bekletme | 🔴 | 2 |
| | Adisyon bölme | 🔴 | 2 |
| | Masa taşıma/birleştirme | 🔴 | 2 |
| | Hızlı satış (kasa modu) | 🔴 | 2 |
| | Sipariş notu | 🔴 | 2 |
| | Garson tablet uygulaması | 🟡 | 7 |
| | QR menü & self-order | 🟡 | 7 |
| **Ödeme** | Nakit + para üstü | 🔴 | 3 |
| | Ingenico (tam — 6 fonksiyon) | 🔴 | 3 |
| | Yemek çeki | 🔴 | 3 |
| | Karma ödeme | 🔴 | 3 |
| | Kasa sayım & gün sonu | 🔴 | 3 |
| | Veresiye / cari hesap | 🟡 | 8 |
| | Online ödeme (iyzico/PayTR) | 🟡 | 10 |
| **Offline** | Service Worker / PWA | 🔴 | 5 |
| | Local SQLite sync | 🔴 | 5 |
| | Conflict resolution | 🔴 | 5 |
| **KDS** | Mutfak ekranı (WebSocket) | 🔴 | 4 |
| | İstasyon ayrımı | 🔴 | 4 |
| | Hazırlık süresi takibi | 🟡 | 9 |
| **Menü** | Kategori/ürün CRUD | 🔴 | 1 |
| | Porsiyon + opsiyon | 🔴 | 1 |
| | Menü görseli | 🟡 | 7 |
| | Zaman bazlı menü | 🟡 | 7 |
| | Allerjen / kalori | 🟢 | — |
| **Stok** | Reçete bazlı otomatik düşüm | 🔴 | 8 |
| | Kritik stok uyarısı | 🟡 | 8 |
| | AI stok tahmini | 🟢 | — |
| **Personel** | Rol + yetki | 🔴 | 1 |
| | PIN girişi | 🔴 | 1 |
| | Mesai takibi | 🟡 | 9 |
| | Görev (fotoğraflı) | 🟡 | 9 |
| | AI shift planlama | 🟢 | — |
| **Raporlar** | Günlük/haftalık/aylık satış | 🔴 | 6 |
| | Ürün bazlı analiz | 🔴 | 6 |
| | Excel export | 🟡 | 6 |
| | AI tahminleme | 🟢 | — |
| **AI** | Insight kartları (dashboard) | 🔴 | 6 |
| | Stok tahmini | 🟢 | — |
| | Self-healing (TESTER/CODER) | 🟡 | — |
| **Yasal** | e-Fatura (GİB) | 🟡 | 11 |
| | e-Arşiv | 🟡 | 11 |
| **3. Taraf** | Yemeksepeti/Getir/Trendyol | 🟢 | — |
| | WhatsApp sipariş botu | 🟢 | — |

---

## 12. Test Stratejisi

### 12.1 Test Piramidi

```
        [E2E Tests]          → Playwright (kritik akışlar: sipariş→ödeme→fiş)
      [Integration Tests]    → Supertest (API endpoint'leri)
    [Unit Tests]             → Vitest (servis logic, utility fonksiyonlar)
  [Mock Servis Testleri]     → Her mock driver için smoke test
```

### 12.2 Kritik E2E Senaryolar (MVP)
1. Masa seç → Ürün ekle → Kart öde → Fiş yazdır → Masa kapan
2. Sipariş gir → İnternet kes → Sipariş kaydet → İnternet aç → Sync doğrula
3. Adisyon böl → Kişi A nakit öde → Kişi B kart öde → İkisi de kapansın
4. KDS: Sipariş gir → Mutfakta hazır işaretle → Masa durumu güncelle

### 12.3 Kabul Kriterleri (Tüm MVP Sprint'leri için Genel)
- Tüm API endpoint'leri için >%80 unit test coverage
- E2E senaryolar CI'da geçmeden merge yapılamaz
- Mock servis testi her deploy öncesi otomatik çalışır
- Lighthouse PWA skoru >90

---

## 13. Deployment & DevOps

### 13.1 Ortam Yapısı

| Ortam | Branch | Açıklama |
|---|---|---|
| `development` | `feature/*` | Local Docker Compose |
| `staging` | `develop` | Cloud VM, mock cihazlar |
| `production` | `main` | Cloud VM, gerçek cihazlar |

### 13.2 Docker Compose Servisleri
```yaml
services:
  postgres:     # Ana veritabanı
  redis:        # Cache + queue
  api:          # Fastify backend
  pos-client:   # Next.js POS ekranı (PWA)
  dashboard:    # Next.js işletme paneli
  kds:          # KDS ekranı (Next.js)
  hardware-bridge: # Donanım mock/real driver bridge
```

### 13.3 Gerçek Cihaza Geçiş
```bash
# Ingenico gerçek driver aktif et:
cp /workspace/aurapos/mock/ingenico/real-driver.js \
   /workspace/aurapos/mock/ingenico/mock-driver.js
docker compose restart hardware-bridge
```

### 13.4 Ortam Değişkenleri (Zorunlu)
```env
# Supabase
SUPABASE_URL=https://{project}.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...  # Backend-only, asla client'a expose edilmez

# Redis
REDIS_URL=redis://...

# Auth
JWT_SECRET=...                 # Supabase JWT secret ile aynı olmalı

# AI
DEEPSEEK_API_KEY=...           # AI_MODE=api ise zorunlu
AI_MODE=api|local              # api=DeepSeek API, local=local model (KVKK)

# Ortam
NODE_ENV=development|staging|production

# Donanım
HARDWARE_MODE=mock|real
HARDWARE_DEVICE=ingenico-a910|ingenico-move5000|beko|...
DRAWER_MODE=escpos|serial      # escpos=yazıcı üzerinden, serial=doğrudan seri port

# e-Fatura
EFATURA_PROVIDER=intermediary|gib
```

---

## 14. Açık Sorular & Kararlar Bekleyen Konular

> Bu bölüm bir karar alınmadan implement edilemez. Her madde çözülünce bu doküman güncellenir.

| # | Soru | Karar | Tarih |
|---|---|---|---|
| 1 | Gerçek Ingenico terminal modeli | ✅ **A910SFI + Move5000** öncelikli. Sonrasında tüm piyasa yazarkasa markaları (Beko dahil) desteklenecek. Driver swap mimarisi bu genişlemeye hazır. | 14.03.2026 |
| 2 | Çoklu şube SQLite yapısı | ✅ **Her şubenin kendi SQLite'ı** olacak. Gerekçe: internet kesilmesi durumunda şubenin tamamen bağımsız çalışabilmesi. | 14.03.2026 |
| 3 | e-Fatura GİB entegrasyonu | ✅ **Aşama 1:** Aracı servis (ör. Uyumsoft, Logo e-Fatura vb.) ile başlanır. **Aşama 2:** Doğrudan GİB servisi kurulur (V1.0→V2.0 geçişinde). | 14.03.2026 |
| 4 | Garson tablet uygulaması | ✅ **React Native** (iOS + Android). Monorepo içinde `/apps/waiter-app` olarak konumlanır. | 14.03.2026 |
| 5 | DeepSeek R1 deployment | ✅ **İkisi de desteklenecek.** `AI_MODE=api` → DeepSeek API, `AI_MODE=local` → local model. Ortam değişkeniyle geçiş. KVKK gerektiren müşterilerde `local` mod zorunlu olur. | 14.03.2026 |
| 6 | Para çekmecesi bağlantısı | ✅ **İkisi de desteklenecek.** Yazıcı üzerinden ESC/POS komutu (standart kurulum) + doğrudan seri port (yazıcısız kurulum). Driver swap ile yönetilir. | 14.03.2026 |

---

*Bu doküman yaşayan bir belgedir. Her sprint başında güncellenir.*  
*Son güncelleyen: [geliştirici adı] | Tarih: [tarih]*
