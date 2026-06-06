/**
 * Нормализует номер телефона к формату 7XXXXXXXXXX (11 цифр, без плюса)
 * Подходит для Beeline CloudPBX и Wazzup API.
 */
export function normalizePhone(phone: string): string {
  // Удаляем все символы, кроме цифр
  const clean = phone.replace(/\D/g, '');
  
  if (clean.length === 11) {
    if (clean.startsWith('8')) {
      return '7' + clean.slice(1);
    }
    return clean;
  }
  
  if (clean.length === 10) {
    return '7' + clean;
  }
  
  // Возвращаем как есть, если формат неизвестен, очистив от нецифровых символов
  return clean;
}
