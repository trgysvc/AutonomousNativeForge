import type { 
    PaymentRequest, 
    ApprovalResponse, 
    CancelResponse, 
    RefundResponse, 
    AddTipResponse, 
    PartialPaymentResponse, 
    BatchCloseResponse 
} from '../../../../packages/shared-types/src/index.ts';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function (fastify: FastifyInstance) {
    fastify.post('/api/hardware/payment/sale', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        const { method, amount, cardAmount, cashAmount, cashGiven } = request.body as PaymentRequest;
        
        if (method === 'mixed') {
            const total = cardAmount + cashAmount;
            const change = cashGiven - cashAmount;
            const response: ApprovalResponse = {
                status: 'approved',
                amount: total,
                authorizationCode: 'MOCK_APPROVAL_MIXED',
                cashChange: change >= 0 ? change : 0
            };
            return reply.send(response);
        }

        if (method === 'meal_voucher') {
            const response: ApprovalResponse = {
                status: 'approved',
                amount: amount,
                authorizationCode: 'MOCK_APPROVAL_MEAL_VOUCHER'
            };
            return reply.send(response);
        }

        // Default to card
        const response: ApprovalResponse = {
            status: 'approved',
            amount: amount,
            authorizationCode: 'MOCK_APPROVAL_CARD'
        };
        return reply.send(response);
    });

    fastify.post('/api/hardware/payment/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        const { transactionId } = request.body as { transactionId: string };
        const response: CancelResponse = {
            status: 'cancelled',
            transactionId
        };
        return reply.send(response);
    });

    fastify.post('/api/hardware/payment/refund', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        const { transactionId, amount } = request.body as { transactionId: string; amount: number };
        const response: RefundResponse = {
            status: 'refunded',
            amount,
            transactionId
        };
        return reply.send(response);
    });

    fastify.post('/api/hardware/payment/addTip', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        const { transactionId, tipAmount } = request.body as { transactionId: string; tipAmount: number };
        const response: AddTipResponse = {
            status: 'tipAdded',
            tipAmount,
            transactionId
        };
        return reply.send(response);
    });

    fastify.post('/api/hardware/payment/partialPayment', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        const { transactionId, amount } = request.body as { transactionId: string; amount: number };
        const response: PartialPaymentResponse = {
            status: 'partiallyPaid',
            amount,
            transactionId
        };
        return reply.send(response);
    });

    fastify.post('/api/hardware/payment/batchClose', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        const response: BatchCloseResponse = {
            status: 'closed',
            batchNumber: 1,
            totalAmount: 0,
            transactionCount: 0
        };
        return reply.send(response);
    });

    // End of day cash count & batch close (POS level)
    fastify.post('/api/payments/batch-close', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        // Mock cash count and batch close logic
        const response = {
            status: 'success',
            cashCount: 0,
            cardTotal: 0,
            mealVoucherTotal: 0,
            batchClosed: true
        };
        return reply.send(response);
    });
}