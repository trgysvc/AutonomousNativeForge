import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface PaymentRequest {
  amount: number;
  paymentMethod: 'card' | 'cash' | 'mixed' | 'meal_voucher';
  tipAmount?: number;
  cardAmount?: number;
  cashAmount?: number;
  voucherAmount?: number;
}

interface ApprovalResponse {
  success: boolean;
  approvalCode: string;
  amount: number;
  tipAmount?: number;
  change?: number;
}

interface BatchCloseResponse {
  success: boolean;
  batchId: string;
  totalAmount: number;
  transactionCount: number;
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function paymentRoutes(fastify: FastifyInstance) {
  // Sale
  fastify.post('/api/hardware/payment/sale', async (req: FastifyRequest<{ Body: PaymentRequest }>, reply: FastifyReply) => {
    await delay(300);
    const { amount, paymentMethod, tipAmount = 0, cardAmount, cashAmount, voucherAmount } = req.body;
    let approvalCode = '';
    let change = 0;
    let total = amount;

    if (paymentMethod === 'card') {
      approvalCode = 'ING123';
    } else if (paymentMethod === 'cash') {
      approvalCode = 'CASH123';
      change = Math.max(0, (cashAmount ?? 0) - amount);
    } else if (paymentMethod === 'mixed') {
      approvalCode = 'MIXED123';
      const cash = cashAmount ?? 0;
      change = Math.max(0, cash - (amount - (cardAmount ?? 0)));
    } else if (paymentMethod === 'meal_voucher') {
      approvalCode = 'VOUCHER123';
    }

    const response: ApprovalResponse = {
      success: true,
      approvalCode,
      amount: total,
      tipAmount,
      ...(change > 0 ? { change } : {}),
    };
    reply.send(response);
  });

  // Cancel
  fastify.post('/api/hardware/payment/cancel', async (req: FastifyRequest<{ Body: { approvalCode: string } }>, reply: FastifyReply) => {
    await delay(200);
    reply.send({ success: true, approvalCode: req.body.approvalCode });
  });

  // Refund
  fastify.post('/api/hardware/payment/refund', async (req: FastifyRequest<{ Body: { approvalCode: string; amount: number } }>, reply: FastifyReply) => {
    await delay(200);
    reply.send({ success: true, approvalCode: req.body.approvalCode, amount: req.body.amount });
  });

  // AddTip
  fastify.post('/api/hardware/payment/addTip', async (req: FastifyRequest<{ Body: { approvalCode: string; tipAmount: number } }>, reply: FastifyReply) => {
    await delay(200);
    reply.send({ success: true, approvalCode: req.body.approvalCode, tipAmount: req.body.tipAmount });
  });

  // PartialPayment
  fastify.post('/api/hardware/payment/partialPayment', async (req: FastifyRequest<{ Body: PaymentRequest }>, reply: FastifyReply) => {
    await delay(300);
    const { amount, paymentMethod } = req.body;
    const approvalCode = paymentMethod === 'card' ? 'INGPART' : 'CASHPART';
    reply.send({ success: true, approvalCode, amount });
  });

  // BatchClose (hardware)
  fastify.post('/api/hardware/payment/batchClose', async (_req: FastifyRequest, reply: FastifyReply) => {
    await delay(400);
    const response: BatchCloseResponse = {
      success: true,
      batchId: `BATCH-${Date.now()}`,
      totalAmount: 1250.00,
      transactionCount: 27,
    };
    reply.send(response);
  });

  // BatchClose (payments) as requested
  fastify.post('/api/payments/batch-close', async (_req: FastifyRequest, reply: FastifyReply) => {
    await delay(400);
    const response: BatchCloseResponse = {
      success: true,
      batchId: `BATCH-PAY-${Date.now()}`,
      totalAmount: 980.50,
      transactionCount: 22,
    };
    reply.send(response);
  });
}