/**
 * Testes unitários para StoreResolver
 * Table-driven tests para cobrir casos de resolução de lojas
 */

import { describe, it, expect } from '@jest/globals';
import { resolveStore } from '../store-resolver';
import type { StoreService } from '../service';
import type { Store } from '../types';

// Mock do StoreService
class MockStoreService implements Partial<StoreService> {
  constructor(private stores: Store[]) {}

  async getAllStores(tenantId: string): Promise<Store[]> {
    return this.stores.filter(s => s.isActive);
  }
}

describe('StoreResolver', () => {
  const mockStores: Store[] = [
    {
      id: 'store-1',
      name: 'Loja da Armação',
      address: 'Rua da Armação, 123',
      neighborhood: 'Armação',
      city: 'Florianópolis',
      openingHours: '08:00 - 20:00',
      phone: '48999999999',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'store-2',
      name: 'Loja do Centro',
      address: 'Rua do Centro, 456',
      neighborhood: 'Centro',
      city: 'Florianópolis',
      openingHours: '09:00 - 19:00',
      phone: '48988888888',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'store-3',
      name: 'Loja do Shopping',
      address: 'Shopping Center, Loja 10',
      neighborhood: 'Shopping',
      city: 'Florianópolis',
      openingHours: '10:00 - 22:00',
      phone: '48977777777',
      isActive: false, // Inativa
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  const testCases = [
    {
      name: 'Resolve loja por nome completo',
      message: 'foi na loja da armação',
      expected: {
        resolved: true,
        storeId: 'store-1',
        storeName: 'Loja da Armação',
      },
    },
    {
      name: 'Resolve loja por palavra-chave (armação)',
      message: 'foi a da armação',
      expected: {
        resolved: true,
        storeId: 'store-1',
        storeName: 'Loja da Armação',
      },
    },
    {
      name: 'Resolve loja por bairro',
      message: 'foi na loja do centro',
      expected: {
        resolved: true,
        storeId: 'store-2',
        storeName: 'Loja do Centro',
      },
    },
    {
      name: 'Não resolve loja inativa',
      message: 'foi na loja do shopping',
      expected: {
        resolved: false,
      },
    },
    {
      name: 'Não resolve quando não há match',
      message: 'foi na loja de são paulo',
      expected: {
        resolved: false,
      },
    },
    {
      name: 'Retorna única loja quando há apenas uma',
      message: 'qualquer texto',
      stores: [mockStores[0]], // Apenas uma loja
      expected: {
        resolved: true,
        storeId: 'store-1',
        storeName: 'Loja da Armação',
      },
    },
  ];

  testCases.forEach(({ name, message, stores: testStores, expected }) => {
    it(name, async () => {
      const storeService = new MockStoreService(testStores || mockStores) as unknown as StoreService;
      const result = await resolveStore(storeService, 'tenant-1', message);
      
      expect(result.resolved).toBe(expected.resolved);
      
      if (expected.storeId) {
        expect(result.storeId).toBe(expected.storeId);
        expect(result.storeName).toBe(expected.storeName);
      }
    });
  });
});

