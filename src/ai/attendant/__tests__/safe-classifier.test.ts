/**
 * Testes unitários para SafeClassifier
 * Table-driven tests para cobrir casos de devolução/reembolso
 */

import { describe, it, expect } from '@jest/globals';
import { classifyMessage } from '../safe-classifier';

describe('SafeClassifier - Devolução/Reembolso', () => {
  const testCases = [
    {
      name: 'Pergunta simples sobre devolução com policy existente',
      message: 'tem devolução?',
      expected: {
        isSafe: true,
        intent: 'refund',
      },
    },
    {
      name: 'Pergunta sobre política de devolução',
      message: 'qual a política de devolução?',
      expected: {
        isSafe: true,
        intent: 'refund',
      },
    },
    {
      name: 'Pergunta sobre reembolso',
      message: 'como funciona o reembolso?',
      expected: {
        isSafe: true,
        intent: 'refund',
      },
    },
    {
      name: 'Exigência de reembolso imediato - deve bloquear',
      message: 'quero meu dinheiro agora',
      expected: {
        isSafe: false,
        intent: 'complaint',
      },
    },
    {
      name: 'Exigência de devolução hoje - deve bloquear',
      message: 'devolve hoje',
      expected: {
        isSafe: false,
        intent: 'complaint',
      },
    },
    {
      name: 'Pedido de exceção sem nota - deve bloquear',
      message: 'mesmo sem nota?',
      expected: {
        isSafe: false,
        intent: 'complaint',
      },
    },
    {
      name: 'Pedido de exceção produto aberto - deve bloquear',
      message: 'produto aberto pode devolver?',
      expected: {
        isSafe: false,
        intent: 'complaint',
      },
    },
    {
      name: 'Ameaça legal - deve bloquear',
      message: 'vou processar se não devolver',
      expected: {
        isSafe: false,
        intent: 'legal',
      },
    },
    {
      name: 'Pedido de prazo específico - deve bloquear',
      message: 'qual o prazo de devolução?',
      expected: {
        isSafe: false,
        intent: 'complaint',
      },
    },
    {
      name: 'Pedido de valor específico - deve bloquear',
      message: 'quanto tempo demora o reembolso?',
      expected: {
        isSafe: false,
        intent: 'complaint',
      },
    },
  ];

  testCases.forEach(({ name, message, expected }) => {
    it(name, () => {
      const result = classifyMessage(message);
      expect(result.isSafe).toBe(expected.isSafe);
      expect(result.intent).toBe(expected.intent);
    });
  });
});

describe('SafeClassifier - Outras intenções', () => {
  it('deve classificar endereço como safe', () => {
    const result = classifyMessage('onde fica a loja?');
    expect(result.isSafe).toBe(true);
    expect(result.intent).toBe('address');
  });

  it('deve classificar horário como safe', () => {
    const result = classifyMessage('qual o horário de funcionamento?');
    expect(result.isSafe).toBe(true);
    expect(result.intent).toBe('hours');
  });
});

