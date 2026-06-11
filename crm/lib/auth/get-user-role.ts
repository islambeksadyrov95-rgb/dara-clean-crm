import type { User } from '@supabase/supabase-js'

type UserRole = 'admin' | 'manager'

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'manager'
}

/**
 * Reads the user's role from app_metadata (primary) or user_metadata (fallback).
 * Pure function — no server dependencies, safe for client components and middleware.
 */
export function getUserRole(user: User | null): UserRole | null {
  if (!user) return null

  const appRole = user.app_metadata?.role
  if (isUserRole(appRole)) return appRole

  const metaRole = user.user_metadata?.role
  if (isUserRole(metaRole)) return metaRole

  return null
}
