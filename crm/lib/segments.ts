// Единая семантическая палитра сегментов RFM.
// Источник правды для бейджей сегментов во всех экранах (queue, clients, card, pipeline).
export const SEGMENT_COLORS: Record<string, string> = {
  'Новый': 'bg-blue-50 text-blue-700 border-blue-100',
  'Повторный': 'bg-teal-50 text-teal-700 border-teal-100',
  'Постоянный': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  'В риске': 'bg-amber-50 text-amber-700 border-amber-100',
  'Потерянный': 'bg-red-50 text-red-700 border-red-100',
}
