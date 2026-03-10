/**
 * Store Service
 * Lógica de negócio para lojas e políticas
 */

import type { IStoreRepository } from './repository';
import type { Store, Policy, CreateStoreInput, UpdateStoreInput, CreatePolicyInput, UpdatePolicyInput } from './types';

export class StoreService {
  constructor(private repository: IStoreRepository) {}

  // ========== STORES ==========

  async getAllStores(tenantId: string): Promise<Store[]> {
    const result = this.repository.getAllStores(tenantId);
    return result instanceof Promise ? await result : result;
  }

  async getStoreById(id: string, tenantId: string): Promise<Store | null> {
    const result = this.repository.getStoreById(id, tenantId);
    return result instanceof Promise ? await result : result;
  }

  async createStore(input: CreateStoreInput, tenantId: string): Promise<Store> {
    const result = this.repository.createStore(input, tenantId);
    return result instanceof Promise ? await result : result;
  }

  async updateStore(input: UpdateStoreInput, tenantId: string): Promise<Store | null> {
    const result = this.repository.updateStore(input, tenantId);
    return result instanceof Promise ? await result : result;
  }

  async deleteStore(id: string, tenantId: string): Promise<boolean> {
    const result = this.repository.deleteStore(id, tenantId);
    return result instanceof Promise ? await result : result;
  }

  // ========== POLICIES ==========

  async getAllPolicies(tenantId: string): Promise<Policy[]> {
    const result = this.repository.getAllPolicies(tenantId);
    return result instanceof Promise ? await result : result;
  }

  async getPolicyById(id: string, tenantId: string): Promise<Policy | null> {
    const result = this.repository.getPolicyById(id, tenantId);
    return result instanceof Promise ? await result : result;
  }

  async createPolicy(input: CreatePolicyInput, tenantId: string): Promise<Policy> {
    const result = this.repository.createPolicy(input, tenantId);
    return result instanceof Promise ? await result : result;
  }

  async updatePolicy(input: UpdatePolicyInput, tenantId: string): Promise<Policy | null> {
    const result = this.repository.updatePolicy(input, tenantId);
    return result instanceof Promise ? await result : result;
  }

  async deletePolicy(id: string, tenantId: string): Promise<boolean> {
    const result = this.repository.deletePolicy(id, tenantId);
    return result instanceof Promise ? await result : result;
  }
}

