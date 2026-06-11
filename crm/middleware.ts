import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getUserRole } from './lib/auth/get-user-role'
import type { Database } from './types/database'

const ADMIN_ROUTES = ['/import', '/team', '/settings/telephony', '/settings/segments']
const PUBLIC_ROUTES = ['/login']
// External integrations (VPBX webhook, cron) вЂ” no user session, must skip auth.
const PUBLIC_API_ROUTES = ['/api/vpbx/webhook', '/api/cron']

export async function middleware(request: NextRequest) {
  // Bypass auth entirely for machine-to-machine endpoints (they self-authorize).
  if (PUBLIC_API_ROUTES.some((route) => request.nextUrl.pathname.startsWith(route))) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Р’РђР–РќРћ: getUser() Р° РЅРµ getSession() вЂ” РїСЂРѕРІРµСЂСЏРµС‚ СЃ СЃРµСЂРІРµСЂРѕРј Supabase
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route))

  if (isPublic) {
    if (user) {
      const url = request.nextUrl.clone()
      url.pathname = '/queue'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const isAdminRoute = ADMIN_ROUTES.some((route) => pathname.startsWith(route))
  if (isAdminRoute) {
    if (getUserRole(user) !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/queue'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

