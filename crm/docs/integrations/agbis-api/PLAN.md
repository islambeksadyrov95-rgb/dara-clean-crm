# План: двусторонняя синхронизация CRM ↔ Agbis

> Статус: ЧЕРНОВИК на утверждение. Код — после «ок».
> Решения пользователя (15.06.2026): (1) заказы полностью под Агбис — форма на реальном прайсе с `tovar_id`; (2) **CRM — источник правды** (при конфликте побеждает CRM); (3) пуш CRM→Агбис **синхронно** (менеджер ждёт `dor_id`).
> База CRM: Supabase `otcktbyxaptxjnkxyili`. API Агбис: `https://himinfo.org/cl/daraclean_838936e8/api/`, user `Дарын` (User_ID 1022).

---

## 1. Модель данных: как сводим CRM и Агбис

| Сущность | CRM сейчас | Агбис | Решение |
|---|---|---|---|
| Клиент | `clients` (ключ `phone`) | `contr_id`, `teleph_cell` | матч по телефону; добавить `agbis_client_id` |
| Заказ | `orders` (`services text[]` + `amount`) | `dor_id`, позиции с `tovar_id` | **перейти на структурные позиции**; добавить `agbis_order_id` |
| Услуга/товар | нет каталога | прайс-лист `tovar_id`/`price` | **завести кэш каталога** + `order_items` |

**Источник правды — CRM.** Агбис-данные подтягиваем (импорт + то, что создано напрямую в Агбисе), но при конфликте по записи, которая есть в обеих системах, **CRM перетирает Агбис** (push CRM→Agbis). Матч клиента — по нормализованному телефону.

---

## 2. Изменения схемы (миграции, db:migrate)

Каждая миграция: RLS в той же миграции, CHECK-констрейнты, индексы на FK, DEFAULT для NOT NULL, обратная (DOWN) миграция, затем `gen:types`.

### 2.1 `agbis_price_items` — кэш каталога Агбиса (новая таблица)
Зеркало `PriceList`/`PriceTree`. Поля: `id uuid pk`, `agbis_tovar_id text` (unique), `code`, `name`, `unit`, `price integer` (тенге, из строки с запятой → round), `tovar_type smallint` (1 товар/2 услуга), `group_name`, `top_parent`, `is_price_editable boolean`, `order_addon_pack_id`, `price_id text`, `is_active boolean`, `synced_at timestamptz`. Индексы: `tovar_id`, trgm на `name`. RLS: read всем аутентифицированным, write — service role.

### 2.2 `order_items` — структурные позиции заказа (новая таблица)
`id uuid pk`, `order_id uuid FK→orders ON DELETE CASCADE`, `agbis_tovar_id text`, `name text`, `qty integer`, `kfx numeric`, `unit_price integer` (тенге), `line_amount integer`, `discount_percent numeric(5,2)`, `addons jsonb`. Индекс на `order_id`. RLS как у orders.

### 2.3 `clients` — добавить
`agbis_client_id text` (nullable, unique), `agbis_synced_at timestamptz`, `sync_status text CHECK in ('local','synced','pending','error') default 'local'`, `sync_error text`. Индекс на `agbis_client_id`.

### 2.4 `orders` — добавить
`agbis_order_id text` (nullable, unique), `agbis_doc_num text`, `agbis_sclad_id text`, `agbis_sclad_out_id text`, `agbis_price_id text`, `agbis_status_id smallint`, `agbis_status_name text` (read-only зеркало статуса из Агбиса — статусы берём из Агбиса, не выдумываем), `agbis_synced_at timestamptz`, `sync_status text CHECK in ('local','synced','pending','error') default 'local'`, `sync_error text`. Индексы на `agbis_order_id`, `sync_status WHERE sync_status in ('pending','error')`.
> `orders.services text[]` оставляем для обратной совместимости (заполняем именами позиций), детализация — в `order_items`.

### 2.5 `agbis_sync_state` — курсоры инкремента (новая таблица)
`entity text pk` (`clients`/`orders`/`catalog`), `last_synced_at timestamptz`, `last_run_at`, `last_status`, `last_error`. RLS: service role.

### 2.6 `agbis_session` — хранение сессии (новая таблица или в `crm_settings`)
`session_id text`, `refresh_id text`, `user_id text`, `expires_at timestamptz`. Сессия живёт 10 мин → `RefreshSession`. Хранить в `crm_settings` (как vpbx) — одна строка.

### 2.7 `agbis_outbox` — очередь надёжности (синхронный пуш + сетка безопасности)
Даже при синхронном пуше, если Агбис недоступен (429/504) — заказ сохраняется в CRM (`sync_status='pending'`), запись попадает в outbox, ретрай-джоб дотолкает. `id`, `entity`, `crm_id`, `op` (create/update/status/pay), `payload jsonb`, `attempts`, `next_attempt_at`, `last_error`, `created_at`. Индекс на `next_attempt_at`.

---

## 3. Agbis API-клиент (`lib/agbis/`)

По образцу `lib/vpbx/client.ts`. Секреты из env: `AGBIS_API_BASE`, `AGBIS_API_USER`, `AGBIS_API_PWD` (хэшируем SHA-1 на сервере; в открытом виде не храним, не коммитим).

### `lib/agbis/client.ts`
- `login()` → `Login` (User кириллицей литералом в JSON; **весь параметр URL-кодируется один раз** — gotcha; Pwd=SHA1). Сохранить `session_id`/`refresh_id`/`expires_at`.
- `refreshSession()` → `RefreshSession` по `refresh_id`. `getSession()` — авто-рефреш если истекает.
- `get(command, params)` / `post(command, body)` — GET только из query string (POST для команд-данных не работает, кроме коммерческих `*ForAll` с телом `{"Cmd":{...}}`). Таймаут (AbortController), повтор при `429` с backoff+jitter, при `error:3` (сессия) → refresh+повтор.
- Хелперы: `enc(json)` (encodeURIComponent всей строки), `decodeAll(obj)` (URL-decode всех строк рекурсивно), `money(str)` (`"801,93"`→ integer тенге, Math.round), `parseDate`.
- `callbackUrl()` — для широких окон `*ByDateTimeForAll` (см. §6).

### `lib/agbis/commands.ts` — типизированные обёртки
Чтение: `priceList`, `priceTree`, `receptionCenters`, `regions`, `contrTree`, `contrInfoForAll`, `contragInfoForAll`, `clientsByDateTimeForAll`, `orderByDateTimeForAll`, `getListsOrderTNDForAll`, `lastChangeOrder`.
Запись: `contragForAll`, `saveOrderForAll`, `updateOrderForAll`, `changeStatusOrdersForAll`, `payForAll`.
Каждая команда — Zod-схема ответа, generic `Msg`-ошибки наружу (R1), без `as any` (R6).

---

## 4. Чтение Agbis → CRM (импорт + инкремент)

### 4.1 Каталог (первый шаг, без сессии)
Джоб `syncCatalog`: `PriceList` (+`PriceTree`, `ReceptionCenters`, `Regions`) → upsert в `agbis_price_items` по `agbis_tovar_id`. Расписание: раз в сутки (cron). Дефолтные `sclad_id`/`sclad_out_id`/`price_id` — в `crm_settings` (выбрать из ReceptionCenters/PriceLists, подтвердить с пользователем какой склад «по умолчанию»).

### 4.2 Клиенты (`ClientsByDateTimeForAll`, пользовательская сессия)
- **Первичный импорт:** окно по месяцам с `callback_address` (широкие окна → 504). Матч по телефону: если клиент с таким `phone` есть — проставить `agbis_client_id`, **CRM-поля не перетирать** (CRM главный); если нет — создать клиента (`sync_status='synced'`).
- **Инкремент:** `StartDate=last_synced_at`, upsert. Конфликт: CRM главный — обновляем в CRM только поля, которые локально не трогали (трекинг по `updated_at` vs `agbis update`).
- Маппинг: `name/fullname`, `teleph_cell→phone`, `address`, `bonus`/`deposit`/`dolg` (read-only зеркало), `order_count`.

### 4.3 Заказы (`OrderByDateTimeForAll`, пользовательская сессия)
- Узкие окна синхронно; широкие → `callback_address`.
- Создан напрямую в Агбисе (нет `agbis_order_id` в CRM) → импортировать в `orders`+`order_items`, привязать к клиенту по `contr_id→agbis_client_id`.
- Обновление статуса/сумм → обновить зеркало (`agbis_status_id/name`, суммы). CRM-исходные заказы (`sync_status='synced'`) — статус read-only из Агбиса.

---

## 5. Запись CRM → Agbis (синхронно, CRM главный)

### 5.1 Клиент: `createClient`/`updateClient` → `ContragForAll`
- В `app/(protected)/clients/actions.ts` после локального insert — синхронный вызов `ContragForAll` (name/fullname, teleph_cell, address, gender?, discount?). Ответ `contr_id` → `agbis_client_id`, `sync_status='synced'`.
- Идемпотентность: если `agbis_client_id` уже есть → `ContragForAll` с `contr_id` (update), иначе create. Дубли в Агбисе ловятся по `contr_id`.
- При сбое (429/504/таймаут): клиент сохранён локально, `sync_status='pending'`, запись в `agbis_outbox`.

### 5.2 Заказ: новая форма + `createOrder` → `SaveOrderForAll`
**Форма заказа (ребилд, decision 1):** `app/(protected)/queue/order-form.tsx` тянет `agbis_price_items` (кэш), менеджер выбирает реальные позиции (`tovar_id`) с количеством. Сумма считается по прайсу Агбиса (для `is_price_editable` — можно править). Выбор склада/прайса — дефолт из `crm_settings`.
> PRESERVE: сохранить старый поток как фолбэк/режим, не ломать существующие экраны очереди; перечислить все элементы формы и перенести в новую. Скидочная логика (`order/actions.ts:57-61`) — сохранить/согласовать с прайсом.

`createOrder` (`app/(protected)/queue/order/actions.ts`):
1. Локально: транзакция — `orders` + `order_items` (атомарно), пересчёт агрегатов клиента (как сейчас, `:82-109`), деньги integer + Math.round.
2. Гарантия: клиент уже в Агбисе (`agbis_client_id`); если нет — сначала `ContragForAll`.
3. Синхронно `SaveOrderForAll`: `Order{contr_id, sclad_id, sclad_out_id, price_id, status_id?}`, `Services[]` из `order_items` (`tovar_id`,`count`,`kfx`,`discount`,`addons`). Ответ `dor_id` → `agbis_order_id`, `agbis_doc_num`, `sync_status='synced'`.
4. **Сетка безопасности:** при сбое Агбиса заказ НЕ теряется — остаётся в CRM с `sync_status='pending'` + `agbis_outbox`; менеджеру показываем «заказ создан, отправка в Агбис в очереди». Идемпотентность: ретрай шлёт `SaveOrderForAll` только если `agbis_order_id IS NULL`.
5. Аудит: запись в лог (кто/когда/что отправлено/ответ).

### 5.3 Прочее
- Смена статуса заказа (если делаем в CRM) → `ChangeStatusOrdersForAll` (валидные статусы из Агбиса: 1/3/4/5/7).
- Оплата → `PayForAll` (тип 1 карта/2 касса/3 банк/4 бонус/5 депозит). ⚠ тариф.

---

## 6. Надёжность, джобы, инфраструктура

- **Сессия:** авто-логин/рефреш в API-клиенте; хранить в `crm_settings`. `error:3`→refresh.
- **Rate limit `429`:** backoff+jitter, очередь, не более N параллельных DB-команд.
- **Широкие окна `504`:** `callback_address` — новый эндпоинт `app/api/agbis/callback/route.ts` (shared secret в query, как vpbx webhook), принимает асинхронный результат `*ByDateTimeForAll`, апсертит. Узкие окна — синхронно.
- **Cron:** `app/api/cron/agbis/route.ts` (CRON_SECRET) — инкремент клиентов+заказов+каталога + разбор `agbis_outbox` (ретраи pending). Идемпотентность, структурный лог, алерт при N сбоях, без перекрытия запусков.
- **Outbox ретраи:** экспоненциальный backoff, dead-letter после M попыток.
- **Тарификация:** записывающие команды платные (до 1000/мес 3000₽, далее 3₽). Логировать счётчик (`ExecutedApiCount`), не пушить лишнего.
- **Безопасность:** секреты в env (не git), пароль только SHA-1; RLS на новых таблицах; проверка ролей (admin/manager) на write-actions; callback/cron — shared secret; IDOR — менеджер пушит только свои заказы.

---

## 7. Фазы (read → write, минимизируем риск)

- **Фаза 1 — Фундамент:** миграции (§2), `lib/agbis/` клиент+команды, хранение сессии, `Login`/refresh, юнит-тесты хелперов (money/encode/decode). DoD: `login()` отдаёт сессию, `priceList()` тянет каталог.
- **Фаза 2 — Чтение (импорт):** `syncCatalog`, `syncClients` (первичный импорт 565 + инкремент), `syncOrders`, callback-эндпоинт, cron. DoD: 565 клиентов и их заказы в CRM, инкремент работает.
- **Фаза 3 — Запись клиентов:** `ContragForAll` в createClient/updateClient + outbox + ретрай. DoD: новый клиент в CRM появляется в Агбисе.
- **Фаза 4 — Запись заказов (ребилд формы):** `agbis_price_items` UI, `order_items`, `SaveOrderForAll`, синхронный пуш + сетка безопасности. DoD: заказ из CRM падает в Агбис с `dor_id`, сумма/позиции совпадают.
- **Фаза 5 — Полировка:** статусы/оплаты, конфликт-резолюция CRM-главный по всем полям, мониторинг, алерты, тарифный учёт.

---

## 8. Открытые вопросы (уточнить до Фазы 2/4)
1. **Дефолтный склад приёма/выдачи** (`sclad_id`/`sclad_out_id`) и `price_id` для новых заказов — какой из 9 складов и какой прайс по умолчанию?
2. **Скидки:** оставляем нашу тиражную скидку (5/10/15%) или цены/скидки полностью из Агбиса (ВДС/ДС)? (decision «всё под Агбис» склоняет ко второму — подтвердить).
3. **Статус заказа в CRM:** добавляем read-only зеркало из Агбиса (предложено) — ок?
4. **Маппинг наших 4 услуг** на позиции прайса (если оставляем быстрые кнопки) — или менеджер всегда выбирает из полного прайса?

## 9. Definition of Done (вся фича)
`bun/npm build` 0 ошибок; миграции применены + `gen:types`; обе стороны: новый клиент/заказ в CRM → появляется в Агбисе с правильной суммой; 565 клиентов импортированы; инкремент по cron; сетка безопасности (Агбис лежит → заказ не потерян); RLS/роли проверены; секреты в env; REGISTRY обновлён (новые таблицы/флоу).

---

# v2 — ОБЯЗАТЕЛЬНЫЕ ПОПРАВКИ после адверсариального ревью (17 блокеров)

> Эти поправки **замещают** соответствующие пункты выше. Без них Фазу 1 не начинать.
> Решения пользователя (16.06): склад — менеджер выбирает в форме (дефолт предвыбран); прайс один (`id=0 Розничная`); цены/услуги из Агбиса; скидку можно завести и в CRM; статус-зеркало — да.

## Исправление неверных допущений (проверено по коду)
- **`order_history` существует** (мигр. `20260612000002`, `import_batch_id` для отката) — это владелец истории заказов. **Исторические/Агбис-заказы импортировать в `order_history`** (`source='agbis_import'`), НЕ в `orders`. `orders`+`order_items` — только для заказов, созданных в CRM. (B3, B12)
- **RPC `recalc_client_aggregates(uuid[])` существует** (мигр. `...000003`, считает из `order_history` ∪ live `orders`). Все sync-пути после батча зовут ЕГО — не изобретать агрегаты, не `+= amount`. Дедуп по `agbis_order_id`/`dor_id` через ОБЕ таблицы, иначе двойной счёт. (B2, B4)
- **Excel-импорт (`app/(protected)/import/actions.ts`) уже upsert-ит тех же клиентов по телефону и перетирает поля** — конфликт с «CRM не перетирать». Решить владение (см. развилку D1) и проставлять `agbis_client_id` в обоих путях. (B3)
- **`crm_settings` RLS = `USING(true)`** → сессию/креды Агбиса туда класть НЕЛЬЗЯ. (B6)
- Новые RLS role-проверки — только `(auth.jwt()->'app_metadata'->>'role')`, не `user_metadata` (иначе самопромоут в admin). (B16)

## Критические механизмы (вместо «прилагательных»)
- **B1 — дубли биллинга (SaveOrderForAll/ContragForAll/PayForAll).** «timeout = unknown, не failed». Записать CRM-UUID заказа в свободное поле Агбиса (комментарий/реф). Перед ЛЮБЫМ ретраем записи — **reconcile (read-back)**: прочитать `OrderByDateTimeForAll`/`lastChangeOrder` по маркеру; найден → присвоить `dor_id`, не создавать. Ретраи: чтения — свободно; записи — макс 1 ретрай после refresh и только через reconcile (`verify-before-send`). **`PayForAll` авто-ретрай ЗАПРЕЩЁН** → `pending-manual`, человек сверяет. Убрать «`agbis_order_id IS NULL`» как единственный гард.
- **B2 — локальной транзакции нет.** Создать RPC `create_order_with_items` (один транзакционный SECURITY DEFINER: `orders`+`order_items`+идемпотентный пересчёт агрегатов), возвращает `order_id`. `createOrder` → RPC → потом пуш (commit-then-push).
- **B5 — RLS `order_items`** через join к родителю: `USING (EXISTS (SELECT 1 FROM orders o WHERE o.id=order_items.order_id AND (role='admin' OR o.manager_id=auth.uid())))`, тот же `WITH CHECK`. Не «как orders».
- **B6 — сессия/секреты.** Отдельная таблица `agbis_session` с RLS `ENABLE` + НИ ОДНОЙ authenticated-политики (deny-by-default, только service role). Креды строго в env. Отдельной задачей закрыть ту же дыру у VPBX-токена.
- **B7 — гонка refresh сессии.** `pg_advisory_lock`/`FOR UPDATE` на строке сессии: рефрешит одна инвокация, остальные перечитывают свежую (single-flight + jitter).
- **B8 — cron/outbox.** (1) глобальный `pg_advisory_xact_lock` на тело cron; (2) per-row claim: `UPDATE ... SET claimed_at WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT N) RETURNING *`. Синхронный пуш и ретрай — на тот же per-order claim.
- **B9 — конфликт по полям, не по `updated_at`** (один триггерный `updated_at` непригоден). Правило: для клиента с `agbis_client_id` и `sync_status in (synced,pending)` CRM НЕ принимает входящие name/phone/address; `bonus/deposit/dolg/order_count` — всегда read-only зеркало. Таблицу «поле × владелец» — в DECISIONS.md.
- **B13 — дедуп телефонов.** Сильный ключ после линковки — `agbis_client_id`; телефон только для первичного матча. Пустой/невалидный/many-to-one → карантин в staging + ревью, не матчить по `''`, не сливать.
- **B14 — one-time бэкфилл 565.** Фаза 2 явно линкует все 565 по телефону (несматченные — в ревью) ДО включения инкремента; `last_synced_at` ставить только после. Excel-импорт тоже пишет `agbis_client_id`. Гард: не `ContragForAll`-create, если телефон уже в Агбисе → адаптировать `contr_id`.
- **B15 — зависимость client→order.** order-outbox-op неэлигибельна, пока `clients.agbis_client_id IS NOT NULL AND sync_status='synced'`. Claim исключает order-строки без synced-клиента. Перед create-контрагента на ретрае — lookup по телефону (`ContrInfo`/`ContragInfoForAll`), адаптировать `contr_id`.
- **B16 — деньго-трата под гардом.** Каждый write-action: проверка роли (admin/manager) + IDOR через перечтение цели RLS-scoped клиентом (не admin). `PayForAll` — admin-only (если бизнес не скажет иначе).
- **B17 — callback.** Version-guarded upsert: писать `agbis_*` зеркало только если `change_ts >= agbis_synced_at`; дедуп `(entity, agbis_id, change_ts)`; трогать ТОЛЬКО `agbis_*` колонки; auth — header/HMAC (не query), Zod всего тела (R2), replay-reject по времени, лимит тела.

## Добавить в §2 (схема)
- `agbis_api_log` (append-only аудит каждой write-попытки: op, entity_id, command, request/response jsonb БЕЗ паролей, http_status, error_code, dor_id/contr_id, billed, executed_api_count, latency_ms). Источник биллинг-сверки.
- `agbis_session` (deny-by-default RLS). `agbis_sync_state`/`agbis_outbox` — `ENABLE RLS` + 0 authenticated-политик. `agbis_price_items` — read `USING(true)`, write service-role.
- Cost-guard: дневной/месячный лимит write-команд по `ExecutedApiCount`, пауза у 1000/мес. Пуш-триггер — только при изменении Agbis-релевантных полей (НЕ `assigned_manager_id`/`segment`/`sticky_note`; `bulkAssign*` не пушат).
- Dead-letter: transient (429/504/error:3) → backoff; permanent (бизнес-`Msg`) → `sync_status='error'` + видимый индикатор на заказе, не ретраить.
- `order_items` — единственный источник позиций; `services[]` — триггер-проекция (перечислить читателей `services[]`: `getClientCardData`, скидка по `services.length`, `distinct_order_services`, FilterBar — blast-radius).
- money(str) parser + тест-матрица (`'801,93'`,`'12 800,50'`,`''`,`null`,…) → integer тенге или `null` (caller отклоняет). Синхронный пуш — бюджет < serverless-лимита (1 попытка + 1 reconcile-ретрай, <8-10s), иначе safety-net.

## 🔴 Бизнес-развилки — обязательная валидация ДО Фазы 4 (B10/B11/B3)
- **D1 (цена/скидка, CRITICAL):** один движок. Рекоменд. — **Агбис авторитетен**: форма шлёт `tovar_id`+qty+`price_id`, CRM зеркалит сумму Агбиса; нашу тиражную `calculateDiscount` (5/10/15) для Агбис-заказов ретайрим, скидку — как явный per-line `discount` в Агбис (твоё «скидку можно в CRM» = передаём её в Агбис, но считает один движок). Альтернатива — CRM считает и отключает ВДС Агбиса. Зафиксировать в DECISIONS.md: какое число в `orders.amount`, что пушим, скидка применяется один раз.
- **D2 (владелец данных):** ретайрим Excel-импорт ИЛИ направляем его через тот же upsert+recalc путь. Один владелец мастера клиентов и истории заказов.
- **D3 (легаси-услуги):** free-text заказы (Excel/история) — НЕ пушим (read-only история). «Unmapped service» в форме — hard validation error, не молчаливый skip.
- **D4 (оплаты):** `PayForAll` — отдельная фаза + таблица `payments` (её сейчас нет), не «полировка». Скоуп подтвердить.
- **D5 (удаления):** политика soft-delete/отмены (`ChangeStatusOrdersForAll` статус 7 vs `deleted_at`), согласовать с `ON DELETE CASCADE` и outbox.

## Прочее
- Cutover: засидить каталог + дефолты в `crm_settings` ДО включения новой формы (feature-flag, Level 2). Pre-existing `'local'` заказы НЕ пушить (скоуп по cutover-timestamp).
- REGISTRY устарел — добавить `order_history`, `recalc_client_aggregates`, `agbis_*` ДО Фазы 1.
- Тесты (vitest): `money/enc/decodeAll/parseDate` на реальных payload; idempotency; conflict-resolution. DoD фазы — `npm test` зелёный.
- PRESERVE order-form: keyboard 1-4+Enter, live discount-preview, autoFocus amount, «Следующий клиент», комментарий, валидация — чеклист non-regression.

## Вердикт ревью
Архитектурные инстинкты верны (outbox, refresh, callback, CRM-источник-правды), read-сторона ложится на vpbx/cron-паттерны. Но write/reliability-ядро (§5–§6) было спроектировано «прилагательными». После закрытия 17 блокеров (особо B1–B6) и фиксации D1–D5 — **Фаза 1 (миграции + клиент + хелперы + тесты) готова к старту**.

---

# Статус реализации Фазы 1

## Применено на бой (otcktbyxaptxjnkxyili)
- **Миграция 1** `20260615000001_agbis_infra` (commit 9e41b25): `agbis_session`, `agbis_sync_state`, `agbis_outbox`, `agbis_api_log`, `agbis_price_items` (deny-by-default RLS; каталог read-only).
- **Миграция 2** `20260615000002_agbis_orders_schema` (2026-06-15): `order_items` (RLS SELECT через parent-join, запись deny-by-default), agbis-зеркала на `clients`/`orders`, RPC `create_order_with_items` (атомарная транзакция, security definer, manager_id=auth.uid(), агрегаты через `recalc_client_aggregates`, скидку НЕ считает). gen:types + build зелёные. RPC создан, но НЕ вызывается (createOrder на него переводится в Фазе 4).

## Адверсариальное ревью Миграции 2 (2026-06-15) — две находки в Фазу 4 (НЕ в эту additive-миграцию)
- **HIGH — дедуп агрегатов.** `recalc_client_aggregates` суммирует `order_history ∪ orders` БЕЗ дедупа. Фаза 4/sync ОБЯЗАНА гарантировать: один и тот же заказ не попадает одновременно в обе таблицы для клиента (инвариант D-2026-06-15-arch-history-target — CRM-заказы только в `orders`, импорт/история только в `order_history`). Иначе двойной счёт `total_spent`.
- **MEDIUM — Zod на p_items.** Перед вызовом `create_order_with_items` форма ОБЯЗАНА валидировать `p_items` (qty>0 int, unit_price/line_amount ≥0 int, name непустой, discount_percent ≤ 999.99). Иначе кривой jsonb → сырые PG-коды наружу (нарушение R1/R2). Сам RPC при плохой строке откатывает всю транзакцию (заказ не создаётся) — это желаемое поведение, но ошибки надо ловить до RPC.
- LOW: привилегия вложенного `recalc` держится на владельце `postgres` (Management-API раннер) — задокументировано; при смене пути применения проверить EXECUTE.

## Долг createOrder (чинится при вязке RPC в Фазе 4)
`app/(protected)/queue/order/actions.ts` сейчас: не атомарен; `+= amount` (не идемпотентно, дрейф от recalc); raw-error наружу (:79, R1); `updateFields: any` (:94, R6). Перевод на `create_order_with_items` чинит всё это разом.

## Аудит данных 15.06.2026 (live-сверка Агбис ↔ CRM) — уточняет объём Фазы 2
Live-проход `ClientsByDateTimeForAll` (помесячно 2025-01…2026-06, чтение бесплатно):
- **Агбис: 6180** клиентов (с телефоном 5979, без — 178). **CRM: 4879** (все с телефоном).
- Матч по телефону (last-10): **4875 совпали** (→ линк, near-100%), **1104 только в Агбисе** (→ импорт, в осн. май–июнь 2026), **4 только в CRM** (→ ревью: ручные/тест).
- **🔴 Потеря денег при Excel-импорте:** `clients.total_spent=0` у **4265/4879 (87%)**; `order_history.amount=0` у **5037/5672 (89%)** строк (затронуто 4382 клиента). В Агбисе суммы есть (`pay_summ`): у **3835** матч-клиентов CRM=0 при Агбис>0 → восстановимо **~87.4 млн ₸**; шире (Агбис>CRM) — **4104** клиента, Δ **~92.7 млн ₸**. CRM показывает ~7.3 млн, реально ~100 млн.
- **Вывод для Фазы 2 (read/import) — три задачи, все бесплатные:**
  1. Линк 4875 CRM-клиентов по телефону (set `agbis_client_id`).
  2. Импорт 1104 «только в Агбисе».
  3. **Восстановление сумм:** переимпорт истории заказов из Агбиса с реальным `kredit` (`OrderByDateTimeForAll`) → перезаписать `order_history.amount` → `recalc_client_aggregates`. Это главная ценность: вернуть ~93 млн ₸ корректных сумм (нужно для аналитики/сегментов/мотивации).
  - 178 без телефона + 4 CRM-only → карантин/ревью (B13). Тест-карточки (id 1022/10013/10014) отфильтровать.
