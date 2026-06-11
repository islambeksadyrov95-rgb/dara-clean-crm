/**
 * Sanitizes a free-text search term before interpolating it into a PostgREST
 * `.or()` filter (e.g. `name.ilike.%term%,phone.ilike.%term%`).
 *
 * PostgREST treats commas as condition separators and parentheses as grouping,
 * so an unescaped term like `a,b` or `x)` would inject extra filter logic or
 * break the query. We strip those structural characters (and `*`, the ilike
 * wildcard) and collapse whitespace. The result is safe to wrap in `%...%`.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
