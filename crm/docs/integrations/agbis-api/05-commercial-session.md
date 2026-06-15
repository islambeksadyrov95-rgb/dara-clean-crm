# Agbis API — Коммерческие команды (commercial_session) ⭐ ЗАПИСЬ

> Источник: https://doc.minihim.ru/api/commercial_session — изменение 12.05.2026
> Сохранение/редактирование клиентов, заказов, оплат. Требуется **пользовательская** `SessionID` (из `Login`).
> ⚠ Эти команды **тарифицируются** (см. `06-tariffs.md`) и считаются в `ExecutedApiCount`.
> Все значения ключей JSON — URI-кодированные (encodeURIComponent).
> `error`: 0 ок · 1 ошибка · 2 не авторизован · 3 авторизация просрочена. При error=1 — поле `Msg`.

## Ключевые enum'ы (запись)
**`status_id` заказа/услуги (запись):** 1 новый · 3 в исполнении · 4 исполненный · 5 выданный · 7 отменённый
**`contrag_type`:** 1 организации · 2 частные лица (умолч.) · 3 организации по договорам
**`type_doc` (PayForAll):** 1 карта (умолч.) · 2 касса · 3 банк · 4 бонус · 5 депозит
**`type_doc` (ReturnPayForAll):** 1 карта (умолч.) · 2 касса · 3 банк
**Доп. реквизит `value_type` → формат `values`:** 0 целое `"12"` · 1 строка (multisel — через запятую) · 2 булево `1/0` · 3 дата `12.03.2022` · 5 float `12,3` · 7 строка с ценой+кол-вом `"20,3.3,2"` · 8 строка с коэф. · 9 фигура `тип|длина|ширина|` (1 квадрат `1|3,3|`, 2 прямоуг. `2|1.3|3|`, 3 круг `3|4,8|2.4|`, 4 овал `4|2,3|4,5|`)

---

## ContragForAll — создание/изменение клиента ⭐
`POST .../api/?ContragForAll` · Header `Content-type: application/json; charset=UTF-8`
Тело: `{ "ContragForAll": {...}, "SessionID": "..." }`
- `contr_id` — если указан → поиск и изменение клиента (необяз.)
- `name` — короткое имя «Иванов И.И.» (**обяз.**)
- `fullname` — полное имя «Иванов Иван Иванович» (**обяз.**)
- `contrag_type` — 1/2/3 (умолч. 2), необяз.
- `teleph_cell` — сотовый (начинается с `+`, кодируется `%2B`), необяз.
- `telephone` — городской, необяз.
- `barcode` — номер карты, необяз.
- `gender` — 0 м/1 ж, необяз.
- `address`, `email`, необяз.
- `discount` — скидка (разделитель — запятая), необяз.
- `birthday` — `dd.mm.yyyy`, необяз.
- `agree_to_receive_sms`, `agree_to_receive_adv_sms`, `agree_to_receive_adv_email` — необяз.
- `scheme_id` — ID ДС (из `GetListsVdsDsForAll.ds`), необяз.
- `price_list_id` — прайс по умолчанию (с 24.4)
- `folder_id` — ID группы создания клиента

Ответ: `{ error, contr_id, WasNew }` — `WasNew` 1 новый / 0 обновлён.

---

## AddBonusForAll — пополнение бонусного счёта
`GET .../api/?AddBonusForAll={"contr_id":"12345","amount":"125.85","active_before":"25.05.2022","max_percent_in_zakaz":"12.4","bonus_type_id":"1001","comment":"..."}&SessionID=`
- `contr_id` (обяз. если нет `barcode`) / `barcode` (обяз. если нет `contr_id`)
- `amount` — сумма бонусов (**обяз.**)
- `active_before`, `max_percent_in_zakaz`, `bonus_type_id`, `comment` — необяз.
Ответ: `{error:0}`.

---

## SaveOrderForAll — создание заказа ⭐
`POST .../api/?SaveOrderForAll` · Header JSON UTF-8
Тело: `{ "SaveOrderForAll": { "Order":{...}, "Services":[...], "Products":[...], "Comments":[...] }, "SessionID":"..." }`

**`Order`:**
- `contr_id` — ID клиента (**обяз.**)
- `doc_num` — номер заказа `XXXX-YY` (необяз., обычно не заполнять — контроль на разработчике)
- `bso` — БСО, необяз.
- `doc_date` — `dd.mm.yyyy`, необяз.
- `fast_exec` — ID срочности (из `GetListsOrderTNDForAll.order_times`), необяз.
- `creater_id` — ID приёмщика (умолч. авторизованный пользователь)
- `sclad_id` — склад принятия (**обяз.**)
- `sclad_out_id` — склад выдачи (**обяз.**)
- `current_sclad_id` — текущий склад (умолч. = склад принятия)
- `price_id` — прайс (умолч. 0 розничный)
- `date_out` — `dd.mm.yyyy HH:MM:SS`, необяз.
- `vds_id` — ID ВДС (из `GetListsVdsDsForAll.vds`), необяз.
- `status_id` — 1/3/4/5/7, необяз.
- `waiting_confirm` — 0/1/2/3, необяз.
- `is_not_confirmed` — 0/1, необяз.
- `get_confirm_link` — 1 → вернуть ссылку подтверждения `https://agb.is/...` (нужно `waiting_confirm=1` и `is_not_confirmed=0`)
- `only_with_main_calc_price` — опция «цена как % от другой услуги»

**`Services[]`** (обяз.; если услуг нет — пусто, но тогда обязателен `Products`; пустые заказы нельзя):
- `dos_id` — порядковый № основной услуги (1,2…) для привязки дочерних
- `parent_id` — порядковый № родительской услуги (для комплектных/ремонтных)
- `tovar_id` — ID услуги из прайса (только `tovar_type=2`) (**обяз.**)
- `count` — кол-во (**обяз.**)
- `barcode_serv` — ШК услуги (обычно не заполнять)
- `discount` — ручная скидка
- `is_recalc_disc` — пересчёт скидки на сервере (игнорит `discount`)
- `ext_info` — описание
- `nursery_id` — детская скидка (из `GetListsOrderTNDForAll.order_nurseries`)
- `dirty_id` — наценка (из `GetListsOrderTNDForAll.order_dirties`)
- `status_id` — 1/3/4/5/7
- `current_sclad_id` — текущий склад услуги
- `addons[]` (обяз., пусто `[]` если нет): `addon_id` (из `AddonTypes`), `values` (формат по `value_type`, см. enum)

**`Products[]`** (необяз.): `tovar_id` (только `tovar_type=1` товары), `count` (обяз.), `discount`, `tovar_descript`, `ext_info`.
**`Comments[]`** — массив строк комментариев (пусто `[]` если нет).

Ответ: `{ error, dor_id, confirm_link }`.

---

## UpdateOrderForAll — изменение заказа
`POST .../api/?UpdateOrderForAll` · Header JSON UTF-8
Тело: `{ "UpdateOrderForAll": { "Order":{...}, "Services":[...], "Products":[...], "Comments":[...] }, "SessionID":"..." }`
Отличия от `SaveOrderForAll`:
- `Order.dor_id` — **обяз.** (ID существующего заказа); `sclad_id`/`sclad_out_id` тут необяз.
- `Services[].dos_id` — ID услуги в заказе (реальный, напр. `12344422`) → изменение; если не указан или порядковый — добавляется как новая.
- `Services[].addons[].aos_id` — ID строки реквизита в существующей услуге (изменение); если не указан — `addon_id` для новой.
- `Products[].dol_id` — ID товара в заказе (изменение); без него — новый.
Ответ: `{ error, dor_id, confirm_link }`.

---

## ChangeStatusOrdersForAll — массовая смена статуса заказов
`POST .../api/?ChangeStatusOrdersForAll` · Header JSON UTF-8
Тело: `{ "ChangeStatusOrdersForAll": { "Orders":[ {"dor_id":"100182","status_id":"3"} ] }, "SessionID":"..." }`
- `status_id` — 1/3/4/5/7 (**обяз.**). Ответ: `{error:0}`.

---

## SetOrderImagesForAll — сохранение фото в услуге
`POST .../api/?SetOrderImagesForAll` · Header JSON UTF-8
Тело: `{ "SetOrderImagesForAll": { "dos_id":"...", "img":"<base64 jpeg>" }, "SessionID":"..." }`
- `dos_id` (обяз.), `img` — JPEG в base64 (обяз.). Ответ: `{error:0}`.

---

## PayForAll — оплата заказа из внешней системы ⭐
⚠ Требует 2 глобальные настройки на центральной базе клиента (согласовать с химчисткой). Возможна частичная оплата.
`GET .../api/?PayForAll={"dor_id":"1123444","amount":"123.25","type_doc":"1"}&SessionID=`
- `dor_id`, `amount`, `type_doc` (1 карта/2 касса/3 банк/4 бонус/5 депозит) — **обяз.**
- `is_fiscal` — 0/1 фискализация (нужна настроенная онлайн-касса + опция «Фискализировать оплаты коммерческого API»)
- `payment_url` — домен онлайн-оплаты при `type_doc=1` (для фискализации)
- `kassa_id` — вн. номер кассы
Ответ: `{error:0}`.

---

## ReturnPayForAll — возврат средств
`GET .../api/?ReturnPayForAll={"dor_id":"1123444","amount":"123.25","type_doc":"1"}&SessionID=`
- `dor_id`, `amount`, `type_doc` (1 карта/2 касса/3 банк) — **обяз.**
- `is_fiscal`, `payment_url` — как в PayForAll.
Ответ: `{error:0}`.

---

## Команды-зависимости
- **GetListsOrderTNDForAll** — источник `order_times` (срочности, `fast_exec`), `order_nurseries` (детские скидки, `nursery_id`), `order_dirties` (наценки, `dirty_id`). Описание есть в `03-user-session.md` (пользовательская сессия).
- **GetListsVdsDsForAll** — источник `vds_id` (ВДС) и `scheme_id` (ДС). Описание в `04-double-session.md`.
- **PriceList** — источник `tovar_id` (услуги `tovar_type=2`, товары `tovar_type=1`). Описание в `01-no-session.md`.
- **AddonTypes** — источник `addon_id` и правил кодирования `values`. Описание в `01-no-session.md`.
