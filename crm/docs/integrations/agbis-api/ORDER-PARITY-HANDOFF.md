# HANDOFF — Эпик «паритет создания заказа со стандартным заказом Агбиса»

> Вставь этот файл целиком как стартовый промт новой сессии. Он самодостаточен: не нужно
> заново аудировать. Цель — довести создание/редактирование заказов в CRM до уровня
> стандартного заказа Агбиса (поля, выезд/самовывоз, страница заказа, создание с /orders),
> двусторонняя синхронизация, под реальными менеджерами.

---

## 0. КОНТЕКСТ И ПРАВИЛА РАБОТЫ (прочитать первым)

- Проект: **Dara Clean CRM** (Next.js 16 App Router + Supabase + Vercel), химчистка ковров/мебели, Алматы.
- **Я веду WRITE-сторону заказов** (создание заказа в CRM → пуш в Агбис + двусторонняя синхронизация заказа). Импорт/чтение (клиенты, заказы, каталог) ведёт **другая параллельная сессия** на ветке `main`.
- **One Window Rule (ЖЁСТКО):** не трогать файлы импорт-сессии (см. §5). Работать в своём worktree, коммитить явными путями (`git add <paths>`, НИКОГДА `git add -A`), коммитить часто, по одному концерну.
- **Хуки enforce'ят (учесть СРАЗУ, иначе блок):**
  - TDD: для каждого `.ts`/`.tsx` в `lib/`/`app/` сначала пишется `*.test.ts`, потом реализация.
  - Запрещено: `as any`, `as unknown as T`, `@ts-ignore`, `!` non-null (`x!.y`), `enum`, `.catch(() => …)` (даже с error-state — используй `try/catch`), `.select('*')`, raw `err.message` в ответ клиенту (R1 → generic), магия/хардкод без named const.
  - Перед `Edit` файла — сначала `Read` его (read-before-edit guard).
  - Перед `git commit` — `git diff --staged` (diff-review guard) и пройденный build+test.
  - Деньги — integer (тенге), `Math.round`. Money из Агбиса "801,93" → integer.
  - Zod на вход server-actions (R2); 4 состояния у fetch-компонентов (loading/error/empty/success, R4).
- **Стиль:** русский в диалоге, код/комментарии — английский. Функция ≤30 строк, файл ≤300, вложенность ≤3.

---

## 1. ОКРУЖЕНИЕ, ДЕПЛОЙ, БД (всё проверено рабочим 2026-06-16)

- **Worktree (моя рабочая папка):** `D:/Mind map/crm-agbis-orders/crm` — ветка `agbis-orders`.
  - В нём уже есть `.env.local` (скопирован) и РЕАЛЬНЫЙ `node_modules` (сделан `npm ci`). ⚠ junction на node_modules ломает Turbopack — нужен реальный install.
  - Главный репозиторий: `D:/Mind map/Dara Clean` (монорепо; crm — подпапка; git-root = родитель).
- **Сборка/тесты (из worktree):** `npm run build` (Turbopack, ~40s на Vercel), `npx vitest run <files>`, `npx eslint <files>`.
- **Деплой на прод:** из worktree `vercel deploy --prod --yes` (CLI установлен, авторизован; `.vercel` скопирован в worktree). Прод-URL: **https://crm-roan-ten.vercel.app**.
- **⚠ Env на Vercel заданы только для Production.** `AGBIS_API_BASE/USER/PWD` уже добавлены в Vercel Production (2026-06-16). Если добавляешь новые секреты — добавляй в Vercel Production (`printf '%s' "$VAL" | vercel env add NAME production`), иначе рантайм упадёт (заказ уйдёт в pending — сетка безопасности отработает).
- **Supabase прод:** проект `otcktbyxaptxjnkxyili`. Миграции: `npm run db:migrate` (+ `:status`), типы: `npm run gen:types` (коммитить миграцию+типы вместе, в ОДНОМ коммите). `types/database.ts` — общий файл, трогать только в составе своей миграции.
- **Прямой запрос к прод-БД (для проверок), read-only пример:**
  ```bash
  cd "D:/Mind map/Dara Clean/crm" && node --env-file=.env.local -e '
  const { createClient } = require("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  (async()=>{ const {data}=await s.from("orders").select("id,agbis_order_id,sync_status,sync_error").order("created_at",{ascending:false}).limit(5); console.log(JSON.stringify(data,null,1)); })();'
  ```

---

## 1.1 ДОСТУПЫ И УЧЁТКИ (⚠ БЕЗ СЕКРЕТОВ В GIT — только где лежат)

- **НЕ писать пароли/ключи в этот файл (он в git).** Секреты живут в `crm/.env.local` (gitignored) и в Vercel → Project → Settings → Environment Variables (Production).
- **Имена секретов (значения — в .env.local / Vercel):** `AGBIS_API_BASE`, `AGBIS_API_USER`, `AGBIS_API_PWD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `NEXT_PUBLIC_DEEPGRAM_API_KEY`, `WAZZUP_API_KEY(_2)`, `BEELINE_VPBX_TOKEN/URL`. Скрипты берут их через `node --env-file=.env.local`.
- **Аккаунты приложения (Supabase Auth):** `admin@dara.clean` (роль admin), `elena@daraclean.kz` (менеджер, Agbis user_id 1035), `samal@daraclean.kz` (менеджер, Agbis 1023). **Паролей менеджеров у ассистента НЕТ** — для браузер-тестов под менеджером (Wave 8): пароль даёт владелец в рантайме (вводит в видимом браузере), либо менеджер тестирует сам, либо владелец временно задаёт пароль через Supabase Auth. Сервисный путь (без UI-логина): проверять `creater_id`/RLS напрямую скриптом (см. §2 recipe) или service-role запросом к БД.
- **Браузер для проверок:** chrome-devtools MCP; на проде может быть уже активна admin-сессия (как в этой сессии). Для логина под менеджером — пароль вводит человек.
- **Supabase Management (миграции):** `SUPABASE_ACCESS_TOKEN` в .env.local; `npm run db:migrate`.

## 2. AGBIS API — ПРОВЕРЕННЫЕ ФАКТЫ (доки местами врут — верить этому)

- База: `https://himinfo.org/cl/daraclean_838936e8/api`, юзер `Дарын` (user_id 1022). Креды в `AGBIS_API_*`.
- Авторизация: `GET ?Login={"User":"Дарын","Pwd":<SHA1(pwd)>,"AsUser":"1"}` → `Session_id` (живёт 10 мин, `RefreshSession` по `Refresh_id`). Уже реализовано в `lib/agbis/{client,session,config,helpers}.ts` (НЕ трогать — переиспользовать `getValidSession()` + `agbisCall()`).
- **Протокол:** весь JSON-параметр URL-кодируется РОВНО ОДИН РАЗ (`enc`); ответ — все строки URL-кодированы, декодировать рекурсивно (`decodeAll`); деньги "801,93" → integer (`money`). Хелперы в `lib/agbis/helpers.ts`.
- **Ключ ответа заказов = `orders` (мн.ч.), НЕ `order`** (док врёт). Массив услуг в заказе = **`Srvices`** (опечатка в API).
- **Единый прайс `price_list_id=0`** на 100% заказов. **`sclad_id == sclad_to`** всегда. `kind_id=0` химчистка (выездной=4, но в данных все 0). Статусы: 1 новый, 3 в исполнении, 4 исполненный, 5 выданный, 7 отменённый.
- **Каталог** (`PriceList price_id=0`) = 30 позиций, засеяны в `agbis_price_items`. Фикс-услуги (`tovar_type=2, is_price_editable=false, price>0`) — поддерживаем. **Ковёр** (`tov_id=100387`) — цена за м², `is_price_editable`, qty=площадь, цена/площадь задаётся через **addons** («Площадь» value_type 9 фигура `"2|2|3|"`, «Тип ковра» value_type 8) → ОТЛОЖЕНО (нужно моделирование аддонов + AddonTypes).
- **Склады (Cars/ReceptionCenters):** `1023 Машина 2` (дефолт), `1032 Машина 1`, `1033 Машина 3`, `1004 Машина 4`, `1 Сайрам 2`, `1022 Орманова 117а`. Машины = `car_id` для выезда.
- **Менеджеры → Agbis user_id (creater_id/приёмщик):** `elena@daraclean.kz=1035`, `samal@daraclean.kz=1023` (Дарын 1022 = API-юзер). Уже в `lib/agbis/managers.ts`.
- **Regions** = районы Алматы (для выезда `region_id`). `Cars` = машины выезда.
- **Поля стандартного заказа** (из живого заказа + скриншотов Агбиса): `doc_num` (№, напр. «02361-3»), `doc_date` (дата приёма), `date_out` (дата+время выдачи, `"dd.mm.yyyy HH:MM:SS"`), `date_out_fact`, `fast_execute` (срочность), `creater_id` (приёмщик), `Srvices[]` (tov_id/qty/kfx/price/discount/addons), `Tovars[]`, `payments[]`, комментарии.
- **Срочность:** `GetListsOrderTNDForAll` → `order_times` (нужна SessionID в query). Дефолт — «Не срочный» (fast_execute не слать).

### Команды записи (`05-commercial-session.md`, ТАРИФИЦИРУЮТСЯ):
- `ContragForAll` (POST `{ContragForAll:{name,fullname,teleph_cell,address?,contr_id?},SessionID}`) → `{error,contr_id,WasNew}`.
- `SaveOrderForAll` (POST `{SaveOrderForAll:{Order:{contr_id,sclad_id,sclad_out_id,price_id,status_id,doc_date?,date_out?,creater_id?,fast_exec?},Services:[{dos_id,tovar_id,count,discount?,addons:[]}],Products:[],Comments:[…]},SessionID}`) → `{error,dor_id,confirm_link}`. ⚠ В `Services` НЕТ поля цены — Агбис берёт цену из прайса по `tovar_id`.
- `UpdateOrderForAll` (нужен `Order.dor_id`) — редактирование заказа.
- `ChangeStatusOrdersForAll`, `PayForAll` (оплата, отдельная фаза).
- **Выезд:** `TripOrder` (GET) `{tp:"1"забрать/"2"доставить, date:"dd.mm.yyyy", hr:"11:00", hr_to:"12:00", car_id, address, region_id, tel, mp_status:"0", contr_id?, fio?, comment?, user_id?}` → `{error,TripID}`. Свободные слоты: `TripsHr`/`TripsHrTo` (no-session, по date+car_id). Самовывоз = БЕЗ TripOrder, заказ на склад-точку.

### ⚠ Идемпотентность/биллинг (B1):
timeout = unknown ≠ failed. Перед ретраем записи — reconcile (read-back по dor_id/маркеру). `SaveOrderForAll` авто-ретрай только через verify-before-send; `PayForAll` авто-ретрай ЗАПРЕЩЁН (→ pending-manual).

### Recipe «создать тестовый заказ напрямую в проде Агбисе» (для проверки):
```bash
cd "D:/Mind map/Dara Clean/crm" && node --env-file=.env.local -e '
const {createHash}=require("node:crypto");
const base=(process.env.AGBIS_API_BASE||"").trim().replace(/\/+$/,"");
const user=(process.env.AGBIS_API_USER||"").trim(),pw=(process.env.AGBIS_API_PWD||"").trim();
const pwd=/^[0-9a-f]{40}$/i.test(pw)?pw.toLowerCase():createHash("sha1").update(pw,"utf8").digest("hex");
const enc=p=>encodeURIComponent(JSON.stringify(p));
const dec=v=>{if(typeof v==="string"){try{return decodeURIComponent(v.replace(/\+/g," "));}catch{return v;}}if(Array.isArray(v))return v.map(dec);if(v&&typeof v==="object"){const o={};for(const[k,x]of Object.entries(v))o[k]=dec(x);return o;}return v;};
const ck=r=>{const c=Number(r.error??0);if(c)throw new Error("err"+c+" "+(r.Msg||""));return r;};
const get=async(c,p)=>{const r=await fetch(base+"/?"+c+(p?"="+enc(p):""));return ck(dec(await r.json()));};
const post=async(c,b,s)=>{const r=await fetch(base+"/?"+c,{method:"POST",headers:{"Content-type":"application/json; charset=UTF-8"},body:JSON.stringify({[c]:b,SessionID:s})});return ck(dec(await r.json()));};
(async()=>{const lg=await get("Login",{User:user,Pwd:pwd,AsUser:"1"});const sid=lg.Session_id;
  const so=await post("SaveOrderForAll",{Order:{contr_id:"10041",sclad_id:"1023",sclad_out_id:"1023",price_id:"0",status_id:"1",doc_date:"16.06.2026",creater_id:"1023"},Services:[{dos_id:"1",tovar_id:"102418",count:"1",addons:[]}],Products:[],Comments:["test"]},sid);
  console.log("dor_id",so.dor_id);})().catch(e=>console.log("FATAL",e.message));'
```
Read-back: `OrderByDateTimeForAll` (POST) `{StartDate:"16.06.2026 00:00",StopDate:"16.06.2026 23:59"}`, найти по `dor_id` (узкие окна; ≥2 недель/год → HTML 504).

---

## 3. ЧТО УЖЕ СДЕЛАНО (на проде, ветка `agbis-orders`)

- **Миграции 1+2 на проде:** `agbis_session/sync_state/outbox/api_log/price_items` (mig 1); `order_items`, agbis-зеркала на `clients`/`orders` (`agbis_order_id/doc_num/sclad_*/price_id/status_*/synced_at`, `sync_status`, `sync_error`), RPC **`create_order_with_items`** (атомарно: orders+order_items+`recalc_client_aggregates`) (mig 2). Колонки для write-стороны УЖЕ есть — новые миграции для §4 в основном НЕ нужны (кроме хранения `date_out`/выезда — см. ниже).
- **v1 создание заказа (фикс-услуги):** форма на каталоге → `createOrder` → RPC → синхронный `SaveOrderForAll`; сбой/незалинкованный клиент → `sync_status='pending'` + `agbis_outbox` (заказ не теряется). Файлы:
  - `lib/agbis/order-config.ts` — дефолты (PRICE_ID '0', NEW_STATUS 1, DEFAULT_SCLAD '1023', AGBIS_WAREHOUSES).
  - `lib/agbis/write-commands.ts` — `contragForAll`, `saveOrderForAll` (Zod, чистые `buildSaveOrderBody`/parsers; `SaveOrderInput` уже умеет `createrId`).
  - `lib/agbis/push-order.ts` — `pushOrderToAgbis(orderId,{scladId,managerEmail})`: грузит клиента/позиции, шлёт SaveOrder, пишет зеркала (admin client), outbox при сбое, `agbis_api_log`.
  - `lib/agbis/managers.ts` — email→agbis user_id (creater_id).
  - `app/(protected)/queue/order/catalog.ts` — `getOrderFormData()` (каталог фикс-услуг + склады).
  - `app/(protected)/queue/order/order-build.ts` — `CreateOrderSchema`(Zod), `computeAmount`, `buildOrderItems`.
  - `app/(protected)/queue/order/actions.ts` — `createOrder(rawInput)`.
  - `app/(protected)/queue/order-form.tsx` — текущая форма (выбор услуг/кол-во/склад/коммент; 4 состояния; «ковры — скоро»). Используется в `order/[clientId]/page.tsx` и `components/call-work-panel.tsx` (props: clientId, clientName, totalOrders?, onDone, onCancel — СОХРАНИТЬ интерфейс).
- **Wave 1 (приёмщик):** `SaveOrderForAll` шлёт `creater_id` = id менеджера. Проверено: заказ создаётся с правильным «Приёмщик» (Самал/Елена).
- Проверено браузером на проде (заказ № 000265) + напрямую (№ 000264/000266).

---

## 4. ЧТО ДОДЕЛАТЬ — ВОЛНЫ (делать по порядку, каждая = build+test+commit+deploy+verify)

### Wave 2 — Даты + срочность
- В форму: **дата приёма** (default сегодня), **дата+время выдачи** (`date_out`), селект **срочности** (`order_times` из `GetListsOrderTNDForAll`, default «Не срочный»).
- Прокинуть в `CreateOrderSchema` → `actions.createOrder` → `pushOrderToAgbis` → `saveOrderForAll` (`Order.date_out` формат `dd.mm.yyyy HH:MM:SS`, `Order.fast_exec`).
- БД: добавить локальные `orders.intake_date`, `orders.delivery_date` (timestamptz) — НУЖНА мини-миграция (RLS уже на orders; + `gen:types`, коммит вместе). Зеркало `agbis_*` уже есть.
- `getOrderFormData()` — добавить список срочности.

### Wave 3 — Выезд vs самовывоз (КОРРЕКТНОСТЬ, ядро жалобы)
- В форме переключатель: **самовывоз** (склад приёма = точка `Сайрам 2`/`Орманова`, без выезда) / **выезд** (Забрать/Доставить + адрес + район(`region_id`) + машина(`car_id`) + дата + окно времени).
- Выезд: после `SaveOrderForAll` (или до) — вызвать **`TripOrder`** (tp, date, hr, hr_to, car_id, address, region_id, tel, mp_status='0', contr_id). Свободные окна — `TripsHr`/`TripsHrTo` (показать слоты в форме). Хранить `TripID` локально (мини-миграция `orders.agbis_trip_id`, `delivery_type`, `delivery_address`, `region_id`).
- Новый файл `lib/agbis/trips.ts` (типизированные `tripsHr`, `tripsHrTo`, `tripOrder` + тесты). НЕ в `commands.ts` (он у импорт-сессии).
- Клиентский адрес: `clients.address` — переиспользовать как дефолт адреса выезда.

### Wave 4 — Номер Агбиса (doc_num) + read-back
- `SaveOrderForAll` возвращает только `dor_id` (НЕ doc_num). После пуша — лёгкий read-back (`OrderByDateTimeForAll` узкое окно сегодня, найти dor_id) → сохранить `orders.agbis_doc_num`, `agbis_status_*`, `date_out_fact`. Либо положиться на read-sync импорт-сессии (согласовать). Дедуп по `agbis_order_id` через обе таблицы (`orders` ∪ `order_history`), иначе двойной счёт в `recalc_client_aggregates`.

### Wave 5 — Ребилд формы (полноэкранный best-practice)
- `order-form.tsx` или новая страница-форма: двухколоночный layout на весь экран — слева каталог по группам с поиском/кол-вом, справа параметры (клиент, склад, выезд/самовывоз, даты, срочность, комментарий, итог, кнопка). Сохранить хоткеи/«Следующий клиент»/4 состояния. Дизайн-система проекта (Tailwind/shadcn, `components/ui/*`). При желании прогнать `/design-visual` для вариантов ДО кода.

### Wave 6 — Страница заказа `/orders/[id]` + ссылки (п.1 пользователя)
- Новая `app/(protected)/orders/[id]/page.tsx` — детальная карточка заказа (позиции, суммы, № Агбиса, даты, статус, приёмщик, выезд, оплаты-зеркало, кнопка редактирования → `UpdateOrderForAll`).
- В карточке клиента `app/(protected)/clients/[id]/...` — каждый заказ клиента кликабелен → `/orders/[id]`. Найти где рендерятся заказы клиента (grep по clients/[id]).
- В `/orders` строки → `/orders/[id]` (сейчас ведут на карточку клиента).

### Wave 7 — `/orders`: создание заказа + привязка клиента (п.4)
- Кнопка «Создать заказ» на `app/(protected)/orders/page.tsx`.
- Флоу создания с поиском/выбором клиента (если заходят не из карточки) — компонент поиска клиента (по имени/телефону), затем форма заказа.
- Фильтр услуг на `/orders` сейчас на СТАРЫХ категориях (`Ковры/Шторы/Мебель/Клининг`) — заменить на группы каталога; добавить колонки № Агбиса/даты выдачи/статус синка.

### Wave 8 — Тесты под Еленой и Самал (п.3)
- Нужны логины `elena@daraclean.kz` / `samal@daraclean.kz` (пароли у пользователя) ИЛИ пусть менеджеры сами создадут заказ. Проверить: заказ создаётся, приёмщик = менеджер, RLS (`manager_id=auth.uid()` в RPC), заказ виден менеджеру, выезд/даты корректны в Агбисе.

### Отложено (подтвердить у пользователя перед стартом)
- **Ковры** («Иранские, кв.м») — редактируемая цена/площадь через addons + `AddonTypes` (value_type 9 фигура). Большой кусок.
- **Оплаты** `PayForAll` + таблица `payments` (её нет). Отдельная фаза, авто-ретрай запрещён.
- **Outbox-ретрай cron** для pending-заказов (`app/api/cron/agbis` — у импорт-сессии; согласовать, чтобы дотолкать pending после линковки клиента).
- **Мердж `agbis-orders` → `main`** (сейчас прод = моя ветка; импорт-сессия на main). Согласовать слияние, потом `gen:types` при необходимости.
- Перенести `managers.ts` маппинг в БД (колонка `agbis_user_id` у менеджеров).

---

## 5. НЕ ТРОГАТЬ (файлы импорт-сессии, read-сторона, на `main`)
`lib/agbis/{client,session,config,helpers,commands,sync,windows,sync-clients,sync-orders,sync-types,run,match}.ts`, `app/(protected)/import/*`, `app/api/cron/agbis/*`, общие `types/database.ts`/`.planning/REGISTRY.md`/`sidebar`/lockfiles (только в составе своей миграции/задачи, коммит сразу). Свои новые команды — в ОТДЕЛЬНЫХ файлах (`write-commands.ts`, `trips.ts`), не в `commands.ts`.

---

## 5.1 КРИТИЧНЫЕ СКВОЗНЫЕ МОМЕНТЫ (легко забыть — учесть в каждой волне)

- **D1 — цена/скидка: Агбис авторитетен.** CRM НЕ считает скидку (старая тиражная 5/10/15% РЕТАЙРНУТА). `orders.amount = Σ(unitPrice×qty)`, `discount_percent/amount = 0`, `discount` — per-line в Агбис. Не возвращать CRM-скидку. `orders.services[]` (text-имена) оставлены для обратной совместимости (читатели: карточка клиента, фильтр /orders), но ИСТОЧНИК позиций — `order_items`.
- **Зависимость от линковки клиента.** Пуш заказа требует `clients.agbis_client_id`. Сейчас если клиента нет в Агбисе → заказ `pending` + outbox (не теряется), но в Агбис НЕ уходит. Для Wave 7 (создание с привязкой, в т.ч. НОВЫЙ клиент) нужен **`lib/agbis/push-client.ts` → `ensureClientInAgbis(clientId)`** (идемпотентно: есть `agbis_client_id` → ничего; иначе lookup по телефону `ContrInfo`/`ContragInfoForAll` чтобы не плодить дубли (B13/B14), затем `ContragForAll` create, записать `agbis_client_id`). Уже есть `contragForAll` в `write-commands.ts` — обвязку `ensureClientInAgbis` ещё НЕ написал.
- **Двусторонняя синхронизация статусов (Агбис→CRM).** Статус заказа двигает ЦЕХ в Агбисе — CRM держит **read-only зеркало** (`agbis_status_id/name`, `date_out_fact`, суммы, оплаты). Это тянет read-sync (импорт-сессия). **Инвариант дедупа:** заказы, созданные в CRM, живут ТОЛЬКО в `orders`; импорт/история — в `order_history`. Один dor_id не должен попасть в обе (иначе двойной счёт в `recalc_client_aggregates`). Согласовать с импорт-сессией, что её order-sync обновляет `agbis_*`-зеркало CRM-заказов по `dor_id` и НЕ дублирует их в `order_history`.
- **Роли/IDOR на write-actions (B16).** Каждый server-action создания/редактирования: проверка роли (admin/manager) + IDOR (перечтение цели RLS-scoped клиентом, не admin). RPC `create_order_with_items` уже пиннит `manager_id=auth.uid()`. `orders`/`order_items` НЕ имеют authenticated-UPDATE — зеркала пишет только service role (`createAdminClient`).
- **Тест-гочи (vitest):** моки `vi.mock` подняты выше импортов → спаи только через `vi.hoisted`. Zod `.uuid()` требует валидный UUID v4 в тестах. Тесты с `render()` → `// @vitest-environment jsdom` + jest-dom.
- **GSD-хук** в проекте просит вести правки через GSD-команды — можно обходить по прямому указанию пользователя (как в этой сессии).

## 5.2 LIVE-IMPACT (прод сейчас) — помнить
Прод (`crm-roan-ten.vercel.app`) сейчас крутит ветку `agbis-orders` (новая форма заказа выкатана ВСЕМ менеджерам): **нет ковров** (ядро бизнеса), заказы незалинкованных клиентов → `pending` без авто-ретрая (cron нет). Откат: `vercel rollback`. Это осознанное решение пользователя; при доработке не забыть про эти хвосты. См. также память: `agbis-orders-facts`, `order-write-v1-live`.

## 5.3 ОПЕРАЦИОННОЕ (ещё не забыть)

- **⚠ Перед КАЖДЫМ прод-деплоем — подтянуть `main`.** Прод деплоится из worktree (ветка `agbis-orders`). Импорт-сессия коммитит в `main`. Если просто задеплоить отставшую ветку — на проде ОТКАТится их закоммиченная работа. Перед `vercel deploy --prod`: `git fetch && git merge origin/main` (или rebase) в `agbis-orders`, прогнать build, потом деплой. На старте сессии — `git status` + `git log --oneline -5 main`.
- **Отображение заказов = `orders` ∪ `order_history`.** История заказов клиента импортируется в `order_history` (~5672 строк), CRM-созданные — в `orders`. Карточка клиента (п.1), страница заказа (Wave 6) и `/orders` (Wave 7) должны показывать ОБЕ таблицы (дедуп по `agbis_dor_id`/`agbis_order_id`). Иначе менеджер увидит только новые CRM-заказы, без истории. Решить единый view/тип заказа для UI.
- **Локальный запуск (если нужен без деплоя):** из worktree `npm run dev` (Next dev). Прод данные/Agbis через `.env.local`. Пользователь просил «именно прод» — для демо деплоить, но для разработки локально ок.
- **REGISTRY/память:** после новых сущностей/флоу — обновить `.planning/REGISTRY.md` (свои записи, коммит сразу) и память (`order-write-v1-live`). MEMORY.md грузится в начало сессии.

## 6. ЧИСТКА ТЕСТОВЫХ ДАННЫХ (когда скажет пользователь)
В Агбисе: контрагент «ТЕСТ CRM» `contr_id=10041`; заказы № 000264 (dor 100276), 000265 (100277), 000266 (100278); ручной 03990-3. В CRM: клиент `6c0a73dd-8623-444f-99b0-f5df8db12484`; локальный pending-заказ `8b938073-b30d-4cca-b205-4de741160f66` (создан до env-фикса, в Агбис не ушёл).

---

## 7. DEFINITION OF DONE (вся фича)
`npm run build` 0 ошибок; vitest зелёный; миграции применены + `gen:types`; заказ из CRM (через браузер, под реальным менеджером) появляется в Агбисе с верными: приёмщик, даты приёма/выдачи, срочность, выезд/самовывоз (TripOrder), № заказа (read-back), сумма/позиции; страница заказа открывается из карточки клиента и из `/orders`; `/orders` умеет создавать заказ с привязкой клиента; сетка безопасности (Агбис лёг → заказ не потерян); RLS/роли проверены; секреты в env; деплой + post-deploy verify (curl 200 + браузер-проверка изменённого).
