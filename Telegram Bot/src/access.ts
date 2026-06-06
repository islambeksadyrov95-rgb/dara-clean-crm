import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import { env } from './env.js'
import crypto from 'crypto'

export type UserRole = 'superadmin' | 'admin'
export type UserStatus = 'approved' | 'pending'

export type AccessRecord = {
  chatId: number
  username: string
  displayName: string
  role: UserRole
  status: UserStatus
  addedBy: string
  addedAt: string
  inviteCode: string
}

const SUPER_ADMIN_USERNAME = 'Islambek_Sadyrov'
const SHEET_NAME = 'Доступ'
const HEADERS = ['chatId', 'username', 'displayName', 'role', 'status', 'addedBy', 'addedAt', 'inviteCode']

const auth = new JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})

const doc = new GoogleSpreadsheet(env.GOOGLE_SPREADSHEET_ID, auth)

let sheet: GoogleSpreadsheetWorksheet | null = null

const ensureSheet = async () => {
  if (sheet) return sheet
  await doc.loadInfo()
  sheet = doc.sheetsByTitle[SHEET_NAME] ?? null
  if (!sheet) {
    sheet = await doc.addSheet({ title: SHEET_NAME, headerValues: HEADERS })
  }
  return sheet
}

// ── Кэш ──

let cache: AccessRecord[] = []
let cacheAt = 0

const loadAll = async (): Promise<AccessRecord[]> => {
  const now = Date.now()
  if (cache.length && now - cacheAt < 30_000) return cache

  const s = await ensureSheet()
  const rows = await s.getRows()

  cache = rows.map((r) => ({
    chatId: Number(r.get('chatId') || 0),
    username: r.get('username') || '',
    displayName: r.get('displayName') || '',
    role: (r.get('role') || 'admin') as UserRole,
    status: (r.get('status') || 'pending') as UserStatus,
    addedBy: r.get('addedBy') || '',
    addedAt: r.get('addedAt') || '',
    inviteCode: r.get('inviteCode') || ''
  }))
  cacheAt = now
  return cache
}

const invalidateCache = () => {
  cache = []
  cacheAt = 0
}

// ── Публичный API ──

export const isSuperAdmin = (username: string | undefined) =>
  username?.toLowerCase() === SUPER_ADMIN_USERNAME.toLowerCase()

export const SUPER_ADMIN_USERNAME_DISPLAY = SUPER_ADMIN_USERNAME

export const isApproved = async (chatId: number, username?: string): Promise<boolean> => {
  if (username && isSuperAdmin(username)) return true
  const all = await loadAll()
  return all.some((r) => r.chatId === chatId && r.status === 'approved')
}

export const isAdmin = async (chatId: number, username?: string): Promise<boolean> => {
  if (username && isSuperAdmin(username)) return true
  const all = await loadAll()
  return all.some((r) => r.chatId === chatId && r.status === 'approved')
}

export const getPendingRequests = async (): Promise<AccessRecord[]> => {
  const all = await loadAll()
  return all.filter((r) => r.status === 'pending')
}

export const getApprovedUsers = async (): Promise<AccessRecord[]> => {
  const all = await loadAll()
  return all.filter((r) => r.status === 'approved')
}

export const requestAccess = async (chatId: number, username: string, displayName: string) => {
  const all = await loadAll()
  const existing = all.find((r) => r.chatId === chatId)
  if (existing) return existing.status

  const s = await ensureSheet()
  await s.addRow({
    chatId: String(chatId),
    username,
    displayName,
    role: 'admin',
    status: 'pending',
    addedBy: 'self',
    addedAt: new Date().toISOString(),
    inviteCode: ''
  })
  invalidateCache()
  return 'pending' as UserStatus
}

export const approveUser = async (chatId: number): Promise<boolean> => {
  const s = await ensureSheet()
  const rows = await s.getRows()
  const row = rows.find((r) => String(r.get('chatId')) === String(chatId) && r.get('status') === 'pending')
  if (!row) return false
  row.set('status', 'approved')
  await row.save()
  invalidateCache()
  return true
}

export const rejectUser = async (chatId: number): Promise<boolean> => {
  const s = await ensureSheet()
  const rows = await s.getRows()
  const row = rows.find((r) => String(r.get('chatId')) === String(chatId) && r.get('status') === 'pending')
  if (!row) return false
  await row.delete()
  invalidateCache()
  return true
}

export const removeUser = async (chatId: number): Promise<{ ok: boolean; reason?: string }> => {
  const s = await ensureSheet()
  const rows = await s.getRows()
  const row = rows.find((r) => String(r.get('chatId')) === String(chatId))
  if (!row) return { ok: false, reason: 'Пользователь не найден' }

  const username = row.get('username') || ''
  if (isSuperAdmin(username)) return { ok: false, reason: 'Нельзя удалить главного администратора' }

  await row.delete()
  invalidateCache()
  return { ok: true }
}

export const addByUsername = async (username: string, addedBy: string): Promise<{ ok: boolean; reason?: string }> => {
  const clean = username.replace(/^@/, '')
  const all = await loadAll()
  const existing = all.find((r) => r.username.toLowerCase() === clean.toLowerCase() && r.status === 'approved')
  if (existing) return { ok: false, reason: 'Пользователь уже имеет доступ' }

  const s = await ensureSheet()
  await s.addRow({
    chatId: '0',
    username: clean,
    displayName: clean,
    role: 'admin',
    status: 'approved',
    addedBy,
    addedAt: new Date().toISOString(),
    inviteCode: ''
  })
  invalidateCache()
  return { ok: true }
}

export const generateInviteCode = async (createdBy: string): Promise<string> => {
  const code = crypto.randomBytes(8).toString('hex')
  const s = await ensureSheet()
  await s.addRow({
    chatId: '0',
    username: '',
    displayName: '',
    role: 'admin',
    status: 'approved',
    addedBy: createdBy,
    addedAt: new Date().toISOString(),
    inviteCode: code
  })
  invalidateCache()
  return code
}

export const redeemInviteCode = async (code: string, chatId: number, username: string, displayName: string): Promise<boolean> => {
  const s = await ensureSheet()
  const rows = await s.getRows()
  const row = rows.find((r) => r.get('inviteCode') === code && r.get('chatId') === '0')
  if (!row) return false

  // Check if user already has access
  const existing = rows.find((r) => String(r.get('chatId')) === String(chatId) && r.get('status') === 'approved')
  if (existing) {
    await row.delete()
    invalidateCache()
    return true
  }

  row.set('chatId', String(chatId))
  row.set('username', username)
  row.set('displayName', displayName)
  await row.save()
  invalidateCache()
  return true
}

export const isApprovedByUsername = async (username: string): Promise<boolean> => {
  if (isSuperAdmin(username)) return true
  const all = await loadAll()
  return all.some((r) => r.username.toLowerCase() === username.toLowerCase() && r.status === 'approved' && r.chatId === 0)
}

export const claimByUsername = async (username: string, chatId: number, displayName: string): Promise<boolean> => {
  const s = await ensureSheet()
  const rows = await s.getRows()
  const row = rows.find(
    (r) => r.get('username').toLowerCase() === username.toLowerCase() && r.get('status') === 'approved' && String(r.get('chatId')) === '0'
  )
  if (!row) return false
  row.set('chatId', String(chatId))
  row.set('displayName', displayName)
  await row.save()
  invalidateCache()
  return true
}
