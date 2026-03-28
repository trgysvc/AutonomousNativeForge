// packages/electric-config/src/client.ts
// ─────────────────────────────────────────────────────────────
// PGlite + ElectricSQL client factory
// Hem browser (POS PWA) hem Node.js (branch-server) için çalışır
// ─────────────────────────────────────────────────────────────

import { PGlite } from '@electric-sql/pglite'
import { electricSync } from '@electric-sql/pglite/sync'
import { ELECTRIC_URL, SUPABASE_URL, BRANCH_ID } from './env'

let _client: PGlite | null = null

export async function getElectricClient(): Promise<PGlite> {
  if (_client) return _client

  // Browser: IndexedDB'ye yaz | Node: dosya sistemine yaz
  const dataDir = typeof window !== 'undefined'
    ? 'idb://aurapos-branch'          // Browser → IndexedDB
    : `/data/branch-${BRANCH_ID}.db`  // Node → Dosya sistemi

  _client = await PGlite.create(dataDir, {
    extensions: { electric: electricSync() }
  })

  await _client.electric.connect(ELECTRIC_URL)
  return _client
}


// ─────────────────────────────────────────────────────────────
// packages/electric-config/src/shapes.ts
// Shape tanımları: Hangi tablolar şubeye sync edilir?
// "Shape" = bir tablonun şube için çekilecek alt kümesi
// ─────────────────────────────────────────────────────────────

import { PGlite } from '@electric-sql/pglite'

interface SyncOptions {
  db: PGlite
  branchId: string
  businessId: string
}

export async function startBranchSync({ db, branchId, businessId }: SyncOptions) {

  // ── Menü (tüm işletme — şubeler arası paylaşılır)
  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'categories',
             where: `business_id = '${businessId}'` },
    table: 'categories',
    primaryKey: ['id'],
  })

  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'products',
             where: `business_id = '${businessId}'` },
    table: 'products',
    primaryKey: ['id'],
  })

  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'portions',
    // products join üzerinden — ElectricSQL V2 ile desteklenir
    },
    table: 'portions',
    primaryKey: ['id'],
  })

  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'option_groups' },
    table: 'option_groups',
    primaryKey: ['id'],
  })

  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'option_items' },
    table: 'option_items',
    primaryKey: ['id'],
  })

  // ── Masa planı (şubeye özel)
  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'table_areas',
             where: `branch_id = '${branchId}'` },
    table: 'table_areas',
    primaryKey: ['id'],
  })

  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'tables',
             where: `branch_id = '${branchId}'` },
    table: 'tables',
    primaryKey: ['id'],
  })

  // ── Aktif siparişler (son 7 gün — tarih sınırı performans için)
  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'orders',
             where: `branch_id = '${branchId}' AND created_at > NOW() - INTERVAL '7 days'` },
    table: 'orders',
    primaryKey: ['id'],
  })

  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'order_items',
    // orders join üzerinden filtrelenir
    },
    table: 'order_items',
    primaryKey: ['id'],
  })

  // ── Stok (şubeye özel)
  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'ingredients',
             where: `branch_id = '${branchId}'` },
    table: 'ingredients',
    primaryKey: ['id'],
  })

  // ── Personel (şubeye atanmış)
  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'staff',
             where: `branch_id = '${branchId}' AND is_active = true` },
    table: 'staff',
    primaryKey: ['id'],
  })

  // ── Görevler
  await db.electric.syncShapeToTable({
    shape: { url: `${ELECTRIC_URL}/v1/shape`, table: 'tasks',
             where: `branch_id = '${branchId}' AND is_active = true` },
    table: 'tasks',
    primaryKey: ['id'],
  })

  console.log(`[ElectricSQL] Şube ${branchId} sync başladı ✓`)
}


// ─────────────────────────────────────────────────────────────
// apps/branch-server/src/sync/conflict.ts
// Conflict Resolution Kuralları
// ─────────────────────────────────────────────────────────────

export type ConflictType = 'order' | 'payment' | 'stock' | 'table_status'

export interface ConflictRecord {
  table: string
  local_record: Record<string, unknown>
  cloud_record: Record<string, unknown>
  conflict_type: ConflictType
  detected_at: string
}

/**
 * Conflict resolution stratejileri:
 *
 * ORDER    → last-write-wins (updated_at karşılaştır)
 * PAYMENT  → cloud kazanır her zaman (finansal kayıt bütünlüğü)
 * STOCK    → her iki hareketi de uygula, sonuç negatifse uyarı ver
 * TABLE    → cloud kazanır (başka şube/cihaz kapattıysa geçerli)
 */
export async function resolveConflict(conflict: ConflictRecord): Promise<'local' | 'cloud' | 'merge'> {
  switch (conflict.conflict_type) {
    case 'payment':
    case 'table_status':
      await logConflict(conflict, 'cloud_wins')
      return 'cloud'

    case 'order': {
      const localTs  = new Date(conflict.local_record.updated_at as string).getTime()
      const cloudTs  = new Date(conflict.cloud_record.updated_at as string).getTime()
      const winner   = localTs > cloudTs ? 'local' : 'cloud'
      await logConflict(conflict, `last_write_wins:${winner}`)
      return winner
    }

    case 'stock':
      // Her iki hareketi de uygula — merge
      await logConflict(conflict, 'both_applied')
      return 'merge'
  }
}

async function logConflict(conflict: ConflictRecord, resolution: string) {
  // audit_logs tablosuna yaz (Supabase service role ile)
  console.warn(`[CONFLICT] ${conflict.table} → ${resolution}`, {
    local:  conflict.local_record?.id,
    cloud:  conflict.cloud_record?.id,
    at:     conflict.detected_at,
  })
  // TODO: Supabase audit_logs tablosuna INSERT
}


// ─────────────────────────────────────────────────────────────
// packages/hardware/IHardwareDriver.ts
// Tüm donanım driver'larının implement etmesi ZORUNLU interface
// Bu interface değişmeden yeni marka/model eklenebilir
// ─────────────────────────────────────────────────────────────

// ── Ödeme Terminali
export interface IPaymentTerminalDriver {
  sale(amount: number, currency?: string): Promise<ApprovalResponse>
  cancel(transactionId: string): Promise<CancelResponse>
  refund(transactionId: string, amount: number): Promise<RefundResponse>
  batchClose(): Promise<BatchResponse>
  addTip(transactionId: string, tipAmount: number): Promise<TipResponse>
  partialPayment(amount: number, total: number): Promise<PartialResponse>
  healthCheck(): Promise<{ online: boolean; model: string }>
}

// ── Termal Yazıcı
export interface IPrinterDriver {
  print(receipt: ReceiptObject): Promise<PrintResponse>
  printKitchenTicket(ticket: KitchenTicket): Promise<PrintResponse>
  healthCheck(): Promise<{ online: boolean; paperLevel: 'ok' | 'low' | 'empty' }>
}

// ── Para Çekmecesi
export interface IDrawerDriver {
  open(): Promise<{ status: 'OPENED'; timestamp: string }>
  status(): Promise<{ status: 'OPEN' | 'CLOSED' }>
}

// ── Müşteri Ekranı
export interface IDisplayDriver {
  show(lines: string[]): Promise<{ status: 'SHOWN' }>
  clear(): Promise<{ status: 'CLEARED' }>
}

// ── Barkod Okuyucu
export interface IBarcodeDriver {
  onScan(callback: (barcode: string) => void): void
  offScan(): void
}

// ── Terazi
export interface IScaleDriver {
  readWeight(): Promise<{ weight: number; unit: 'kg' | 'g' }>
  tare(): Promise<{ status: 'TARED' }>
}

// ── Tip Tanımları
export interface ApprovalResponse {
  status: 'APPROVED' | 'DECLINED' | 'ERROR'
  auth_code: string
  transaction_id: string
  amount: number
  currency: string
  card_last4: string
  card_type: 'VISA' | 'MASTERCARD' | 'AMEX' | 'TROY' | 'OTHER'
}
export interface CancelResponse   { status: 'CANCELLED'; transaction_id: string }
export interface RefundResponse   { status: 'REFUNDED';  transaction_id: string; amount: number }
export interface BatchResponse    { status: 'BATCH_CLOSED'; batch_id: string }
export interface TipResponse      { status: 'TIP_ADDED'; transaction_id: string; tip: number }
export interface PartialResponse  { status: 'APPROVED'; paid: number; remaining: number }
export interface PrintResponse    { status: 'PRINTED'; file?: string }

export interface ReceiptObject {
  business_name?: string
  order_id:       string
  table?:         string
  cashier?:       string
  items:          Array<{ name: string; qty: number; price: number }>
  total:          number
  payment_method?: string
  tip_amount?:    number
  change_given?:  number
}

export interface KitchenTicket {
  order_id:   string
  table?:     string
  station:    'kitchen' | 'bar' | 'cold'
  items:      Array<{ name: string; qty: number; note?: string; options?: string[] }>
  created_at: string
}
