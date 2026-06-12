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
