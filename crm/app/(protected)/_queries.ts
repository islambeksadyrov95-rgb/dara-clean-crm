'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUsersDirectory, getFilterDictionaries, listSavedFilters } from './clients/actions'
import { getSegmentRules, getSettings } from './settings/actions'

// Общие справочники/настройки CRM на TanStack Query.
//
// Зачем: эти данные (пользователи, словари фильтров, правила сегментов, настройки,
// сохранённые фильтры) тянулись на КАЖДОМ маунте через useEffect — и отдельно на /queue,
// и на /clients. Один общий кэш с длинным staleTime дедуплицирует их между страницами и
// между возвратами: повторный заход = ноль server actions вместо ~10.

// Справочники меняются редко — держим свежими всю сессию, не рефетчим на каждый возврат.
const REFERENCE_STALE_TIME = 5 * 60_000

// Карты id→имя для менеджеров и всех пользователей (мемоизированы по data — стабильная ссылка).
export function useUsersDirectory() {
  const { data, isSuccess } = useQuery({
    queryKey: ['users-directory'],
    queryFn: getUsersDirectory,
    staleTime: REFERENCE_STALE_TIME,
  })
  const managersMap = useMemo(
    () => new Map((data?.managers ?? []).map((u) => [u.id, u.name] as const)),
    [data],
  )
  const namesMap = useMemo(
    () => new Map((data?.allUsers ?? []).map((u) => [u.id, u.name] as const)),
    [data],
  )
  return { managersMap, namesMap, isLoaded: isSuccess }
}

export function useFilterDictionaries() {
  return useQuery({
    queryKey: ['filter-dictionaries'],
    queryFn: getFilterDictionaries,
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useSegmentRules() {
  return useQuery({
    queryKey: ['segment-rules'],
    queryFn: getSegmentRules,
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: REFERENCE_STALE_TIME,
  })
}

export function useSavedFilters(scope: 'clients' | 'queue') {
  return useQuery({
    queryKey: ['saved-filters', scope],
    queryFn: () => listSavedFilters(scope),
    staleTime: REFERENCE_STALE_TIME,
  })
}
