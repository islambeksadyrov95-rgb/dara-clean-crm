import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'

type UserRole = 'admin' | 'manager'

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'manager'
}

export function getUserRole(user: User | null): UserRole | null {
  if (!user) return null

  const appRole = user.app_metadata?.role
  if (isUserRole(appRole)) return appRole

  const metaRole = user.user_metadata?.role
  if (isUserRole(metaRole)) return metaRole

  return null
}

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
