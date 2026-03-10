/**
 * Team Management Routes
 * Gerencia membros da equipe (Multi-User RBAC)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { authMiddleware } from '../../auth';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for team management');
}

// Cliente Supabase Admin (bypass RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type AddTeamMemberRequest = {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'agent';
  color?: string; // Cor personalizada do agente (hex)
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'agent';
  created_at: string;
  color?: string; // Cor personalizada do agente (hex)
};

export function registerTeamRoutes(fastify: FastifyInstance) {
  // Listar membros da equipe
  fastify.get('/api/v1/team', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = request.tenantId;
      const userId = request.userId;
      
      if (!tenantId || !userId) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Buscar perfis do tenant
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, name, role, created_at, color')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Team] Erro ao buscar membros:', error);
        return reply.status(500).send({
          success: false,
          message: 'Erro ao buscar membros da equipe',
        });
      }

      // Buscar emails dos usuários do auth.users
      const userIds = profiles?.map(p => p.id) || [];
      const members: TeamMember[] = [];

      for (const profile of profiles || []) {
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);
          members.push({
            id: profile.id,
            name: profile.name,
            email: authUser?.user?.email || 'N/A',
            role: profile.role,
            created_at: profile.created_at,
            color: profile.color || '#3B82F6',
          });
        } catch (err) {
          console.error(`[Team] Erro ao buscar email do usuário ${profile.id}:`, err);
          members.push({
            id: profile.id,
            name: profile.name,
            email: 'N/A',
            role: profile.role,
            created_at: profile.created_at,
            color: profile.color || '#3B82F6',
          });
        }
      }

      return reply.send({
        success: true,
        data: members,
      });
    } catch (error) {
      console.error('[Team] Erro inesperado:', error);
      return reply.status(500).send({
        success: false,
        message: 'Erro interno do servidor',
      });
    }
  });

  // Adicionar membro à equipe
  fastify.post('/api/v1/team', async (request: FastifyRequest<{ Body: AddTeamMemberRequest }>, reply: FastifyReply) => {
    try {
      const tenantId = request.tenantId;
      const userId = request.userId;
      const userRole = request.userRole; // Role do JWT
      
      if (!tenantId || !userId) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Verificar se o usuário é admin
      // Primeiro tenta do JWT (sistema antigo pode ter role no token)
      // Depois tenta da tabela profiles (novo sistema)
      // Por último, tenta da tabela users (sistema antigo)
      let isAdmin = false;
      
      // 1. Verificar no JWT
      if (userRole === 'admin') {
        isAdmin = true;
      }
      
      // 2. Se não for admin no JWT, verificar na tabela profiles
      if (!isAdmin) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        
        if (profile && profile.role === 'admin') {
          isAdmin = true;
        }
      }
      
      // 3. Se ainda não for admin, verificar na tabela users (sistema antigo)
      if (!isAdmin) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('role')
          .eq('id', userId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        
        if (user && user.role === 'admin') {
          isAdmin = true;
        }
      }

      if (!isAdmin) {
        return reply.status(403).send({
          success: false,
          message: 'Apenas administradores podem adicionar membros',
        });
      }

      const { name, email, password, role, color } = request.body;

      // Validações
      if (!name || !email || !password || !role) {
        return reply.status(400).send({
          success: false,
          message: 'Todos os campos são obrigatórios',
        });
      }

      if (role !== 'admin' && role !== 'agent') {
        return reply.status(400).send({
          success: false,
          message: 'Role deve ser "admin" ou "agent"',
        });
      }

      // Validar cor (formato hexadecimal)
      const defaultColor = '#3B82F6'; // Azul padrão
      let finalColor = color || defaultColor;
      
      // Validar formato hexadecimal
      if (finalColor && !/^#[0-9A-Fa-f]{6}$/.test(finalColor)) {
        return reply.status(400).send({
          success: false,
          message: 'Cor deve estar no formato hexadecimal (ex: #3B82F6)',
        });
      }

      // Criar usuário no Supabase Auth (usando service role para não deslogar admin)
      console.log('[Team] Criando usuário no Supabase Auth...', { email, tenantId });
      
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Confirmar email automaticamente
      });

      if (authError || !authData.user) {
        console.error('[Team] ❌ Erro ao criar usuário no Auth:', {
          error: authError,
          message: authError?.message,
          code: authError?.status,
        });
        return reply.status(400).send({
          success: false,
          message: authError?.message || 'Erro ao criar usuário',
        });
      }

      console.log('[Team] ✅ Usuário criado no Auth:', {
        userId: authData.user.id,
        email: authData.user.email,
      });

      // Criar perfil na tabela profiles
      console.log('[Team] Criando perfil na tabela profiles...', {
        userId: authData.user.id,
        tenantId,
        name,
        role,
      });

      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authData.user.id,
          tenant_id: tenantId,
          name,
          role,
          color: finalColor,
        });

      if (profileError) {
        // Se falhar ao criar perfil, deletar usuário do auth
        console.error('[Team] ❌ Erro ao criar perfil, deletando usuário do Auth:', profileError);
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return reply.status(500).send({
          success: false,
          message: `Erro ao criar perfil do usuário: ${profileError.message}`,
        });
      }

      console.log('[Team] ✅ Perfil criado com sucesso');

      // 3. Criar também na tabela users (sistema antigo) para compatibilidade total
      // Isso garante que o login funcione tanto com auth.users quanto com users
      const { hashPassword } = require('../../auth/repository-postgres');
      const passwordHash = await hashPassword(password);
      
      console.log('[Team] Criando usuário na tabela users (compatibilidade)...');
      
      const { error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authData.user.id,
          tenant_id: tenantId,
          email,
          password_hash: passwordHash,
          name,
          role: role === 'agent' ? 'user' : 'admin', // Mapear agent -> user, admin -> admin
          is_active: true,
        });

      if (userError) {
        // Não bloquear se falhar - o usuário já está no auth.users e profiles
        // Mas logar o erro para debug
        console.warn('[Team] ⚠️ Erro ao criar na tabela users (não crítico):', userError.message);
      } else {
        console.log('[Team] ✅ Usuário criado na tabela users (compatibilidade)');
      }

      return reply.send({
        success: true,
        data: {
          id: authData.user.id,
          name,
          email,
          role,
          color: finalColor,
        },
        message: 'Membro adicionado com sucesso',
      });
    } catch (error) {
      console.error('[Team] Erro inesperado:', error);
      return reply.status(500).send({
        success: false,
        message: 'Erro interno do servidor',
      });
    }
  });

  // Atualizar cor do agente
  fastify.patch('/api/v1/team/:id/color', async (request: FastifyRequest<{ Params: { id: string }; Body: { color?: string } }>, reply: FastifyReply) => {
    try {
      const tenantId = request.tenantId;
      const userId = request.userId;
      const userRole = request.userRole;
      const { id } = request.params;
      const { color } = request.body;
      
      if (!tenantId || !userId) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Verificar se é admin
      let isAdmin = userRole === 'admin';
      if (!isAdmin) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        
        if (profile && profile.role === 'admin') {
          isAdmin = true;
        } else {
          const { data: user } = await supabaseAdmin
            .from('users')
            .select('role')
            .eq('id', userId)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          
          if (user && user.role === 'admin') {
            isAdmin = true;
          }
        }
      }

      if (!isAdmin) {
        return reply.status(403).send({
          success: false,
          message: 'Apenas administradores podem atualizar cores',
        });
      }

      // Validar cor
      if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return reply.status(400).send({
          success: false,
          message: 'Cor deve estar no formato hexadecimal (ex: #3B82F6)',
        });
      }

      // Atualizar cor do perfil
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ color })
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (updateError) {
        console.error('[Team] Erro ao atualizar cor:', updateError);
        return reply.status(500).send({
          success: false,
          message: 'Erro ao atualizar cor do agente',
        });
      }

      return reply.send({
        success: true,
        message: 'Cor atualizada com sucesso',
      });
    } catch (error) {
      console.error('[Team] Erro ao atualizar cor:', error);
      return reply.status(500).send({
        success: false,
        message: 'Erro ao atualizar cor',
      });
    }
  });

  // Remover membro da equipe (opcional, para MVP não é necessário)
  fastify.delete('/api/v1/team/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const tenantId = request.tenantId;
      const userId = request.userId;
      const userRole = request.userRole; // Role do JWT
      
      if (!tenantId || !userId) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Verificar se o usuário é admin
      // Primeiro tenta do JWT (sistema antigo pode ter role no token)
      // Depois tenta da tabela profiles (novo sistema)
      // Por último, tenta da tabela users (sistema antigo)
      let isAdmin = false;
      
      // 1. Verificar no JWT
      if (userRole === 'admin') {
        isAdmin = true;
      }
      
      // 2. Se não for admin no JWT, verificar na tabela profiles
      if (!isAdmin) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        
        if (profile && profile.role === 'admin') {
          isAdmin = true;
        }
      }
      
      // 3. Se ainda não for admin, verificar na tabela users (sistema antigo)
      if (!isAdmin) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('role')
          .eq('id', userId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        
        if (user && user.role === 'admin') {
          isAdmin = true;
        }
      }

      if (!isAdmin) {
        return reply.status(403).send({
          success: false,
          message: 'Apenas administradores podem remover membros',
        });
      }

      const { id } = request.params;

      // Não permitir remover a si mesmo
      if (id === userId) {
        return reply.status(400).send({
          success: false,
          message: 'Você não pode remover a si mesmo',
        });
      }

      // Deletar perfil (cascade deletará do auth.users também)
      const { error } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[Team] Erro ao remover membro:', error);
        return reply.status(500).send({
          success: false,
          message: 'Erro ao remover membro',
        });
      }

      // Deletar do auth também (caso cascade não funcione)
      await supabaseAdmin.auth.admin.deleteUser(id);

      return reply.send({
        success: true,
        message: 'Membro removido com sucesso',
      });
    } catch (error) {
      console.error('[Team] Erro inesperado:', error);
      return reply.status(500).send({
        success: false,
        message: 'Erro interno do servidor',
      });
    }
  });
}
