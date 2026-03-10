import type { FastifyInstance } from 'fastify';
import type { CompanyService } from '../../company';
import type { CompanyContext } from '../../company/types';

export const registerCompanyRoutes = (
  fastify: FastifyInstance,
  companyService: CompanyService
): void => {
  fastify.get('/api/v1/company/context', async (request, reply) => {
    try {
      const context = await companyService.getContext();

      if (!context) {
        return reply.code(404).send({
          success: false,
          message: 'Company context not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        data: context,
      };
    } catch (error) {
      console.error('[API] Error fetching company context:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch company context',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.put('/api/v1/company/context', async (request, reply) => {
    try {
      const context = request.body as CompanyContext;

      if (
        !context.businessName ||
        !context.address ||
        !context.openingHours ||
        !context.deliveryPolicy ||
        !context.paymentMethods
      ) {
        return reply.code(400).send({
          success: false,
          message: 'Missing required fields',
          errorCode: 'INVALID_INPUT',
        });
      }

      await companyService.updateContext(context);

      return {
        success: true,
        data: context,
        message: 'Company context updated',
      };
    } catch (error) {
      console.error('[API] Error updating company context:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to update company context',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
};

