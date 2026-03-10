/**
 * PostgreSQL Store Repository
 * Implementação usando Supabase
 */

import { createClient } from '@supabase/supabase-js';
import type { IStoreRepository } from './repository';
import type { Store, Policy, CreateStoreInput, UpdateStoreInput, CreatePolicyInput, UpdatePolicyInput } from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[StoreRepository] ⚠️  Supabase credentials not found - using in-memory repository');
}

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

class PostgresStoreRepository implements IStoreRepository {
  constructor() {
    console.log('[PostgresStoreRepository] ✅ Initialized');
  }

  // ========== STORES ==========

  async getAllStores(tenantId: string): Promise<Store[]> {
    if (!supabase) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true });

      if (error) {
        console.error('[PostgresStoreRepository] Error fetching stores:', error);
        return [];
      }

      const stores = (data || []).map(this.mapRowToStore);
      
      // Debug: logar campos de gerente para verificar
      stores.forEach(store => {
        if (store.managerWhatsappNumber || store.managerWhatsappEnabled) {
          console.log(`[PostgresStoreRepository] 🔍 Store com gerente: ${store.name}`, {
            managerWhatsappNumber: store.managerWhatsappNumber,
            managerWhatsappEnabled: store.managerWhatsappEnabled,
          });
        }
      });
      
      return stores;
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in getAllStores:', error);
      return [];
    }
  }

  async getStoreById(id: string, tenantId: string): Promise<Store | null> {
    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToStore(data);
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in getStoreById:', error);
      return null;
    }
  }

  async createStore(input: CreateStoreInput, tenantId: string): Promise<Store> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { data, error } = await supabase
        .from('stores')
        .insert({
          name: input.name,
          address: input.address,
          neighborhood: input.neighborhood,
          city: input.city,
          opening_hours: input.openingHours,
          phone: input.phone,
          is_active: input.isActive ?? true,
          manager_whatsapp_number: input.managerWhatsappNumber || null,
          manager_whatsapp_enabled: input.managerWhatsappEnabled || false,
          google_review_link: input.googleReviewLink || null,
          tenant_id: tenantId,
        })
        .select()
        .single();

      if (error) {
        console.error('[PostgresStoreRepository] Error creating store:', error);
        throw error;
      }

      return this.mapRowToStore(data);
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in createStore:', error);
      throw error;
    }
  }

  async updateStore(input: UpdateStoreInput, tenantId: string): Promise<Store | null> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const updateData: any = {};
      if (input.name) updateData.name = input.name;
      if (input.address) updateData.address = input.address;
      if (input.neighborhood) updateData.neighborhood = input.neighborhood;
      if (input.city) updateData.city = input.city;
      if (input.openingHours) updateData.opening_hours = input.openingHours;
      if (input.phone) updateData.phone = input.phone;
      if (input.isActive !== undefined) updateData.is_active = input.isActive;
      if (input.managerWhatsappNumber !== undefined) updateData.manager_whatsapp_number = input.managerWhatsappNumber || null;
      if (input.managerWhatsappEnabled !== undefined) updateData.manager_whatsapp_enabled = input.managerWhatsappEnabled || false;
      if (input.googleReviewLink !== undefined) updateData.google_review_link = input.googleReviewLink || null;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('stores')
        .update(updateData)
        .eq('id', input.id)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToStore(data);
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in updateStore:', error);
      return null;
    }
  }

  async deleteStore(id: string, tenantId: string): Promise<boolean> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { error } = await supabase
        .from('stores')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);

      return !error;
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in deleteStore:', error);
      return false;
    }
  }

  // ========== POLICIES ==========

  async getAllPolicies(tenantId: string): Promise<Policy[]> {
    if (!supabase) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('policies')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('title', { ascending: true });

      if (error) {
        console.error('[PostgresStoreRepository] Error fetching policies:', error);
        return [];
      }

      return (data || []).map(this.mapRowToPolicy);
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in getAllPolicies:', error);
      return [];
    }
  }

  async getPolicyById(id: string, tenantId: string): Promise<Policy | null> {
    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('policies')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToPolicy(data);
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in getPolicyById:', error);
      return null;
    }
  }

  async createPolicy(input: CreatePolicyInput, tenantId: string): Promise<Policy> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { data, error } = await supabase
        .from('policies')
        .insert({
          title: input.title,
          content: input.content,
          applicable_stores: input.applicableStores || [],
          tenant_id: tenantId,
        })
        .select()
        .single();

      if (error) {
        console.error('[PostgresStoreRepository] Error creating policy:', error);
        throw error;
      }

      return this.mapRowToPolicy(data);
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in createPolicy:', error);
      throw error;
    }
  }

  async updatePolicy(input: UpdatePolicyInput, tenantId: string): Promise<Policy | null> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const updateData: any = {};
      if (input.title) updateData.title = input.title;
      if (input.content) updateData.content = input.content;
      if (input.applicableStores !== undefined) updateData.applicable_stores = input.applicableStores;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('policies')
        .update(updateData)
        .eq('id', input.id)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToPolicy(data);
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in updatePolicy:', error);
      return null;
    }
  }

  async deletePolicy(id: string, tenantId: string): Promise<boolean> {
    if (!supabase) {
      throw new Error('Supabase not configured');
    }

    try {
      const { error } = await supabase
        .from('policies')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);

      return !error;
    } catch (error) {
      console.error('[PostgresStoreRepository] Error in deletePolicy:', error);
      return false;
    }
  }

  // ========== MAPPERS ==========

  private mapRowToStore(row: any): Store {
    // Debug: logar se encontrar campos de gerente
    if (row.manager_whatsapp_number || row.manager_whatsapp_enabled) {
      console.log(`[PostgresStoreRepository] 🔍 Mapeando store com gerente: ${row.name}`, {
        manager_whatsapp_number: row.manager_whatsapp_number,
        manager_whatsapp_enabled: row.manager_whatsapp_enabled,
        rawRow: {
          manager_whatsapp_number: row.manager_whatsapp_number,
          manager_whatsapp_enabled: row.manager_whatsapp_enabled,
        },
      });
    }
    
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      neighborhood: row.neighborhood,
      city: row.city,
      openingHours: row.opening_hours,
      phone: row.phone,
      isActive: row.is_active,
      managerWhatsappNumber: row.manager_whatsapp_number || null,
      managerWhatsappEnabled: row.manager_whatsapp_enabled || false,
      googleReviewLink: row.google_review_link || null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  private mapRowToPolicy(row: any): Policy {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      applicableStores: row.applicable_stores || [],
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }
}

export const createPostgresStoreRepository = (): IStoreRepository => {
  if (supabase) {
    return new PostgresStoreRepository();
  }
  // Fallback para in-memory se Supabase não estiver configurado
  const { createStoreRepository } = require('./repository');
  return createStoreRepository();
};

