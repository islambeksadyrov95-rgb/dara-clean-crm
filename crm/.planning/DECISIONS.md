# DECISIONS — Dara Clean CRM

> Append-only decision log. Immutable — never edit, only append.
> Referenced from REGISTRY.md entries. `[arch]` = architecture decision.

## D-2026-06-11-role-in-app-metadata
Authorization role moved from `user_metadata.role` to `app_metadata.role`. user_metadata is
self-writable by any authenticated user (`auth.updateUser({data:{role:'admin'}})`), which let a
manager self-promote to admin — bypassing both RLS (read user_metadata) and in-code checks. Fix:
role now lives in raw_app_meta_data (writable only by service role / Admin API). handle_new_user
trigger, all RLS policies, and `getUserRole` read from app_metadata. Deploy required coordinated
migration + code + global re-login (old JWTs lacked the claim).
Migration: 20260611000004_role_to_app_metadata.sql. Code: lib/auth/get-user-role.ts, team/actions.ts.
Rejected: keeping role in profiles only — RLS would need a per-row subquery (slow, and profiles.role
was itself sourced from the spoofable user_metadata).

## D-2026-06-12-money-as-whole-tenge
All monetary columns are `integer` whole tenge — NOT smallest-unit tiyn. Business deals in whole
tenge; sub-tenge precision is meaningless for this domain and tiyn conversion was explicitly out of
scope (EXECUTION-PLAN «Вне скоупа»). Pre-migration fractional values (10 clients + 1 order) were
round()'d; snapshot taken before migration. discount_percent stays numeric(5,2) (a percentage, not
money). Always Math.round() after money math.
Migration: 20260612000001_money_to_integer.sql.
Rejected: tiyn (×100 integer smallest-unit) — adds conversion complexity for zero business benefit.

## D-2026-06-15-agbis-tariff-packages
Тариф Агбиса подтверждён Леонидом Бурмакиным (2026-06-15): модель — ПРЕДОПЛАЧЕННЫЕ ПАКЕТЫ транзакций
(2 000→5 000 ₽ … 500 000→150 000 ₽; 2.5→0.3 ₽/транз), запись платная, чтение бесплатное и в лимит не входит.
Пакетная сетка авторитетнее «помесячного фикса 3000 ₽» из doc.minihim.ru (05.06.2026) — последнюю не применяем.
Монитор Агбиса показывает покрывающий пакет на объём платных (coveringPackage), а не flat «paid × 3 ₽».
Источник в коде: lib/integrations/agbis-tariff.ts. Доку: docs/integrations/agbis-api/06-tariffs.md.
Открыто: сгорает ли пакет по времени — у Леонида не уточнено.
Rejected: помесячный фикс 3000 ₽; flat 3 ₽/команда в оценке стоимости (не соответствует ни одному тиру).

## D-2026-06-15-integrations-monitoring [arch]
Admin-only monitoring section "Интеграции" (nested sidebar subsection under Админ): /settings/integrations
+ agbis/telephony/wazzup. Read-only server components; aggregates read via service role (lib/integrations/stats.ts)
because the log tables are deny-by-default RLS. Period today|month computed in Asia/Almaty (UTC+5).
Decisions inside:
- `wazzup_api_log` has NO `billed` column — Wazzup pricing is subscription-based, not per-action (unlike Agbis).
- Wazzup logs OUTBOUND only (message send + iframe open). No inbound logging — there is no Wazzup webhook;
  chats live inside the Wazzup iframe, so inbound messages never reach our server.
- Standalone /settings/telephony config link removed from sidebar and folded into the Интеграции subsection;
  config stays reachable via a "Настройки телефонии" button on the telephony monitoring page.
- Agbis cost shown as rough estimate (paid × 3 ₽, EST_RATE_PER_COMMAND) with a caveat — exact tariff TBD (06-tariffs.md).
- Stats fetchers throw on Supabase query error (pages render an error card) instead of silently showing zeros.
Known limitation: PERIOD_ROW_LIMIT=10000 caps per-period aggregation rows; fine for current volume (hundreds/mo),
revisit with exact count() queries if a period ever exceeds it.
Rejected: per-action billing for Wazzup; logging inbound (no webhook exists); separate config pages duplication.

## D-2026-06-11-deploy-cli-only [arch]
No git-based deploy integration. Production deploys happen only via CLI: `npx vercel deploy --prod`.
Database migrations are applied separately (`npm run db:migrate`, Supabase Management API) before/with
the deploy. There is no auto-deploy on push; "done" = manually deployed + verified.

## D-2026-06-11-call-recordings-private-bucket
The `call-recordings` Supabase Storage bucket is **private**, not public. Recordings are served via
short-lived (1 hour) signed URLs generated on demand (`queue/actions.ts:getClientCallHistory`).
Old recordings work too — the storage path is extracted from the previously-stored public URL.
Rejected: public bucket — call recordings are sensitive PII; permanent public URLs leak them.

## D-2026-06-11-microsip-local-recording-sync [arch]
MicroSIP saves call recordings as local MP3 files (Record call/ folder). These are synced to the
`call-recordings` bucket from the **browser** using the File System Access API (no server-side file
access). The sync daemon runs in the protected layout (recording-sync-daemon).
Rejected: in-browser audio mixing/recording — declined in favor of MicroSIP's native MP3 capture.

## D-2026-06-15-recordings-per-manager-folder [arch]
Local MicroSIP recordings upload to a per-manager folder: `call-recordings/local/<manager_uid>/<file>.mp3`
(`lib/recordings/sync-client.ts`, manager id from the browser session). The storage INSERT policy scopes
each manager to their own `local/<uid>/` folder; server-side uploads use the service role and bypass RLS.
Playback is unaffected — `recordingPath()` (queue/actions.ts) extracts everything after `/call-recordings/`,
so nested paths and old flat-prefix recordings both resolve.
Rejected: shared flat `local/<file>` prefix — keyed objects by filename only, so two managers with the
same filename collided and the second recording was silently dropped (upload "exists" → no attach).

Rollout uses EXPAND/CONTRACT so the policy is safe to apply in any order vs the front-end deploy (the
live flat-path client keeps working; tolerant of stale tabs):
- EXPAND (`20260615000001_recordings_per_manager_folder_policy.sql`, applied) — allows the new
  `local/<auth_uid>/<file>` path (owner-only) AND the legacy flat `local/<file>` path (transition).
- CONTRACT (apply manually once every browser runs the new build) — drop the legacy-flat branch:
  ```sql
  drop policy if exists "authenticated upload own call-recordings folder" on storage.objects;
  create policy "authenticated upload own call-recordings folder"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'call-recordings'
      and (storage.foldername(name))[1] = 'local'
      and (storage.foldername(name))[2] = auth.uid()::text
    );
  ```

## D-2026-06-16-order-form-carpets-in-catalog-trip-simplified
Форма создания заказа переработана по запросу руководителя:
1. **Отдельная страница** `/orders/new` вместо инлайн-блока на `/orders` (всплывающий блок был тесным/неудобным).
   Кнопка «Создать заказ» (`orders/create-order-button.tsx`) ведёт на роут; поиск клиента + `OrderForm` —
   в `orders/new/new-order-client.tsx`.
2. **Ковры — в общем списке услуг** (`order-form-parts.tsx` CatalogColumn → CarpetRows): каждый тип ковра —
   строка-чекбокс в группе «Ковры»; при выборе раскрываются «форма + размер1 + размер2», площадь/цена считаются.
   Один настроенный ковёр на тип (следствие модели «тип = строка»).
3. **Убраны «Район» и «Время с–до»** из формы выезда. Остаются адрес + машина.
   - `region_id` больше НЕ передаётся в Agbis `TripOrder` (`trips.ts buildTripOrderParams` — параметр опционален).
   - Окно выезда подставляется автоматически server-side (`order/actions.ts widestTripWindow`): самый широкий
     свободный слот дня (первый→последний из `TripsHr`). Нет слотов → выезд пропускается (заказ создаётся).
   - Схема (`order-build.ts`): для выезда обязательны только `deliveryAddress` + `carId`.
Rejected: ввод площади ковра напрямую в м² без формы — Agbis figure требует dim1|dim2|shapeFlt, прямой ввод
дал бы неточную фигуру в Agbis. Выбрана модель с формой+размерами (точная площадь и фигура).

## D-2026-06-17-two-trip-arms
Выезд заказа смоделирован как ДВА независимых плеча, а не один взаимоисключающий выбор: **Забор**
(pickup, Agbis tp=1) + **Выдача** (delivery, tp=2), каждое самовывоз|выезд, оба опциональны. Причина:
домен — заказ это одна сущность, инфу о заборе и выдаче кладут в разное время/разные сотрудники;
один тумблер self/pickup/dropoff этого не выражал.
- Хранение: дочерняя `order_trips` (1:N, UNIQUE(order_id,kind)) = источник правды по выездам. Старые
  одно-выездные колонки на `orders` ДРОПНУТЫ в той же миграции (`20260616000030`) с бэкфиллом — модель
  была временная, держать мёртвые колонки + зеркало хуже (решение пользователя: «дропнуть в этой же волне»).
- Надёжность: упавшее плечо → sync_status='failed' + agbis_outbox(entity='trip'), докручивает крон
  (решение пользователя: «outbox-ретрай», не «pending без ретрая» — иначе плечо зависало бы до В2).
- Редактирование (В2): разрешено ПОЛНОЕ — добавить/изменить/отменить плечо, в т.ч. уже синканутый выезд
  (решение пользователя: «полное редактирование»). Agbis `TripOrder` это умеет: опц. `id`+`mp_status`
  (0 новый / 2 отменён). Экшн `updateOrderTrips` — владелец/IDOR через RLS-scoped SELECT, запись service-role.
- В3 (синк Агбис→CRM) НЕ реализован: зона импорт/read-стрима (One Window Rule). Контракт передан:
  docs/integrations/agbis-api/WAVE3-DELIVERY-SYNC-CONTRACT.md.
Rejected: (1) «только добавление/ретрай» в В2 без отмены синканутых — отклонено пользователем в пользу
полного редактирования; (2) держать старые orders.delivery_* как зеркало — отклонено (дроп сразу, чище).
