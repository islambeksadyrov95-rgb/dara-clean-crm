import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { getUserRole } from './get-user-role'
export { getUserRole } from './get-user-role'

type RequireAdminResult =
  | { ok: true; user: User }
  | { ok: false; error: string }

export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || getUserRole(user) !== 'admin') {
    return {
      ok: false as const,
      error: 'Доступ запрещен. Требуются права администратора.',
    }
  }

  return { ok: true as const, user }
}
