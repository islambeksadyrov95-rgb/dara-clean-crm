'use client'

import type { CatalogService, OrderFormData } from '@/app/(protected)/queue/order/catalog'
import { computeArea, estimateCarpetPrice, type CarpetType, type CarpetShape } from '@/lib/agbis/carpet'
import { fmtTenge } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * Presentational pieces of the order form (split out so order-form.tsx stays the state hub and
 * each file stays small). Pure helpers (groupServices/matchesSearch) live here too for reuse + test.
 * Carpets are part of the catalog column (a «Ковры» group): each carpet type is a checkbox row;
 * selecting it reveals shape + size inputs (area/price computed). Trip section is address + car
 * only — район and the time window were dropped (D-2026-06-16); Agbis gets a default window server-side.
 */

export type DeliveryType = 'self' | 'pickup' | 'dropoff'
export type OrderResultData = { agbisStatus: 'synced' | 'pending'; dorId: string | null; amount: number; tripId: string | null }

export type CarpetLine = {
  typeStrId: string; typeName: string; pricePerM2: number
  shapeFlt: string; dim1: number; dim2: number
}

/** Per-type carpet config kept as strings while editing (parsed to numbers on submit). */
export type CarpetCfg = { shapeFlt: string; dim1: string; dim2: string }

export const DELIVERY_OPTIONS: readonly { id: DeliveryType; label: string }[] = [
  { id: 'self', label: 'Самовывоз' },
  { id: 'pickup', label: 'Выезд — забрать' },
  { id: 'dropoff', label: 'Выезд — доставить' },
]

export const selectCls = 'w-full h-9 rounded-md border border-input bg-background px-3 text-sm'

/** Combine structured address parts into one Agbis address string. Empty parts are skipped. */
export function combineAddress(street: string, house: string, apartment: string, floor: string): string {
  const parts: string[] = []
  if (street.trim()) parts.push(street.trim())
  if (house.trim()) parts.push(`д. ${house.trim()}`)
  if (apartment.trim()) parts.push(`кв. ${apartment.trim()}`)
  if (floor.trim()) parts.push(`эт. ${floor.trim()}`)
  return parts.join(', ')
}

export function groupServices(services: readonly CatalogService[]): [string, CatalogService[]][] {
  const map = new Map<string, CatalogService[]>()
  for (const s of services) {
    const arr = map.get(s.group)
    if (arr) arr.push(s)
    else map.set(s.group, [s])
  }
  return Array.from(map.entries())
}

export function matchesSearch(s: CatalogService, q: string): boolean {
  return !q || s.name.toLowerCase().includes(q.toLowerCase())
}

export type CatalogColumnProps = {
  grouped: [string, CatalogService[]][]
  qty: Record<string, number>
  search: string
  onSearch: (v: string) => void
  onToggle: (id: string) => void
  onQty: (id: string, v: number) => void
  carpetTypes: readonly CarpetType[]
  carpetShapes: readonly CarpetShape[]
  carpetCfg: Record<string, CarpetCfg>
  onCarpetToggle: (strId: string) => void
  onCarpetField: (strId: string, field: keyof CarpetCfg, value: string) => void
}

function ServiceRow({ s, qty, onToggle, onQty }: {
  s: CatalogService; qty: number; onToggle: (id: string) => void; onQty: (id: string, v: number) => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm py-0.5">
      <Checkbox checked={qty > 0} onCheckedChange={() => onToggle(s.tovarId)} />
      <span className="flex-1">{s.name}</span>
      <span className="text-muted-foreground text-xs">{fmtTenge(s.price)}</span>
      {qty > 0 && (
        <Input type="number" min={1} value={qty}
          onChange={(e) => onQty(s.tovarId, Number(e.target.value))} className="w-16 h-7" />
      )}
    </div>
  )
}

function CarpetFields({ type, shapes, cfg, onField }: {
  type: CarpetType; shapes: readonly CarpetShape[]; cfg: CarpetCfg
  onField: (field: keyof CarpetCfg, value: string) => void
}) {
  const area = cfg.shapeFlt ? computeArea(cfg.shapeFlt, Number(cfg.dim1) || 0, Number(cfg.dim2) || 0) : 0
  return (
    <div className="ml-6 mt-1 space-y-1">
      <select aria-label={`Форма — ${type.name}`} value={cfg.shapeFlt}
        onChange={(e) => onField('shapeFlt', e.target.value)} className={selectCls}>
        <option value="">Форма…</option>
        {shapes.map((s) => <option key={s.shapeFlt} value={s.shapeFlt}>{s.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" min={0} step="0.1" aria-label={`Размер 1 — ${type.name}`} placeholder="Размер 1 (м)"
          value={cfg.dim1} onChange={(e) => onField('dim1', e.target.value)} className="h-8" />
        <Input type="number" min={0} step="0.1" aria-label={`Размер 2 — ${type.name}`} placeholder="Размер 2 (м)"
          value={cfg.dim2} onChange={(e) => onField('dim2', e.target.value)} className="h-8" />
      </div>
      <div className="text-xs text-muted-foreground">
        {area > 0 ? `${area} м² · ~${fmtTenge(estimateCarpetPrice(area, type.pricePerM2))}` : 'Укажите форму и размеры'}
      </div>
    </div>
  )
}

function CarpetRows({ types, shapes, cfg, onToggle, onField }: {
  types: readonly CarpetType[]; shapes: readonly CarpetShape[]; cfg: Record<string, CarpetCfg>
  onToggle: (strId: string) => void; onField: (strId: string, field: keyof CarpetCfg, value: string) => void
}) {
  if (types.length === 0) return null
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">Ковры (цена ориентировочная, итог — из Агбиса)</div>
      {types.map((t) => {
        const c = cfg[t.strId]
        return (
          <div key={t.strId} className="py-0.5">
            <div className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!c} onCheckedChange={() => onToggle(t.strId)} />
              <span className="flex-1">{t.name}</span>
              <span className="text-muted-foreground text-xs">{fmtTenge(t.pricePerM2)}/м²</span>
            </div>
            {c && <CarpetFields type={t} shapes={shapes} cfg={c} onField={(f, v) => onField(t.strId, f, v)} />}
          </div>
        )
      })}
    </div>
  )
}

export function CatalogColumn(p: CatalogColumnProps) {
  return (
    <div className="space-y-2">
      <Input placeholder="Поиск услуги..." value={p.search} onChange={(e) => p.onSearch(e.target.value)} className="h-9" />
      <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1 border rounded-md p-2">
        {p.grouped.length === 0 && p.carpetTypes.length === 0 && (
          <div className="text-muted-foreground text-sm py-4 text-center">Ничего не найдено</div>
        )}
        {p.grouped.map(([group, items]) => (
          <div key={group}>
            <div className="text-xs text-muted-foreground mb-1">{group}</div>
            {items.map((s) => (
              <ServiceRow key={s.tovarId} s={s} qty={p.qty[s.tovarId] ?? 0} onToggle={p.onToggle} onQty={p.onQty} />
            ))}
          </div>
        ))}
        <CarpetRows types={p.carpetTypes} shapes={p.carpetShapes} cfg={p.carpetCfg}
          onToggle={p.onCarpetToggle} onField={p.onCarpetField} />
      </div>
    </div>
  )
}

export function WarehouseField({ scladId, warehouses, onChange }: {
  scladId: string; warehouses: OrderFormData['warehouses']; onChange: (v: string) => void
}) {
  return (
    <div>
      <Label htmlFor="order-sclad" className="mb-1 block text-xs text-muted-foreground">Склад (приём/выдача)</Label>
      <select id="order-sclad" value={scladId} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </div>
  )
}

export type DeliveryProps = {
  type: DeliveryType; onType: (t: DeliveryType) => void
  form: OrderFormData
  street: string; onStreet: (v: string) => void
  house: string; onHouse: (v: string) => void
  apartment: string; onApartment: (v: string) => void
  floor: string; onFloor: (v: string) => void
  carId: string; onCar: (v: string) => void
}

export function DeliverySection(p: DeliveryProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">Доставка</div>
      <div className="flex gap-1">
        {DELIVERY_OPTIONS.map((o) => (
          <Button key={o.id} type="button" size="sm" variant={p.type === o.id ? 'default' : 'outline'}
            className="flex-1 text-xs" onClick={() => p.onType(o.id)}>{o.label}</Button>
        ))}
      </div>
      {p.type !== 'self' && (
        <div className="space-y-2 rounded-md border p-2">
          <div>
            <Label htmlFor="trip-street" className="mb-1 block text-xs text-muted-foreground">Адрес выезда (улица)</Label>
            <Input id="trip-street" value={p.street} onChange={(e) => p.onStreet(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input aria-label="Дом" placeholder="Дом" value={p.house} onChange={(e) => p.onHouse(e.target.value)} className="h-9" />
            <Input aria-label="Квартира" placeholder="Кв." value={p.apartment} onChange={(e) => p.onApartment(e.target.value)} className="h-9" />
            <Input aria-label="Этаж" placeholder="Этаж" value={p.floor} onChange={(e) => p.onFloor(e.target.value)} className="h-9" />
          </div>
          <select aria-label="Машина" value={p.carId} onChange={(e) => p.onCar(e.target.value)} className={selectCls}>
            <option value="">Машина…</option>
            {p.form.cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

export type DatesProps = {
  intakeDate: string; onIntake: (v: string) => void
  deliveryAt: string; onDelivery: (v: string) => void
  orderTimes: OrderFormData['orderTimes']; fastExecId: string; onUrgency: (v: string) => void
}

export function DatesSection(p: DatesProps) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="order-intake" className="mb-1 block text-xs text-muted-foreground">Приём (дата/время)</Label>
          <Input id="order-intake" type="datetime-local" value={p.intakeDate} onChange={(e) => p.onIntake(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label htmlFor="order-delivery" className="mb-1 block text-xs text-muted-foreground">Выдача (дата/время) <span className="text-red-500">*</span></Label>
          <Input id="order-delivery" type="datetime-local" value={p.deliveryAt} onChange={(e) => p.onDelivery(e.target.value)} className="h-9" />
        </div>
      </div>
      {p.orderTimes.length > 1 && (
        <div>
          <Label htmlFor="order-urgency" className="mb-1 block text-xs text-muted-foreground">Срочность</Label>
          <select id="order-urgency" value={p.fastExecId} onChange={(e) => p.onUrgency(e.target.value)} className={selectCls}>
            {p.orderTimes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

export function OrderResult({ result, onDone }: { result: OrderResultData; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg bg-green-50 border border-green-200">
        <div className="font-semibold text-green-800 mb-1">Заказ создан · {fmtTenge(result.amount)}</div>
        <div className="text-sm text-muted-foreground">
          {result.agbisStatus === 'synced' ? `Отправлен в Агбис (№ ${result.dorId})` : 'Отправка в Агбис поставлена в очередь'}
          {result.tripId && ` · выезд №${result.tripId}`}
        </div>
      </div>
      <Button size="sm" onClick={onDone} className="w-full">Следующий клиент</Button>
    </div>
  )
}
