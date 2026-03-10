/**
 * Auth Repository Interface
 * Abstração para persistência de tenants e users
 */

import type { User, Tenant } from './types';

export interface IAuthRepository {
  // Tenants
  createTenant(name: string, slug: string): Tenant | Promise<Tenant>;
  getTenantById(id: string): Tenant | null | Promise<Tenant | null>;
  getTenantBySlug(slug: string): Tenant | null | Promise<Tenant | null>;

  // Users
  createUser(input: {
    tenantId: string;
    email: string;
    passwordHash: string;
    name: string;
    role?: string;
  }): User | Promise<User>;
  getUserByEmail(tenantId: string, email: string): User | null | Promise<User | null>;
  getUserByEmailGlobal(email: string): User | null | Promise<User | null>; // Busca usuário por email em qualquer tenant
  getUserById(id: string): User | null | Promise<User | null>;
}

/**
 * In-Memory Implementation (para desenvolvimento/testes)
 */
class InMemoryAuthRepository implements IAuthRepository {
  private tenants: Map<string, Tenant> = new Map();
  private users: Map<string, User> = new Map();
  private passwordHashes: Map<string, string> = new Map(); // Para in-memory: armazenar hashes separadamente

  createTenant(name: string, slug: string): Tenant {
    const id = `tenant_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();

    const tenant: Tenant = {
      id,
      name,
      slug,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    this.tenants.set(id, tenant);
    return tenant;
  }

  getTenantById(id: string): Tenant | null {
    return this.tenants.get(id) || null;
  }

  getTenantBySlug(slug: string): Tenant | null {
    return Array.from(this.tenants.values()).find((t) => t.slug === slug) || null;
  }

  createUser(input: {
    tenantId: string;
    email: string;
    passwordHash: string;
    name: string;
    role?: string;
  }): User {
    const id = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();

    const user: User = {
      id,
      tenantId: input.tenantId,
      email: input.email,
      name: input.name,
      role: (input.role as any) || 'user',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(id, user);
    this.passwordHashes.set(id, input.passwordHash); // Armazenar hash separadamente
    return user;
  }

  getUserByEmail(tenantId: string, email: string): User | null {
    return (
      Array.from(this.users.values()).find(
        (u) => u.tenantId === tenantId && u.email === email
      ) || null
    );
  }

  getUserById(id: string): User | null {
    return this.users.get(id) || null;
  }

  getUserByEmailGlobal(email: string): User | null {
    // Buscar usuário por email em qualquer tenant
    return Array.from(this.users.values()).find((u) => u.email === email) || null;
  }
}

export const createAuthRepository = (): IAuthRepository => {
  return new InMemoryAuthRepository();
};

