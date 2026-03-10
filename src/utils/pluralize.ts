/**
 * Função simples de pluralização para produtos em português
 * 
 * @param product Nome do produto (ex: "ovo", "bandeja", "leite")
 * @param quantity Quantidade (string ou number)
 * @returns Produto no singular ou plural conforme a quantidade
 */
export function pluralizeProduct(product: string, quantity?: string | number | null): string {
  if (!quantity) {
    return product; // Se não houver quantidade, retorna como está
  }

  const qty = typeof quantity === 'string' ? parseInt(quantity, 10) : quantity;
  
  // Se a quantidade for 1, retorna singular
  if (qty === 1) {
    return product;
  }

  // Se a quantidade for maior que 1 ou não numérica, retorna plural
  // Regras básicas de pluralização em português
  const productLower = product.toLowerCase().trim();
  
  // Palavras que terminam em "o" → "os"
  if (productLower.endsWith('o') && !productLower.endsWith('ão')) {
    return product.slice(0, -1) + 'os';
  }
  
  // Palavras que terminam em "a" → "as"
  if (productLower.endsWith('a') && !productLower.endsWith('ão')) {
    return product + 's';
  }
  
  // Palavras que terminam em "ão" → "ões"
  if (productLower.endsWith('ão')) {
    return product.slice(0, -2) + 'ões';
  }
  
  // Palavras que terminam em "l" → "is"
  if (productLower.endsWith('l')) {
    return product.slice(0, -1) + 'is';
  }
  
  // Palavras que terminam em "r", "s", "z" → adiciona "es"
  if (productLower.endsWith('r') || productLower.endsWith('s') || productLower.endsWith('z')) {
    return product + 'es';
  }
  
  // Caso padrão: adiciona "s"
  return product + 's';
}
