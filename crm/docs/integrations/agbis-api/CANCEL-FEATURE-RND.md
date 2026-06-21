# Отмена заказа в CRM — R&D и продолжение контролируемого теста

> Состояние на 2026-06-22. Цель: полноценная «Отмена заказа» как в десктопе (статус 7 + обнуление услуг +
> запись «возврат/действие» с причиной + отмена выездов), через локальную Firebird-запись. Выбран путь:
> **A — полный контролируемый тест на выбрасываемом заказе, потом сборка фичи.**

## ВЕРДИКТ R&D: ВИАБЕЛЬНО (с оговоркой)
- Триггеры таблиц отмены (`DOCS_ORDER_AU`, `DOC_ORDER_SERVICES_AU`, `DOC_ORDER_SERV_RETURNS_AI`) пишут очередь через **`MST_META_CHANGES_I`** — голая последовательность, **БЕЗ префикса депо** → маршрутизация репликации depot-АГНОСТИЧНА. (Префиксный `MST_META_CHANGES_ID`, на котором строился страх, эти триггеры НЕ зовут.)
- ДОКАЗАНО: собственная отмена заказа 100353 десктопом шла под `GEN_CUR_DEP_ID=107` (ID возврата `1072 = 107‖2`), обнулила DEP_SRC_ID=1 строку услуги, и ВСЁ уехало на центр (`MST_META_CHANGES.UNLOADED=1`). → 107 репликации не мешает; **никакой возни с глобальным генератором, никакого карантина десктопа.**
- `GEN_CUR_DEP_ID` влияет ТОЛЬКО на ID возврата (BI-триггер `DOC_ORDER_SERV_RETURNS_BI`: `NEW.ID = gen_id(GEN_CUR_DEP_ID,0)‖gen_id(GEN_DOC_ORDER_SERV_RETURNS_ID,1)` когда NEW.ID NULL). Под 107 даёт `107‖seq` (как 1072) — ровно как десктоп. Оставляем BI-генерацию (NEW.ID не задаём).
- **ОГРАНИЧЕНИЕ ФИЧИ:** raw-запись минует прикладной реверс **оплат/бонусов** (`SP_RECALC_BONUS_SUMMS`, payment/balance reversal) и app-аудит. → Firebird-отмену вешать **ТОЛЬКО на неоплаченные заказы без бонусов**. Оплаченные — десктоп. Только активные (не Выданный — гард state machine уже это даёт).
- Узел = депо **7** (ARM_7.FDB, GL_DEFDEP_ID=7), не 3 — но из-за depot-агностичной маршрутизации это не важно для отмены.

## ТОЧНЫЙ РЕЦЕПТ ЗАПИСИ (app-часть; триггеры доделают goods-zero + отмену выезда + репликацию)
Для `dor` со строками услуг `DOC_ORDER_SERVICES` (DEP_SRC_ID=1, серверные):
1. По каждой строке услуги (`STATUS_ID<>7`): `update DOC_ORDER_SERVICES set PRICE=0, DEBET=0, KREDIT=0, COST=0, STATUS_ID=7, RETURNED=1, LAST_TIME_CH_STATUS=current_timestamp where ID=:dos`. (QTY_KREDIT НЕ трогать.)
2. `insert into DOC_ORDER_SERV_RETURNS (DOS_ID, RETURN_KIND_ID, DT, USER_ID, COMMENT) values (:dos, 8, current_timestamp, 1057, :comment)` — БЕЗ ID (BI-триггер сам, 107‖seq). RETURN_KIND_ID: 7=«Отказ клиента от обработки», 8=«Ошибка при оформлении». USER_ID=1057 (Исламбек). COMMENT — кодировка **CP1251** (connect charset='WIN1251').
3. Допы (если есть): `select ID, CHANGE_PRICE from ADDON_ORDER_SERVICES where LINE_ID=:dos` → обнулить ненулевые денежные колонки (CHANGE_PRICE и т.п.).
4. `update DOCS_ORDER set STATUS_ID=7, KREDIT=0, DEBET=0 where ID=:dor` — фимрит триггер ZERO_TOVARS (goods-zero + отмена привязанного выезда, если ВСЕ его заказы стали 7).
5. `con.commit()`. НИКАКОГО `SET GENERATOR` — не трогать GEN_CUR_DEP_ID.
Аудит-строки (DOCS_ORDER_HISTORY/DOC_ORDER_SERV_HISTORY/DOCS_ORDER_CHGS) — app-write у десктопа, для репликации НЕ обязательны → пропускаем.

## СОСТОЯНИЕ ТЕСТА СЕЙЧАС
- Создан выбрасываемый заказ: **dor_id 100354**, клиент **10042** «ТЕСТ Сценарий (удалить)», услуга «Диванная подушка» `tovar_id 102413` 1000₸, status Новый, НЕоплачен, без выезда. (REST SaveOrderForAll, на центре.)
- Идёт долив на ветку. Фоновый поллинг `bon3eaosf` (Firebird DOCS_ORDER ID=100354) выведет состояние + границу `MST_META_CHANGES.SEQ_ID`, когда заказ доедет.

## ПРОДОЛЖЕНИЕ (свежая сессия)
1. Дождаться долива (поллинг `bon3eaosf` или вручную: `select * from DOCS_ORDER where ID=100354`). Запомнить DOS_ID строки услуги + baseline KREDIT (=1000) + границу SEQ_ID.
2. Сделать Firebird-отмену 100354 по рецепту выше (charset='WIN1251', commit). Проверить локально: новые строки в `MST_META_CHANGES` с `UNLOADED=0`; ID возврата well-formed (107‖seq), без коллизии.
3. Ждать ~10 мин (выгрузка вверх). **Make-or-break:** REST `FullOrderInfo{dor_id:'100354'}` (поле `order_services[].kredit`) ИЛИ `OrderByDateTimeForAll` за дату — должен показать **status 7 + kredit 0** на центре. И `UNLOADED` новых строк → 1.
4. **GO/NO-GO:** GREEN = центр показал kredit 0 + status 7 за ~15 мин → Firebird-отмена работает → строить фичу. RED = центр статус сменил, но деньги НЕ обнулились (центр пересчитывает app-логикой, которую raw минул) → откат на MiniHim/API-частичную отмену.

## ФИЧА (если GREEN) — архитектура
- CRM: кнопка «Отменить заказ» в карточке (`app/(protected)/orders/[id]/`) → дропдаун причины (константы 7/8) + коммент. Только для неоплаченных активных заказов. Server action пишет CRM-флаг `cancel_requested` + reason + comment.
- Локальный агент (расширить `binding/agent.py`): пуллит CRM заказы `cancel_requested` → делает Firebird-отмену по рецепту + отменяет выезды (`TripOrder mp_status=2` per arm, гард общего выезда) → помечает done.
- Зеркало CRM: `orders.cancel_reason/cancelled_at/cancelled_by`, статус → Отменённый.

## CLEANUP теста
- Заказ 100354 — выбрасываемый (клиент 10042 уже помечен «удалить»). Если тест GREEN, он уже отменён. Возврат-запись остаётся (тест-данные). При желании — отменить/убрать как остальные тест-заказы.
- Если RED/полуотмена — отменить 100354 через REST ChangeStatusOrdersForAll status 7 (или довести до чистого состояния).

## РЕКВИЗИТЫ
- Firebird (read+write, branch): `C:\fb64client\fbclient.dll`, DSN `127.0.0.1/3050:C:/Agbis/DB/ARM_7.FDB`, SYSDBA, пароль из `C:\Agbis\LicensingService.ini` `[Firebird] Password=`. Данные — charset по умолчанию; чтение SOURCE процедур падает на cp1251 0x98 → charset='NONE'+decode replace; запись cyrillic — charset='WIN1251'.
- REST: `.env.local` AGBIS_API_BASE/USER/PWD. Login SHA-1(pwd) AsUser=1.
