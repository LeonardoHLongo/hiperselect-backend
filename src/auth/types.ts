/**
 * Authentication Types
 * Tipos para autenticação e multi-tenancy
 */

export type UserRole = 'admin' | 'user' | 'viewer';

export type User = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

export type JWTPayload = {
  userId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = {
  tenantName: string;
  tenantSlug: string;
  userEmail: string;
  userPassword: string;
  userName: string;
};

export type AuthResult = {
  user: User;
  token: string;
};

