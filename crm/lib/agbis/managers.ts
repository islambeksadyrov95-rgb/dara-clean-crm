import { createAdminClient } from '@/lib/supabase/admin'

/**
 * CRM manager (auth email) → Agbis user_id (приёмщик / creater_id), read from profiles.agbis_user_id.
 * Was a hardcoded 2-entry map (elena/samal only) — now DB-backed so a new manager is one UPDATE on
 * profiles, not a code deploy. null → the order is created under the API user (Дарын=1022); with a
 * mapping, Agbis attributes the order to the real manager (the "Приёмщик" field).
 * D-2026-06-28-agbis-user-map.
 */
export async function resolveAgbisUserId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  const { data } = await createAdminClient()
    .from('profiles')
    .select('agbis_user_id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  return data?.agbis_user_id ?? null
}
