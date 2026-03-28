# AuraPOS — Tam Referans Dokümanı
**Bu doküman AI ajanının tek gerçek kaynağıdır.**  
**Versiyon:** 1.0 | **Tarih:** 14 Mart 2026

---

> ## ⚠️ HALLÜSINASYON ENGEL PROTOKOLÜ
> 1. Bu dokümanda **tanımlanmayan** hiçbir davranış varsayılamaz.
> 2. Belirsiz bir durum → önce soru sor, sonra yaz.
> 3. "Muhtemelen şöyle çalışır" → **geçersiz**.
> 4. "Dokümanda X bölümünde yazıyor" → **geçerli**.
> 5. İki doküman çelişirse → **bu doküman kazanır**, çelişkiyi rapor et.

---

## İÇİNDEKİLER
1. [Kod Yazım Kuralları](#1-kod-yazım-kuralları)
2. [Ortam Değişkenleri Haritası](#2-ortam-değişkenleri-haritası)
3. [Auth Sistemi — Tam Akış](#3-auth-sistemi--tam-akış)
4. [API Sözleşmeleri — Tam Şemalar](#4-api-sözleşmeleri--tam-şemalar)
5. [UI Davranış Kuralları](#5-ui-davranış-kuralları)
6. [Hata Yönetimi Standartları](#6-hata-yönetimi-standartları)
7. [Servisler Arası İletişim Kuralları](#7-servisler-arası-i̇letişim-kuralları)
8. [Test Senaryoları — Tüm Sprintler](#8-test-senaryoları--tüm-sprintler)
9. [Dosya ve Klasör İsimlendirme Kuralları](#9-dosya-ve-klasör-i̇simlendirme-kuralları)
10. [Sprint 1 — JWT Auth, PIN, Rol Sistemi](#10-sprint-1--jwt-auth-pin-rol-sistemi)
11. [Bilinen Kısıtlar ve Kesin Yasaklar](#11-bilinen-kısıtlar-ve-kesin-yasaklar)

---

## 1. Kod Yazım Kuralları

### 1.1 Genel
- Dil: **TypeScript strict mode** — `"strict": true` tsconfig'de zorunlu
- Formatter: **Prettier** — `.prettierrc` proje kökünde, tartışılmaz
- Linter: **ESLint** + `@typescript-eslint` + `eslint-plugin-react-hooks`
- Import sırası: 1) Node built-ins 2) Dış paketler 3) Workspace paketleri 4) Local
- Her dosya **tek sorumluluk** — bir dosya bir şey yapar

### 1.2 Prettier Konfigürasyonu (`.prettierrc`)
```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "avoid"
}
```

### 1.3 TypeScript Kuralları
```typescript
// ✅ DOĞRU — explicit return type
async function getOrder(id: string): Promise<Order> { ... }

// ❌ YANLIŞ — return type çıkarıma bırakılamaz (public API'lerde)
async function getOrder(id: string) { ... }

// ✅ DOĞRU — unknown > any
catch (err: unknown) { ... }

// ❌ YANLIŞ — any yasak
catch (err: any) { ... }

// ✅ DOĞRU — type assertion yerine type guard
function isOrder(x: unknown): x is Order {
  return typeof x === 'object' && x !== null && 'id' in x
}

// ❌ YANLIŞ — zorla cast
const order = response as Order
```

### 1.4 React Kuralları
- **Functional component + hooks only** — class component yasak
- Component dosyası = PascalCase: `OrderCard.tsx`
- Hook dosyası = camelCase, `use` prefix: `useOrderSync.ts`
- Her component kendi klasöründe: `components/OrderCard/index.tsx`
- Props tipi her zaman dosyada tanımlı:
```typescript
// ✅ DOĞRU
interface OrderCardProps {
  order: Order
  onClose: () => void
}
export function OrderCard({ order, onClose }: OrderCardProps) { ... }

// ❌ YANLIŞ — inline object tip
export function OrderCard({ order, onClose }: { order: Order; onClose: () => void }) { ... }
```

### 1.5 Async/Await Kuralları
```typescript
// ✅ DOĞRU — her async çağrı try/catch içinde
try {
  const result = await paymentTerminal.sale(amount)
  return result
} catch (err: unknown) {
  throw new AppError('PAYMENT_FAILED', err)
}

// ❌ YANLIŞ — unhandled promise
paymentTerminal.sale(amount).then(handleResult)
```

### 1.6 Commit Mesajı Formatı
```
<tip>(<kapsam>): <kısa açıklama>

Tipler: feat | fix | chore | docs | test | refactor | perf
Kapsam: auth | orders | payments | hardware | sync | ui | db

Örnekler:
feat(auth): PIN girişi akışı eklendi
fix(payments): Ingenico partial payment response parse hatası
chore(deps): ElectricSQL 0.12 güncellendi
```

---

## 2. Ortam Değişkenleri Haritası

Hangi `.env` değişkeni hangi serviste kullanılır — AI asla tahmin edemez, buraya bakar.

| Değişken | branch-server | pos (Next.js) | dashboard | waiter-app | Açıklama |
|---|---|---|---|---|---|
| `SUPABASE_URL` | ✅ | ✅ (PUBLIC_) | ✅ (PUBLIC_) | ✅ | Supabase proje URL |
| `SUPABASE_ANON_KEY` | ❌ | ✅ (PUBLIC_) | ✅ (PUBLIC_) | ✅ | Client tarafı key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ❌ | ❌ | ❌ | Sadece backend — asla client'a expose edilmez |
| `SUPABASE_DB_URL` | ✅ | ❌ | ❌ | ❌ | ElectricSQL için direct DB bağlantısı |
| `ELECTRIC_URL` | ✅ | ✅ | ❌ | ✅ | ElectricSQL endpoint |
| `REDIS_URL` | ✅ | ❌ | ❌ | ❌ | Sadece branch-server |
| `JWT_SECRET` | ✅ | ❌ | ❌ | ❌ | PIN token imzalamak için |
| `AI_MODE` | ✅ | ❌ | ✅ | ❌ | `api` veya `local` |
| `DEEPSEEK_API_KEY` | ✅ | ❌ | ✅ | ❌ | AI_MODE=api ise zorunlu |
| `HARDWARE_MODE` | ✅ | ❌ | ❌ | ❌ | `mock` veya `real` |
| `HARDWARE_DEVICE` | ✅ | ❌ | ❌ | ❌ | Terminal model adı |
| `DRAWER_MODE` | ✅ | ❌ | ❌ | ❌ | `escpos` veya `serial` |
| `EFATURA_PROVIDER` | ✅ | ❌ | ✅ | ❌ | `intermediary` veya `gib` |
| `BRANCH_ID` | ✅ | ✅ | ❌ | ✅ | Bu cihazın şube UUID'si |
| `BUSINESS_ID` | ✅ | ✅ | ❌ | ✅ | İşletme UUID'si |
| `NODE_ENV` | ✅ | ✅ | ✅ | ✅ | `development`/`staging`/`production` |

**Next.js kuralı:** Browser'a expose edilecek değişkenler `NEXT_PUBLIC_` prefix'i alır.  
`SUPABASE_URL` → `NEXT_PUBLIC_SUPABASE_URL` (pos ve dashboard için)

---

## 3. Auth Sistemi — Tam Akış

### 3.1 İki Farklı Auth Tipi

AuraPOS'ta **iki ayrı kullanıcı tipi** vardır. Bunları karıştırmak ciddi güvenlik açığıdır.

| Tip | Kim? | Nasıl giriş? | Token | Kullandığı servis |
|---|---|---|---|---|
| **İşletme Kullanıcısı** | Sahip, Yönetici | Email + şifre (Supabase Auth) | Supabase JWT | Dashboard |
| **Şube Personeli** | Kasiyer, Garson, Barista | 4 haneli PIN | Custom JWT (branch-server imzalar) | POS, KDS, Waiter App |

---

### 3.2 İşletme Kullanıcısı Auth (Supabase Auth)

```
[Dashboard Login Sayfası]
        ↓ email + şifre
[Supabase Auth]
        ↓ session (access_token + refresh_token)
[Dashboard — supabase.auth.getSession()]
        ↓ her API çağrısında Authorization: Bearer <access_token>
[Supabase RLS — auth.jwt() → business_id kontrol]
```

**Dashboard'da Supabase client başlatma:**
```typescript
// apps/dashboard/lib/supabase.ts
import { createBrowserClient } from '@supabase/ssr'

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

**Supabase JWT'ye business_id enjekte etme:**  
Kullanıcı kayıt/giriş sonrası `app_metadata.business_id` set edilmeli:
```sql
-- Supabase Edge Function veya webhook ile:
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"business_id": "UUID"}'
WHERE id = auth.uid();
```
Bu sayede RLS'deki `auth_business_id()` fonksiyonu çalışır.

---

### 3.3 Şube Personeli PIN Auth (Custom JWT)

```
[POS PIN Ekranı]
        ↓ staff_id + 4 haneli PIN
[branch-server POST /api/auth/pin-login]
        ↓ DB'den staff çek, bcrypt.compare(pin, pin_hash)
        ↓ HATA: 401 — yanlış PIN (mesaj: "Hatalı PIN")
        ↓ BAŞARI: JWT imzala (JWT_SECRET ile, 8 saat geçerli)
[POS — localStorage DEĞİL — memory state + httpOnly cookie]
        ↓ her branch-server isteğinde Cookie: pos_token=...
[branch-server middleware — token doğrula, role yükle]
```

**PIN JWT Payload şeması — bu şemadan sapılamaz:**
```typescript
interface PinTokenPayload {
  sub:         string   // staff.id (UUID)
  name:        string   // staff.name
  role:        string   // 'owner' | 'manager' | 'cashier' | 'waiter' | 'barista'
  permissions: string[] // ['orders', 'payments', 'reports', ...]
  branch_id:   string   // staff.branch_id
  business_id: string   // staff.business_id
  iat:         number   // issued at
  exp:         number   // iat + 8 saat (28800 saniye)
}
```

**branch-server PIN login endpoint:**
```typescript
// apps/branch-server/src/routes/auth.ts
app.post<{ Body: { staff_id: string; pin: string } }>('/pin-login', async (req, reply) => {
  const { staff_id, pin } = req.body

  // Validasyon
  if (!staff_id || !pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    return reply.code(400).send({ code: 'INVALID_INPUT', message: 'Geçersiz giriş' })
  }

  // Personeli çek (local PGlite'tan — offline da çalışsın)
  const staff = await db.query<Staff>(
    'SELECT * FROM staff WHERE id = $1 AND is_active = true', [staff_id]
  )
  if (!staff.rows[0]) {
    return reply.code(401).send({ code: 'STAFF_NOT_FOUND', message: 'Personel bulunamadı' })
  }

  // PIN doğrula
  const valid = await bcrypt.compare(pin, staff.rows[0].pin_hash)
  if (!valid) {
    return reply.code(401).send({ code: 'WRONG_PIN', message: 'Hatalı PIN' })
  }

  // JWT imzala
  const token = jwt.sign({
    sub:         staff.rows[0].id,
    name:        staff.rows[0].name,
    role:        staff.rows[0].role_name,
    permissions: staff.rows[0].permissions,
    branch_id:   staff.rows[0].branch_id,
    business_id: staff.rows[0].business_id,
  } satisfies Omit<PinTokenPayload, 'iat' | 'exp'>,
  process.env.JWT_SECRET!, { expiresIn: '8h' })

  // httpOnly cookie olarak gönder
  reply.setCookie('pos_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   28800
  })

  return { success: true, name: staff.rows[0].name, role: staff.rows[0].role_name }
})
```

---

### 3.4 Rol İzin Matrisi — Kesin Tanım

| İzin | owner | manager | cashier | waiter | barista |
|---|---|---|---|---|---|
| `orders.create` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `orders.cancel` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `orders.discount` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `payments.process` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `payments.refund` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `reports.view` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `staff.manage` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `menu.edit` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `stock.edit` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `kds.update` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `cash_register.open` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `cash_register.close` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `complimentary.give` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `waste.record` | ✅ | ✅ | ✅ | ❌ | ❌ |

**Middleware implementasyonu:**
```typescript
// apps/branch-server/src/middleware/requirePermission.ts
import type { FastifyRequest, FastifyReply } from 'fastify'

export function requirePermission(permission: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies.pos_token
    if (!token) return reply.code(401).send({ code: 'NO_TOKEN' })

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as PinTokenPayload
      if (!payload.permissions.includes(permission)) {
        return reply.code(403).send({
          code: 'FORBIDDEN',
          message: `Bu işlem için '${permission}' yetkisi gerekli`
        })
      }
      req.staff = payload  // FastifyRequest'e extend edilmiş alan
    } catch {
      return reply.code(401).send({ code: 'INVALID_TOKEN' })
    }
  }
}

// Kullanım:
app.post('/orders/:id/cancel',
  { preHandler: requirePermission('orders.cancel') },
  cancelOrderHandler
)
```

---

## 4. API Sözleşmeleri — Tam Şemalar

### 4.1 Genel API Kuralları

**Base URL:** `http://localhost:4000/api` (branch-server)  
**Content-Type:** `application/json` (tüm istekler)  
**Auth:** `Cookie: pos_token=...` (PIN auth gerektiren endpoint'ler)

**Başarılı yanıt formatı:**
```typescript
// Tekil kayıt
{ data: T, meta?: Record<string, unknown> }

// Liste
{ data: T[], meta: { total: number, page: number, per_page: number } }

// İşlem sonucu (create/update/delete)
{ success: true, data: T }
```

**Hata yanıt formatı — istisnasız bu format:**
```typescript
{
  success:   false,
  code:      string,   // 'ORDER_NOT_FOUND' — makine okuyabilir
  message:   string,   // 'Sipariş bulunamadı' — kullanıcıya gösterilebilir
  field?:    string,   // Validasyon hatası hangi alanda
  details?:  unknown   // Debug — sadece NODE_ENV=development'ta dolu
}
```

---

### 4.2 Auth Endpoint'leri

```
POST /api/auth/pin-login
POST /api/auth/logout
GET  /api/auth/me
```

**POST /api/auth/pin-login**
```typescript
// Request
{ staff_id: string, pin: string }  // pin: 4 haneli rakam string

// Response 200
{ success: true, name: string, role: string }

// Response 400 — geçersiz input
{ success: false, code: 'INVALID_INPUT', message: 'Geçersiz giriş' }

// Response 401 — yanlış PIN (kasta belirsiz — kaba kuvvet engeli)
{ success: false, code: 'AUTH_FAILED', message: 'PIN veya personel hatalı' }
```

**GET /api/auth/me** *(auth gerektirir)*
```typescript
// Response 200
{
  data: {
    id:          string,
    name:        string,
    role:        string,
    permissions: string[],
    branch_id:   string
  }
}
```

---

### 4.3 Order Endpoint'leri

```
GET    /api/orders                    → Açık siparişleri listele
POST   /api/orders                    → Yeni adisyon aç
GET    /api/orders/:id                → Adisyon detayı
PATCH  /api/orders/:id/items          → Ürün ekle / güncelle
DELETE /api/orders/:id/items/:itemId  → Ürün çıkar
POST   /api/orders/:id/split          → Adisyon böl
POST   /api/orders/:id/transfer       → Masa taşı
POST   /api/orders/:id/cancel         → İptal et
POST   /api/orders/:id/hold           → Beklet
POST   /api/orders/:id/release        → Beklemeyi kaldır
```

**POST /api/orders** *(orders.create gerektirir)*
```typescript
// Request
{
  table_id?:    string,       // Null = hızlı satış
  type:         'dine_in' | 'takeaway' | 'delivery',
  cover_count?: number,       // Default: 1
  note?:        string
}

// Response 201
{
  success: true,
  data: Order   // Tam Order nesnesi (aşağıda tanımlı)
}

// Response 409 — masada zaten açık adisyon var
{ success: false, code: 'TABLE_OCCUPIED', message: 'Masada açık adisyon mevcut' }
```

**Order nesnesi — tam şema:**
```typescript
interface Order {
  id:            string
  branch_id:     string
  table_id:      string | null
  table_name:    string | null      // join ile gelir
  staff_id:      string
  staff_name:    string             // join ile gelir
  order_number:  number
  status:        'open' | 'on_hold' | 'partial_paid' | 'paid' | 'closed' | 'cancelled'
  type:          'dine_in' | 'takeaway' | 'delivery'
  note:          string | null
  cover_count:   number
  subtotal:      number
  service_fee:   number
  discount:      number
  total:         number
  items:         OrderItem[]
  created_at:    string             // ISO 8601
  updated_at:    string
  closed_at:     string | null
}

interface OrderItem {
  id:            string
  product_id:    string
  product_name:  string             // snapshot
  portion_id:    string | null
  portion_name:  string | null      // snapshot
  qty:           number
  unit_price:    number             // sipariş anındaki fiyat — değişmez
  total_price:   number
  note:          string | null
  status:        'pending' | 'preparing' | 'ready' | 'served' | 'cancelled' | 'waste' | 'complimentary'
  options:       OrderItemOption[]
  sent_to_kds:   boolean
}

interface OrderItemOption {
  option_item_id:   string
  option_item_name: string    // snapshot
  price_modifier:   number
}
```

**PATCH /api/orders/:id/items** *(orders.create gerektirir)*
```typescript
// Request — items dizisi delta olarak gelir (sadece değişenler)
{
  add?: Array<{
    product_id:  string,
    portion_id?: string,
    qty:         number,
    seat_no?:    number,    // ← YENİ: Koltuk numarası (1,2,3...) — null = masa geneli
    note?:       string,
    options?:    Array<{ option_item_id: string }>
  }>,
  update?: Array<{
    item_id:   string,
    qty?:      number,
    note?:     string,
    seat_no?:  number,      // ← YENİ: Koltuğu sonradan değiştirebilir
    status?:   OrderItem['status']
  }>,
  remove?: string[],        // item_id listesi
  lock_version: number      // ← YENİ: Optimistic lock — mevcut order.lock_version gönderilmeli
}

// Response 200
{ success: true, data: Order }  // Güncel adisyon (lock_version artmış hali)

// Response 409 — başka garson aynı anda güncelledi
{ success: false, code: 'OPTIMISTIC_LOCK_FAILED',
  message: 'Adisyon başka bir cihaz tarafından güncellendi, lütfen yenileyin' }

// Response 422 — kapalı adisyona item eklenemez
{ success: false, code: 'ORDER_NOT_EDITABLE', message: 'Kapalı adisyon düzenlenemez' }
```

**POST /api/orders/:id/split**
```typescript
// Request
{
  mode: 'by_person' | 'by_item',
  // mode=by_person ise:
  person_count?: number,
  // mode=by_item ise:
  groups?: Array<{ item_ids: string[] }>
}

// Response 200
{ success: true, data: { original: Order, new_orders: Order[] } }
```

**POST /api/orders/:id/cancel** *(orders.cancel gerektirir)*
```typescript
// Request
{ reason: string }  // Zorunlu — boş string kabul edilmez

// Response 200
{ success: true, data: Order }

// Response 400 — not zorunlu
{ success: false, code: 'REASON_REQUIRED', message: 'İptal nedeni zorunlu' }

// Response 422 — ödenmiş sipariş iptal edilemez
{ success: false, code: 'ORDER_ALREADY_PAID', message: 'Ödenmiş sipariş iptal edilemez' }
```

---

### 4.4 Payment Endpoint'leri

```
POST /api/payments              → Ödeme başlat
POST /api/payments/:id/refund   → İade
GET  /api/payments/summary      → Günlük kasa özeti
POST /api/payments/batch-close  → Gün sonu kapanış
POST /api/cash-register/open    → Kasa aç
POST /api/cash-register/close   → Kasa kapat
POST /api/cash-movements        → Kasa giriş/çıkış
```

**POST /api/payments** *(payments.process gerektirir)*
```typescript
// Request
{
  order_id:      string,
  method:        'cash' | 'card' | 'meal_voucher' | 'mobile' | 'mixed',
  amount:        number,
  tip_amount?:   number,         // Default: 0
  cash_given?:   number,         // method=cash ise zorunlu
  meal_voucher_type?: 'multinet' | 'sodexo' | 'ticket',
  splits?: Array<{               // method=mixed ise zorunlu
    method: 'cash' | 'card' | 'meal_voucher' | 'mobile',
    amount: number
  }>
}

// Response 200
{
  success: true,
  data: {
    payment:      Payment,
    order:        Order,        // güncel order (status güncellendi)
    change_given: number,       // Para üstü (sadece cash ödemede)
    receipt_url?: string        // Fiş PDF (Supabase Storage)
  }
}

// Response 402 — yetersiz miktar
{ success: false, code: 'INSUFFICIENT_AMOUNT', message: 'Ödeme tutarı yetersiz', field: 'amount' }

// Response 503 — terminal bağlantı hatası
{ success: false, code: 'TERMINAL_OFFLINE', message: 'Ödeme terminali bağlı değil' }
```

**Payment nesnesi:**
```typescript
interface Payment {
  id:                 string
  order_id:           string
  method:             string
  amount:             number
  tip_amount:         number
  cash_given:         number | null
  change_given:       number | null
  ingenico_tid:       string | null
  ingenico_auth:      string | null
  card_last4:         string | null
  card_type:          string | null
  meal_voucher_type:  string | null
  status:             'pending' | 'completed' | 'refunded' | 'cancelled'
  staff_id:           string
  created_at:         string
}
```

---

### 4.5 Hardware Endpoint'leri

```
GET  /api/hardware/health          → Tüm cihaz durumu
POST /api/hardware/payment/sale    → Terminal satış
POST /api/hardware/payment/cancel  → Terminal iptal
POST /api/hardware/payment/refund  → Terminal iade
POST /api/hardware/payment/tip     → Bahşiş ekle
POST /api/hardware/payment/partial → Kısmi ödeme
POST /api/hardware/payment/batch-close → Gün sonu
POST /api/hardware/print/receipt   → Fiş yazdır
POST /api/hardware/print/kitchen   → Mutfak fişi
POST /api/hardware/drawer/open     → Para çekmecesi
POST /api/hardware/display/show    → Müşteri ekranı güncelle
POST /api/hardware/display/clear   → Müşteri ekranı temizle
```

**GET /api/hardware/health**
```typescript
// Response 200
{
  data: {
    terminal: { online: boolean, model: string },
    printer:  { online: boolean, paper_level: 'ok' | 'low' | 'empty' },
    drawer:   { status: 'OPEN' | 'CLOSED' },
    display:  { online: boolean }
  }
}
```

---

### 4.6 Tables Endpoint'leri

```
GET   /api/tables              → Tüm masalar + durumları
PATCH /api/tables/:id/status   → Masa durumu güncelle
POST  /api/tables/:id/transfer → Başka masaya taşı
```

**GET /api/tables**
```typescript
// Response 200
{
  data: Array<{
    id:               string,
    area_id:          string,
    area_name:        string,
    name:             string,
    capacity:         number,
    pos_x:            number,
    pos_y:            number,
    status:           'empty' | 'occupied' | 'reserved' | 'blocked',
    current_order_id: string | null,
    current_order?:   { order_number: number, total: number, item_count: number }
  }>
}
```

---

## 5. UI Davranış Kuralları

### 5.1 Masa Renk Kodları — Kesin Tanım

| Durum | Renk | Hex | Tailwind |
|---|---|---|---|
| `empty` | Yeşil | `#22c55e` | `bg-green-500` |
| `occupied` | Kırmızı | `#ef4444` | `bg-red-500` |
| `on_hold` | Sarı | `#eab308` | `bg-yellow-500` |
| `reserved` | Mavi | `#3b82f6` | `bg-blue-500` |
| `blocked` | Gri | `#6b7280` | `bg-gray-500` |

### 5.2 Loading State Kuralları
- Her async işlem sırasında ilgili button/alan disabled + spinner gösterir
- Spinner: Tailwind `animate-spin` — özel spinner bileşeni kullanılmaz
- Sayfa geneli loading: skeleton bileşeni — `loading.tsx` App Router convention
- Toast bildirimleri: **react-hot-toast** kütüphanesi (başka toast lib yasak)

### 5.3 Toast Mesaj Kuralları

| Durum | Toast tipi | Süre | Örnek mesaj |
|---|---|---|---|
| Başarılı işlem | `toast.success` | 2000ms | "Sipariş kaydedildi" |
| Hata | `toast.error` | 4000ms | "Ödeme başarısız" |
| Uyarı | `toast.` custom sarı | 3000ms | "Stok kritik seviyede" |
| Offline mod | `toast.` custom mavi | kalıcı (dismiss'e kadar) | "Çevrimdışı mod — değişiklikler kaydediliyor" |

### 5.4 Responsive Kurallar
- Breakpoint: **768px** — altı mobil, üstü masaüstü
- Tablo → 768px altında kart görünümüne geçer (CSS Grid, JS dönüşümü yok)
- Modal: Masaüstünde centered, mobilede bottom sheet
- Masa planı: Sadece masaüstünde drag-drop, mobilede tap-to-select

### 5.5 Form Validasyon Kuralları
- Kütüphane: **react-hook-form** + **zod**
- Hata mesajı: Input'un hemen altında, kırmızı, küçük font
- Submit button: form valid olana kadar disabled
- PIN input: 4 hane dolunca otomatik submit — ayrı button yok

### 5.6 Offline Mod UI
- Üst bara sabit banner: `bg-blue-600` — "📡 Çevrimdışı mod"
- Sync tamamlanınca banner kaybolur
- Sync bekleyen işlem sayısı badge olarak gösterilir: "3 işlem senkronize ediliyor..."

---

## 6. Hata Yönetimi Standartları

### 6.1 Hata Sınıflandırması

```typescript
// packages/shared-types/src/errors.ts

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public statusCode: number = 500,
    public field?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export type ErrorCode =
  // Auth
  | 'AUTH_FAILED' | 'NO_TOKEN' | 'INVALID_TOKEN' | 'FORBIDDEN' | 'INVALID_INPUT'
  // Orders
  | 'ORDER_NOT_FOUND' | 'ORDER_NOT_EDITABLE' | 'ORDER_ALREADY_PAID'
  | 'TABLE_OCCUPIED' | 'REASON_REQUIRED' | 'ORDER_LOCKED' | 'OPTIMISTIC_LOCK_FAILED'
  // Payments
  | 'INSUFFICIENT_AMOUNT' | 'PAYMENT_NOT_FOUND' | 'REFUND_FAILED'
  // Hardware
  | 'TERMINAL_OFFLINE' | 'TERMINAL_DECLINED' | 'PRINTER_OFFLINE' | 'PRINTER_NO_PAPER'
  // Sync
  | 'SYNC_CONFLICT' | 'SYNC_FAILED'
  // Aggregator
  | 'AGGREGATOR_SKU_NOT_FOUND' | 'AGGREGATOR_ORDER_DUPLICATE'
  // Stock
  | 'WAREHOUSE_NOT_FOUND' | 'INSUFFICIENT_STOCK'
  // Generic
  | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR'
```

### 6.2 branch-server Global Hata Handler'ı

```typescript
// apps/branch-server/src/index.ts — Fastify global error handler
app.setErrorHandler((error, req, reply) => {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      success: false,
      code:    error.code,
      message: error.message,
      field:   error.field,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }

  // Beklenmeyen hata — log at, 500 dön
  app.log.error({ err: error, req: { url: req.url, method: req.method } })
  return reply.code(500).send({
    success: false,
    code:    'INTERNAL_ERROR',
    message: 'Beklenmeyen bir hata oluştu'
  })
})
```

### 6.3 Frontend Hata Yönetimi

```typescript
// packages/shared-types/src/api-client.ts
// Tüm API çağrıları bu fonksiyon üzerinden yapılır

export async function apiCall<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BRANCH_SERVER_URL}${url}`, {
    ...options,
    credentials: 'include',   // httpOnly cookie gönder
    headers: { 'Content-Type': 'application/json', ...options?.headers }
  })

  const body = await res.json()

  if (!res.ok) {
    // Toast göster
    toast.error(body.message ?? 'Bir hata oluştu')
    throw new AppError(body.code, body.message, res.status, body.field)
  }

  return body.data as T
}
```

### 6.4 Hardware Hata Senaryoları ve Davranışları

| Senaryo | Kod | UI Davranışı |
|---|---|---|
| Terminal offline | `TERMINAL_OFFLINE` | "Terminal bağlı değil" modal — sadece nakit/diğer ödeme seçenekleri aktif |
| Kart reddedildi | `TERMINAL_DECLINED` | "Kart reddedildi, başka ödeme yöntemi deneyin" toast |
| Yazıcı offline | `PRINTER_OFFLINE` | Ödeme yine de tamamlanır, "Fiş yazdırılamadı, yeniden dene" butonu gösterilir |
| Kağıt bitti | `PRINTER_NO_PAPER` | Yazıcı offline ile aynı davranış + "Kağıt yükleyin" mesajı |
| Para çekmecesi açılmadı | — | Log'a yaz, kullanıcıya sessizce hata göster — ödemeyi bloklamaz |

---

## 7. Servisler Arası İletişim Kuralları

### 7.1 İletişim Kanalları

| Gönderen | Alan | Kanal | Ne zaman |
|---|---|---|---|
| POS Browser | branch-server | REST + Cookie | Her sipariş/ödeme işlemi |
| POS Browser | branch-server | WebSocket | Masa durumu subscribe |
| branch-server | Supabase | ElectricSQL sync | Sürekli (background) |
| branch-server | Supabase | REST (service role) | Conflict log, audit |
| branch-server | Hardware | Lokal function call | Ödeme, yazdırma |
| Dashboard | Supabase | REST (Supabase client) | Raporlar, ayarlar |
| KDS Browser | branch-server | WebSocket | Sipariş güncellemeleri |

### 7.2 WebSocket Event Şeması

Tüm WebSocket mesajları bu formatı takip eder:

```typescript
interface WSMessage<T = unknown> {
  event:    WSEvent
  payload:  T
  branch_id: string
  timestamp: string  // ISO 8601
}

type WSEvent =
  | 'order:created'
  | 'order:updated'
  | 'order:cancelled'
  | 'order:item:status_changed'   // KDS için
  | 'table:status_changed'
  | 'payment:completed'
  | 'sync:status'                  // offline/online geçişi
  | 'hardware:status'              // cihaz durumu değişimi
```

**Örnek event payloadları:**
```typescript
// table:status_changed
{ table_id: string, old_status: string, new_status: string }

// order:item:status_changed (KDS için kritik)
{ order_id: string, item_id: string, old_status: string, new_status: string }

// sync:status
{ online: boolean, pending_count: number }
```

### 7.3 KDS WebSocket Bağlantısı

KDS yalnızca kendi istasyonuna ait siparişleri alır:

```typescript
// KDS bağlanırken station filtresi gönderir
ws.send(JSON.stringify({
  event: 'kds:subscribe',
  payload: { station: 'kitchen' | 'bar' | 'cold' }
}))
```

---

## 8. Test Senaryoları — Tüm Sprintler

### 8.1 Sprint 0 Kabul Testleri

```bash
# T0-1: Tüm mock servisler çalışıyor
npx tsx scripts/test-all-mocks.ts
# Beklenen: "=== TÜM MOCK SERVİSLER ÇALIŞIYOR ==="

# T0-2: Supabase bağlantısı
curl http://localhost:3001  # dashboard
# Beklenen: "✅ Supabase bağlı"

# T0-3: ElectricSQL sync
npx tsx scripts/check-sync-status.ts
# Beklenen: "✅ ElectricSQL sync çalışıyor"

# T0-4: Branch server health
curl http://localhost:4000/health
# Beklenen: {"status":"ok","timestamp":"..."}
```

### 8.2 Sprint 1 Kabul Testleri (Auth)

```bash
# T1-1: Geçerli PIN girişi
curl -X POST http://localhost:4000/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"staff_id":"SEED_STAFF_ID","pin":"1234"}'
# Beklenen: {"success":true,"name":"Demo Kasiyer","role":"cashier"}
# Cookie: pos_token=... set edilmeli

# T1-2: Yanlış PIN
curl -X POST http://localhost:4000/api/auth/pin-login \
  -d '{"staff_id":"SEED_STAFF_ID","pin":"0000"}'
# Beklenen: 401 {"code":"AUTH_FAILED"}

# T1-3: 4 haneden az PIN
curl -X POST http://localhost:4000/api/auth/pin-login \
  -d '{"staff_id":"SEED_STAFF_ID","pin":"12"}'
# Beklenen: 400 {"code":"INVALID_INPUT"}

# T1-4: Yetkisiz endpoint erişimi
curl http://localhost:4000/api/auth/me  # cookie yok
# Beklenen: 401 {"code":"NO_TOKEN"}

# T1-5: Yetersiz yetki
# cashier token ile payments.refund endpoint'i çağır
# Beklenen: 403 {"code":"FORBIDDEN"}
```

### 8.3 Sprint 2 Kabul Testleri (Sipariş)

```
T2-1: Masa aç, sipariş oluştur → order.status = 'open'
T2-2: Aynı masaya 2. sipariş açmaya çalış → 409 TABLE_OCCUPIED
T2-3: Siparişe ürün ekle → order.items sayısı artar, total güncellenir
T2-4: Siparişi beklet → status = 'on_hold', masa rengi sarı
T2-5: Adisyon böl (2 kişi) → 2 yeni order, toplamlar orijinal ile eşit
T2-6: Masa taşı → eski masa 'empty', yeni masa 'occupied'
T2-7: Not zorunlu iptal → reason olmadan istek → 400 REASON_REQUIRED
T2-8: Eşzamanlı 2 garson aynı masaya sipariş ekle → race condition yok, her iki item da kaydedilir
```

### 8.4 Sprint 3 Kabul Testleri (Ödeme)

```
T3-1: Nakit ödeme → change_given = cash_given - total doğru
T3-2: Nakit ödeme → para çekmecesi açılır (mock log'a düşer)
T3-3: Kart ödeme → mock terminal 1500ms gecikmeyle APPROVED döner
T3-4: Kısmi kart + nakit karma → splits toplamı = total
T3-5: Ödeme sonrası masa 'empty' olur (ayar açıksa)
T3-6: İade → payment.status = 'refunded', order yeniden 'open'
T3-7: Terminal offline → sadece nakit seçeneği aktif
T3-8: Batch close → mock terminal BATCH_CLOSED döner
```

### 8.5 Sprint 4 Kabul Testleri (KDS)

```
T4-1: Sipariş kaydedilince KDS'de <500ms görünür
T4-2: Mutfak istasyonu sadece kitchen siparişlerini görür
T4-3: KDS'den "Hazır" → order_item.status = 'ready' → WebSocket event yayınlanır
T4-4: İptal edilen item KDS'den kaybolur
T4-5: Fiş yazdır → mock printer receipts/ klasörüne .txt yazar
T4-6: Yazıcı offline → ödeme bloklanmaz, "yeniden dene" butonu çıkar
```

### 8.6 Sprint 5 Kabul Testleri (Offline)

```
T5-1: Network disabled → sipariş alınabilir (PGlite'tan)
T5-2: Network disabled → nakit ödeme alınabilir
T5-3: Network geri gelince → pending queue otomatik sync
T5-4: Sync tamamlanınca → "X kayıt senkronize edildi" toast
T5-5: Çakışma senaryosu → aynı order hem local hem cloud'da güncellendi
       → last-write-wins uygulanır, conflict audit'e loglanır
T5-6: Offline banner → network kesilince görünür, gelince kaybolur
```

---

## 9. Dosya ve Klasör İsimlendirme Kuralları

### 9.1 Genel Kurallar

| Dosya Tipi | Format | Örnek |
|---|---|---|
| React Component | PascalCase | `OrderCard.tsx` |
| Hook | camelCase, `use` prefix | `useOrderSync.ts` |
| Utility/Helper | camelCase | `formatCurrency.ts` |
| Type/Interface | PascalCase | `order.ts` (içinde `Order` tipi) |
| API Route (Fastify) | camelCase | `orders.ts` |
| Config dosyası | kebab-case | `next.config.js` |
| Test dosyası | kaynak adı + `.test` | `OrderCard.test.tsx` |
| Mock dosyası | `mock-driver.ts` | sabit isim — değiştirilemez |

### 9.2 Klasör Kuralları

```
components/
  OrderCard/
    index.tsx        # Bileşen
    OrderCard.test.tsx
    types.ts         # Sadece bu bileşene ait tipler (varsa)

hooks/
  useOrderSync.ts
  usePayment.ts

lib/
  supabase.ts        # Client başlatma — singleton
  electric.ts        # ElectricSQL başlatma — singleton
  api.ts             # apiCall wrapper

types/               # Sadece bu app'e özel tipler (paylaşılmıyorsa)
  local.ts
```

### 9.3 Import Path Kuralları

```typescript
// ✅ DOĞRU — workspace alias
import type { Order } from '@aurapos/shared-types'
import { paymentTerminal } from '@aurapos/hardware/payment-terminal'

// ✅ DOĞRU — Next.js path alias (@/)
import { OrderCard } from '@/components/OrderCard'

// ❌ YANLIŞ — relative path (2+ seviye derinlikte)
import { Order } from '../../../../packages/shared-types/src'

// ❌ YANLIŞ — index barrel import (performans)
import { OrderCard, PaymentModal, TableGrid } from '@/components'
```

---

## 10. Sprint 1 — JWT Auth, PIN, Rol Sistemi

### 10.1 Sprint Bilgileri
**Süre:** Sprint 0 bittikten sonra 4 gün  
**Önkoşul:** Sprint 0 tüm kabul testleri geçmiş olmalı  
**Çıktı:** PIN ile giriş yapılabilen, rol bazlı yetki çalışan, token yönetimi tamamlanmış sistem

---

### GÖREV S1-1 — Seed: Demo Personel Ekle
*Süre: 30 dk*

`supabase/migrations/005_seed_staff.sql`:
```sql
-- bcrypt hash'i: pin "1234" için
-- node -e "const b=require('bcrypt');b.hash('1234',10).then(console.log)"
-- hash'i buraya yapıştır

INSERT INTO staff (id, business_id, branch_id, role_id, name, email, pin_hash) VALUES
(
  uuid_generate_v4(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  (SELECT id FROM roles WHERE name = 'cashier' AND business_id = '00000000-0000-0000-0000-000000000001'),
  'Demo Kasiyer',
  'kasiyer@demo.com',
  '$2b$10$BURAYA_HASH_GELECEK'
),
(
  uuid_generate_v4(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  (SELECT id FROM roles WHERE name = 'waiter' AND business_id = '00000000-0000-0000-0000-000000000001'),
  'Demo Garson',
  'garson@demo.com',
  '$2b$10$BURAYA_HASH_GELECEK'
),
(
  uuid_generate_v4(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  (SELECT id FROM roles WHERE name = 'manager' AND business_id = '00000000-0000-0000-0000-000000000001'),
  'Demo Yönetici',
  'yonetici@demo.com',
  '$2b$10$BURAYA_HASH_GELECEK'
);
```

```bash
# Hash üret:
node -e "const b=require('bcryptjs'); b.hash('1234',10).then(console.log)"
# Üretilen hash'i SQL'e yapıştır, sonra:
supabase db push
```

✅ **Kabul kriteri:** `SELECT name, role_id FROM staff` → 3 satır görünür.

---

### GÖREV S1-2 — Bağımlılıkları Kur
*Süre: 15 dk*

```bash
cd apps/branch-server
pnpm add bcryptjs jsonwebtoken @fastify/cookie @fastify/jwt
pnpm add -D @types/bcryptjs @types/jsonwebtoken
```

`apps/branch-server/src/index.ts`'e cookie plugin ekle:
```typescript
import cookie from '@fastify/cookie'
app.register(cookie)
```

---

### GÖREV S1-3 — FastifyRequest'e staff Tipi Ekle
*Süre: 15 dk*

```typescript
// apps/branch-server/src/types/fastify.d.ts
import type { PinTokenPayload } from '@aurapos/shared-types'

declare module 'fastify' {
  interface FastifyRequest {
    staff?: PinTokenPayload
  }
}
```

---

### GÖREV S1-4 — Auth Route'ları Yaz
*Süre: 1.5 saat*

`apps/branch-server/src/routes/auth.ts` — Bölüm 3.3'teki tam implementasyonu yaz.

Endpoint'ler:
- `POST /api/auth/pin-login` → PIN doğrula, JWT imzala, cookie set et
- `POST /api/auth/logout` → cookie temizle
- `GET  /api/auth/me` → token'dan staff bilgisi dön

`apps/branch-server/src/index.ts`'e register et:
```typescript
import { authRoutes } from './routes/auth'
app.register(authRoutes, { prefix: '/api/auth' })
```

✅ **Kabul kriteri:** T1-1 → T1-4 testleri geçmeli (Bölüm 8.2)

---

### GÖREV S1-5 — requirePermission Middleware
*Süre: 1 saat*

`apps/branch-server/src/middleware/requirePermission.ts` — Bölüm 3.4'teki implementasyonu yaz.

Ayrıca `requireAuth` middleware'i (izin kontrolü yapmadan sadece token doğrular):
```typescript
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies.pos_token
  if (!token) return reply.code(401).send({ success: false, code: 'NO_TOKEN' })
  try {
    req.staff = jwt.verify(token, process.env.JWT_SECRET!) as PinTokenPayload
  } catch {
    return reply.code(401).send({ success: false, code: 'INVALID_TOKEN' })
  }
}
```

✅ **Kabul kriteri:** T1-5 testi geçmeli.

---

### GÖREV S1-6 — Global Hata Handler'ı Kur
*Süre: 30 dk*

`apps/branch-server/src/errors.ts` — AppError sınıfını yaz (Bölüm 6.1).

`apps/branch-server/src/index.ts`'e global handler ekle (Bölüm 6.2).

✅ **Kabul kriteri:**
```bash
curl http://localhost:4000/api/auth/me
# → {"success":false,"code":"NO_TOKEN"} (401)
# Stack trace GÖRÜNMEMELI (production benzeri davranış)
```

---

### GÖREV S1-7 — POS PIN Ekranı (Frontend)
*Süre: 2 saat*

`apps/pos/app/(auth)/pin/page.tsx`:

**Davranış kuralları (UI Bölüm 5.5'ten):**
- Ekranda personel listesi görünür (branch'teki aktif staff, ElectricSQL'den)
- Personel seçilince PIN pad açılır
- 4 hane girilince otomatik submit — buton yok
- Yanlış PIN → input kırmızıya döner, 1 saniyet sonra temizlenir
- 3 yanlış denemede 30 saniyet kilitleme (frontend sayacı)
- Başarılı giriş → `/pos/tables` rotasına yönlendir

**PIN input bileşeni:** `apps/pos/components/PinInput/index.tsx`
```typescript
// 4 adet tek haneli input — her hane dolunca focus bir sonrakine geçer
// Değer değişince parent'a string olarak bildir: "1", "12", "123", "1234"
// 4 haneye ulaşınca onComplete(pin) çağır
interface PinInputProps {
  onComplete: (pin: string) => void
  error: boolean
  disabled: boolean
}
```

✅ **Kabul kriteri:**
- Personel listesi görünür
- 1234 girilince auth/pin-login çağrılır
- Yanlış PIN → kırmızı flash → temizle
- Doğru PIN → /pos/tables'a yönlendir

---

### GÖREV S1-8 — Auth Guard (POS Route Koruma)
*Süre: 45 dk*

`apps/pos/middleware.ts` (Next.js middleware):
```typescript
import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const token = req.cookies.get('pos_token')

  // Korunan rota + token yok → PIN sayfasına yönlendir
  if (!token && req.nextUrl.pathname.startsWith('/pos')) {
    return NextResponse.redirect(new URL('/pin', req.url))
  }

  // Zaten girişli + PIN sayfasına gitmeye çalışıyor → pos'a yönlendir
  if (token && req.nextUrl.pathname === '/pin') {
    return NextResponse.redirect(new URL('/pos/tables', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/pos/:path*', '/pin']
}
```

✅ **Kabul kriteri:**
- Token olmadan `/pos/tables`'a git → `/pin`'e yönlendirilir
- Token varken `/pin`'e git → `/pos/tables`'a yönlendirilir

---

### GÖREV S1-9 — Staff Listesi Hook'u
*Süre: 45 dk*

`apps/pos/hooks/useStaffList.ts`:
```typescript
// ElectricSQL local DB'den aktif personeli çeker
// İnternet olmadan da çalışır (PGlite'tan)
export function useStaffList(branchId: string): {
  staff: StaffListItem[]
  loading: boolean
} { ... }

interface StaffListItem {
  id:   string
  name: string
  role: string
}
```

✅ **Kabul kriteri:** Network disabled → staff listesi hâlâ görünür.

---

### GÖREV S1-10 — Sprint 1 Entegrasyon Testi
*Süre: 30 dk*

Tüm T1-x testlerini sırayla çalıştır (Bölüm 8.2).

Son olarak tam akış testi:
```
1. http://localhost:3000 aç (POS)
2. /pin sayfasına otomatik yönlendir → ✅
3. "Demo Kasiyer" seç → PIN pad açılır → ✅
4. "1234" gir → /pos/tables'a yönlendir → ✅
5. GET /api/auth/me → kasiyer bilgileri dönüyor → ✅
6. Logout → /pin'e yönlendir → ✅
```

✅ **Sprint 1 tamamlanma kriteri:** T1-1'den T1-5'e kadar tüm testler geçer + tam akış testi çalışır.

---

### Sprint 1 Bitti → Sprint 2'ye Geçiş Koşulu

Şu kontroller yapılmadan Sprint 2 başlamaz:
```
□ Tüm T1-x testleri yeşil
□ PIN ekranı tam akış çalışıyor
□ Rol bazlı erişim kısıtlaması çalışıyor
□ Network disabled → staff listesi görünüyor (offline test)
□ Global error handler → stack trace production'da görünmüyor
□ Commit: "feat(auth): Sprint 1 tamamlandı — PIN auth + rol sistemi"
```

---

## 11. Bilinen Kısıtlar ve Kesin Yasaklar

### 11.1 Kesin Yasaklar — Bunları Yapma

| Yasak | Neden |
|---|---|
| `localStorage` / `sessionStorage` kullanmak | Güvenlik + offline uyumsuzluk |
| `SUPABASE_SERVICE_ROLE_KEY`'i client'a expose etmek | Kritik güvenlik açığı |
| PIN'i plain text saklamak | Güvenlik — bcrypt zorunlu |
| `any` tipi kullanmak | Type safety bozulur |
| Class component yazmak | Proje standardı |
| Dexie.js eklemek | ElectricSQL/PGlite ile çakışır |
| Ayrı toast kütüphanesi eklemek | `react-hot-toast` seçildi |
| `console.log` production'da bırakmak | Fastify logger kullanılacak |
| `// TODO` bırakmak | Her TODO önce issue açılmalı |
| Migration dosyasını elle düzenlemek | Yeni migration yaz |
| `mock-driver.ts` dosya adını değiştirmek | Driver swap sistemi bu isme bağımlı |

### 11.2 Bilinen Teknik Kısıtlar

| Kısıt | Detay |
|---|---|
| ElectricSQL partial sync | Şu an nested relation filterı desteklemiyor (şekillerde belirtildi) — V2 ile çözülecek |
| Supabase Realtime + RLS | Realtime subscription'larda RLS tam çalışmıyor — branch-server WebSocket üzerinden yönetiliyor |
| PGlite browser'da WASM | Safari 16 altında çalışmaz — minimum browser desteği: Chrome 90+, Safari 16+, Firefox 90+ |
| Ingenico A910SFI driver | Gerçek NEXO SDK henüz yok — mock driver üzerinde geliştirme yapılıyor |
| React Native offline | Expo SQLite + ElectricSQL RN entegrasyonu Sprint 7'de yapılacak |

### 11.3 Güvenlik Kontrol Listesi (Her PR'da)

```
□ Yeni endpoint → requireAuth veya requirePermission eklendi mi?
□ Kullanıcı inputu → zod ile validate edildi mi?
□ SQL sorgusu → parametreli mi? (string interpolation yok)
□ Yeni env değişkeni → .env.example'a eklendi mi?
□ Supabase storage upload → dosya tipi ve boyutu kontrol ediliyor mu?
□ Error response → stack trace production'da gizleniyor mu?
```

---

*Bu doküman yaşayan bir belgedir.*  
*Değişiklik = PR + bu dokümanda güncelleme. İkisi birlikte merge edilir.*  
*Son güncelleyen: — | Tarih: 14 Mart 2026*
