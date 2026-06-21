# Промт для свежей сессии: суммаризация + привязка выездов + очистка тест-данных

> Самодостаточный. Продолжение работы от 2026-06-21 (после прод-QA потока заказов CRM→Агбис).
> Сначала прочитай память: `project_order_flow_fixes`, `project_agbis_trip_binding`, `project_microsip_recording`.
> Все три задачи делать **ВМЕСТЕ**. Рекомендованный порядок: 1 (быстро) → 2 (большое) → 3 (последним, тест-данные нужны для проверки агента).

## КОНТЕКСТ (доказано, не переоткрывать)
- Проект: Dara Clean CRM, `D:\Mind map\Dara Clean\crm`, Next.js (App Router) + Supabase + Vercel.
- Прод: `https://crm-roan-ten.vercel.app`. Supabase: `otcktbyxaptxjnkxyili`. Деплой: `vercel deploy --prod --yes` (CLI 51.x стоит). Git push НЕ авто-деплоит.
- Миграции: `npm run db:migrate` (+ `:status`, `npm run gen:types`). Коммить миграцию+типы вместе.
- Агбис **REST**: креды в `.env.local` (AGBIS_API_BASE/USER/PWD). Login(SHA-1 пароля, AsUser=1)→Session_id. Кириллица: Python `json.dumps(..., ensure_ascii=False)` ОБЯЗАТЕЛЬНО (иначе пусто); JS норм.
- Агбис **Firebird** (локально, read concurrent-safe): `C:\fb64client\fbclient.dll`, БД `127.0.0.1/3050:C:/Agbis/DB/ARM_7.FDB`, SYSDBA, пароль в `C:\Agbis\LicensingService.ini` `[Firebird] Password=`.
- Менеджеры: **Самал**=`samal@daraclean.kz` (приёмщик Agbis 1023), **Елена**=`elena@daraclean.kz` (1035). Паролей в открытом виде НЕТ. Браузер-сессию менеджера минтить **недеструктивно**: admin `generateLink({type:'magiclink'})` → `verifyOtp` через `@supabase/ssr` `createServerClient` с cookie-jar → вживить cookie `sb-otcktbyxaptxjnkxyili-auth-token` через `document.cookie` → reload. Пароль НЕ менять. Админ (`admin@dara.clean`, role=admin) видит всё.
- Тест-заказы на проде (созданы в прошлой сессии, нулевой ковёр 0₸, склад Машина 3=Машина 3 id 1033):
  - dor **100350** Роза +77052122211 (№000338), выезды 100348/100349
  - dor **100351** «ТЕСТ Самал Новый» +77000002121 (№000339, contr 10051), выезды 100350/100351
  - dor **100352** Айгуль +77017709165 (№000340), выезды 100352/100353
  - dor **100353** «ТЕСТ Елена Новая» +77000002222 (№000341, contr 10052), выезды 100354/100355
  - Junction-строки, вставленные вручную (привязка выездов): MOBILE_PLAN_ORDERS.ID **1039358–1039365** (депо-3).
- Ковёр-товар Агбиса: `100387` («Ковёр (без оценки)»), в `order_items.agbis_tovar_id`.
- VIEW списка заказов: `orders_unified` (security_invoker) + helper `order_list_brief(client_id, manager_id, order_id)` (security definer — отдаёт client_name/phone, manager_name=приёмщик, addr=адрес выезда, has_trip). Запрос: `app/(protected)/orders/orders-query.ts`; UI: `orders-client.tsx`. Колонка «Выезд» уже есть.
- Грабли среды: hook **emoji-guard** блокирует эмодзи/символы-галочки в коде (используй CSS-точки/текст). Hook **ui-verify-guard** блокирует коммит UI-файла без браузер-проверки → деплой рабочего дерева (`vercel deploy` берёт cwd) → скриншот прода → потом коммит. Кодировка консоли Windows: `PYTHONIOENCODING=utf-8`.

---

## ЗАДАЧА 1 — Суммаризация по дате (Σ сумма + Σ кол-во ковров)
Под таблицей `/orders` показать итоги по **текущему фильтру/диапазону дат**: суммарная сумма и **суммарное кол-во ковров** в оформленных заказах (по всем строкам фильтра, не только странице).
- Кол-во ковров заказа: для CRM-заказа = число `order_items` с `agbis_tovar_id='100387'` ИЛИ это ковёр (kfx/addons); для истории — best-effort парс `service` (текст «Ковер»). Добавь `carpet_count` в `order_list_brief` (CRM) + в VIEW колонкой; история — из текста.
- Запрос итогов: отдельный агрегат по `orders_unified` с теми же фильтрами (search/service/status/manager/payment/from/to), `sum(amount)` + `sum(carpet_count)`, БЕЗ `.range()` (весь набор). См. `fetchOrdersList` в `orders-query.ts` — переиспользуй фильтры.
- UI: блок итогов над/под таблицей в `orders-client.tsx`: «За период: N заказов · Σ X ₸ · Σ ковров Y». Учти 4 состояния. После — деплой → браузер-проверка (ui-verify-guard).
- Миграция VIEW: drop+recreate `orders_unified` (как `20260621000003`), helper — drop+create при смене сигнатуры. Следующий номер `20260621000004`.

## ЗАДАЧА 2 — Привязка выездов self-service (#2 системно)
REST `TripOrder` привязку заказ↔выезд НЕ умеет (доказано, [[project_agbis_trip_binding]]) — единственный канал — строка в локальной Firebird `MOBILE_PLAN_ORDERS`, CRM на Vercel её не достаёт.
1. **СНАЧАЛА изучи `C:\Agbis`** (структуру, конфиги, где Firebird, как запускается клиент) и реши архитектуру: у каждого менеджера свой Agbis-клиент на ПК (с локальной репликой Firebird) → агент у каждого; ИЛИ достаточно одной папки от админа с маршрутизацией по тому, кто оформил заказ. Спроси пользователя, если из C:\Agbis неоднозначно.
2. **Доступ менеджерам** к `Настройки → Интеграция → Агбис` (сейчас, вероятно, admin-only) — поправь routing/RLS/permissions страницы `app/(protected)/settings/integrations/agbis/`.
3. **Папка привязки на менеджера** — как папка записей MicroSIP (см. [[project_microsip_recording]], паттерн `local/<uid>/`, «Подключить папку» через File System Access API). В разделе Агбис менеджер подключает свою папку.
4. **Локальный агент привязки** (на машине(ах) с Firebird-доступом): пуллит CRM `order_trips` (synced, но не привязанные — DOR_ID нет в junction) → пишет junction по рецепту ниже. Кандидат — папка `recorder/` или новый сервис. Маршрутизация: заказ → его приёмщик/менеджер → его агент/папка.
5. **Рецепт junction** (рабочий): `INSERT INTO MOBILE_PLAN_ORDERS (ID, MOBILE_PLAN_ID, DOR_ID, DEP_ID, LAST_DEP_ID, DEP_SRC_ID) VALUES (:id, :trip, :order, 3,3,3)`. ID — НЕ глобальный MAX+1 (коллизия с центром), а `max(ID) where DEP_SRC_ID=3 and ID between 1030000 and 1039999` + запас, проверив отсутствие в MOBILE_PLAN_ORDERS и MST_META_CHANGES. Десктоп читает локальную базу → «Есть выезд ✅» сразу; центр — через репликацию ~5 мин. Полный рецепт: `docs/integrations/agbis-api/PROD-TEST-PROMPT.md`.
6. Честность: сейчас CRM ставит выездам `sync_status=synced`, хотя они НЕ привязаны. Добавь статус «отправлен, но не привязан» либо привязывай по факту.

## ЗАДАЧА 3 — Очистка тест-данных (последней)
- Отменить 4 тест-заказа REST `ChangeStatusOrdersForAll status_id=7` для dor **100350, 100351, 100352, 100353** (рецепт логина/вызова — см. PROD-TEST-PROMPT.md; верифицировать центр через `OrderByDateTimeForAll` + локаль Firebird, репликация ~5 мин).
- Снять вручную вставленные junction: `delete from MOBILE_PLAN_ORDERS where ID in (1039358,...,1039365)`. ВНИМАНИЕ: CDO-триггер при удалении ПОСЛЕДНЕГО junction выезда ставит ему `mp_status=2` (отмена) — для очистки это ок (мы и отменяем). Commit.
- Тест-клиенты «ТЕСТ Самал Новый» (+77000002121, contr 10051) и «ТЕСТ Елена Новая» (+77000002222, contr 10052): Агбис API контрагентов не удаляет — переименовать в десктопе в «УДАЛИТЬ» вручную. В CRM `clients` можно удалить две строки (после отмены заказов) или оставить.
- Снести временные скрипты из `scratch/` (свои).

## Готово =
1: итоги (сумма + ковры) видны на проде по дате, проверено браузером. 2: менеджер заходит в Настройки→Интеграция→Агбис, подключает папку; новый заказ с выездом → агент привязывает → десктоп «Есть выезд ✅» без ручных вставок. 3: 4 заказа отменены (статус 7), junction сняты, тест-клиенты помечены, scratch чист.
