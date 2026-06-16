/**
 * CRM manager (auth email) → Agbis user_id (приёмщик / creater_id) map.
 * Verified live 2026-06-16 from real orders: Елена=1035, Самал=1023 (Дарын=1022 is the API user).
 * Without a mapping, the order is created under the API user; with it, Agbis attributes the
 * order to the real manager (the "Приёмщик" field). Small + stable — move to a managers table
 * (e.g. profiles.agbis_user_id) when the team grows.
 */

const EMAIL_TO_AGBIS_USER_ID: Record<string, string> = {
  'elena@daraclean.kz': '1035',
  'samal@daraclean.kz': '1023',
}

export function getAgbisUserId(email: string | null | undefined): string | null {
  if (!email) return null
  return EMAIL_TO_AGBIS_USER_ID[email.trim().toLowerCase()] ?? null
}
