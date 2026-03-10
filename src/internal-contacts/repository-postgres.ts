/**
 * PostgreSQL Implementation for Internal Contacts Repository
 */

import { createClient } from '@supabase/supabase-js';
import type { IInternalContactRepository } from './repository';
import type { InternalContact, CreateInternalContactInput } from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export class PostgresInternalContactRepository implements IInternalContactRepository {
  async create(input: CreateInternalContactInput): Promise<InternalContact> {
    const { data, error } = await supabase
      .from('internal_contacts')
      .insert({
        tenant_id: input.tenantId,
        phone_number: input.phoneNumber,
        contact_type: input.contactType,
        store_id: input.storeId || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[PostgresInternalContactRepository] ❌ Error creating internal contact:', error);
      throw error;
    }

    return this.mapRowToContact(data);
  }

  async findByPhoneNumber(phoneNumber: string, tenantId: string): Promise<InternalContact | null> {
    const { data, error } = await supabase
      .from('internal_contacts')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapRowToContact(data);
  }

  async findAllByTenant(tenantId: string): Promise<InternalContact[]> {
    const { data, error } = await supabase
      .from('internal_contacts')
      .select('*')
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[PostgresInternalContactRepository] ❌ Error finding contacts:', error);
      return [];
    }

    return (data || []).map(this.mapRowToContact);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const { error } = await supabase
      .from('internal_contacts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[PostgresInternalContactRepository] ❌ Error deleting contact:', error);
      throw error;
    }
  }

  private mapRowToContact(row: any): InternalContact {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      phoneNumber: row.phone_number,
      contactType: row.type || row.contact_type, // Suporta ambos os nomes
      storeId: row.store_id || null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }
}
