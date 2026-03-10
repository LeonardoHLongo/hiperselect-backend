/**
 * Internal Contacts Types
 * Contatos internos (gerentes, admins) que recebem mensagens automáticas
 */

export type InternalContactType = 'manager' | 'admin';

export type InternalContact = {
  id: string;
  tenantId: string;
  phoneNumber: string; // Formato: 5548999999999
  contactType: InternalContactType;
  storeId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateInternalContactInput = {
  tenantId: string;
  phoneNumber: string;
  contactType: InternalContactType;
  storeId?: string | null;
};
