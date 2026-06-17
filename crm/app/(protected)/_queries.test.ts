// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('./clients/actions', () => ({
  getUsersDirectory: vi.fn(),
  getFilterDictionaries: vi.fn(),
  listSavedFilters: vi.fn(),
}))
vi.mock('./settings/actions', () => ({
  getSegmentRules: vi.fn(),
  getSettings: vi.fn(),
}))

import { getUsersDirectory, getFilterDictionaries, listSavedFilters } from './clients/actions'
import { useUsersDirectory, useFilterDictionaries, useSavedFilters } from './_queries'

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

describe('useUsersDirectory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('строит managersMap и namesMap из данных справочника', async () => {
    vi.mocked(getUsersDirectory).mockResolvedValue({
      managers: [{ id: 'm1', name: 'Самал' }],
      allUsers: [{ id: 'm1', name: 'Самал' }, { id: 'a1', name: 'Админ' }],
    })
    const { result } = renderHook(() => useUsersDirectory(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isLoaded).toBe(true))
    expect(result.current.managersMap.get('m1')).toBe('Самал')
    expect(result.current.namesMap.get('a1')).toBe('Админ')
    expect(result.current.managersMap.has('a1')).toBe(false)
  })

  it('до загрузки отдаёт пустые карты и isLoaded=false', () => {
    vi.mocked(getUsersDirectory).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useUsersDirectory(), { wrapper: makeWrapper() })
    expect(result.current.managersMap.size).toBe(0)
    expect(result.current.isLoaded).toBe(false)
  })
})

describe('справочные хуки прокидывают результат экшена', () => {
  beforeEach(() => vi.clearAllMocks())

  it('useFilterDictionaries возвращает данные экшена', async () => {
    const dict = { tags: [{ id: 't1', name: 'VIP' }], sources: [], services: [] }
    vi.mocked(getFilterDictionaries).mockResolvedValue(dict)
    const { result } = renderHook(() => useFilterDictionaries(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(dict)
  })

  it('useSavedFilters ключуется по scope', async () => {
    vi.mocked(listSavedFilters).mockResolvedValue([])
    const { result } = renderHook(() => useSavedFilters('queue'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(listSavedFilters).toHaveBeenCalledWith('queue')
  })
})
