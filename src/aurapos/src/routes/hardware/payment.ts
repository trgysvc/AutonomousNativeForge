import { FastifyInstance } from 'fastify';
import { PaymentRequest, PaymentResponse } from '../../../shared-types';

async function paymentRoutes(fastify: FastifyInstance, opts: any) {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  fastify.post('/sale', async (request, reply) => {
    await delay(Math.floor(Math.random() * 800) + 200);
    const req = request.body as PaymentRequest;
    
    if (!req.amount || req.amount <= 0) {
      return reply.status(400).send({ error: 'Invalid amount' });
    }

    let response: PaymentResponse = { approved: false };

    switch (req.method) {
      case 'card':
        response = {
          approved: true,
          amount: req.amount,
          authorizationCode: `ING_MOCK_${Math.floor(Math.random() * 900000) + 100000}`,
          transactionId: `txn_${Date.now()}`,
          timestamp: new Date().toISOString()
        };
        break;
      case 'cash':
        if (!req.amountTendered || req.amountTendered < req.amount) {
          return reply.status(400).send({ error: 'Insufficient cash tendered' });
        }
        response = {
          approved: true,
          amount: req.amount,
          change: req.amountTendered - req.amount,
          transactionId: `cash_${Date.now()}`,
          timestamp: new Date().toISOString()
        };
        break;
      case 'meal_voucher':
        if (!req.voucherId) {
          return reply.status(400).send({ error: 'Voucher ID required' });
        }
        response = {
          approved: true,
          amount: req.amount,
          voucherId: req.voucherId,
          authorizationCode: `MV_${Math.floor(Math.random() * 9000) + 1000}`,
          transactionId: `mv_${Date.now()}`,
          timestamp: new Date().toISOString()
        };
        break;
      case 'mixed':
        if (!req.cardAmount || !req.cashAmount || req.cardAmount + req.cashAmount !== req.amount) {
          return reply.status(400).send({ error: 'Invalid mixed payment amounts' });
        }
        if (!req.amountTendered || req.amountTendered < req.cashAmount) {
          return reply.status(400).send({ error: 'Insufficient cash tendered for cash portion' });
        }
        
        const cardResp = {
          approved: true,
          amount: req.cardAmount,
          authorizationCode: `ING_MOCK_${Math.floor(Math.random() * 900000) + 100000}`,
          transactionId: `txn_card_${Date.now()}`,
          timestamp: new Date().toISOString()
        };
        
        const cashResp = {
          approved: true,
          amount: req.cashAmount,
          change: req.amountTendered - req.cashAmount,
          transactionId: `txn_cash_${Date.now() + 1}`,
          timestamp: new Date().toISOString()
        };
        
        response = {
          approved: true,
          amount: req.amount,
          cardApproval: cardResp,
          cashApproval: cashResp,
          transactionId: `mixed_${Date.now()}`,
          timestamp: new Date().toISOString()
        };
        break;
      default:
        return reply.status(400).send({ error: 'Unsupported payment method' });
    }

    reply.send(response);
  });

  fastify.post('/cancel', async (request, reply) => {
    await delay(Math.floor(Math.random() * 600) + 100);
    const { originalTransactionId } = request.body as { originalTransactionId: string };
    
    if (!originalTransactionId) {
      return reply.status(400).send({ error: 'Transaction ID required' });
    }
    
    reply.send({
      approved: true,
      originalTransactionId,
      cancellationCode: `CANC_${Math.floor(Math.random() * 9000) + 1000}`,
      timestamp: new Date().toISOString()
    });
  });

  fastify.post('/refund', async (request, reply) => {
    await delay(Math.floor(Math.random() * 700) + 150);
    const { originalTransactionId, amount } = request.body as { originalTransactionId: string; amount: number };
    
    if (!originalTransactionId || !amount || amount <= 0) {
      return reply.status(400).send({ error: 'Valid transaction ID and amount required' });
    }
    
    reply.send({
      approved: true,
      originalTransactionId,
      refundAmount: amount,
      refundCode: `RFND_${Math.floor(Math.random() * 9000) + 1000}`,
      timestamp: new Date().toISOString()
    });
  });

  fastify.post('/addTip', async (request, reply) => {
    await delay(Math.floor(Math.random() * 500) + 100);
    const { originalTransactionId, tipAmount } = request.body as { originalTransactionId: string; tipAmount: number };
    
    if (!originalTransactionId || !tipAmount || tipAmount < 0) {
      return reply.status(400).send({ error: 'Valid transaction ID and tip amount required' });
    }
    
    reply.send({
      approved: true,
      originalTransactionId,
      tipAmount,
      totalAmount: tipAmount, // Assuming tip amount only, original amount would be from original transaction
      tipCode: `TIP_${Math.floor(Math.random() * 900) + 100}`,
      timestamp: new Date().toISOString()
    });
  });

  fastify.post('/partialPayment', async (request, reply) => {
    await delay(Math.floor(Math.random() * 600) + 100);
    const { originalTransactionId, amount } = request.body as { originalTransactionId: string; amount: number };
    
    if (!originalTransactionId || !amount || amount <= 0) {
      return reply.status(400).send({ error: 'Valid transaction ID and amount required' });
    }
    
    reply.send({
      approved: true,
      originalTransactionId,
      partialAmount: amount,
      partialCode: `PART_${Math.floor(Math.random() * 9000) + 1000}`,
      timestamp: new Date().toISOString()
    });
  });

  fastify.post('/batchClose', async (request, reply) => {
    await delay(Math.floor(Math.random() * 1000) + 500);
    
    reply.send({
      approved: true,
      batchCloseCode: `BATCH_${Date.now()}`,
      totalAmount: Math.floor(Math.random() * 10000) + 500,
      transactionCount: Math.floor(Math.random() * 50) + 10,
      timestamp: new Date().toISOString()
    });
  });
}

export default paymentRoutes;