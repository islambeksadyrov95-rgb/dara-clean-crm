/**
 * Канонический формат хранения телефона — E.164 для Казахстана: +7XXXXXXXXXX.
 * Вся база клиентов (импорт) хранится именно так, поэтому это единый формат
 * на запись и на поиск (clients.phone). Конвертация под конкретного потребителя
 * (Beeline, Wazzup, tel:) выполняется адаптерами ниже.
 */
export function normalizePhone(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');

  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '+7' + digits;
  }

  // Неизвестный/некорректный формат — пустая строка (вызывающий код проверяет !phone).
  return '';
}

/** Корректный казахстанский номер: «+7» и ровно 10 цифр после. */
export function isValidPhone(raw: string): boolean {
  return /^\+7\d{10}$/.test(normalizePhone(raw));
}

/**
 * Цифры для набора без «+»: 7XXXXXXXXXX.
 * Нужен для Beeline CloudPBX (MakeCall2 number) и Wazzup (chatId) — они не принимают «+».
 */
export function toDialDigits(raw: string): string {
  const normalized = normalizePhone(raw);
  return normalized ? normalized.slice(1) : String(raw ?? '').replace(/\D/g, '');
}

/** Формат для tel:-ссылок и отображения: +7XXXXXXXXXX. */
export function toE164(raw: string): string {
  return normalizePhone(raw) || String(raw ?? '');
}
