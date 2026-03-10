/**
 * PostgreSQL Company Repository
 * Implementação de ICompanyRepository usando Supabase
 */

import { createClient } from '@supabase/supabase-js';
import type { ICompanyRepository } from './repository';
import type { CompanyContext } from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[CompanyRepository] ⚠️  Supabase credentials not found - using in-memory repository');
}

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

class PostgresCompanyRepository implements ICompanyRepository {
  constructor() {
    console.log('[PostgresCompanyRepository] ✅ Initialized');
  }

  async getContext(): Promise<CompanyContext | null> {
    if (!supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('company_context')
        .select('*')
        .eq('id', 'default')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - context not set yet
          console.log('[PostgresCompanyRepository] ℹ️  No company context found');
          return null;
        }
        console.error('[PostgresCompanyRepository] Error fetching context:', error);
        return null;
      }

      if (!data) {
        return null;
      }

      return {
        businessName: data.business_name,
        address: data.address,
        openingHours: data.opening_hours,
        deliveryPolicy: data.delivery_policy,
        paymentMethods: data.payment_methods,
        internalNotes: data.internal_notes || '',
      };
    } catch (error) {
      console.error('[PostgresCompanyRepository] Error in getContext:', error);
      return null;
    }
  }

  async updateContext(context: CompanyContext): Promise<void> {
    if (!supabase) {
      console.warn('[PostgresCompanyRepository] ⚠️  Cannot update context - Supabase not configured');
      return;
    }

    try {
      const { error } = await supabase
        .from('company_context')
        .upsert({
          id: 'default',
          business_name: context.businessName,
          address: context.address,
          opening_hours: context.openingHours,
          delivery_policy: context.deliveryPolicy,
          payment_methods: context.paymentMethods,
          internal_notes: context.internalNotes || '',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id',
        });

      if (error) {
        console.error('[PostgresCompanyRepository] Error updating context:', error);
        throw error;
      }

      console.log('[PostgresCompanyRepository] ✅ Company context updated');
    } catch (error) {
      console.error('[PostgresCompanyRepository] Error in updateContext:', error);
      throw error;
    }
  }
}

export const createPostgresCompanyRepository = (): ICompanyRepository => {
  if (supabase) {
    return new PostgresCompanyRepository();
  }
  // Fallback para in-memory se Supabase não estiver configurado
  const { createCompanyRepository } = require('./repository');
  return createCompanyRepository();
};

