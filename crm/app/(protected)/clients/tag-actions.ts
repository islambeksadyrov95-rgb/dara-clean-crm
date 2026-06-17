'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'

// Теги — общий справочник на команду: создал любой (где угодно — карточка,
// панель, фильтр), видят и используют все. Работают через user-клиент:
// RLS (20260612000007) разрешает читать/создавать всем авторизованным.

export type ClientTag = { id: string; name: string }

const TAG_NAME_MAX = 40

export async function getAllTags(): Promise<ClientTag[]> {
  try {
    const supabase = await createSupabaseClient()
    const { data, error } = await supabase.from('tags').select('id, name').order('name')
    if (error || !data) return []
    return data
  } catch (err) {
    console.error('getAllTags error:', err)
    return []
  }
}

/** Создаёт тег без привязки к клиенту (из конструктора фильтров). Существующий по имени — возвращает его. */
export async function createTag(name: string) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    const trimmed = name.trim()
    if (!trimmed || trimmed.length > TAG_NAME_MAX) {
      return { success: false as const, error: `Название тега: 1–${TAG_NAME_MAX} символов` }
    }

    const { data: existing } = await supabase.from('tags').select('id, name').eq('name', trimmed).maybeSingle()
    if (existing) return { success: true as const, tag: existing as ClientTag }

    const { data: created, error } = await supabase
      .from('tags')
      .insert({ name: trimmed, created_by: user.id })
      .select('id, name')
      .single()
    if (error || !created) {
      console.error('createTag error:', error?.message)
      return { success: false as const, error: 'Не удалось создать тег' }
    }
    return { success: true as const, tag: created as ClientTag }
  } catch (err) {
    console.error('createTag error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

export async function getClientTags(clientId: string): Promise<ClientTag[]> {
  try {
    const supabase = await createSupabaseClient()
    const { data, error } = await supabase
      .from('client_tags')
      .select('tag:tags(id, name)')
      .eq('client_id', clientId)
    if (error || !data) return []
    return data
      .map((row) => row.tag)
      .filter((t): t is ClientTag => Boolean(t))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  } catch (err) {
    console.error('getClientTags error:', err)
    return []
  }
}

/** Вешает тег на клиента; name без tagId = создать тег (или взять существующий по имени). */
export async function addTagToClient(clientId: string, input: { tagId?: string; name?: string }) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    let tagId = input.tagId ?? null
    if (!tagId) {
      const name = (input.name ?? '').trim()
      if (!name || name.length > TAG_NAME_MAX) {
        return { success: false as const, error: `Название тега: 1–${TAG_NAME_MAX} символов` }
      }
      // Существующий тег с таким именем — используем, не дублируем.
      const { data: existing } = await supabase.from('tags').select('id').eq('name', name).maybeSingle()
      if (existing) {
        tagId = existing.id
      } else {
        const { data: created, error: createError } = await supabase
          .from('tags')
          .insert({ name, created_by: user.id })
          .select('id')
          .single()
        if (createError || !created) {
          console.error('addTagToClient create error:', createError?.message)
          return { success: false as const, error: 'Не удалось создать тег' }
        }
        tagId = created.id
      }
    }

    const { error } = await supabase
      .from('client_tags')
      .insert({ client_id: clientId, tag_id: tagId, created_by: user.id })
    // 23505 = тег уже на клиенте — не ошибка для пользователя.
    if (error && error.code !== '23505') {
      console.error('addTagToClient error:', error.message)
      return { success: false as const, error: 'Не удалось добавить тег' }
    }
    return { success: true as const, tagId }
  } catch (err) {
    console.error('addTagToClient error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

// Чанк для .in()/insert: PostgREST не вмещает тысячи uuid в URL.
const TAG_BULK_CHUNK = 200

// Разрешает (создаёт/находит) тег по имени или id. Возвращает tagId либо ошибку.
async function resolveTagId(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  userId: string,
  input: { tagId?: string; name?: string },
): Promise<{ success: true; tagId: string } | { success: false; error: string }> {
  if (input.tagId) return { success: true, tagId: input.tagId }

  const name = (input.name ?? '').trim()
  if (!name || name.length > TAG_NAME_MAX) {
    return { success: false, error: `Название тега: 1–${TAG_NAME_MAX} символов` }
  }
  const { data: existing } = await supabase.from('tags').select('id').eq('name', name).maybeSingle()
  if (existing) return { success: true, tagId: existing.id }

  const { data: created, error } = await supabase
    .from('tags')
    .insert({ name, created_by: userId })
    .select('id')
    .single()
  if (error || !created) {
    console.error('resolveTagId create error:', error?.message)
    return { success: false, error: 'Не удалось создать тег' }
  }
  return { success: true, tagId: created.id }
}

/**
 * Массовое навешивание тега на множество клиентов.
 *
 * Анти-IDOR: НЕ доверяем переданным clientIds. Используем USER-клиент
 * (createSupabaseClient), а не admin. RLS на public.clients (SELECT) отдаёт менеджеру
 * только его клиентов (assigned_manager_id = auth.uid()) и общий пул (assigned_manager_id
 * IS NULL); админ видит всех. Поэтому select('id').in('id', clientIds) физически возвращает
 * ТОЛЬКО те id, к которым у текущего пользователя есть доступ — пишем теги исключительно по
 * этому отфильтрованному списку. Так невозможно повесить тег на чужого клиента, даже если
 * подставить произвольные id. (Сама INSERT-политика client_tags скоупит лишь created_by =
 * auth.uid(), НЕ владельца клиента, поэтому проверку владения делаем здесь явно — паттерн
 * как у updateClientStickyNote, но с пред-валидацией набора id, а не пост-детектом 0 строк.)
 */
export async function bulkAddTag(clientIds: string[], input: { tagId?: string; name?: string }) {
  try {
    const supabase = await createSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Не авторизован' }

    if (clientIds.length === 0) return { success: false as const, error: 'Не выбран ни один клиент' }

    const tag = await resolveTagId(supabase, user.id, input)
    if (!tag.success) return { success: false as const, error: tag.error }

    // RLS-фильтр: остаются только клиенты, к которым у пользователя есть доступ.
    const { data: allowed, error: checkError } = await supabase
      .from('clients')
      .select('id')
      .in('id', clientIds)
    if (checkError) {
      console.error('[bulkAddTag] ownership check:', checkError.message)
      return { success: false as const, error: 'Ошибка при проверке прав' }
    }
    const allowedIds = (allowed ?? []).map((r) => r.id)
    if (allowedIds.length === 0) {
      return { success: false as const, error: 'Нет прав: тег можно вешать только своим клиентам' }
    }

    // Вставляем связки только по разрешённым id (чанками). 23505 = тег уже на клиенте — не ошибка.
    for (let i = 0; i < allowedIds.length; i += TAG_BULK_CHUNK) {
      const rows = allowedIds.slice(i, i + TAG_BULK_CHUNK).map((clientId) => ({
        client_id: clientId,
        tag_id: tag.tagId,
        created_by: user.id,
      }))
      const { error } = await supabase.from('client_tags').upsert(rows, { onConflict: 'client_id,tag_id', ignoreDuplicates: true })
      if (error) {
        console.error('[bulkAddTag] insert:', error.message)
        return { success: false as const, error: 'Не удалось добавить тег' }
      }
    }

    // skipped > 0 → часть переданных id оказалась чужой/несуществующей (отфильтрована RLS).
    const skipped = clientIds.length - allowedIds.length
    return { success: true as const, applied: allowedIds.length, skipped }
  } catch (err) {
    console.error('bulkAddTag error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}

export async function removeTagFromClient(clientId: string, tagId: string) {
  try {
    const supabase = await createSupabaseClient()
    const { error } = await supabase
      .from('client_tags')
      .delete()
      .eq('client_id', clientId)
      .eq('tag_id', tagId)
    if (error) {
      console.error('removeTagFromClient error:', error.message)
      return { success: false as const, error: 'Не удалось убрать тег' }
    }
    return { success: true as const }
  } catch (err) {
    console.error('removeTagFromClient error:', err)
    return { success: false as const, error: 'Внутренняя ошибка сервера' }
  }
}
