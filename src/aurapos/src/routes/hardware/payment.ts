import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function (fastify: FastifyInstance) {
    fastify.post('/api/hardware/payment/sale', async (request: FastifyRequest, reply: FastifyReply) => {
        await delay(500);
        const { method, amount } = request.body as any;
        return reply.send({ status: 'approved', amount, authorizationCode: 'MOCK_APPROVAL_CARD' });
    });
}
