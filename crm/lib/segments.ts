// Дефолтная семантическая палитра сегментов RFM — фолбэк, если правило не задаёт цвет.
export const SEGMENT_COLORS: Record<string, string> = {
  'Новый': 'bg-blue-50 text-blue-700 border-blue-100',
  'Повторный': 'bg-teal-50 text-teal-700 border-teal-100',
  'Постоянный': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  'В риске': 'bg-amber-50 text-amber-700 border-amber-100',
  'Потерянный': 'bg-red-50 text-red-700 border-red-100',
}

// ── Настраиваемые правила сегментации (источник правды: crm_settings.segment_rules) ──
// Правила оцениваются по порядку, первое совпадение выигрывает. Должно совпадать с
// SQL-функцией public.compute_segment (миграция 20260611000005).

export type SegmentRuleType = 'days_gt' | 'orders_gte' | 'default'

export interface SegmentRule {
  name: string
  color: string
  type: SegmentRuleType
  value: number
}

export interface SegmentConfig {
  segments: SegmentRule[]
}

export const DEFAULT_SEGMENT_RULES: SegmentConfig = {
  segments: [
    { name: 'Потерянный', color: 'bg-red-50 text-red-700 border-red-100', type: 'days_gt', value: 180 },
    { name: 'В риске', color: 'bg-amber-50 text-amber-700 border-amber-100', type: 'days_gt', value: 90 },
    { name: 'Постоянный', color: 'bg-emerald-50 text-emerald-700 border-emerald-100', type: 'orders_gte', value: 4 },
    { name: 'Повторный', color: 'bg-teal-50 text-teal-700 border-teal-100', type: 'orders_gte', value: 2 },
    { name: 'Новый', color: 'bg-blue-50 text-blue-700 border-blue-100', type: 'default', value: 0 },
  ],
}

// Безопасный парс значения из crm_settings (value: Json может быть любым типом).
export function parseSegmentConfig(value: unknown): SegmentConfig {
  if (!value || typeof value !== 'object') return DEFAULT_SEGMENT_RULES
  const segments = (value as { segments?: unknown }).segments
  if (!Array.isArray(segments)) return DEFAULT_SEGMENT_RULES

  const parsed: SegmentRule[] = []
  for (const raw of segments) {
    if (!raw || typeof raw !== 'object') continue
    const rule = raw as Record<string, unknown>
    if (typeof rule.name !== 'string' || !rule.name.trim()) continue
    const type: SegmentRuleType =
      rule.type === 'days_gt' || rule.type === 'orders_gte' ? rule.type : 'default'
    parsed.push({
      name: rule.name,
      color: typeof rule.color === 'string' ? rule.color : '',
      type,
      value: typeof rule.value === 'number' ? rule.value : Number(rule.value) || 0,
    })
  }
  return parsed.length > 0 ? { segments: parsed } : DEFAULT_SEGMENT_RULES
}

// TS-зеркало SQL public.compute_segment: первое совпавшее правило выигрывает.
export function computeSegment(
  totalOrders: number,
  daysSinceLastOrder: number | null,
  config: SegmentConfig = DEFAULT_SEGMENT_RULES,
): string {
  for (const seg of config.segments) {
    if (seg.type === 'days_gt' && daysSinceLastOrder !== null && daysSinceLastOrder > seg.value) {
      return seg.name
    }
    if (seg.type === 'orders_gte' && totalOrders >= seg.value) {
      return seg.name
    }
    if (seg.type === 'default') {
      return seg.name
    }
  }
  return config.segments[config.segments.length - 1]?.name ?? 'Новый'
}

export function colorForSegment(name: string, config: SegmentConfig = DEFAULT_SEGMENT_RULES): string {
  const seg = config.segments.find((s) => s.name === name)
  return seg?.color || SEGMENT_COLORS[name] || ''
}

export function segmentNames(config: SegmentConfig = DEFAULT_SEGMENT_RULES): string[] {
  return config.segments.map((s) => s.name)
}
