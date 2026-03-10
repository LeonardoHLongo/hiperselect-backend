/**
 * Auth Routes
 * Endpoints de autenticação e registro
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../../auth';

// Schemas de validação
const LoginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

const RegisterSchema = z.object({
  tenantName: z.string().min(1, 'Nome da empresa é obrigatório'),
  tenantSlug: z.string().min(1, 'Slug é obrigatório').regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  userEmail: z.string().email('Email inválido'),
  userPassword: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  userName: z.string().min(1, 'Nome é obrigatório'),
});

export const registerAuthRoutes = (
  fastify: FastifyInstance,
  authService: AuthService
): void => {
  // POST /api/v1/auth/register - Registrar novo tenant e usuário admin
  fastify.post('/api/v1/auth/register', async (request, reply) => {
    try {
      const body = request.body as any;
      const validation = RegisterSchema.safeParse(body);

      if (!validation.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid input',
          errorCode: 'INVALID_INPUT',
          errors: validation.error.errors,
        });
      }

      const result = await authService.register(validation.data);

      return {
        success: true,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
            tenantId: result.user.tenantId,
          },
          token: result.token,
        },
        message: 'Registration successful',
      };
    } catch (error: any) {
      console.error('[API] Error registering:', error);
      
      // Verificar se é erro de slug duplicado
      if (error.message?.includes('slug') || error.message?.includes('unique')) {
        return reply.code(400).send({
          success: false,
          message: 'Slug já está em uso',
          errorCode: 'DUPLICATE_SLUG',
        });
      }

      return reply.code(500).send({
        success: false,
        message: 'Failed to register',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // POST /api/v1/auth/login - Login de usuário
  fastify.post('/api/v1/auth/login', async (request, reply) => {
    try {
      const body = request.body as any;
      const validation = LoginSchema.safeParse(body);

      if (!validation.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid input',
          errorCode: 'INVALID_INPUT',
          errors: validation.error.errors,
        });
      }

      // O login agora busca o tenantId automaticamente pelo email do usuário
      // Não é mais necessário passar tenantId no body
      const result = await authService.login(validation.data);

      if (!result) {
        return reply.code(401).send({
          success: false,
          message: 'Invalid credentials',
          errorCode: 'INVALID_CREDENTIALS',
        });
      }

      return {
        success: true,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
            tenantId: result.user.tenantId,
          },
          token: result.token,
        },
        message: 'Login successful',
      };
    } catch (error) {
      console.error('[API] Error logging in:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to login',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
};

