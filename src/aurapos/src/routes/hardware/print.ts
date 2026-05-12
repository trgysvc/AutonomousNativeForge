import { FastifyInstance } from 'fastify';
import { ReceiptObject } from '../../../packages/shared-types/src/index';

export async function printRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ReceiptObject }>('/api/hardware/print', async (request, reply) => {
    const receipt = request.body;
    console.log('Mock printer: Printing receipt:', JSON.stringify(receipt, null, 2));
    reply.send({ success: true, message: 'Receipt sent to mock printer' });
  });
}