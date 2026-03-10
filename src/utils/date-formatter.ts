/**
 * Date Formatter Utilities
 * Formatação de datas em formato brasileiro amigável
 */

/**
 * Formata uma data/hora em formato brasileiro amigável
 * Exemplos:
 * - "hoje às 20:48" (se for hoje)
 * - "20:48" (se for hoje e não especificar data)
 * - "13/02 às 20:48" (se for outro dia do mesmo ano)
 * - "13/02/2026 às 20:48" (se for outro ano)
 */
export function formatBrazilianDateTime(dateInput: string | number | Date): string {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' 
    ? new Date(dateInput) 
    : dateInput;
  
  if (isNaN(date.getTime())) {
    // Se não conseguir parsear, tentar extrair apenas hora se for formato ISO
    if (typeof dateInput === 'string') {
      const timeMatch = dateInput.match(/(\d{2}):(\d{2})/);
      if (timeMatch) {
        return timeMatch[0]; // Retorna apenas "HH:MM"
      }
    }
    return String(dateInput); // Fallback: retorna o valor original
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const inputDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  // Se for hoje, retorna "hoje às HH:MM"
  if (inputDate.getTime() === today.getTime()) {
    return `hoje às ${timeStr}`;
  }

  // Se for outro dia do mesmo ano, retorna "DD/MM às HH:MM"
  if (date.getFullYear() === now.getFullYear()) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month} às ${timeStr}`;
  }

  // Se for outro ano, retorna "DD/MM/YYYY às HH:MM"
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year} às ${timeStr}`;
}

/**
 * Formata apenas o horário (HH:MM)
 */
export function formatTime(dateInput: string | number | Date): string {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' 
    ? new Date(dateInput) 
    : dateInput;
  
  if (isNaN(date.getTime())) {
    // Tentar extrair apenas hora se for formato ISO
    if (typeof dateInput === 'string') {
      const timeMatch = dateInput.match(/(\d{2}):(\d{2})/);
      if (timeMatch) {
        return timeMatch[0];
      }
    }
    return String(dateInput);
  }

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Converte um horário (string ou timestamp) para timestamp
 * Suporta:
 * - Formato HH:MM ou HH:MM:SS (ex: "21:05", "21:05:00")
 * - Timestamp numérico (ex: 1736892300000)
 * - ISO string (ex: "2026-02-13T21:05:00Z")
 * 
 * Se for apenas horário (HH:MM), assume o dia atual.
 * Se o horário já passou hoje, assume amanhã.
 */
export function parsePickupTime(pickupTime: string | number): number {
  // Se já for número, assumir que é timestamp
  if (typeof pickupTime === 'number') {
    return pickupTime;
  }

  // Tentar parsear como timestamp string
  if (pickupTime.match(/^\d+$/)) {
    return parseInt(pickupTime, 10);
  }

  // Tentar parsear como ISO string
  const isoDate = new Date(pickupTime);
  if (!isNaN(isoDate.getTime())) {
    return isoDate.getTime();
  }

  // Tentar parsear como horário HH:MM ou HH:MM:SS
  const timeMatch = pickupTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60) {
      // Criar data para hoje com o horário especificado
      const now = new Date();
      const pickupDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hours,
        minutes,
        seconds
      );

      // Se o horário já passou hoje, assumir que é para amanhã
      if (pickupDate.getTime() < now.getTime()) {
        pickupDate.setDate(pickupDate.getDate() + 1);
      }

      return pickupDate.getTime();
    }
  }

  // Se não conseguir parsear, lançar erro
  throw new Error(`Formato de horário inválido: ${pickupTime}. Use HH:MM, timestamp ou ISO string.`);
}
