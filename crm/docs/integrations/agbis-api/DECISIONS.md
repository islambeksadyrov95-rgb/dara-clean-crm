# DECISIONS — интеграция CRM ↔ Agbis (append-only)

## D-2026-06-15-agbis-bidirectional-sync
Полная двусторонняя синхронизация CRM ↔ Agbis. Agbis → CRM (импорт клиентов/заказов), CRM → Agbis (создание клиента/заказа).
Rejected: только чтение (пользователь хочет создавать заказы в CRM с отправкой в Агбис).

## D-2026-06-15-crm-source-of-truth
**CRM — источник правды.** При конфликте записи, существующей в обеих системах, CRM перетирает Агбис.
Уточнение после ревью (B9): «перетирание» определяется не по триггерному `updated_at` (он один и бьётся на любой апдейт), а по правилу поле×владелец: для клиента с `agbis_client_id` и `sync_status in (synced,pending)` CRM НЕ принимает входящие `name/phone/address`; `bonus/deposit/dolg/order_count` — всегда read-only зеркало из Агбиса.

## D-2026-06-15-sync-push-synchronous
Пуш CRM → Агбис — **синхронный** (менеджер ждёт `dor_id`), с сеткой безопасности: при 429/504 заказ остаётся в CRM (`sync_status='pending'`) + outbox-ретрай. Бюджет синхронного пуша < serverless-лимита (1 попытка + 1 reconcile-ретрай).
Rejected: чисто фоновый пуш (пользователь выбрал синхронный для наглядности).

## D-2026-06-15-orders-under-agbis
Заказы строятся на реальном прайсе Агбиса: форма тянет `PriceList`, менеджер выбирает позиции (`tovar_id`) с количеством; структурные позиции в `order_items`. Услуги — только из каталога Агбиса (не свободный текст).
Rejected: одна строка с нашей суммой; маппинг 4 хардкод-услуг.

## D-2026-06-15-pricing-agbis-authoritative [D1]
**Агбис авторитетен по цене и скидке.** Форма шлёт `tovar_id`+кол-во+`price_id`; сумму считает Агбис, CRM её зеркалит. Скидку менеджер может ввести — передаём как per-line `discount` в Агбис (считает один движок). Нашу тиражную `calculateDiscount` (5/10/15%) для Агбис-заказов отключаем. `orders.amount` хранит сумму, подтверждённую Агбисом.
Rejected: CRM считает финальную сумму и отключает ВДС Агбиса (риск расхождения с прайсом).

## D-2026-06-15-default-warehouse [#1]
Склад приёма/выдачи — **менеджер выбирает в форме** (дропдаун из `ReceptionCenters`, дефолт предвыбран). Прайс-лист один — `id=0 «Розничная»`, выбора нет.

## D-2026-06-15-arch-session-storage [arch]
Сессия/креды Агбиса — НЕ в `crm_settings` (там RLS `SELECT USING(true)` — читает любой менеджер). Отдельная таблица `agbis_session` с deny-by-default RLS (только service role). Креды — в env (`AGBIS_API_USER`/`AGBIS_API_PWD`), пароль только SHA-1.
Связано: у существующего VPBX-токена в `crm_settings` та же дыра — отдельная задача (проверить читателей `getVpbxConfig` до сужения политики, чтобы не сломать телефонию).

## D-2026-06-15-arch-idempotency-reconcile [arch]
У Агбиса нет `idempotency_key`. Защита от дублей платных записей: CRM-UUID заказа пишется в свободное поле Агбиса; перед ретраем записи — reconcile (read-back через `OrderByDateTimeForAll`/`lastChangeOrder`). `PayForAll` авто-ретрай запрещён (`pending-manual`).

## D-2026-06-15-arch-history-target [arch]
Исторические/Агбис-заказы импортируются в существующую `order_history` (`source='agbis_import'`, `import_batch_id`), НЕ в `orders`. `orders`+`order_items` — только заказы, созданные в CRM. Агрегаты — через существующий RPC `recalc_client_aggregates`, дедуп по `agbis_order_id`/`dor_id`.

## D-2026-06-15-arch-tariff-reads-free [arch]
Леонид Бурмакин (MiniHim) подтвердил: **читающие команды API Agbis — бесплатные; тарифицируются только записывающие** (`*ForAll`-записи + `TripOrder`: до 1000/мес 3000₽, далее 3₽/запрос). Следствие: вся read-сторона (импорт каталога / 565 клиентов / истории заказов, инкремент, cron) — БЕЗ cost-guard, гоняем свободно. Cost-guard и учёт `ExecutedApiCount` — только на write-стороне (Фаза 3-4). Снимает открытый вопрос №2.

## D-2026-06-16-api-doc-corrections [arch] ⚠ ДОКА API ВРЁТ — ПРОВЕРЕНО ВЖИВУЮ
Найдено при live-валидации импорта (Фаза 2). Доверять live-API, не доке `03-user-session.md`:
- **`OrderByDateTimeForAll` возвращает массив под ключом `orders` (мн.ч.), НЕ `order`** (как в доке). Чтение `res.order` давало пусто. Поля внутри (header + `Srvices[]`) — совпали с докой.
- Шапка заказа имеет И `status_id`, И `status` (равны) — берём `status_id`.
- **Кириллица в ответах URL-encoded UTF-8** → `decodeURIComponent` декодит верно (мохибейк бывает только от устаревшей сборки, не от кода).
- Заголовок ответа `Content-Type: application/json; charset=UTF-8`.

## D-2026-06-16-supabase-in-uuid-limit [arch]
Supabase/PostgREST `.in('col', uuid[])` (GET/DELETE — список идёт в URL) **падает при >~300 UUID** («fetch failed», URL слишком длинный). Лимит проверен: 300 ok, 400 падает. Для UUID-списков чанк = `ID_IN_CHUNK=200` (`lib/agbis/sync-orders.ts`). Короткие строки (phone/contr_id) — 500 ок. INSERT/UPSERT (тело POST) — не затронуты.

## D-2026-06-16-orders-full-mirror
Импорт заказов = **ENRICH, не wipe** (подтверждено 16.06). Agbis-заказы матчатся one-to-one к существующим `order_history` по (client + календарная дата), дополняются: `amount`(kredit), `agbis_dor_id/doc_num/user_name/status`, **`agbis_debet`(оплачено)/`agbis_dolg`(долг)/`agbis_date_out`(выдача)/`agbis_discount`** (миграция `20260616000001`), + позиции в `order_history_items` (услуги `Srvices` + товары `Tovars`, флаг `is_product`). Несматченные → INSERT. Идемпотентность по `agbis_dor_id` (partial unique); суммы не понижаем нулём (`enrichAmount` хранит положительную). Драйвер: `app/api/cron/agbis` (`backfill`/`increment`/`dry-run`, auth `CRON_SECRET`).
Результат прогона 16.06: 5980 клиентов слинковано/создано (0 дублей), `total_spent` ~7.3 млн → **~115.7 млн ₸**, 7014 заказов с полным зеркалом, товаров 0 (сервисный бизнес).
Rejected: wipe+reimport (затёр бы верные телефоны/даты Excel-импорта); хранить только сумму (теряли бы номер/услуги/«кто»).

## D-2026-06-16-excel-import-retired
Excel-импорт (`app/(protected)/import/`) **ретайрен**: `importClients` — серверный no-op guard + UI-баннер. `order_history` теперь единственно владеет Agbis-синхронизация (D2 — один владелец). `rollbackImport` оставлен, но щадит обогащённые строки (`agbis_dor_id IS NOT NULL`).
Rejected: оставить Excel-путь рабочим — его delete+reinsert затёр бы восстановленные суммы.
