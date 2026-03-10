/**
 * PostgreSQL Auth Repository
 * Implementação usando Supabase
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import type { IAuthRepository } from './repository';
import type { User, Tenant } from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[AuthRepository] ⚠️  Supabase credentials not found - using in-memory repository');
}

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

class PostgresAuthRepository implements IAuthRepository {
  constructor() {
    console.log('[PostgresAuthRepository] ✅ Initialized');
  }

  // ========== TENANTS ==========

  async createTenant(name: string, slug: string): Promise<Tenant> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { data, error } = await supabase
        .from('tenants')
        .insert({
          name,
          slug,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        console.error('[PostgresAuthRepository] Error creating tenant:', error);
        throw error;
      }

      return this.mapRowToTenant(data);
    } catch (error) {
      console.error('[PostgresAuthRepository] Error in createTenant:', error);
      throw error;
    }
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToTenant(data);
    } catch (error) {
      console.error('[PostgresAuthRepository] Error in getTenantById:', error);
      return null;
    }
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToTenant(data);
    } catch (error) {
      console.error('[PostgresAuthRepository] Error in getTenantBySlug:', error);
      return null;
    }
  }

  // ========== USERS ==========

  async createUser(input: {
    tenantId: string;
    email: string;
    passwordHash: string;
    name: string;
    role?: string;
  }): Promise<User> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .insert({
          tenant_id: input.tenantId,
          email: input.email,
          password_hash: input.passwordHash,
          name: input.name,
          role: input.role || 'user',
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        console.error('[PostgresAuthRepository] Error creating user:', error);
        throw error;
      }

      return this.mapRowToUser(data);
    } catch (error) {
      console.error('[PostgresAuthRepository] Error in createUser:', error);
      throw error;
    }
  }

  async getUserByEmail(tenantId: string, email: string): Promise<User | null> {
    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('email', email)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToUser(data);
    } catch (error) {
      console.error('[PostgresAuthRepository] Error in getUserByEmail:', error);
      return null;
    }
  }

  async getUserById(id: string): Promise<User | null> {
    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToUser(data);
    } catch (error) {
      console.error('[PostgresAuthRepository] Error in getUserById:', error);
      return null;
    }
  }

  async getUserByEmailGlobal(email: string): Promise<User | null> {
    // Buscar usuário por email em qualquer tenant
    // Suporta tanto sistema antigo (tabela users) quanto novo (auth.users + profiles)
    if (!supabase) {
      return null;
    }

    try {
      // 1. Primeiro tenta buscar na tabela users (sistema antigo)
      const { data: oldUser, error: oldError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .maybeSingle();

      if (oldUser && !oldError) {
        return this.mapRowToUser(oldUser);
      }

      // 2. Se não encontrou, tenta buscar no auth.users + profiles (novo sistema)
      // Usar getUserByEmail do Supabase Auth Admin (mais eficiente que listUsers)
      let authUser = null;
      try {
        // Tentar buscar pelo email usando a API Admin
        // Nota: A API Admin não tem getUserByEmail direto, então vamos listar e filtrar
        // Mas limitamos a busca para melhorar performance
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
        
        if (authError) {
          console.error('[PostgresAuthRepository] Error fetching users from auth:', authError);
          return null;
        }

        // Encontrar usuário no auth.users pelo email
        authUser = authUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
        
        if (!authUser) {
          return null;
        }
      } catch (error) {
        console.error('[PostgresAuthRepository] Error in auth.users lookup:', error);
        return null;
      }

      // Buscar perfil na tabela profiles
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (profileError || !profile) {
        console.error('[PostgresAuthRepository] Error fetching profile:', profileError);
        return null;
      }

      // Mapear para formato User
      return {
        id: authUser.id,
        tenantId: profile.tenant_id,
        email: authUser.email || email,
        name: profile.name,
        role: profile.role as any, // 'admin' | 'agent' -> 'admin' | 'user' | 'viewer'
        isActive: true,
        createdAt: new Date(profile.created_at).getTime(),
        updatedAt: new Date(profile.updated_at).getTime(),
      };
    } catch (error) {
      console.error('[PostgresAuthRepository] Error in getUserByEmailGlobal:', error);
      return null;
    }
  }

  // ========== MAPPERS ==========

  private mapRowToTenant(row: any): Tenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      isActive: row.is_active,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  private mapRowToUser(row: any): User {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: row.is_active,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }
}

/**
 * Helper para hash de senha
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Helper para verificar senha
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const createPostgresAuthRepository = (): IAuthRepository => {
  if (supabase) {
    return new PostgresAuthRepository();
  }
  // Fallback para in-memory se Supabase não estiver configurado
  const { createAuthRepository } = require('./repository');
  return createAuthRepository();
};

