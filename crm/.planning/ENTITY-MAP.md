# Entity Map — Dara Clean CRM

> Обновлено: 2026-05-14. Обновлять после изменения сущностей (`/entity-map`).

## Архитектура данных

```
Excel (База Агбис.xlsx)
    ↓ Import (web form)
Supabase PostgreSQL
    ├── clients (21K+ записей)
    ├── orders
    ├── call_logs
    └── client_segments (view: RFM + days_since_last_order)
        ↓
Next.js App (Vercel)
    ├── Очередь звонков
    ├── Клиенты
    ├── Создание заказа
    └── WhatsApp генерация (OpenRouter API)
```

---

## Сущности

### Client
- **Таблица:** `clients`
- **Поля:** id (uuid), name, phone (unique), address, total_orders, total_spent, avg_order_value, last_order_date, locked_by (FK auth.users), locked_until, created_at, updated_at
- **Индексы:** phone, last_order_date, locked_by
- **Читает:** все страницы (clients list, queue, order, whatsapp, client detail)
- **Пишет:** import/actions.ts (upsert), queue/actions.ts (lock/unlock), queue/order/actions.ts (update aggregates)
- **RLS:** read — all authenticated; insert/update/delete — admin; lock updates — manager (own)

### Client Segments (view)
- **View:** `client_segments` (поверх `clients`)
- **Добавляет:** rfm_segment (Новый/Повторный/Постоянный/В риске/Потерянный), days_since_last_order
- **RFM логика:** total_orders (1=Новый, 2-3=Повторный, 4+=Постоянный) + last_order_date (>90д=В риске, >180д=Потерянный)
- **Читает:** clients list, queue page, whatsapp page, client detail
- **Read-only** — пишут в `clients`, view пересчитывается автоматически

### Order
- **Таблица:** `orders`
- **Поля:** id (uuid), client_id (FK clients), manager_id (FK auth.users), services (text[]), amount, discount_percent, discount_amount, comment, created_at
- **Индексы:** client_id, manager_id
- **Читает:** client detail page (история заказов), getDayStats()
- **Пишет:** queue/order/actions.ts → createOrder()
- **Скидки:** 5% (повторный), 10% (>30К), 15% (2+ услуги)
- **RLS:** select — admin all, manager own; insert — manager (auth.uid())

### CallLog
- **Таблица:** `call_logs`
- **Поля:** id (uuid), client_id (FK clients), manager_id (FK auth.users), status ('reached'/'not_reached'), created_at
- **Индексы:** client_id, manager_id, created_at
- **Читает:** client detail page (история звонков), getDayStats()
- **Пишет:** queue/actions.ts → recordDisposition()
- **RLS:** select — admin all, manager own; insert — manager (auth.uid())

---

## Операции с пересечениями

### Import: загрузка клиентов
**Трогает:** Client (upsert)
**Файлы:** `app/(protected)/import/page.tsx`, `app/(protected)/import/actions.ts`
**Логика:** Excel → parse → normalize phone (E.164) → batch upsert 500 rows → dedup by phone
**Риск:** повторный импорт может перезаписать обновлённые агрегаты (total_orders)

### Queue: звонок клиенту
**Трогает:** Client (lock/unlock), CallLog (insert), Client Segments (read)
**Файлы:** `app/(protected)/queue/page.tsx`, `app/(protected)/queue/actions.ts`
**Шаги:** фильтр по дням → позвонить (lock) → дозвонился/нет (disposition + unlock)
**Realtime:** подписка на clients.locked_by через Supabase Realtime
**Риск:** lock expiry 10 мин — если менеджер не завершил, клиент разблокируется

### Order: создание заказа
**Трогает:** Order (insert), Client (update aggregates)
**Файлы:** `app/(protected)/queue/order/[clientId]/page.tsx`, `app/(protected)/queue/order/actions.ts`
**Логика:** выбор услуг → авто-скидка → save order → update client (total_orders, total_spent, avg_order_value, last_order_date)
**Риск:** нет транзакции — order может создаться, а client aggregates не обновиться

### WhatsApp: генерация сообщения
**Трогает:** Client Segments (read), OpenRouter API (external)
**Файлы:** `app/(protected)/queue/whatsapp/[clientId]/page.tsx`, `app/(protected)/queue/whatsapp/actions.ts`
**Логика:** read client → OpenRouter (gemini-flash-1.5) → personalized message → wa.me deep link
**Fallback:** template без API если OpenRouter недоступен

---

## Хранилища данных

| Хранилище | Тип | Сущности | Доступ |
|-----------|-----|----------|--------|
| Supabase `clients` | Live DB | Client | App R/W (RLS) |
| Supabase `orders` | Live DB | Order | App R/W (RLS) |
| Supabase `call_logs` | Live DB | CallLog | App R/W (RLS) |
| Supabase `client_segments` | SQL View | Client + computed | App R |
| OpenRouter API | External | — | WhatsApp generation |
| Excel (База Агбис.xlsx) | File upload | Client source | Import page |

---

## Связи между сущностями

```
Client (1) ←→ (N) Order       — client_id FK
Client (1) ←→ (N) CallLog     — client_id FK
Order  (N) ←→ (1) auth.users  — manager_id FK
CallLog(N) ←→ (1) auth.users  — manager_id FK
Client (1) ←→ (1) auth.users  — locked_by FK (временная блокировка)
```
