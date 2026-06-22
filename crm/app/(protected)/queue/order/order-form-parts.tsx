'use client'

import type { CatalogService, OrderFormData } from '@/app/(protected)/queue/order/catalog'
import { computeArea, estimateCarpetPrice, type CarpetType, type CarpetShape } from '@/lib/agbis/carpet'
import { almatyNowPlusDaysLocal } from '@/lib/agbis/order-dates'
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

export type ArmMode = 'self' | 'trip'
export type OrderResultData = { agbisStatus: 'synced' | 'pending'; dorId: string | null; amount: number; tripIds: string[] }

/**
 * Unified trip choice (D-2026-06-17 simplification + D-2026-06-18 explicit mode + выезд default).
 * Забор и выдача — одни и те же адрес/машина, отличаются только датой, поэтому ОДИН блок вместо двух.
 * `mode` is the EXPLICIT выезд/самовывоз choice (выезд по умолчанию), NOT derived from carId — it
 * distinguishes «выезд, машина ещё не выбрана» (not ready) from «самовывоз» (ready), so a typed
 * address is never silently dropped (the bug it fixes). Выезд → that address/car for BOTH legs
 * (pickup + delivery); самовывоз → no address/car. Both legs derive from this single choice.
 */
export type TripChoice = { mode: ArmMode; carId: string; address: string; house: string; apartment: string }
export const emptyTrip = (mode: ArmMode = 'trip'): TripChoice => ({ mode, carId: '', address: '', house: '', apartment: '' })

/** Single choice → ONE arm payload (used for pickup). Самовывоз → no address/car. */
export function tripChoiceToArm(t: TripChoice): { mode: ArmMode; address?: string; carId?: string } {
  if (t.mode === 'self') return { mode: 'self' }
  return { mode: 'trip', address: combineAddress(t.address, t.house, t.apartment, ''), carId: t.carId }
}

/**
 * Delivery (Выдача) arm — становится выездом ТОЛЬКО когда задана дата выдачи. Без даты выдачи
 * доставка не создаётся (бизнес-правило: заполненная дата выдачи — триггер создания доставки).
 * Самовывоз остаётся self при любой дате (tripChoiceToArm вернёт self).
 */
export function deliveryArm(
  t: TripChoice,
  deliveryAt: string | null | undefined,
): { mode: ArmMode; address?: string; carId?: string } {
  return deliveryAt ? tripChoiceToArm(t) : { mode: 'self' }
}

/** Inverse of combineAddress для нашего детерминированного формата (улица, д. X, кв. Y, эт. Z).
 *  Свободный текст (импорт) → всё в улицу (мягкая деградация). */
export function parseAddress(combined: string | null): { street: string; house: string; apartment: string } {
  let street = '', house = '', apartment = ''
  for (const raw of (combined ?? '').split(',')) {
    const p = raw.trim()
    if (!p) continue
    if (p.startsWith('д. ')) house = p.slice(3).trim()
    else if (p.startsWith('кв. ')) apartment = p.slice(4).trim()
    else if (p.startsWith('эт. ')) continue // этаж отдельным полем не редактируем
    else street = street ? `${street}, ${p}` : p
  }
  return { street, house, apartment }
}

/** Submit-ready when самовывоз; выезд needs BOTH a car and an address (адрес не теряется молча). */
export function isTripChoiceReady(t: TripChoice): boolean {
  if (t.mode === 'self') return true
  return !!t.carId && !!t.address.trim()
}

export type CarpetLine = {
  typeStrId: string; typeName: string; pricePerM2: number
  shapeFlt: string; dim1: number; dim2: number
}

/** Per-type carpet config kept as strings while editing (parsed to numbers on submit). */
export type CarpetCfg = { shapeFlt: string; dim1: string; dim2: string }

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

export function WarehouseField({ scladId, scladOutId, warehouses, onChangeIn, onChangeOut }: {
  scladId: string
  scladOutId: string
  warehouses: OrderFormData['warehouses']
  onChangeIn: (v: string) => void
  onChangeOut: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label htmlFor="order-sclad" className="mb-1 block text-xs text-muted-foreground">Склад приёма</Label>
        <select id="order-sclad" value={scladId} onChange={(e) => onChangeIn(e.target.value)} className={selectCls}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="order-sclad-out" className="mb-1 block text-xs text-muted-foreground">Склад выдачи</Label>
        <select id="order-sclad-out" value={scladOutId} onChange={(e) => onChangeOut(e.target.value)} className={selectCls}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
    </div>
  )
}

export type TripBlockProps = {
  choice: TripChoice
  onChange: (patch: Partial<TripChoice>) => void
  cars: OrderFormData['cars']
  carsLoading?: boolean // машины грузятся в фоне — селект показывает «Загрузка…», адрес/даты доступны сразу
  intakeDate: string; onIntake: (v: string) => void
  deliveryAt: string; onDelivery: (v: string) => void
}

/** Both trip dates (забор + выдача) with +N дн presets for выдача. Always shown (выезд or самовывоз). */
function TripDates({ intakeDate, onIntake, deliveryAt, onDelivery }: {
  intakeDate: string; onIntake: (v: string) => void; deliveryAt: string; onDelivery: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label htmlFor="order-intake" className="mb-1 block text-xs text-muted-foreground">Забор (дата/время)</Label>
        <Input id="order-intake" type="datetime-local" value={intakeDate} onChange={(e) => onIntake(e.target.value)} className="h-9" />
      </div>
      <div>
        <Label htmlFor="order-delivery" className="mb-1 block text-xs text-muted-foreground">Выдача (дата/время)</Label>
        <Input id="order-delivery" type="datetime-local" value={deliveryAt} onChange={(e) => onDelivery(e.target.value)} className="h-9" />
        <div className="mt-1 flex gap-1">
          {[3, 4, 5].map((d) => (
            <Button key={d} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
              onClick={() => onDelivery(almatyNowPlusDaysLocal(d))}>+{d} дн</Button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Unified выезд block: a Выезд/Самовывоз toggle (выезд по умолчанию — D-2026-06-18), and when выезд a
 * машина dropdown + address + apartment; both dates always show. Машина и адрес обязательны для выезда
 * (submit блокируется через isTripChoiceReady) — поэтому введённый адрес не пропадёт молча. No
 * Забор/Выдача split — обе ноги шлются на один адрес/машину, отличаются только датой.
 */
export function TripBlock(p: TripBlockProps) {
  const isTrip = p.choice.mode === 'trip'
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex gap-1">
        <Button type="button" size="sm" variant={isTrip ? 'default' : 'outline'} aria-pressed={isTrip}
          className="h-8 flex-1" onClick={() => p.onChange({ mode: 'trip' })}>Выезд</Button>
        <Button type="button" size="sm" variant={isTrip ? 'outline' : 'default'} aria-pressed={!isTrip}
          className="h-8 flex-1" onClick={() => p.onChange({ mode: 'self' })}>Самовывоз</Button>
      </div>
      {isTrip && (
        <>
          <div>
            <Label htmlFor="trip-car" className="mb-1 block text-xs text-muted-foreground">Машина</Label>
            <select id="trip-car" aria-label="Машина" value={p.choice.carId} disabled={p.carsLoading}
              onChange={(e) => p.onChange({ carId: e.target.value })} className={selectCls}>
              <option value="">{p.carsLoading ? 'Загрузка машин…' : 'Выберите машину…'}</option>
              {p.cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-[1fr_5rem_5rem] gap-2">
            <Input aria-label="Адрес выезда" placeholder="Улица" value={p.choice.address}
              onChange={(e) => p.onChange({ address: e.target.value })} className="h-9" />
            <Input aria-label="Дом" placeholder="Дом" value={p.choice.house}
              onChange={(e) => p.onChange({ house: e.target.value })} className="h-9" />
            <Input aria-label="Квартира" placeholder="Кв." value={p.choice.apartment}
              onChange={(e) => p.onChange({ apartment: e.target.value })} className="h-9" />
          </div>
        </>
      )}
      <TripDates intakeDate={p.intakeDate} onIntake={p.onIntake} deliveryAt={p.deliveryAt} onDelivery={p.onDelivery} />
    </div>
  )
}

export type UrgencyProps = { orderTimes: OrderFormData['orderTimes']; fastExecId: string; onUrgency: (v: string) => void }

export function UrgencySection(p: UrgencyProps) {
  if (p.orderTimes.length <= 1) return null
  return (
    <div>
      <Label htmlFor="order-urgency" className="mb-1 block text-xs text-muted-foreground">Срочность</Label>
      <select id="order-urgency" value={p.fastExecId} onChange={(e) => p.onUrgency(e.target.value)} className={selectCls}>
        {p.orderTimes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  )
}

export type DiscountProps = { value: string; onValue: (v: string) => void }

export function DiscountSection(p: DiscountProps) {
  return (
    <div>
      <Label htmlFor="order-discount" className="mb-1 block text-xs text-muted-foreground">Скидка, %</Label>
      <Input id="order-discount" type="number" min={0} max={100} placeholder="0" value={p.value}
        onChange={(e) => p.onValue(e.target.value)} className="h-9 w-28" />
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
          {result.tripIds.length > 0 && ` · выезд${result.tripIds.length > 1 ? 'ы' : ''} №${result.tripIds.join(', №')}`}
        </div>
      </div>
      <Button size="sm" onClick={onDone} className="w-full">Следующий клиент</Button>
    </div>
  )
}
