import type { FastifyInstance } from 'fastify';

export default async function (fastify: FastifyInstance) {
  fastify.post<{ Body: unknown }>('/hardware/print', async (request, reply) => {
    console.log('Mock Thermal Printer: Printing receipt:', request.body);
    reply.send({ success: true, message: 'Print job queued' });
  });
}