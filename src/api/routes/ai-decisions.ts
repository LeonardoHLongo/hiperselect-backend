import type { FastifyInstance } from 'fastify';
import { eventBus } from '../../events';

export const registerAIDecisionRoutes = (fastify: FastifyInstance): void => {
  fastify.get('/api/v1/ai/decisions', async (request, reply) => {
    try {
      const history = eventBus.getHistory();
      const decisions = history.filter((event) => event.name === 'ai.decision.made');

      return {
        success: true,
        data: decisions.map((event) => ({
          ...event.payload,
          timestamp: event.timestamp,
          traceId: event.traceId,
        })),
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch AI decisions',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.get('/api/v1/ai/decisions/:traceId', async (request, reply) => {
    try {
      const { traceId } = request.params as { traceId: string };
      const history = eventBus.getHistory();

      const relatedEvents = history.filter((event) => event.traceId === traceId);

      if (relatedEvents.length === 0) {
        return reply.code(404).send({
          success: false,
          message: 'Decision trace not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        data: relatedEvents.map((event) => ({
          name: event.name,
          payload: event.payload,
          timestamp: event.timestamp,
          traceId: event.traceId,
        })),
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch decision trace',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
};

