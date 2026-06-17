import type { User } from '@supabase/supabase-js'

type UserRole = 'admin' | 'manager'

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'manager'
}

function pickRole(appRole: unknown, metaRole: unknown): UserRole | null {
  if (isUserRole(appRole)) return appRole
  if (isUserRole(metaRole)) return metaRole
  return null
}

/**
 * Reads the user's role from app_metadata (primary) or user_metadata (fallback).
 * Pure function — no server dependencies, safe for client components and middleware.
 */
export function getUserRole(user: User | null): UserRole | null {
  if (!user) return null
  return pickRole(user.app_metadata?.role, user.user_metadata?.role)
}

// Роль из JWT-claims (supabase.auth.getClaims) — для read-мест, где не нужен сетевой
// getUser: claims = декодированный payload access-токена, содержит app_metadata/user_metadata.
function readRoleField(meta: unknown): unknown {
  if (meta && typeof meta === 'object' && 'role' in meta) {
    return (meta as { role: unknown }).role
  }
  return undefined
}
export function getUserRoleFromClaims(
  claims: { app_metadata?: unknown; user_metadata?: unknown } | null,
): UserRole | null {
  if (!claims) return null
  return pickRole(readRoleField(claims.app_metadata), readRoleField(claims.user_metadata))
}
