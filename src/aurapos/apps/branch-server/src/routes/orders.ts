import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { pool } from '../db'; // Adjust path as needed

enum OrderStatus {
  OPEN = 'OPEN',
  PARTIAL_PAID = 'PARTIAL_PAID',
  PAID = 'PAID',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

interface Order {
  id: string;
  table_id: number;
  branch_id: number;
  status: OrderStatus;
  total_amount: number;
  created_at: Date;
  updated_at: Date;
}

interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  note?: string;
}

// Ensure indexes on startup
(async () => {
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON orders(branch_id);
    `);
  } catch (err) {
    console.error('Failed to create indexes on orders table:', err);
  }
})();

export default async function (fastify: FastifyInstance, _opts: unknown, done: () => void) => {
  // POST /api/orders - create new order
  fastify.post('/api/orders', async (request: FastifyRequest, reply: FastifyReply) => {
    const { table_id, branch_id, items = [] } = request.body as {
      table_id: number;
      branch_id: number;
      items: Array<Omit<OrderItem, 'id' | 'order_id'>>;
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert order
      const orderResult = await client.query<
        Order,
        [number, number, OrderStatus, number]
      >(
        `INSERT INTO orders (table_id, branch_id, status, total_amount)
         VALUES ($1, $2, $3, $4)
         RETURNING id, table_id, branch_id, status, total_amount, created_at, updated_at`,
        [table_id, branch_id, OrderStatus.OPEN, 0]
      );
      const order = orderResult.rows[0];

      // Insert items and calculate total
      let total = 0;
      for const item of items {
        const itemResult = await client.query<
          OrderItem,
          [string, string, string, number, number, string?]
        >(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price, note)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, order_id, product_id, quantity, unit_price, note`,
          [
            order.id,
            item.product_id,
            item.quantity,
            item.unit_price,
            item.note ?? null,
          ]
        );
        const insertedItem = itemResult.rows[0];
        total += insertedItem.quantity * insertedItem.unit_price;
      }

      // Update order total
      await client.query(
        `UPDATE orders SET total_amount = $1, updated_at = NOW() WHERE id = $2`,
        [total, order.id]
      );

      await client.query('COMMIT');

      const updatedOrder = { ...order, total_amount: total };
      reply.code(201).send(updatedOrder);
    } catch (err) {
      await client.query('ROLLBACK');
      reply.code(500).send({ error: 'Failed to create order' });
    } finally {
      client.release();
    }
  });

  // GET /api/orders/:id - get order detail
  fastify.get('/api/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await pool.query<Order>(
        `SELECT id, table_id, branch_id, status, total_amount, created_at, updated_at
         FROM orders WHERE id = $1`,
        [id]
      );
      if (result.rowCount === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      reply.send(result.rows[0]);
    } catch (err) {
      reply.code(500).send({ error: 'Failed to fetch order' });
    }
  });

  // PATCH /api/orders/:id - update order (e.g., status, items)
  fastify.patch('/api/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { status, items } = request.body as {
      status?: OrderStatus;
      items?: Array<Partial<OrderItem> & { product_id: string }>;
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (status !== undefined) {
        await client.query(
          `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
          [status, id]
        );
      }

      if (items !== undefined) {
        for const item of items {
          // Upsert item: update if exists, else insert
          const existing = await client.query(
            `SELECT id FROM order_items WHERE order_id = $1 AND product_id = $2`,
            [id, item.product_id]
          );
          if (existing.rowCount > 0) {
            await client.query(
              `UPDATE order_items SET quantity = COALESCE($1, quantity),
                                       unit_price = COALESCE($2, unit_price),
                                       note = COALESCE($3, note)
               WHERE order_id = $4 AND product_id = $5`,
              [
                item.quantity ?? undefined,
                item.unit_price ?? undefined,
                item.note ?? undefined,
                id,
                item.product_id,
              ]
            );
          } else {
            await client.query(
              `INSERT INTO order_items (order_id, product_id, quantity, unit_price, note)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                id,
                item.product_id,
                item.quantity ?? 1,
                item.unit_price ?? 0,
                item.note ?? null,
              ]
            );
          }
        }
        // Recalculate total
        const totalResult = await client.query(
          `SELECT SUM(quantity * unit_price) AS total FROM order_items WHERE order_id = $1`,
          [id]
        );
        const total = totalResult.rows[0].total ?? 0;
        await client.query(
          `UPDATE orders SET total_amount = $1, updated_at = NOW() WHERE id = $2`,
          [total, id]
        );
      }

      await client.query('COMMIT');
      const updated = await pool.query<Order>(
        `SELECT id, table_id, branch_id, status, total_amount, created_at, updated_at
         FROM orders WHERE id = $1`,
        [id]
      );
      reply.send(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      reply.code(500).send({ error: 'Failed to update order' });
    } finally {
      client.release();
    }
  });

  // DELETE /api/orders/:id - cancel order
  fastify.delete('/api/orders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      await pool.query(
        `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
        [OrderStatus.CANCELLED, id]
      );
      reply.send({ message: 'Order cancelled' });
    } catch (err) {
      reply.code(500).send({ error: 'Failed to cancel order' });
    }
  });

  // POST /api/orders/:id/split - split order by person or item
  fastify.post('/api/orders/:id/split', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { type, count } = request.body as { type: 'person' | 'item'; count: number };
    if (!['person', 'item'].includes(type) || count < 2) {
      return reply.code(400).send({ error: 'Invalid split parameters' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch order and items
      const orderResult = await pool.query<Order>(
        `SELECT * FROM orders WHERE id = $1`,
        [id]
      );
      if (orderResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Order not found' });
      }
      const order = orderResult.rows[0];

      const itemsResult = await pool.query<OrderItem>(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [id]
      );
      const items = itemsResult.rows;

      // Simple split: distribute items evenly across `count` new orders
      const newOrders: Order[] = [];
      const itemsPerOrder = Math.ceil(items.length / count);
      for (let i = 0; i < count; i++) {
        const slice = items.slice(i * itemsPerOrder, (i + 1) * itemsPerOrder);
        if (slice.length === 0) break;

        const insertOrder = await client.query<Order>(
          `INSERT INTO orders (table_id, branch_id, status, total_amount)
           VALUES ($1, $2, $3, $4)
           RETURNING id, table_id, branch_id, status, total_amount, created_at, updated_at`,
          [
            order.table_id,
            order.branch_id,
            OrderStatus.OPEN,
            0,
          ]
        );
        const newOrder = insertOrder.rows[0];
        let total = 0;
        for const item of slice {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_price, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              newOrder.id,
              item.product_id,
              item.quantity,
              item.unit_price,
              item.note ?? null,
            ]
          );
          total += item.quantity * item.unit_price;
        }
        await client.query(
          `UPDATE orders SET total_amount = $1, updated_at = NOW() WHERE id = $2`,
          [total, newOrder.id]
        );
        newOrders.push({ ...newOrder, total_amount: total });
      }

      // Optionally mark original order as split (could keep OPEN or set a custom status)
      // We'll keep it OPEN but you could change to a custom status if needed.

      await client.query('COMMIT');
      reply.send({ originalOrderId: id, splitOrders: newOrders });
    } catch (err) {
      await client.query('ROLLBACK');
      reply.code(500).send({ error: 'Failed to split order' });
    } finally {
      client.release();
    }
  });

  // POST /api/orders/:id/merge - merge multiple orders into one
  fastify.post('/api/orders/:id/merge', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { orderIds } = request.body as { orderIds: string[] };
    if (!orderIds || orderIds.length < 2) {
      return reply.code(400).send({ error: 'At least two order IDs required for merge' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch target order (the one in URL) and ensure it exists
      const targetResult = await pool.query<Order>(
        `SELECT * FROM orders WHERE id = $1`,
        [id]
      );
      if (targetResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Target order not found' });
      }
      const targetOrder = targetResult.rows[0];

      // Fetch all orders to merge (including target)
      const allIds = [...new Set([id, ...orderIds])];
      const ordersResult = await pool.query<Order>(
        `SELECT * FROM orders WHERE id = ANY($1::uuid[])`,
        [allIds]
      );
      const ordersMap = new Map<string, Order>();
      ordersResult.rows.forEach(o => ordersMap.set(o.id, o));
      if (ordersMap.size !== allIds.length) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'One or more orders not found' });
      }

      // Collect items from all orders
      const itemsResult = await pool.query<OrderItem>(
        `SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])`,
        [allIds]
      );
      const itemsByOrder: Map<string, OrderItem[]> = new Map();
      itemsResult.rows.forEach(item => {
        const list = itemsByOrder.get(item.order_id) ?? [];
        list.push(item);
        itemsByOrder.set(item.order_id, list);
      });

      // Insert all items into target order, recalc total
      let total = 0;
      for const [orderId, items] of itemsByOrder.entries()) {
        for const item of items) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_price, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              targetOrder.id,
              item.product_id,
              item.quantity,
              item.unit_price,
              item.note ?? null,
            ]
          );
          total += item.quantity * item.unit_price;
        }
        // If not target, mark original as merged (e.g., set status to CLOSED or custom)
        if (orderId !== targetOrder.id) {
          await client.query(
            `UPDATE orders SET status = $1, updated_at = NOW() WHERE id