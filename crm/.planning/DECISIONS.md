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

## D-2026-06-17-unified-trip-block
Форма выезда упрощена по фидбэку владельца: забор и выдача используют один адрес/машину и отличаются
только датой → ОДИН блок вместо двух (TripArmSection×2 → TripBlock). UI: один dropdown «Машина /
самовывоз» (Самовывоз = без выезда, машина = выезд), один адрес+квартира (показывается только при
выезде), и обе даты (забор/выдача). Нет тумблера Самовывоз/Доставка и нет деления Забор/Выдача —
оба плеча order_trips строятся из одного выбора (`tripChoiceToArm`), адрес/машина одинаковы, даты разные.
Редактирование заказа использует тот же блок и тоже правит обе даты (persist через updateOrderTrips).
Цель — меньше кликов на оформление и редактирование. Модель данных order_trips (два плеча) НЕ менялась —
изменился только ввод. Дом/Этаж убраны (оставлены Адрес+Квартира). Срочность осталась отдельным полем.
Tz-фикс: даты для datetime-local конвертируются из UTC timestamptz в Almaty (`isoToAlmatyInput`), а не
сырым слайсом (слайс давал −5ч).
Rejected: оставить два независимых плеча с раздельным вводом адреса (D-2026-06-17-two-trip-arms) —
на практике адрес/машина совпадают, двойной ввод = лишние клики; выезд только на одно плечо больше
не выражается в UI (оба плеча идут вместе), это осознанное упрощение под реальный процесс.

## D-2026-06-17-broadcast-logs-shared-visibility
`broadcast_logs` SELECT RLS остаётся `using(true)` — менеджеры ВИДЯТ рассылки друг друга (намеренно,
не дыра). Причина: модель общего пула — менеджеры работают с общей базой клиентов, и каждый должен
видеть, что коллега уже писал клиенту, чтобы не дублировать касание. Решение владельца (2026-06-17)
в ответ на находку аудита (AUDIT-2026-06-17.md, помеченную как «cross-manager PII leak»): это by design.
INSERT остаётся скоупленным (`auth.uid() = manager_id`); меняется только трактовка SELECT-видимости.
Rejected: скоупить SELECT по manager_id/владению клиентом — отклонено владельцем, ломает анти-дубль
видимость в общем пуле.

## D-2026-06-17-agbis-push-idempotency
Пуш заказа в Agbis (`SaveOrderForAll`) сделан идемпотентным к ретраю/дрейну (фикс P1 #2,
AUDIT-2026-06-17.md): таймаут после коммита (10с abort клиента) больше НЕ приводит ко второму
реальному заказу. Механизм: перед повторным созданием, если в `agbis_api_log` есть предыдущая
попытка SaveOrderForAll по этому заказу, читаем день-окно по `contr_id`
(`findExistingOrderByContr` через `OrderByDateTimeForAll`) и при находке помечаем заказ synced с
найденным dor_id вместо создания дубля. Если read-back САМ упал — заказ остаётся pending (НЕ пушим
вслепую, иначе вернём дубль). dor_id + request/response/latency/реальный error_code пишутся в
`agbis_api_log` ДО markSynced — крах между Agbis-коммитом и записью в CRM восстановим. Outbox-дрейн
переписан на стейт-машину: `claim_agbis_outbox` (FOR UPDATE SKIP LOCKED, in_progress, attempts++) →
push → `settle_agbis_outbox` (success→done; fail→backoff+error или dead при attempts≥max). Дедуп
очереди: partial `UNIQUE(entity,crm_id,op) WHERE entity='order'` + upsert ignoreDuplicates → один
заказ в очереди максимум один раз (выезды сохраняют по строке на плечо).
Гарантия: ретрай/дрейн НЕ создаёт второй заказ Agbis. Остаточная гонка (документирована): два
ЛЕГИТИМНО разных заказа одного клиента в один день read-back различить не может — выбирает
последний (по max dor_id). Для повторных продаж химчистки приемлемо; альтернатива (дубль реального
заказа) строго хуже.
Rejected: (1) клиентский external/idempotency id в SaveOrder — Agbis его НЕ поддерживает (`doc_num` =
«контроль на разработчике», уникальность не гарантируется, дубль не отклоняется). (2) Read-back на
КАЖДОМ пуше (включая первый) — отклонён: на первом пуше дал бы ложные совпадения с несвязанными
заказами клиента того же дня; read-back только на ретрае (когда есть прошлая попытка в audit-логе).

## D-2026-06-18-order-trip-explicit-mode
Баг «адрес не сохраняется» в форме заказа: адрес выезда молча терялся. Корень — `TripChoice` выводил
режим из `carId` (`carId===''` = самовывоз), а дефолт был «Самовывоз»; поле адреса пряталось, пока не
выбрана машина, при этом адрес префиллился из карточки клиента. Менеджер видел/вводил адрес, оставлял
дефолтный «Самовывоз» → `tripChoiceToArm` возвращал `{mode:'self'}` и выбрасывал адрес; `order_trips`
(единственное место хранения адреса с 16.06) не создавался. Решение владельца (2026-06-18): адрес нужен
ТОЛЬКО для выезда, и ВЫЕЗД — по умолчанию. Фикс (без миграции БД, серверная zod-схема уже имела
`mode:self|trip`+superRefine): клиентский `TripChoice` получил ЯВНЫЙ `mode` (не из carId). `emptyTrip()`
дефолт = `mode:'trip'`. `TripBlock` — явный тумблер Выезд/Самовывоз (выезд активен по умолчанию), в
режиме выезда машина+адрес обязательны (`isTripChoiceReady`: trip → carId && address.trim()), submit
блокируется пока не выбраны → адрес НИКОГДА не теряется молча, и не назначается «молчаливый» фургон.
Самовывоз = осознанный клик, без адреса. Редактирование (`tripFromTrips`) отражает фактическое состояние
(есть order_trips → trip, нет → self), а не выезд-дефолт. Меняет: order-form-parts.tsx (TripChoice,
emptyTrip, tripChoiceToArm, isTripChoiceReady, TripBlock + TripDates), order-form.tsx (дефолт-коммент),
edit-trips.tsx (tripFromTrips). Тесты обновлены.
Заменяет часть D-2026-06-17-unified-trip-block: «один dropdown Машина/самовывоз» → явный тумблер +
отдельный выбор машины; «самовывоз по умолчанию» → выезд по умолчанию. Принцип unified (один адрес/машина
на обе ноги, забор/выдача отличаются датой) СОХРАНЁН.
Rejected: (1) авто-выбор первой машины как «выезд по умолчанию» — отклонён: молча назначает произвольный
фургон (новая тихая ошибка вместо потерянной). (2) Миграция (хранить адрес для самовывоза, order_trips
без машины / возродить orders.address) — не нужна: адрес осмыслен только для выезда (решение владельца).

## D-2026-06-18-reason-and-task-type-columns
Модель «звонок→задача», часть фильтр-причин (CALL-TASK-SYSTEM-SPEC §6/§8.8). Две денормализованные
колонки на `clients` + единый словарь причин. Решения владельца (2026-06-18): полный слайс + фильтр
«Все» (обе аналитические призмы причин).
- **next_action_type** (text CHECK callback|retry): тип запланированной задачи. Значение уже считал
  `computeNextAction` (с d9617b1), но в `clients` не писалось. Теперь `applyClientDisposition` пишет его
  рядом с `next_action_at` (всегда синхронно: оба set / оба null) → бейдж «Перезвон · сегодня 14:00» /
  «Недозвон · DD.MM» в строке очереди (`queue-client.tsx taskBadgeLabel`, Алматы-время).
- **last_call_reason** (text CHECK 9 канон. кодов): причина ПОСЛЕДНЕГО контакта (denormalized). Пишет
  `recordDisposition` через `deriveLastCallReason` на каждой диспозиции (overwrite incl. null = «последний
  контакт побеждает»). Отказ → код из decline_* sub_status; перезвон → опц. тег-причина. Свой-текст
  `decline_other` уходит ТОЛЬКО в `call_logs.reason` (audit), в `last_call_reason` → `'other'`.
- **Единый словарь причин** — `lib/call-status.ts`: `CALL_REASONS` (код→подпись),
  `CALLBACK_REASON_CODES` (5 для тега перезвона), `deriveLastCallReason`, `reasonLabel`. SSOT для
  CHECK-миграции, фильтра, движка, cockpit. Тест-гард: производные коды = ключи CALL_REASONS = CHECK.
- **Два фильтра причин** (владелец: «Все»): `decline_reason` (по ВСЕЙ истории отказов, embed
  call_logs.sub_status — оставлен как был) + `last_call_reason` (последний контакт, отказ ИЛИ перезвон,
  прямая колонка). Первый — «когда-либо называл X», второй — «сейчас почему не заказывает».
- Cockpit: фаза «Перезвон» получила опц. тег-причину (§8.3) — раньше причина перезвона не захватывалась
  вообще (мёртвый `CALLBACK_REASONS` удалён из disposition-build.ts). История/calls показывают `reasonLabel`.
Migration: 20260618000001_client_reason_and_action_type.sql (колонки+CHECK+индекс+view recreate из
20260612000011 +2 колонки + backfill). Применена на проде 2026-06-18 (backfill 0 строк — на проде всего
6 call_logs, ни один последний лог не declined; движок наполняет колонки вперёд).
Rejected: (1) embed-фильтр по call_logs.reason для «последней причины» вместо denormalized колонки —
колонку всё равно надо для бейджа next_action_type в view, last_call_reason дешево добавить туда же;
прямой `.in('last_call_reason')` проще и индексируется. (2) Заменить decline_reason единым фильтром —
владелец выбрал «Все»: разная семантика (историческая vs последняя) полезна обе. (3) Хранить причину
перезвона как русский текст — код канонический (фильтруемый, = last_call_reason), подпись через reasonLabel.

## D-2026-06-20-deal-visibility-all-employees
Вся информация по сделке клиента — история звонков (call_logs, vpbx_calls) и заказы (orders) —
видна КАЖДОМУ сотруднику, а не только создателю. Менеджеры работают по общей базе клиентов
(clients и так видны всем). RLS-политики для роли manager изменены с «только свои»
(manager_id = auth.uid()) на «все строки», role-based (role = 'manager') — новые менеджеры
покрываются автоматически, без перечисления id и правок кода.
Безопасность метрик: персональные показатели (motivation/*) фильтруют manager_id ЯВНО в
запросах, а не через RLS, поэтому расширение снимает только потолок видимости и не меняет
персональные цифры. Агрегаты команды/воронки читают все строки и так (admin / admin-клиент).
Migration: 20260620000001_deal_visibility_all_employees.sql (применена на проде 2026-06-20).
Rejected: (1) Подменять call_logs.manager_id, чтобы звонок «появился» у нужного менеджера —
это фальсификация: владелец записи = кто реально звонил (extension). (2) Оставить per-manager и
фильтровать видимость в коде — противоречит правилу «всё по сделке видно каждому». (3) Открыть
только call_logs — владелец выбрал полный охват сделки (звонки + заказы).

## D-2026-06-26-notification-center
Центр уведомлений (колокольчик в шапке), Фаза 1 — звонки. Best practice: тост/карточка
на «звонит сейчас» + персистентный инбокс (БД) на остальное. Колокольчик на БД-таблице
закрывает дыру realtime-only карточки входящего (пропуск пока менеджер не смотрел не теряется).
Решения владельца: видимость ПЕРСОНАЛЬНАЯ (свои клиенты + командные/неназначенные; админ — всё);
типы MVP = пропущенные + новые входящие в отсутствие + «пора перезвонить»; «Перезвонить» = звонок
(click-to-call), не WhatsApp.
Архитектура: таблица `notifications` хранит только call_inbound (нужна персистентность + read-state),
наполняется ТРИГГЕРОМ на vpbx_calls (а не кодом вебхука — чтобы не пропустить ни один путь записи);
coalescing «один непрочитанный тред на клиента» через partial-unique по dedup_key, event_count растёт
лишь на новый звонок. «Пора перезвонить» — derive-on-read из clients.next_action_at (без хранения/крона).
Migration: 20260626000001_notifications_calls.sql (на проде 2026-06-26, проверено вживую: триггер +
realtime + колокольчик).
Rejected: (1) DB-миграция REPLICA IDENTITY FULL для карточки входящего (диагноз прошлой сессии) —
ОШИБОЧНО: realtime пайплайн исправен (доказано 4 способами + live), карточка работает; фикс не нужен.
(2) Скрытый поллинг-fallback в карточке — заменён полноценным центром уведомлений (он И есть надёжная
подстраховка, и даёт историю/действия). (3) callback_due хранить в таблице + cron — derive-on-read проще,
всегда свежо, без внешнего планировщика. (4) Фанаут командных уведомлений по строке на менеджера —
recipient_id NULL + RLS проще для MVP (read-state командных общий — приемлемо для неизвестных номеров).
(5) WhatsApp-ответы клиента — Фаза 2: требует inbound-вебхук Wazzup (сейчас /inbox = iframe, входящие
не хранятся); с coalescing по клиенту против бёрста сообщений.

## D-2026-06-28-cancelled-excluded
Отменённые CRM-заказы (orders.cancelled_at IS NOT NULL) больше НЕ считаются выручкой и НЕ
показываются в списке /orders. Фикс в migration 20260628000002: (1) recalc_client_aggregates —
orders_agg исключает cancelled; (2) orders_unified (CRM-ветка) исключает cancelled; (3) дедуп
(в VIEW и в recalc) требует o.cancelled_at IS NULL — т.е. отменённый CRM-заказ больше НЕ подавляет
своё Agbis-зеркало (order_history), оно показывается/считается вместо «исчезновения» заказа (у
реальной отмены Agbis-сумма = 0 ZERO_TOVARS → зеркало даёт 0 → корректно). Карточка заказа читает
orders НАПРЯМУЮ (order-detail.ts), поэтому отменённый заказ полностью виден на своей странице — из
списка и агрегатов выпадает только. На проде 2026-06-28.
Rejected: (1) Хранить amount=0 на отмене и полагаться на это для total_spent — хрупко; правильнее
исключать по cancelled_at. (2) Исключать cancelled ТОЛЬКО из recalc (не из VIEW) — список и Σ totals
разъехались бы. (3) Жёстко удалять гхосты — запрещено для бизнес-данных; soft-cancel.

## D-2026-06-28-conservative-reconcile
read-sync авто-связывает «гхост» (CRM-заказ с agbis_order_id IS NULL, что не запушился) с его
Agbis-близнецом из order_history — но ТОЛЬКО при однозначном 1:1 совпадении по (клиент, календарная
дата). БЕЗ суммы: «нулевой ковёр» в CRM = 0, а в Агбисе = обмеренная >0, поэтому матч по сумме
ошибочно отверг бы реальный заказ. Если на (клиент, дата) >1 Agbis-заказ ИЛИ >1 гхост → AMBIGUOUS →
пропуск + лог (доказано нужным: Ренат 27.06 имел два заказа в один день). Fail-closed. При связывании
CRM-заказ берёт dor/doc/статус И сумму Агбиса (иначе recalc потерял бы деньги: дедуп выкидывает
зеркало, а CRM-строка осталась бы 0). lib/agbis/reconcile-ghosts.ts, вызывается из syncOrders.
Владелец одобрил «консервативно» 2026-06-28. Разовая чистка 4 застрявших: c04ad72b→100368,
58204559→100366 (связаны), 19451c03 (дубль) + 1ce25f51 (брошенный, фиктивная выручка 30001) —
отменены; Сауле total_spent 30001→0.
Rejected: (1) Матч по contr_id+дата+СУММА (как в раннем плане) — сумма расходится для ковров. (2)
Авто-связь при неоднозначности — риск ложного линка денег. (3) Только push-сторона (drain+guardRepush)
без read-sync линкера — не покрывает заказы, созданные менеджером вручную в Агбисе.

## D-2026-06-28-enqueue-first
createOrder ставит заказ в agbis_outbox СРАЗУ после create_order_with_items, ДО inline-пуша (а не
только при сбое пуша, как было). Раньше: если inline-пуш или весь server action умирал под
maxDuration=60 ДО enqueue — заказ оставался в orders без строки в очереди → вечный pending-призрак
(судьба 1ce25f51 'local'). Теперь заказ durable до любого пуша. Inline-пуш остаётся быстрым путём
для мгновенного № на стойке; при успехе outbox-строку дренаж позже снимает идемпотентно (заказ уже
с agbis_order_id → pushOrderToAgbis возвращает synced без вызова Агбиса). НЕ делаем «всегда
pending-№» полный async — он убил бы мгновенный № в 88% успешных случаев. Полный контекст пуша
(склады, дата приёма, дата выдачи, срочность, менеджер) ЗАМОРОЖЕН в payload очереди → дренаж
толкает идентично inline, а не дефолтами дня дренажа (OrderOutboxPayload).
Rejected: (1) «Всегда async pending-№» — деградация UX для общего случая. (2) Минимальный payload
(только склады) — дренаж терял бы дату/менеджера/срочность.

## D-2026-06-28-drain-piggyback
Дренаж очереди CRM→Agbis (drainPendingOrders/Trips) теперь вызывается ВНУТРИ read-sync increment
(/api/cron/agbis), который cron-job.org дёргает каждые ~10 мин — потому что выделенный
/api/cron/agbis-orders в vercel.json стоял DAILY (Hobby-лимит 04:00) → дренаж фактически не работал
(трип-строки висели 9ч до ручного триггера). Теперь восстановление ~10 мин без нового триггера.
Best-effort: сбой write-стороны НЕ роняет read-sync (catch). Vercel daily cron перенацелен с
agbis-orders на /api/cron/agbis?mode=increment&entity=all → даёт read-sync+дренажу суточный backup
(если cron-job.org умрёт — раз в сутки вместо никогда; два независимых триггера, §11). Vercel
автоматически шлёт Bearer CRON_SECRET. Полный анти-SPOF (свой ПК/Cloudflare как 2-й 10-мин триггер)
— остаётся owner-задачей Фазы H.
Rejected: (1) Добавить 3-й vercel cron для read-sync — Hobby лимит. (2) Только полагаться на
cron-job.org — SPOF (провал 16–23 июня).

## D-2026-06-28-idempotency
Создание заказа идемпотентно по ключу. Форма генерит idempotency_key (uuid) ОДИН раз при открытии
(useState lazy); повторный submit (ретрай после таймаута/ошибки) шлёт тот же ключ →
create_order_with_items возвращает ТОТ ЖЕ заказ, не создаёт дубль. Особенно важно после
enqueue-first: таймнутый createOrder ВСЁ РАВНО создал+поставил в очередь заказ, поэтому ретрай без
ключа дал бы дубль. migration 20260628000003: orders.idempotency_key (nullable) + ПАРТИАЛЬНЫЙ unique
index → две гонки с одним ключом не пройдут обе (проигравший ловит unique_violation и возвращает
заказ победителя). Check-first = быстрый путь, индекс+handler = гонка. Новый 8-й арг → старая 7-арг
перегрузка ДРОПНУТА (иначе PostgREST «could not choose best candidate»). На проде 2026-06-28.
Rejected: (1) Контент-окно дедуп (тот же клиент+позиции за N мин) — ложно склеил бы два ЛЕГИТИМНЫХ
одинаковых заказа клиента; ключ-на-открытие-формы такого риска не имеет. (2) Только client-side
disable кнопки — не спасает от ретрая после потерянного ответа.

## D-2026-06-28-agbis-user-map
CRM email → Agbis user_id (приёмщик/creater_id) больше НЕ хардкод (был map elena/samal в
managers.ts), а profiles.agbis_user_id — новый менеджер настраивается одним UPDATE, без деплоя.
Старый хардкод знал только elena/samal → admin@dara.clean (владелец, СОЗДАЁТ заказы) и новые
молча уходили под API-юзера Дарын=1022 (неверный «Приёмщик» в Агбисе; CRM manager_id всегда верен).
Agbis-id найдены сам (не спрашивал владельца): elena=1035, samal=1023 (живые заказы 16.06),
admin/Исламбек=1057 (живая Firebird-запись отмены, CANCEL-FEATURE-RND.md). manager1/manager2 —
новые (создан 27.06, заказов нет, Agbis-аккаунта скорее нет) → NULL = API-юзер (безопасный дефолт).
migration 20260628000004. managers.ts: resolveAgbisUserId(email) async читает profiles. push-order
await-ит; push-trip читает agbis_user_id прямо из профиля, что и так грузит (без лишнего запроса).
Rejected: (1) Дополнить хардкод-map (admin=1057) — всё равно хардкод, новые требуют деплоя.
(2) Контент-окно/манагер_id-резолв в orders read — email-резолв проще, один helper. Складские
warehouses (order-config.ts) оставлены хардкодом — стабильный набор, нет повода усложнять.
