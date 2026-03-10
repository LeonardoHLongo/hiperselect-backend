/**
 * Types for Stores and Policies
 * Central de verdade para dados de lojas e políticas
 */

export type Store = {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  openingHours: string;
  phone: string;
  isActive: boolean;
  managerWhatsappNumber?: string | null;
  managerWhatsappEnabled?: boolean;
  googleReviewLink?: string | null; // Link do Google Meu Negócio para avaliações
  createdAt: number;
  updatedAt: number;
};

export type Policy = {
  id: string;
  title: string;
  content: string;
  applicableStores: string[]; // Array de IDs de lojas (vazio = todas)
  createdAt: number;
  updatedAt: number;
};

export type CreateStoreInput = {
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  openingHours: string;
  phone: string;
  isActive?: boolean;
  managerWhatsappNumber?: string | null;
  managerWhatsappEnabled?: boolean;
  googleReviewLink?: string | null;
};

export type UpdateStoreInput = Partial<CreateStoreInput> & {
  id: string;
};

export type CreatePolicyInput = {
  title: string;
  content: string;
  applicableStores?: string[]; // Se não fornecido, aplica a todas
};

export type UpdatePolicyInput = Partial<CreatePolicyInput> & {
  id: string;
};

