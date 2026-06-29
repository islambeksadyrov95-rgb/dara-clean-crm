# Промт для новой сессии — синк выездов Агбис→CRM (+ хвосты)

> Сессия 2026-06-29. Этот файл — точка входа. Прочитай память `[[project_orders_display_and_readback]]`
> (в `~/.claude/projects/D--Mind-map-Dara-Clean/memory/`) и `.planning/STATE.md`.

## 0. Окружение (на новом ПК сделать ПЕРВЫМ)
- Репо: `D:\Mind map\Dara Clean\crm` (ветка `main`). `git log --oneline -12` — контекст.
- `.env.local` нужен (есть `SUPABASE_ACCESS_TOKEN` для миграций). Если нет — взять с рабочего ПК.
- **Vercel CLI**: `vercel whoami` → должен быть `mi6ka123`. Если нет — `vercel login`.
- Прод-алиас: **`https://crm-roan-ten.vercel.app`** (чистый, без Deployment Protection).
  НЕ использовать `crm-mi6ka123s-projects.vercel.app` (за защитой деплоя).
- Supabase project ref: `otcktbyxaptxjnkxyili`. SQL/миграции: `npm run db:migrate` (Management API,
  токен из `.env.local`), типы: `npm run gen:types`. Деплой: `vercel deploy --prod`.
- Произвольный read-SQL: `node` + fetch на `https://api.supabase.com/v1/projects/<ref>/database/query`
  с `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` (см. как делалось в этой сессии).
- Cron: cron-job.org «Agbis -> CRM sync», каждую **1 мин**, URL
  `crm-roan-ten.vercel.app/api/cron/agbis?mode=increment&entity=all`, заголовок
  `Authorization: Bearer <CRON_SECRET>` (CRON_SECRET в Vercel env: `vercel env pull <file> --environment=production`).

## 1. ГЛАВНАЯ задача — импорт выездов (выезды/переносы/адреса) Агбис→CRM
**Проблема:** read-sync тянет из Агбиса только ШАПКУ заказа (`OrderByDateTimeForAll`) в `order_history`.
Выезды (`order_trips`) в CRM — ТОЛЬКО созданные самим CRM. Всё, что заводят/переносят/отменяют по
выездам в Агбисе — в CRM не приходит. Адрес выезда тоже не тянется (сейчас костыль: показываем адрес
клиента, коммит `0fa957b`).

**Блокер (важно):** в Agbis API НЕТ команды «список выездов заказа». `lib/agbis/trips.ts` умеет только
создавать выезд (`TripOrder`) и читать свободные слоты (`TripsHr`). Выезды читаются ТОЛЬКО из Firebird
напрямую — этим занимается **binding-агент** (`binding/agent.py`, Python, на админ-машине).

**Единственный путь:** расширить binding-агент — читать выезды из Firebird и пушить в CRM `order_trips`
(поля: `kind` pickup/delivery, `agbis_trip_id`, `trip_date`, `address`, статус выезда, перенос/отмена,
`agbis_car_id`). Связь выезд↔заказ в Firebird через junction (агент это уже умеет для CRM→Agbis).
Схема `order_trips`: id, order_id, kind, address, agbis_car_id, agbis_trip_id, window_from/to, trip_date,
sync_status, sync_error, comment, bound_at, junction_id. Статусы выезда Агбиса: 0 Новый, 2 Отменён
(`MP_STATUS_CANCELLED`), см. `lib/agbis/trips.ts`. Для UI: `orders_unified.has_trip`/`trip_date` и колонка
«Выезд» в `app/(protected)/orders/orders-client.tsx`.
→ Это работа НА АГЕНТЕ (Firebird-доступ), не в Next.js. Начать с того, что агент-демон запущен и пишет в CRM.

## 2. Хвост — непривязанные заказы (счёт CRM < Агбис)
read-sync даёт `unlinked: ~19` за окно — заказы, чьих клиентов нет в CRM (или телефон не сматчился) →
не импортируются. Отсюда «25 в Агбисе, 20 в CRM». Нужна линковка/импорт этих клиентов. См.
`lib/agbis/sync-clients.ts` (matching по телефону) и `loadClientByContrId` в `sync-orders.ts`.

## 3. Опционально (UX) — одиночная дата как в Агбисе
Сейчас фильтр даты — диапазон «Дата с / Дата по» (`orders-query.ts` dateType + DATE_TYPE_COLUMN). Юзер
путается: «Дата с 29.06» без «по» = всё ≥29.06 (Асан с приёмом 04.07 всплывает). Хочет одно поле = один
день. Решение: заменить два инпута на один + внутри ставить from==to. Файлы: `orders-client.tsx`,
`orders-query.ts`. Спросить юзера — он сам решит, делать ли (теряется диапазон для отчётов).

## 4. Внешнее (не код) — Wazzup
Все WhatsApp-каналы в кабинете Wazzup `blocked`/`qridle` → рассылки и кнопка WhatsApp МОЛЧАТ.
Нужно: пересканировать QR одного номера в кабинете Wazzup → станет `active`. Диагностика:
`GET https://api.wazzup24.com/v3/channels` с `Authorization: Bearer <WAZZUP_API_KEY/_2>` (ищем
`transport=whatsapp` + `state=active`). Код CRM исправен (`lib/wazzup/send.ts` — динамический выбор канала).

## 5. Что уже сделано в этой сессии (на проде, main)
- `b59a7fb` cron-резилиенс: per-entity try/catch, `agbis_sync_state.last_error`, разовый сбой→200,
  повторный→500 (нет ложных писем). Курсор не двигается при ошибке.
- `3570821` orders_unified: отменённые видны с реальным статусом + дедуп истории не зависит от cancelled.
- `3570821`/`20260629000003` даты по Алматы (`AT TIME ZONE`), было UTC-обрезание.
- `4be58a3` отменённые скрыты по умолчанию + галка «Отменённые» (`?cancelled=1`, RPC `p_include_cancelled`).
- `39cff51` темп рассылки ~1/мин зашит в код (`lib/broadcasts/drain.ts` rateBudget по `claimed_at`).
- `3095c3a` read-back ВЫДАЧИ из Агбиса в `orders.delivery_date`.
- `380a5d1` read-back СТАТУСА из Агбиса в `orders` (+ `cancelled_at`) — `syncCrmOrdersFromAgbis` в
  `sync-orders.ts`. Применяется на каждом read-sync; для старых — `?mode=backfill&entity=orders&start=...`.
- `7a22746` фильтр «Дата: приём/выдача/выезд» (`?dt=`, колонка `trip_date` в view, RPC `p_date_type`).
- `0fa957b` адрес из карточки клиента для Агбис-заказов (костыль до реального адреса выезда).
- Удалены тест-клиенты `API TEST *` из CRM (в Агбисе остались — можно почистить в десктопе).

## 6. Ключевые факты (чтобы не копать заново)
- read-sync пишет в `order_history` (зеркало). `orders` обновляет ТОЛЬКО `syncCrmOrdersFromAgbis`
  (статус/выдача/cancelled_at для CRM-заказов). У `orders` НЕТ триггеров → апдейт не зацикливает пуш.
- `orders_unified` = `orders`(CRM) ∪ `order_history`(зеркало, дедуп по `agbis_order_id`), security_invoker.
- Статусы заказа Агбиса: 1 Новый, 6 Закрытый, 7 Отменённый.
- «Накладные в пути» в Агбисе = подмножество (активные выезды), НЕ все заказы — не сравнивать с CRM «Заказы».
- Хуки в этой среде: перед коммитом нужен реальный `git diff --staged` (без `--no-pager`) и build/test;
  UI-файлы требуют browser-verify (Chrome MCP) перед коммитом.
