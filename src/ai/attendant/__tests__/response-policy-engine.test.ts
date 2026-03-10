/**
 * Testes unitários para ResponsePolicyEngine
 * Table-driven tests para cobrir casos de devolução/reembolso
 */

import { describe, it, expect } from '@jest/globals';
import { evaluatePolicyResponse } from '../response-policy-engine';
import type { Policy } from '../../../stores/types';

describe('ResponsePolicyEngine - Devolução/Reembolso', () => {
  const mockReturnPolicy: Policy = {
    id: 'policy-1',
    title: 'Política de Devolução',
    content: 'Aceitamos devoluções em até 7 dias após a compra, com nota fiscal e produto em perfeito estado.',
    applicableStores: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockStores = [
    { id: 'store-1', name: 'Loja Centro', isActive: true },
    { id: 'store-2', name: 'Loja Shopping', isActive: true },
  ];

  const testCases = [
    {
      name: 'Pergunta sobre devolução com policy existente - deve permitir auto-reply',
      input: {
        intent: 'refund',
        topic: 'refund',
        userMessage: 'tem devolução?',
        policies: [mockReturnPolicy],
        stores: [mockStores[0]],
      },
      expected: {
        canAutoReply: true,
        hasTemplateResponse: true,
      },
    },
    {
      name: 'Pergunta sobre devolução com múltiplas lojas sem loja vinculada - deve perguntar qual loja',
      input: {
        intent: 'refund',
        topic: 'refund',
        userMessage: 'tem devolução?',
        policies: [mockReturnPolicy],
        stores: mockStores,
        conversationStoreId: undefined,
      },
      expected: {
        canAutoReply: true,
        templateResponseIncludes: 'qual loja',
      },
    },
    {
      name: 'Exigência de reembolso imediato - deve bloquear',
      input: {
        intent: 'refund',
        topic: 'refund',
        userMessage: 'quero meu dinheiro agora',
        policies: [mockReturnPolicy],
        stores: [mockStores[0]],
      },
      expected: {
        canAutoReply: false,
        requiresHumanApproval: true,
        reasonIncludes: 'imediata',
      },
    },
    {
      name: 'Pedido de exceção sem nota - deve bloquear',
      input: {
        intent: 'refund',
        topic: 'refund',
        userMessage: 'mesmo sem nota?',
        policies: [mockReturnPolicy],
        stores: [mockStores[0]],
      },
      expected: {
        canAutoReply: false,
        requiresHumanApproval: true,
        reasonIncludes: 'exceção',
      },
    },
    {
      name: 'Ameaça legal - deve bloquear',
      input: {
        intent: 'refund',
        topic: 'refund',
        userMessage: 'vou processar se não devolver',
        policies: [mockReturnPolicy],
        stores: [mockStores[0]],
      },
      expected: {
        canAutoReply: false,
        requiresHumanApproval: true,
        reasonIncludes: 'ameaça',
      },
    },
    {
      name: 'Policy inexistente com múltiplas lojas - deve perguntar qual loja',
      input: {
        intent: 'refund',
        topic: 'refund',
        userMessage: 'tem devolução?',
        policies: [],
        stores: mockStores,
        conversationStoreId: undefined,
      },
      expected: {
        canAutoReply: true,
        templateResponseIncludes: 'qual loja',
      },
    },
    {
      name: 'Policy inexistente com uma loja - deve sugerir humano',
      input: {
        intent: 'refund',
        topic: 'refund',
        userMessage: 'tem devolução?',
        policies: [],
        stores: [mockStores[0]],
      },
      expected: {
        canAutoReply: false,
        requiresHumanApproval: true,
        reasonIncludes: 'política',
      },
    },
  ];

  testCases.forEach(({ name, input, expected }) => {
    it(name, () => {
      const result = evaluatePolicyResponse(input);
      
      expect(result.canAutoReply).toBe(expected.canAutoReply);
      
      if (expected.hasTemplateResponse) {
        expect(result.templateResponse).toBeDefined();
        expect(result.templateResponse?.length).toBeGreaterThan(0);
      }
      
      if (expected.templateResponseIncludes) {
        expect(result.templateResponse?.toLowerCase()).toContain(expected.templateResponseIncludes.toLowerCase());
      }
      
      if (expected.requiresHumanApproval !== undefined) {
        expect(result.requiresHumanApproval).toBe(expected.requiresHumanApproval);
      }
      
      if (expected.reasonIncludes) {
        expect(result.reason.toLowerCase()).toContain(expected.reasonIncludes.toLowerCase());
      }
    });
  });
});

