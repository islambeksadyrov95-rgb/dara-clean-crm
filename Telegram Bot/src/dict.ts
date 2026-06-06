import * as sheets from './sheetsClient.js'

let cachedDict:
  | { value: Awaited<ReturnType<typeof sheets.getDictionary>>; fetchedAtMs: number }
  | undefined

export const invalidateDict = () => {
  cachedDict = undefined
}

export const getDict = async () => {
  const now = Date.now()
  if (cachedDict && now - cachedDict.fetchedAtMs < 5 * 60 * 1000) return cachedDict.value
  const value = await sheets.getDictionary()
  cachedDict = { value, fetchedAtMs: now }
  return value
}
