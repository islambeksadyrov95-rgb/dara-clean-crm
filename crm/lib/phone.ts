/**
 * Канонический формат хранения телефона — E.164 для Казахстана: +7XXXXXXXXXX.
 * Вся база клиентов (импорт) хранится именно так, поэтому это единый формат
 * на запись и на поиск (clients.phone). Конвертация под конкретного потребителя
 * (Beeline, Wazzup, tel:) выполняется адаптерами ниже.
 *
 * КЗ-мобильный: код страны 7, далее 10-значный абонентский номер, ПЕРВАЯ цифра
 * которого = 7 (операторские коды 700-708, 747, 750-х, 760-х, 771-778 — все на «7»).
 * Поэтому 10-значный ввод нормализуем в +7 только если он начинается с 7;
 * иначе это не КЗ-мобильный (стационар/мусор) — НЕ выдумываем +7, возвращаем пусто.
 */
const KZ_SUBSCRIBER_PREFIX = '7';

export function normalizePhone(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');

  // 11 цифр с кодом страны (7…) или местным префиксом (8…): срезаем его и проверяем
  // абонентскую часть. 7XXXXXXXXXX и 8XXXXXXXXXX → канон только если абонент начинается с 7.
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    const subscriber = digits.slice(1);
    if (subscriber.startsWith(KZ_SUBSCRIBER_PREFIX)) return '+7' + subscriber;
    return '';
  }
  // 10 цифр без кода страны: это уже абонентский номер — коэрцим в +7 только при префиксе 7.
  if (digits.length === 10 && digits.startsWith(KZ_SUBSCRIBER_PREFIX)) {
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
