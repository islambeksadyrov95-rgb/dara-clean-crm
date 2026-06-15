# Agbis API — Команды ТОЛЬКО с клиентской сессией (client_session)

> Источник: https://doc.minihim.ru/api/client_session — изменение 29.01.2026
> Данные по конкретному клиенту. Требуется **клиентская** `SessionID` (из `ModernLogin`/`AuthByAddon`).
> Время жизни клиентской сессии — неограниченно.
> Все строковые значения в ответах — URL-encoded.

## Ключевые enum'ы (важно для маппинга в CRM)

**Статус заказа `status`:** 1 Новый · 2 На хранении · 3 В исполнении · 4 Исполненный · 5 Выданный · 6 Закрытый · 7 Отменённый
**Тип заказа `kind_id`:** 0 химчистка · 1 прачечная · 2 продажа товаров · 3 выездной
**`waiting_confirm`** (подтверждение клиентом): 0 не требует · 1 требует · 2 клиент согласился · 3 клиент отказался
**`is_not_confirmed`** (подтверждение сотрудником): 0 подтверждён/не ждём · 1 ещё не подтверждён
**Тип сообщения `message_type`/`mes_type`:** 1 отзыв · 2 жалоба · 3 пожелание · 4 некорректные данные · 5 вопрос
**Оценка `star`:** 1 ужасно · 2 плохо · 3 средне · 4 хорошо · 5 отлично (0 по умолчанию)
**`user`** (автор сообщения): 1 клиент · 0 сотрудник химчистки
**Тип акции `act_type_id`:** 1 распродажи · 2 сертификаты · 3 пакеты · 4 бонусные пакеты
**Тип объявления `type`:** 1 Новости · 2 Акция · 3 Спец. предложение · 4 Поздравление

---

## Работа с клиентом

### SaveInfo — сохранение данных клиента
`SaveInfo={...}&SessionID=` — все поля необяз. кроме SessionID:
`Name`, `Teleph_cell`, `Fone`, `birth_day` (01.04.1954), `Email`, `Address`, `gender` (0м/1ж),
`agree_to_receive_sms`, `agree_to_receive_adv_sms`, `source`.
Ответ: `{ error, Msg, contr_id, need_confirm_phone }`. Если телефон изменён — приходит смс с кодом → `ConfirmCellPhone`.

### SavePass — смена пароля
`SavePass={"old":"<SHA1>","new":"<SHA1>","IsDigitPass":"1"}&SessionID=`
`old`,`new` обяз. (SHA1); `IsDigitPass` если пароль из цифр. Ответ `{error:0}`.

### ConfirmCellPhone — подтверждение телефона
`ConfirmCellPhone={"contr_id":"10013","code":"1234"}&SessionID=`
`contr_id` обяз.; `code` необяз. (без него — повторная смс, не чаще 1/5мин). Ответ: `{error, phone, contr_id}`.

### Bonus — остаток бонусов
`Bonus&SessionID=` → `{ error:0, bonus_rest:"1956" }`

### Deposit — остаток депозита
`Deposit&SessionID=` → `{ error:0, deposit_rest:"206" }`

---

## Заказы клиента

### Orders — текущие заказы (кроме выданных)
`Orders={"sclad":1,"need_serv":1}&SessionID=` — `sclad` (инфо по складу 0/1), `need_serv` (детализация услуг 0/1) необяз.
Ответ `orders[]`: `dor_id`, `doc_num`, `doc_date`, `date_out`, `kredit` (сумма заказа), `debet` (оплата),
`discount`, `kind_id`, `photo_exist`, `sclad_to`, `sclad_name`, `sclad_adr`, `sclad_hours`, `current_sclad_id`,
`status`, `waiting_confirm`, `is_not_confirmed`, `condition_id`/`condition_name` (с Агбис 4.4.0),
`services[]`: `dos_id` (ID услуги в заказе), `tov_id` (ID номенклатуры), `service`, `code`, `status_id`,
`status_name`, `barcode`, `price`, `qty`, `kfx`, `discount`, `nursery_id`/`nurseries_name`/`nurseries_discount`,
`serv_weight`, `dirty_id`/`dirty_name`/`dirty_kfx` (наценка), `kredit`, `ext_info`, `shop_description`, `group_tov`,
`addons[]`: `id`, `descr`, `value_type`, `aos_id`, `aos_value`.

### OrdersHistory — выданные заказы
`OrdersHistory={"mon":1,"need_serv":1}&SessionID=` — `mon`: 0 квартал(умолч)/1 полгода/2 год; `sclad`, `need_serv` необяз.
Ответ `orders_history[]`: как Orders + `date_out_fast` (фактич. выдача). `status`=5.

### Services — краткая инфо по услугам заказа
`Services={"dor_id":"1","info":1}&SessionID=` — `dor_id` обяз., `info` (0/1) обяз.
Ответ `order_servises[]`: `dos_id`, `tov_id`, `service`, `status_id`, `unit_name`, `serv_num`, `parent_id`, `kredit`, `ext_info`, `qty_kredit`.

### FullService — полная инфо по услугам заказа
`FullService={"dor_id":"1"}&SessionID=` — `dor_id` обяз.
Ответ `order_services[]`: полный набор полей услуги (см. Orders.services) + `discount_type`.

### OrderAppConfirm — подтверждение заказа клиентом
`OrderAppConfirm={"dor_id":"12345"}&SessionID=` → `{error, Msg}`

### CancelOrderApp — отмена подтверждения
`CancelOrderApp={"dor_id":"12345"}&SessionID=` → `{error, Msg}`

### CancelOrder — перевод заказа в «отменённый»
`CancelOrder={"dor_id":"12345"}&SessionID=` — `dor_id` обяз., `comment` необяз. → `{error:0}`

---

## Оплата заказа

### DepositPay — оплата депозитом
`DepositPay={"dor_id":"123","amount":"12"}&SessionID=` → `{error, Msg}`

### BonusPay — оплата бонусом
`BonusPay={"dor_id":"123","amount":"12"}&SessionID=` → `{error, Msg}`

---

## Общение (переписка)

### TitleMessages — темы обсуждений
`TitleMessages&SessionID=` → `Messages[]`: `id`, `dor_id`, `doc_num`, `dttm`, `star`, `message_type`,
`new_mes_count`, `last_message`, `status_message` (новое), `comment` (главное сообщение), `user`.

### MessageList — сообщения темы (обнуляет счётчик новых)
`MessageList={"id":"123"}&SessionID=` → `childNode_comments[]`: `id`, `dttm`, `comment`, `user`, `status_message`.

### CountNewMessages — кол-во новых сообщений темы
`CountNewMessages={"id":"123"}&SessionID=` → `{error, count_new}` (новые от сотрудников; обнуляется после MessageList).

### SendMessage — отправить сообщение / создать тему
`SendMessage={"id":"1001","dttm":"21.12.2021 12:00","mes_type":"3","comment":"..."}&SessionID=`
Новая тема (отзыв): без `id`, с `star`. Параметры: `dttm`(обяз), `mes_type`(обяз), `comment`(обяз),
`dor_id`(отзыв о заказе), `id`(переписка), `star`, `call_back_me` (0/1 — просит перезвонить).
Ответ: `{ error, fl (0 новая/1 в существующую), id (ID новой темы) }`.

---

## Акции, сертификаты, объявления

### GetActionList — список акций / картинка
`GetActionList={"act":"1"}&SessionID=` (act 1 список / 2 картинка). Для act=2 нужен `action_id`.
Ответ `actions[]`: `action_id`, `act_type_id`, `date_begin`, `date_end`, `name`, `short_detail`, `full_detail`, `sclads_id` (/ `photo` base64 при act=2).

### Certificate — список сертификатов
`Certificate={"id":"123"}&SessionID=` (`id` обяз.) → `certificate[]`: `id`, `name`, `dt_first`, `dt_last`,
`comments`, `price`, `lines[]` (5 первых): `id`, `tov_name`, `discount`, `qty`, `price_before`, `price_after`.

### CertificateLines — строки сертификата
`CertificateLines={"id":"123"}&SessionID=` → `certificate_lines[]`: те же поля строки.

### ActiveCertificates — активные сертификаты клиента
`ActiveCertificates&SessionID=` → `active_certificates[]`: `id`, `certificate_id`, `promo_code`, `cer_name`.

### CreatePayCertificate — создать оплату сертификата
`CreatePayCertificate={"id":"123"}&SessionID=` — создаёт заказ с активирующей услугой. → `{error, dor_id, doc_num}`. Требует предварит. настройки в Агбис.Химчистка.

### Advertisment — рекламные объявления
`Advertisment={"id":"123"}&SessionID=` — `id`, `type`, `date_first`, `date_last`, `not_load_pic` (1=без картинок) — все необяз.
Ответ `advertisments[]`: `id`, `type`, `description`, `mes` (HTML, encodeURIComponent), `sub_mes`, `barcode`, `img[]`: `adv_id`, `path`, `img64` (base64).

### AdvertismentImg — все картинки объявления
`AdvertismentImg={"id":"123"}&SessionID=` (`id` обяз.) → `advertisments_img[]`: `adv_id`, `path`, `img64`.

---

## Промо-коды

### PromoCodeUse — текущий промо-код клиента
`PromoCodeUse&SessionID=` → `{ promo_code, discount_extrnl (имя ВДС), discount, address }`

### PromoCodeActivate — активировать промо-код
`PromoCodeActivate={"PromoCode":"123","dor_id":"12345"}&SessionID=` — `PromoCode` обяз., `dor_id` необяз. → `{error, Msg}`

---

## Статистика ЛК (отметки)

- **Entry** `Entry={"type":"1"}&SessionID=` — 0 регистрация / 1 авторизация. → `{error:0}`
- **EntranceSite** `EntranceSite&SessionID=` — заход без авторизации (обновление/по сессии). → `{error:0}`
- **OpenOrders** `OpenOrders&SessionID=` — открытие заказа. → `{error:0}`
- **OpenHistory** `OpenHistory&SessionID=` — открытие истории. → `{error:0}`

---

## Создание заказа

### SaveFullOrder — создать новый заказ из МП ⭐
`SaveFullOrder={...}&SessionID=`. Обязательные параметры:
`price_id` (ID прайс-листа), `sclad_id` (склад оформления), `sclad_to` (склад выдачи),
`is_not_confirmed` (1 не подтв./0 подтв. сотрудником), `waiting_confirm` (0/1/2/3),
`status_deliver` (статус доставки, таблица `delivery_statuses`), `kredit` (стоимость),
`comments[]` (массив, с `description`), `servs[]`, `plans[]`, `use_promo` (1/0).
Необяз.: `dor_id` (при применении промокода к существующему), `cert_action_id`, `discount_extrnl_id`.

`servs[]` (услуги): `dos_id` (порядковый), `parent_id` (0; гардероб), `tovar_id` (ID в Tovars_TBL),
`count`, `wardrobe_id`, `kfx` (для кв. единиц; иначе 1), `action_him_id` (если услуга в сертификате).
`plans[]` (выезды): `type`, `address`, `dttm` (нижний интервал), `to_dttm` (верхний), `mobile_sclad`,
`region_id`, `room` (квартира, необяз.), `room_level` (этаж, необяз.).
Ответ: `{ error:0, dor_id:"2668" }`.

---

## Устаревшие команды (deprecated)
- **OrderConfirm** — больше не поддерживается. Замена: `OrderAppConfirm`.
