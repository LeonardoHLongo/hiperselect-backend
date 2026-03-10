/**
 * Store Routes
 * CRUD endpoints para lojas e políticas
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StoreService } from '../../stores';
import type { CreateStoreInput, UpdateStoreInput, CreatePolicyInput, UpdatePolicyInput } from '../../stores/types';

// Schemas de validação
const CreateStoreSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  address: z.string().min(1, 'Endereço é obrigatório'),
  neighborhood: z.string().min(1, 'Bairro é obrigatório'),
  city: z.string().min(1, 'Cidade é obrigatória'),
  openingHours: z.string().min(1, 'Horário é obrigatório'),
  phone: z.string().min(1, 'Telefone é obrigatório'),
  isActive: z.boolean().optional(),
  managerWhatsappNumber: z.string().nullable().optional(),
  managerWhatsappEnabled: z.boolean().optional(),
  googleReviewLink: z
    .preprocess(
      (val) => (val === '' || val === undefined ? null : val),
      z.union([
        z.string().url('Link do Google deve ser uma URL válida'),
        z.null(),
      ]).optional()
    ),
});

const UpdateStoreSchema = CreateStoreSchema.partial().extend({
  id: z.string().uuid('ID inválido'),
});

const CreatePolicySchema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  content: z.string().min(1, 'Conteúdo é obrigatório'),
  applicableStores: z.array(z.string().uuid()).optional(),
});

const UpdatePolicySchema = CreatePolicySchema.partial().extend({
  id: z.string().uuid('ID inválido'),
});

export const registerStoreRoutes = (
  fastify: FastifyInstance,
  storeService: StoreService
): void => {
  // ========== STORES ==========

  // GET /api/v1/stores - Listar todas as lojas
  fastify.get('/api/v1/stores', async (request, reply) => {
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const stores = await storeService.getAllStores(tenantId);
      return {
        success: true,
        data: stores,
      };
    } catch (error) {
      console.error('[API] Error fetching stores:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch stores',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // GET /api/v1/stores/:id - Buscar loja por ID
  fastify.get('/api/v1/stores/:id', async (request, reply) => {
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const { id } = request.params as { id: string };
      const store = await storeService.getStoreById(id, tenantId);

      if (!store) {
        return reply.code(404).send({
          success: false,
          message: 'Store not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        data: store,
      };
    } catch (error) {
      console.error('[API] Error fetching store:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch store',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // POST /api/v1/stores - Criar loja
  fastify.post('/api/v1/stores', async (request, reply) => {
    try {
      const body = request.body as CreateStoreInput;
      const validation = CreateStoreSchema.safeParse(body);

      if (!validation.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid input',
          errorCode: 'INVALID_INPUT',
          errors: validation.error.errors,
        });
      }

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const store = await storeService.createStore(validation.data, tenantId);
      return {
        success: true,
        data: store,
        message: 'Store created successfully',
      };
    } catch (error) {
      console.error('[API] Error creating store:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to create store',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // PUT /api/v1/stores/:id - Atualizar loja
  fastify.put('/api/v1/stores/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Omit<UpdateStoreInput, 'id'>;
      
      const input: UpdateStoreInput = { ...body, id };
      const validation = UpdateStoreSchema.safeParse(input);

      if (!validation.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid input',
          errorCode: 'INVALID_INPUT',
          errors: validation.error.errors,
        });
      }

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const store = await storeService.updateStore(validation.data, tenantId);
      
      if (!store) {
        return reply.code(404).send({
          success: false,
          message: 'Store not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        data: store,
        message: 'Store updated successfully',
      };
    } catch (error) {
      console.error('[API] Error updating store:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to update store',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // DELETE /api/v1/stores/:id - Deletar loja
  fastify.delete('/api/v1/stores/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const deleted = await storeService.deleteStore(id, tenantId);

      if (!deleted) {
        return reply.code(404).send({
          success: false,
          message: 'Store not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        message: 'Store deleted successfully',
      };
    } catch (error) {
      console.error('[API] Error deleting store:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to delete store',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // ========== POLICIES ==========

  // GET /api/v1/policies - Listar todas as políticas
  fastify.get('/api/v1/policies', async (request, reply) => {
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const policies = await storeService.getAllPolicies(tenantId);
      return {
        success: true,
        data: policies,
      };
    } catch (error) {
      console.error('[API] Error fetching policies:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch policies',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // GET /api/v1/policies/:id - Buscar política por ID
  fastify.get('/api/v1/policies/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const policy = await storeService.getPolicyById(id, tenantId);

      if (!policy) {
        return reply.code(404).send({
          success: false,
          message: 'Policy not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        data: policy,
      };
    } catch (error) {
      console.error('[API] Error fetching policy:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch policy',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // POST /api/v1/policies - Criar política
  fastify.post('/api/v1/policies', async (request, reply) => {
    try {
      const body = request.body as CreatePolicyInput;
      const validation = CreatePolicySchema.safeParse(body);

      if (!validation.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid input',
          errorCode: 'INVALID_INPUT',
          errors: validation.error.errors,
        });
      }

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const policy = await storeService.createPolicy(validation.data, tenantId);
      return {
        success: true,
        data: policy,
        message: 'Policy created successfully',
      };
    } catch (error) {
      console.error('[API] Error creating policy:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to create policy',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // PUT /api/v1/policies/:id - Atualizar política
  fastify.put('/api/v1/policies/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Omit<UpdatePolicyInput, 'id'>;
      
      const input: UpdatePolicyInput = { ...body, id };
      const validation = UpdatePolicySchema.safeParse(input);

      if (!validation.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid input',
          errorCode: 'INVALID_INPUT',
          errors: validation.error.errors,
        });
      }

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const policy = await storeService.updatePolicy(validation.data, tenantId);
      
      if (!policy) {
        return reply.code(404).send({
          success: false,
          message: 'Policy not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        data: policy,
        message: 'Policy updated successfully',
      };
    } catch (error) {
      console.error('[API] Error updating policy:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to update policy',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // DELETE /api/v1/policies/:id - Deletar política
  fastify.delete('/api/v1/policies/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'Tenant ID is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const deleted = await storeService.deletePolicy(id, tenantId);

      if (!deleted) {
        return reply.code(404).send({
          success: false,
          message: 'Policy not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        message: 'Policy deleted successfully',
      };
    } catch (error) {
      console.error('[API] Error deleting policy:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to delete policy',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
};

