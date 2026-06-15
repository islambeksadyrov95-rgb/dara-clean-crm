// Client-side sync of MicroSIP local MP3 recordings into Supabase Storage.
// Shared by the settings UI (RecordingFolderSync) and the global background
// daemon (RecordingSyncDaemon) so scanning works on any page, not just settings.

import { createClient } from '@/lib/supabase/client'
import { attachLocalRecording, transcribeLocalRecording } from '@/lib/recordings/actions'

export type PermState = 'granted' | 'denied' | 'prompt'
export type DirEntry = { kind: string; name: string; getFile: () => Promise<File> }
export interface DirHandle {
  name: string
  values: () => AsyncIterableIterator<DirEntry>
  queryPermission: (d: { mode: 'read' | 'readwrite' }) => Promise<PermState>
  requestPermission: (d: { mode: 'read' | 'readwrite' }) => Promise<PermState>
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirHandle>
  }
}

const RECORDINGS_BUCKET = 'call-recordings'
const IDB_NAME = 'dara-recordings'
const IDB_STORE = 'handles'
const HANDLE_KEY = 'recordings-dir'
const UPLOADED_KEY = 'dara-uploaded-recordings'

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbSetHandle(value: DirHandle): Promise<void> {
  const db = await openIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbGetHandle(): Promise<DirHandle | null> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const r = tx.objectStore(IDB_STORE).get(HANDLE_KEY)
    r.onsuccess = () => resolve(r.result ?? null)
    r.onerror = () => reject(r.error)
  })
}

export function loadUploaded(): Set<string> {
  try {
    const parsed: string[] = JSON.parse(localStorage.getItem(UPLOADED_KEY) ?? '[]')
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

/** Uploads one MP3 into the manager's own folder, attaches it to a call, then transcribes + scores it. */
async function uploadEntry(
  supabase: ReturnType<typeof createClient>,
  entry: DirEntry,
  managerId: string
): Promise<boolean> {
  const file = await entry.getFile()
  // Per-manager folder isolates each manager's recordings and prevents cross-manager
  // filename collisions in the shared bucket (a collision silently dropped the 2nd file).
  const path = `local/${managerId}/${entry.name}`
  const { error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, file, { upsert: false, contentType: 'audio/mpeg' })
  if (error) {
    if (error.message.toLowerCase().includes('exists')) return true
    console.error('[recordings] upload failed', error.message)
    return false
  }
  const attached = await attachLocalRecording({ fileName: entry.name, lastModifiedMs: file.lastModified, storagePath: path })
  if (attached.success && attached.matched) {
    await transcribeLocalRecording(attached.logId)
  }
  return true
}

/** Scans the folder for new MP3s and uploads them into the manager's folder. Returns how many were added. */
export async function scanFolder(handle: DirHandle): Promise<number> {
  const supabase = createClient()
  // Manager id namespaces the storage folder. Read from the local session (no network):
  // the actual write authorization is enforced by storage RLS server-side.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return 0
  const managerId = session.user.id
  const uploaded = loadUploaded()
  let added = 0
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.mp3')) continue
    if (uploaded.has(entry.name)) continue
    if (await uploadEntry(supabase, entry, managerId)) {
      uploaded.add(entry.name)
      added++
    }
  }
  localStorage.setItem(UPLOADED_KEY, JSON.stringify([...uploaded]))
  return added
}
