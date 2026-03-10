/**
 * Store Repository Interface
 * Abstração para persistência de lojas
 */

import type { Store, Policy, CreateStoreInput, UpdateStoreInput, CreatePolicyInput, UpdatePolicyInput } from './types';

export interface IStoreRepository {
  // Stores
  getAllStores(tenantId: string): Store[] | Promise<Store[]>;
  getStoreById(id: string, tenantId: string): Store | null | Promise<Store | null>;
  createStore(input: CreateStoreInput, tenantId: string): Store | Promise<Store>;
  updateStore(input: UpdateStoreInput, tenantId: string): Store | null | Promise<Store | null>;
  deleteStore(id: string, tenantId: string): boolean | Promise<boolean>;
  
  // Policies
  getAllPolicies(tenantId: string): Policy[] | Promise<Policy[]>;
  getPolicyById(id: string, tenantId: string): Policy | null | Promise<Policy | null>;
  createPolicy(input: CreatePolicyInput, tenantId: string): Policy | Promise<Policy>;
  updatePolicy(input: UpdatePolicyInput, tenantId: string): Policy | null | Promise<Policy | null>;
  deletePolicy(id: string, tenantId: string): boolean | Promise<boolean>;
}

/**
 * In-Memory Implementation (para desenvolvimento/testes)
 */
class InMemoryStoreRepository implements IStoreRepository {
  private stores: Map<string, Store> = new Map();
  private policies: Map<string, Policy> = new Map();

  getAllStores(tenantId: string): Store[] {
    // In-memory não filtra por tenant (para desenvolvimento)
    return Array.from(this.stores.values());
  }

  getStoreById(id: string, tenantId: string): Store | null {
    return this.stores.get(id) || null;
  }

  createStore(input: CreateStoreInput, tenantId: string): Store {
    const id = `store_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();
    
    const store: Store = {
      id,
      name: input.name,
      address: input.address,
      neighborhood: input.neighborhood,
      city: input.city,
      openingHours: input.openingHours,
      phone: input.phone,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    
    this.stores.set(id, store);
    return store;
  }

  updateStore(input: UpdateStoreInput, tenantId: string): Store | null {
    const existing = this.stores.get(input.id);
    if (!existing) {
      return null;
    }

    const updated: Store = {
      ...existing,
      ...(input.name && { name: input.name }),
      ...(input.address && { address: input.address }),
      ...(input.neighborhood && { neighborhood: input.neighborhood }),
      ...(input.city && { city: input.city }),
      ...(input.openingHours && { openingHours: input.openingHours }),
      ...(input.phone && { phone: input.phone }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      updatedAt: Date.now(),
    };

    this.stores.set(input.id, updated);
    return updated;
  }

  deleteStore(id: string, tenantId: string): boolean {
    return this.stores.delete(id);
  }

  getAllPolicies(tenantId: string): Policy[] {
    // In-memory não filtra por tenant (para desenvolvimento)
    return Array.from(this.policies.values());
  }

  getPolicyById(id: string, tenantId: string): Policy | null {
    return this.policies.get(id) || null;
  }

  createPolicy(input: CreatePolicyInput, tenantId: string): Policy {
    const id = `policy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();
    
    const policy: Policy = {
      id,
      title: input.title,
      content: input.content,
      applicableStores: input.applicableStores || [],
      createdAt: now,
      updatedAt: now,
    };
    
    this.policies.set(id, policy);
    return policy;
  }

  updatePolicy(input: UpdatePolicyInput, tenantId: string): Policy | null {
    const existing = this.policies.get(input.id);
    if (!existing) {
      return null;
    }

    const updated: Policy = {
      ...existing,
      ...(input.title && { title: input.title }),
      ...(input.content && { content: input.content }),
      ...(input.applicableStores !== undefined && { applicableStores: input.applicableStores }),
      updatedAt: Date.now(),
    };

    this.policies.set(input.id, updated);
    return updated;
  }

  deletePolicy(id: string, tenantId: string): boolean {
    return this.policies.delete(id);
  }
}

export const createStoreRepository = (): IStoreRepository => {
  return new InMemoryStoreRepository();
};

