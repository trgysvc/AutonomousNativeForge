-- ============================================================
-- 001_init_schema.sql
-- AuraPOS — Temel Şema
-- Her tablo business_id ile multi-tenant izolasyonu sağlar
-- ============================================================

-- UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- İŞLETME & ŞUBE
-- ─────────────────────────────────────────

CREATE TABLE businesses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  vkn           TEXT UNIQUE,
  tax_office    TEXT,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  logo_url      TEXT,              -- Supabase Storage URL
  plan          TEXT DEFAULT 'trial' CHECK (plan IN ('trial','starter','pro','enterprise')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  timezone      TEXT DEFAULT 'Europe/Istanbul',
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PERSONEL & YETKİ
-- ─────────────────────────────────────────

CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,     -- 'owner' | 'manager' | 'cashier' | 'waiter' | 'barista'
  permissions   JSONB DEFAULT '{}',
  is_system     BOOLEAN DEFAULT FALSE  -- TRUE ise silinemez
);

CREATE TABLE staff (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id     UUID REFERENCES branches(id),
  role_id       UUID NOT NULL REFERENCES roles(id),
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  pin_hash      TEXT NOT NULL,     -- bcrypt, asla plain text
  supabase_uid  UUID,              -- Supabase Auth UID (yönetici/sahip için)
  avatar_url    TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE shifts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  staff_id      UUID NOT NULL REFERENCES staff(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  break_minutes INT DEFAULT 0
);

-- ─────────────────────────────────────────
-- MASA PLANI
-- ─────────────────────────────────────────

CREATE TABLE table_areas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,     -- 'İç Mekan' | 'Bahçe' | 'Teras'
  sort_order    INT DEFAULT 0
);

CREATE TABLE tables (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id       UUID NOT NULL REFERENCES table_areas(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  capacity      INT DEFAULT 4,
  pos_x         FLOAT DEFAULT 0,   -- Masa planı koordinatı
  pos_y         FLOAT DEFAULT 0,
  status        TEXT DEFAULT 'empty' CHECK (status IN ('empty','occupied','reserved','blocked')),
  current_order_id UUID            -- Aktif adisyon (FK sonra eklenir)
);

-- ─────────────────────────────────────────
-- MENÜ
-- ─────────────────────────────────────────

CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id     UUID,              -- NULL ise tüm şubeler
  parent_id     UUID REFERENCES categories(id),
  name          TEXT NOT NULL,
  image_url     TEXT,
  sort_order    INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE
);

CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id   UUID NOT NULL REFERENCES categories(id),
  name          TEXT NOT NULL,
  description   TEXT,
  image_url     TEXT,              -- Supabase Storage URL
  base_price    NUMERIC(10,2) NOT NULL,
  vat_rate      NUMERIC(5,2) DEFAULT 8.0,
  unit          TEXT DEFAULT 'adet',
  barcode       TEXT,
  kitchen_station TEXT DEFAULT 'kitchen' CHECK (kitchen_station IN ('kitchen','bar','cold')),
  prep_minutes  INT DEFAULT 5,
  allergens     TEXT[],            -- ['gluten','lactose','nuts']
  calories      INT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE portions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,     -- 'Küçük' | 'Büyük' | '250ml'
  price_modifier NUMERIC(10,2) DEFAULT 0  -- Base fiyata eklenir/çıkarılır
);

CREATE TABLE option_groups (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,     -- 'Süt Seçimi' | 'Şeker'
  is_required   BOOLEAN DEFAULT FALSE,
  min_select    INT DEFAULT 0,
  max_select    INT DEFAULT 1
);

CREATE TABLE option_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id      UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,     -- 'Sütlü' | 'Oat Milk' | 'Az Şekerli'
  price_modifier NUMERIC(10,2) DEFAULT 0,
  sort_order    INT DEFAULT 0
);

-- ─────────────────────────────────────────
-- SİPARİŞ & ADİSYON
-- ─────────────────────────────────────────

CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  table_id      UUID REFERENCES tables(id),
  staff_id      UUID REFERENCES staff(id),
  order_number  SERIAL,            -- Şube bazlı artan numara (trigger ile)
  status        TEXT DEFAULT 'open' CHECK (
                  status IN ('open','on_hold','partial_paid','paid','closed','cancelled')
                ),
  type          TEXT DEFAULT 'dine_in' CHECK (
                  type IN ('dine_in','takeaway','delivery')
                ),
  note          TEXT,
  cancel_reason TEXT,
  cover_count   INT DEFAULT 1,     -- Kişi sayısı (servis ücreti için)
  subtotal      NUMERIC(10,2) DEFAULT 0,
  service_fee   NUMERIC(10,2) DEFAULT 0,
  discount      NUMERIC(10,2) DEFAULT 0,
  total         NUMERIC(10,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id),
  portion_id    UUID REFERENCES portions(id),
  qty           INT NOT NULL DEFAULT 1,
  unit_price    NUMERIC(10,2) NOT NULL,  -- Sipariş anındaki fiyat (snapshot)
  total_price   NUMERIC(10,2) NOT NULL,
  note          TEXT,
  status        TEXT DEFAULT 'pending' CHECK (
                  status IN ('pending','preparing','ready','served','cancelled','waste','complimentary')
                ),
  sent_to_kds   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_item_options (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  option_item_id UUID NOT NULL REFERENCES option_items(id),
  price_modifier NUMERIC(10,2) DEFAULT 0
);

-- ─────────────────────────────────────────
-- ÖDEME & KASA
-- ─────────────────────────────────────────

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  order_id        UUID NOT NULL REFERENCES orders(id),
  method          TEXT NOT NULL CHECK (
                    method IN ('cash','card','meal_voucher','mobile','mixed','unpaid')
                  ),
  amount          NUMERIC(10,2) NOT NULL,
  tip_amount      NUMERIC(10,2) DEFAULT 0,
  cash_given      NUMERIC(10,2),   -- Nakit ödemede
  change_given    NUMERIC(10,2),   -- Para üstü
  ingenico_tid    TEXT,            -- Terminal transaction ID
  ingenico_auth   TEXT,            -- Auth code
  card_last4      TEXT,
  card_type       TEXT,
  meal_voucher_type TEXT,          -- 'multinet' | 'sodexo' | 'ticket'
  status          TEXT DEFAULT 'completed' CHECK (
                    status IN ('pending','completed','refunded','cancelled')
                  ),
  refund_reason   TEXT,
  staff_id        UUID REFERENCES staff(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Karma ödeme alt kalemleri
CREATE TABLE payment_splits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id  UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  method      TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL
);

CREATE TABLE cash_registers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  staff_id        UUID NOT NULL REFERENCES staff(id),
  opened_at       TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  opening_amount  NUMERIC(10,2) DEFAULT 0,
  closing_amount  NUMERIC(10,2),
  expected_amount NUMERIC(10,2),  -- Sistem hesabı
  difference      NUMERIC(10,2),  -- Fark
  note            TEXT
);

CREATE TABLE cash_movements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  register_id UUID REFERENCES cash_registers(id),
  staff_id    UUID NOT NULL REFERENCES staff(id),
  type        TEXT CHECK (type IN ('in','out')),
  amount      NUMERIC(10,2) NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- STOK & REÇETE
-- ─────────────────────────────────────────

CREATE TABLE ingredients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL,     -- 'kg' | 'lt' | 'adet' | 'gr'
  current_qty   NUMERIC(10,3) DEFAULT 0,
  critical_qty  NUMERIC(10,3) DEFAULT 0,
  cost_per_unit NUMERIC(10,2),
  supplier      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recipes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
  qty_per_unit    NUMERIC(10,4) NOT NULL,  -- 1 ürün için gereken miktar
  UNIQUE(product_id, ingredient_id)
);

CREATE TABLE stock_movements (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  type          TEXT CHECK (type IN ('purchase','sale','waste','transfer_in','transfer_out','count')),
  qty           NUMERIC(10,3) NOT NULL,    -- Pozitif=giriş, negatif=çıkış
  note          TEXT,
  order_item_id UUID REFERENCES order_items(id),  -- Satıştan otomatik düşümde
  staff_id      UUID REFERENCES staff(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- GÖREV YÖNETİMİ (fotoğraf kanıtlı)
-- ─────────────────────────────────────────

CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  title           TEXT NOT NULL,
  description     TEXT,
  scheduled_time  TIME,            -- '09:00' — o saatte hatırlat
  requires_photo  BOOLEAN DEFAULT FALSE,
  is_recurring    BOOLEAN DEFAULT TRUE,
  recurrence      TEXT DEFAULT 'daily',  -- 'daily' | 'weekly' | 'monthly'
  assigned_role   TEXT,            -- Hangi rol yapacak
  is_active       BOOLEAN DEFAULT TRUE
);

CREATE TABLE task_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id       UUID NOT NULL REFERENCES tasks(id),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  staff_id      UUID NOT NULL REFERENCES staff(id),
  completed_at  TIMESTAMPTZ DEFAULT NOW(),
  photo_url     TEXT,              -- Supabase Storage URL (requires_photo=TRUE ise zorunlu)
  note          TEXT,
  log_date      DATE DEFAULT CURRENT_DATE
);

-- ─────────────────────────────────────────
-- MÜŞTERİ & SADAKAT (V1.0)
-- ─────────────────────────────────────────

CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  name          TEXT,
  phone         TEXT,
  email         TEXT,
  birth_date    DATE,
  total_spent   NUMERIC(10,2) DEFAULT 0,
  visit_count   INT DEFAULT 0,
  loyalty_pts   INT DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- ÇOKLU DEPO (Multi-Warehouse)
-- ─────────────────────────────────────────

CREATE TABLE warehouses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,     -- 'Ana Depo' | 'Bar Buzdolabı' | 'Mutfak Hattı'
  type          TEXT DEFAULT 'main' CHECK (type IN ('main','bar','kitchen','cold')),
  is_active     BOOLEAN DEFAULT TRUE
);

-- ingredients tablosuna warehouse_id ekle
ALTER TABLE ingredients ADD COLUMN warehouse_id UUID REFERENCES warehouses(id);

-- Her ürün grubunun hangi depodan düşeceğini tanımlar
ALTER TABLE products ADD COLUMN warehouse_type TEXT DEFAULT 'kitchen'
  CHECK (warehouse_type IN ('main','bar','kitchen','cold'));

-- ─────────────────────────────────────────
-- AGGREGATOR ENTEGRASYONU
-- ─────────────────────────────────────────

CREATE TABLE aggregator_mappings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  aggregator      TEXT NOT NULL CHECK (aggregator IN ('yemeksepeti','getir','trendyol')),
  external_sku    TEXT NOT NULL,    -- Aggregator'ın ürün ID'si
  product_id      UUID NOT NULL REFERENCES products(id),
  external_name   TEXT,             -- Aggregator'daki görünen ad (referans)
  is_active       BOOLEAN DEFAULT TRUE,
  UNIQUE(aggregator, external_sku, business_id)
);

CREATE TABLE aggregator_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  aggregator      TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  order_id        UUID REFERENCES orders(id),  -- İç sisteme map edilince dolar
  raw_payload     JSONB NOT NULL,               -- Aggregator'dan gelen ham veri
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','mapped','failed')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- CARİ HESAP (Customer Ledger)
-- ─────────────────────────────────────────

CREATE TABLE customer_ledgers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  customer_id     UUID REFERENCES customers(id),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  order_id        UUID REFERENCES orders(id),
  type            TEXT NOT NULL CHECK (type IN ('debit','credit')),
  amount          NUMERIC(10,2) NOT NULL,
  description     TEXT,             -- "Şirketime yazın" notu
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- YARI MAMUL ÜRETİM LOGU
-- ─────────────────────────────────────────

CREATE TABLE semi_products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  name          TEXT NOT NULL,      -- 'Köfte Harcı' | 'Krema Sos'
  unit          TEXT NOT NULL,
  current_qty   NUMERIC(10,3) DEFAULT 0
);

CREATE TABLE semi_product_recipes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  semi_product_id UUID NOT NULL REFERENCES semi_products(id),
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
  qty_required    NUMERIC(10,4) NOT NULL
);

CREATE TABLE production_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  semi_product_id UUID NOT NULL REFERENCES semi_products(id),
  produced_qty    NUMERIC(10,3) NOT NULL,
  staff_id        UUID REFERENCES staff(id),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
  -- Bu log insert edilince trigger:
  -- 1. semi_product_recipes üzerinden hammaddeleri düş
  -- 2. semi_products.current_qty'yi artır
);

-- Üretim trigger'ı
CREATE OR REPLACE FUNCTION process_production()
RETURNS TRIGGER AS $
DECLARE
  rec RECORD;
BEGIN
  -- Hammaddeleri düş
  FOR rec IN
    SELECT ingredient_id, qty_required FROM semi_product_recipes
    WHERE semi_product_id = NEW.semi_product_id
  LOOP
    UPDATE ingredients
    SET current_qty = current_qty - (rec.qty_required * NEW.produced_qty)
    WHERE id = rec.ingredient_id;

    INSERT INTO stock_movements (branch_id, ingredient_id, type, qty, note)
    VALUES (NEW.branch_id, rec.ingredient_id, 'production',
            -(rec.qty_required * NEW.produced_qty),
            'Üretim: ' || NEW.semi_product_id);
  END LOOP;

  -- Yarı mamul stokunu artır
  UPDATE semi_products
  SET current_qty = current_qty + NEW.produced_qty
  WHERE id = NEW.semi_product_id;

  RETURN NEW;
END;
$ LANGUAGE plpgsql;

CREATE TRIGGER trg_production_log
  AFTER INSERT ON production_logs
  FOR EACH ROW EXECUTE FUNCTION process_production();

-- ─────────────────────────────────────────
-- PRINTER ROUTING RULES (Kural Motoru)
-- ─────────────────────────────────────────

CREATE TABLE printers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  name        TEXT NOT NULL,    -- 'Bar Yazıcısı' | 'Mutfak 1' | 'Paket Yazıcısı'
  ip_address  TEXT,             -- Statik IP (opsiyonel — mDNS varsa gerekmez)
  mdns_name   TEXT,             -- mDNS adı: 'kitchen-printer-1.local'
  port        INT DEFAULT 9100,
  type        TEXT DEFAULT 'kitchen' CHECK (type IN ('kitchen','bar','receipt','packaging')),
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE printer_routing_rules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  printer_id    UUID NOT NULL REFERENCES printers(id),
  condition_type TEXT NOT NULL CHECK (condition_type IN
    ('category','order_type','product','is_fryer','station')),
  condition_value TEXT NOT NULL,  -- Kategori ID, 'paket', true/false vb.
  priority      INT DEFAULT 0,    -- Düşük = yüksek öncelik
  is_active     BOOLEAN DEFAULT TRUE
  -- Örnek kurallar:
  -- condition_type='order_type', condition_value='delivery' → Paket Yazıcısı
  -- condition_type='station',    condition_value='bar'      → Bar Yazıcısı
  -- condition_type='is_fryer',   condition_value='true'     → Mutfak Fritöz Yazıcısı
);

-- ─────────────────────────────────────────
-- SEAT TRACKING (Koltuk Bazlı Sipariş)
-- ─────────────────────────────────────────

-- order_items tablosuna seat_no ekle
ALTER TABLE order_items ADD COLUMN seat_no INT DEFAULT NULL;
-- NULL = koltuğa atanmamış (hızlı satış veya masa geneli)
-- 1,2,3... = o koltuğun siparişi

-- Optimistic lock için orders tablosuna versiyon ekle
ALTER TABLE orders ADD COLUMN lock_version INT DEFAULT 0;
-- Her update'de lock_version artırılır
-- İki garson aynı anda güncellemeye çalışırsa:
-- WHERE id = $1 AND lock_version = $2 → etkilenen satır = 0 → 409 dön

-- ─────────────────────────────────────────
-- QR MESAİ ROTATING TOKEN
-- ─────────────────────────────────────────

CREATE TABLE qr_attendance_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  token       TEXT NOT NULL UNIQUE,   -- Kısa ömürlü random token
  expires_at  TIMESTAMPTZ NOT NULL,   -- Varsayılan: 60 sn
  used_by     UUID REFERENCES staff(id),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Token süresi dolmuş ve kullanılmamışları temizle (pg_cron veya Edge Function ile)
-- DELETE FROM qr_attendance_tokens WHERE expires_at < NOW() AND used_by IS NULL;

-- ─────────────────────────────────────────
-- YARDIMCI INDEXLER
-- ─────────────────────────────────────────

CREATE INDEX idx_orders_branch_status   ON orders(branch_id, status);
CREATE INDEX idx_orders_business_date   ON orders(business_id, created_at DESC);
CREATE INDEX idx_order_items_order      ON order_items(order_id);
CREATE INDEX idx_order_items_kds        ON order_items(order_id, sent_to_kds, kitchen_station) INCLUDE (status);
CREATE INDEX idx_payments_order         ON payments(order_id);
CREATE INDEX idx_payments_branch_date   ON payments(branch_id, created_at DESC);
CREATE INDEX idx_stock_movements_ingr   ON stock_movements(ingredient_id, created_at DESC);
CREATE INDEX idx_tables_branch_status   ON tables(branch_id, status);
CREATE INDEX idx_staff_business_active  ON staff(business_id, is_active);

-- ─────────────────────────────────────────
-- TRIGGER: updated_at otomatik güncelle
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- TRIGGER: Sipariş kapanınca masa boşalt
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION release_table_on_close()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('closed', 'cancelled') AND OLD.status NOT IN ('closed','cancelled') THEN
    UPDATE tables SET status = 'empty', current_order_id = NULL
    WHERE id = NEW.table_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_release_table
  AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION release_table_on_close();


-- ============================================================
-- 002_rls_policies.sql
-- Row Level Security — Multi-tenant izolasyon
-- ============================================================

ALTER TABLE businesses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff            ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_areas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_registers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY;

-- JWT'den business_id çeken yardımcı fonksiyon
CREATE OR REPLACE FUNCTION auth_business_id() RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'business_id')::UUID;
$$ LANGUAGE SQL STABLE;

-- Tüm tablolar için genel policy şablonu:
-- "Yalnızca kendi işletmesinin verisine eriş"

CREATE POLICY "business_isolation" ON businesses
  FOR ALL USING (id = auth_business_id());

CREATE POLICY "business_isolation" ON branches
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON staff
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON roles
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON categories
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON products
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON orders
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON order_items
  FOR ALL USING (
    order_id IN (SELECT id FROM orders WHERE business_id = auth_business_id())
  );

CREATE POLICY "business_isolation" ON payments
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON ingredients
  FOR ALL USING (business_id = auth_business_id());

CREATE POLICY "business_isolation" ON customers
  FOR ALL USING (business_id = auth_business_id());

-- Branch-server service role bypass (şube sunucusu RLS'yi atlar)
-- Branch server SUPABASE_SERVICE_ROLE_KEY kullanır → RLS bypass

-- ============================================================
-- 003_functions.sql
-- Stored Functions & Materialized Views
-- ============================================================

-- Günlük ciro özeti (dashboard için)
CREATE OR REPLACE FUNCTION get_daily_revenue(
  p_business_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  branch_id   UUID,
  branch_name TEXT,
  total       NUMERIC,
  cash        NUMERIC,
  card        NUMERIC,
  meal_voucher NUMERIC,
  mobile      NUMERIC,
  tip_total   NUMERIC,
  order_count BIGINT
) AS $$
  SELECT
    b.id,
    b.name,
    COALESCE(SUM(p.amount), 0),
    COALESCE(SUM(CASE WHEN p.method = 'cash'         THEN p.amount END), 0),
    COALESCE(SUM(CASE WHEN p.method = 'card'         THEN p.amount END), 0),
    COALESCE(SUM(CASE WHEN p.method = 'meal_voucher' THEN p.amount END), 0),
    COALESCE(SUM(CASE WHEN p.method = 'mobile'       THEN p.amount END), 0),
    COALESCE(SUM(p.tip_amount), 0),
    COUNT(DISTINCT o.id)
  FROM branches b
  LEFT JOIN orders o   ON o.branch_id = b.id AND o.business_id = p_business_id
                       AND DATE(o.closed_at) = p_date AND o.status = 'closed'
  LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'completed'
  WHERE b.business_id = p_business_id
  GROUP BY b.id, b.name;
$$ LANGUAGE SQL STABLE;

-- Kritik stok uyarıları
CREATE OR REPLACE FUNCTION get_critical_stock(p_business_id UUID)
RETURNS TABLE (branch_id UUID, ingredient_id UUID, name TEXT, current_qty NUMERIC, critical_qty NUMERIC, unit TEXT) AS $$
  SELECT i.branch_id, i.id, i.name, i.current_qty, i.critical_qty, i.unit
  FROM ingredients i
  WHERE i.business_id = p_business_id
    AND i.current_qty <= i.critical_qty
  ORDER BY (i.current_qty / NULLIF(i.critical_qty, 0)) ASC;
$$ LANGUAGE SQL STABLE;


-- ============================================================
-- 004_seed_data.sql
-- Demo işletme verisi (geliştirme ortamı için)
-- ============================================================

-- Demo işletme
INSERT INTO businesses (id, name, vkn, tax_office, address)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo Kafe',
  '1234567890',
  'Ankara VD',
  'Çankaya, Ankara'
);

-- Demo şube
INSERT INTO branches (id, business_id, name)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Merkez Şube'
);

-- Sistem rolleri
INSERT INTO roles (business_id, name, is_system, permissions) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner',   TRUE, '{"all": true}'),
  ('00000000-0000-0000-0000-000000000001', 'manager', TRUE, '{"orders": true, "payments": true, "reports": true, "staff": true}'),
  ('00000000-0000-0000-0000-000000000001', 'cashier', TRUE, '{"orders": true, "payments": true}'),
  ('00000000-0000-0000-0000-000000000001', 'waiter',  TRUE, '{"orders": true}'),
  ('00000000-0000-0000-0000-000000000001', 'barista', TRUE, '{"kds": true}');
