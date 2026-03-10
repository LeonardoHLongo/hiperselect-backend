/**
 * Internal Contacts Repository Interface
 */

import type { InternalContact, CreateInternalContactInput } from './types';

export interface IInternalContactRepository {
  create(input: CreateInternalContactInput): Promise<InternalContact>;
  findByPhoneNumber(phoneNumber: string, tenantId: string): Promise<InternalContact | null>;
  findAllByTenant(tenantId: string): Promise<InternalContact[]>;
  delete(id: string, tenantId: string): Promise<void>;
}
