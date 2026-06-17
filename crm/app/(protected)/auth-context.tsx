'use client'

import { createContext, useContext } from 'react'

// Auth, провалидированный в layout на сервере (getUser), прокинут в клиентские страницы.
// Зачем: страницы больше НЕ делают свой client-side getUser/getSession для получения
// userId/role — это гейтило data-запросы (~до 1с задержки до старта запроса списка).
// Здесь userId доступен синхронно на маунте → запрос данных стартует сразу при гидрации.
type AuthValue = {
  userId: string
  role: string | undefined
  isAdmin: boolean
  hasSip: boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ value, children }: { value: AuthValue; children: React.ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
