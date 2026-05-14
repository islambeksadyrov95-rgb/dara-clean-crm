/**
 * Нормализация телефона в формат E.164 (+7XXXXXXXXXX)
 * Возвращает null если номер невалиден
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')

  if (digits.length === 11 && digits.startsWith('8')) {
    return '+7' + digits.slice(1)
  }
  if (digits.length === 11 && digits.startsWith('7')) {
    return '+' + digits
  }
  if (digits.length === 10) {
    return '+7' + digits
  }

  return null
}
