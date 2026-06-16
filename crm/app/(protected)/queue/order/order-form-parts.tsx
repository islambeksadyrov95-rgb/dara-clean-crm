'use client'

import type { CatalogService, OrderFormData } from '@/app/(protected)/queue/order/catalog'
import { fmtTenge } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * Presentational pieces of the order form (split out so order-form.tsx stays the state hub and
 * each file stays small). Pure helpers (groupServices/matchesSearch) live here too for reuse + test.
 */

export type DeliveryType = 'self' | 'pickup' | 'dropoff'
export type OrderResultData = { agbisStatus: 'synced' | 'pending'; dorId: string | null; amount: number; tripId: string | null }

export const DELIVERY_OPTIONS: readonly { id: DeliveryType; label: string }[] = [
  { id: 'self', label: 'Самовывоз' },
  { id: 'pickup', label: 'Выезд — забрать' },
  { id: 'dropoff', label: 'Выезд — доставить' },
]

export const selectCls = 'w-full h-9 rounded-md border border-input bg-background px-3 text-sm'

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
}

export function CatalogColumn({ grouped, qty, search, onSearch, onToggle, onQty }: CatalogColumnProps) {
  return (
    <div className="space-y-2">
      <Input placeholder="Поиск услуги..." value={search} onChange={(e) => onSearch(e.target.value)} className="h-9" />
      <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1 border rounded-md p-2">
        {grouped.length === 0 && <div className="text-muted-foreground text-sm py-4 text-center">Ничего не найдено</div>}
        {grouped.map(([group, items]) => (
          <div key={group}>
            <div className="text-xs text-muted-foreground mb-1">{group}</div>
            {items.map((s) => (
              <div key={s.tovarId} className="flex items-center gap-2 text-sm py-0.5">
                <Checkbox checked={(qty[s.tovarId] ?? 0) > 0} onCheckedChange={() => onToggle(s.tovarId)} />
                <span className="flex-1">{s.name}</span>
                <span className="text-muted-foreground text-xs">{fmtTenge(s.price)}</span>
                {(qty[s.tovarId] ?? 0) > 0 && (
                  <Input type="number" min={1} value={qty[s.tovarId]}
                    onChange={(e) => onQty(s.tovarId, Number(e.target.value))} className="w-16 h-7" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground">Ковры — скоро (нужен ввод площади и типа).</div>
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
  address: string; onAddress: (v: string) => void
  regionId: string; onRegion: (v: string) => void
  carId: string; onCar: (v: string) => void
  tripHr: string; onHr: (v: string) => void
  tripHrTo: string; onHrTo: (v: string) => void
  slots: string[]; endOptions: string[]
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
            <Label htmlFor="trip-address" className="mb-1 block text-xs text-muted-foreground">Адрес выезда</Label>
            <Input id="trip-address" value={p.address} onChange={(e) => p.onAddress(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Район" value={p.regionId} onChange={(e) => p.onRegion(e.target.value)} className={selectCls}>
              <option value="">Район…</option>
              {p.form.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select aria-label="Машина" value={p.carId} onChange={(e) => p.onCar(e.target.value)} className={selectCls}>
              <option value="">Машина…</option>
              {p.form.cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Время с" value={p.tripHr} onChange={(e) => p.onHr(e.target.value)} className={selectCls}>
              <option value="">С…</option>
              {p.slots.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Время по" value={p.tripHrTo} onChange={(e) => p.onHrTo(e.target.value)} className={selectCls}>
              <option value="">По…</option>
              {p.endOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
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
          <Label htmlFor="order-intake" className="mb-1 block text-xs text-muted-foreground">Дата приёма</Label>
          <Input id="order-intake" type="date" value={p.intakeDate} onChange={(e) => p.onIntake(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label htmlFor="order-delivery" className="mb-1 block text-xs text-muted-foreground">Выдача (дата/время)</Label>
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
