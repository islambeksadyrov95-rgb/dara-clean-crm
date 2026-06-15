# Agbis API — Команды с клиентской ИЛИ пользовательской сессией (double_session)

> Источник: https://doc.minihim.ru/api/double_session — изменение 05.06.2026
> Работают с клиентской ИЛИ пользовательской `SessionID`.
> Строковые значения в ответах — URL-encoded.

## Ключевые enum'ы (важно для CRM)

**`status_id` заказа:** 1 Новый · 2 На хранении · 3 В исполнении · 4 Исполненный · 5 Выданный · 6 Закрытый · 7 Отменённый
**`kind_id` заказа:** 0 химчистка · 1 прачечная · 2 продажа товаров · 3 выездной · 5 клининг
**`loyalty` клиента:** 0 нейтральный · 1 лояльный · 2 конфликтный · 3 VIP
**`sp` тип клиента:** 1 организация · 2 физлицо
**`doc_type` оплаты:** 3 кассовый (без фиск.) · 4 банковский · 9 оплата картой · 31 кассовый чек оплата (фиск.) · 32 кассовый чек возврат (фиск.) · 91 бонус · 92 депозит
**Выезд `tp`:** 0 забрать · 1 доставить
**Выезд `kind_id`:** 1 по заказу · 2 по клиенту · 3 по складу
**Выезд `mp_status`:** 0 новый · 1 совершён · 2 отменён (в FullOrderInfo.order_plans `mp_status_id`: 0 новый, 3 принял, 4 в пути)
**`message_type_id` = 7** — мешок (мешки у выезда)
**`error`:** 0 ок · 1 ошибка · 2 не авторизован · 3 авторизация просрочена

---

## Сессия

### ValidSessionID — проверка валидности сессии
`ValidSessionID&SessionID=` → `{ error:0, contr_id:"123" }`

### Logout — завершение сессии
`Logout&SessionID=` → `{error:0}`. После — сессия недействительна.

---

## Справочники

### PriceLists — список активных прайс-листов
`PriceLists&SessionID=` → `price_lists[]`: `id`, `description`, `dt_begin`, `dt_end`,
`in_rasprod` (участвует в распродажах 1/0), `is_contract` (на основе договора 1/0).

### GetListsVdsDsForAll — внешние дисконтные схемы (ВДС) и дисконтные схемы (ДС)
`GetListsVdsDsForAll&SessionID=`. Доступны всем клиентам.
**`vds[]`** (внешние дисконтные схемы): `id`, `title`,
`type_of_scheme` (0 скидка/1 начисление бонуса), `type_of_action` (0 по префиксу ШК/1 по ШК/2 при начислении депозита),
`forbid_reuse`, `block_used_bar`, `comment`, `is_active`, `type_of_zeroing` (0 не обнулять/1 все услуги/2 участвующие),
`action_time` (0 всегда/1 раз в месяц/2 только раз/3 в период), `active_with`, `active_to`,
`condition_id` (1 все клиенты/2 созданные сегодня/3 в день первого заказа/4 на первый заказ),
`summ_discount` (0 глобально/1 суммировать/2 не суммировать), `is_add_bonus_ones`, `bonus_end_dt`,
`bonus_active_before`, `bonus_day_active`, `max_percent_in_zakaz`, `select_vds_id`, `bonus_one_time`,
`bonus_tp` (0 фикс.сумма/1 % от суммы при выдаче/2 дифф.цена/3 дифф.процент/4 по скрипту), `bonus_summ`,
`is_for_sclads`, `discount` (скидка по умолчанию), `is_disc_for_folders`, `is_for_tovar`,
`active_times[]` (`day_of_week`, `is_active`, `time_first`, `time_last`),
`sclads[]` (ID складов), `discounts_service_groups[]` (`folder_id`, `parent`, `discount`),
`discounts_services[]` (`tovar_id`, `discount`, `fix_price`, `price_before`, `price_after`),
`promo_codes[]` (`promo_code_id`, `code`, `price_list_id`, `is_active`),
`levels[]` (`name`, `start_sum`, `end_sum` (999999999999 = без огранич.), `percent`).
**`ds[]`** (дисконтные схемы): `id`, `title`, `ext_disc_order_out` (применять ВДС при выдаче),
`vds_list[]` (ID ВДС при выдаче), `levels[]` (`name`, `amount_from`, `amount_to`, `discount_percent`).

---

## Клиент / пользователь

### ContrInfo — информация по авторизованному клиенту/пользователю ⭐
`ContrInfo&SessionID=` →
`contr_id`, `name`, `short_name`, `fone`, `fone_cell`, `email`, `agree_to_receive_sms`,
`agree_to_receive_adv_sms`, `address`, `barcode` (номер карты), `scheme_id` (ID ДС), `discount` (% скидки),
`last_order_discount`, `last_discount` (последняя по ДС), `discount_scheme_name`, `gender` (0м/1ж),
`sp` (1 организация/2 физлицо), `source`, `date_create`, `region_id`, `full_orders_cost` (сумма заказов),
`is_active` (0/1), `loyalty` (0 нейтр./1 лояльный/2 конфликтный/3 VIP), `price_list_id` (с 24.4),
`order_not_pay` (кол-во неоплаченных), `order_count` (кол-во заказов), `deposit`, `bonus`, `dolg` (долг),
`promo_code`, `birth_day`.

---

## Заказы

### FullOrderInfo — полная информация по заказу ⭐
`FullOrderInfo={"dor_id":"1"}&SessionID=` (`dor_id` обяз.)
**`order_dop_info`:** `kind_id` (0..5), `doc_num`, `kredit`, `debet`, `barcode`, `firm_id`, `doc_date`,
`date_out`, `date_out_fact`, `current_sclad_id`, `status_id` (1..7), `photo_exist`, `discount`,
`sclad_to`, `fast_exec_id` (ID срочности), `sclad_name`, `sclad_adr`, `sclad_hours`, `discount_extrnl_id` (ID ВДС),
`sclad_kredit_id` (склад приёма), `contragent_id` (ID клиента), `waiting_confirm` (0..3),
`is_not_confirmed` (0/1), `condition_id`/`condition_name` (с 4.4.0), `max_bonus_pay`.
**`order_services[]`:** `dos_id`, `parent_id`, `tovar_id`, `price`, `qty_kredit`, `kfx`, `kredit`, `discount`,
`name`, `code`, `tovar_type` (1 товар/2 услуга), `lock_bonus_pay`, `is_repair`, `is_serv_add` (комплектная),
`nursery_id`/`nurseries_name`/`nurseries_discount` (детская скидка), `serv_weight`,
`dirty_id`/`dirty_name`/`dirty_kfx` (наценка за загрязнение), `status_id`, `status_name`, `unitname`,
`serv_num`, `barcode`, `barcode_read`, `ext_info`, `shop_description`, `tovar_descript`, `monger_id`/`monger_name` (продавец),
`group_tov`, `photo_exist`, `contr_provider_id`/`name`/`inn` (агент), `nds_name`,
`addons[]` (только для услуг tovar_type=2): `addon_id`, `descr`, `value_type`, `aos_id`, `aos_value`.
**`order_payments[]`:** `doc_id`, `doc_type` (см. enum оплат), `kassa_debet`, `bank_debet`, `card_debet`, `bonus_debet`, `deposit_debet`.
**`order_comments[]`:** `id`, `descript`.
**`order_plans[]`** (выезды; только статусы 0 новый, 3 принял, 4 в пути): `id`, `tp` (0 забрать/1 доставить),
`dt`, `hr`/`mn`, `to_hr`/`to_mn`, `address`, `comment`, `sclad_id`, `sclad_plan_to`, `kind_id` (1/2/3),
`mp_status_id` (0/3/4), `contr_id`, `control_user_id` (диспетчер), `region_id`, `house`, `room`, `level_room`,
`geo_location`, `entrance`, `intercom`, `contr_address_id`,
`messages[]` (мешки): `mess_id`, `user_id`, `message_type_id` (7 мешок), `barcode`, `dttm`, `comm`,
`contr_id`, `sclad_id`, `firm_id`, `warn_group_id`, `count_things`, `sms_tel`, `dor_id`.
**`order_signs[]`** (подписанные квитанции): `id`, `dttm`, `name`.

---

## Квитанции и фото

### ReceiptOnline — квитанция по заказу (бинарные данные)
`ReceiptOnline={"dor_id":"12345","typeExport":"png"}&SessionID=` — `typeExport`: pdf(умолч)/png/svg; `sign` (только с svg).
Content-Type: pdf→application/pdf, png→image/png, svg→image/svg+xml. Возвращает двоичные данные.

### SignReceipt — подписанная квитанция
`SignReceipt={"id":"12345"}&SessionID=` (`id` из FullOrderInfo). Content-Type: image/svg+xml.

### OrderImagesModern — список фото по заказу
`OrderImagesModern={"dor_id":"12345","only_photo_id":"1"}&SessionID=` — `only_photo_id` 0 с фото/1 без (обяз.).
Ответ `photos[]`: `dos_id`, `photo_id`, `img` (base64, устар.). Само фото — через `PhotoOnline`.

### PhotoOnline — фото по заказу
`PhotoOnline={"photo_id":"12345","dos_id":"1234567"}&SessionID=` → Content-Type: image/png.

---

## Выезды

### Trips — список выездов на дату
`Trips={"date":"01.01.2020"}&SessionID=` — `date` обяз., `id` (регион), `detail` (детально) необяз.
Без detail → `trips[]`: `hour`, `engaged` (1 занято/0 свободно).
С `detail:1` → `trips[]`: `id`, `dt`, `hr`/`mn`, `to_hr`/`to_mn`, `tp` (0/1), `contr_id`, `contr_name`,
`contr_tel`, `contr_adr`, `dor_id`, `scl_name`, `sclad_plan_name`, `mp_status` (0/1/2), `car_scl_id`, `comment`,
`address`, `region_id`, `region_name`, `doc_num`, `dolg`, `dor_status_id`, `dor_status_name`, `kredit`, `debet`,
`contr_fio_text`, `contr_tel_text`, `house`, `room`, `level`, `stamp_num`, `user_id`/`user_name` (экспедитор).

### Trip — информация по выезду
`Trip={"id":"1234"}&SessionID=` → поля выезда (как order_plans) + `orders[]`:
`dor_id`, `debet`, `kredit`, `date_out`, `kind_id`, `order_num` (БСО), `status_id`, `sclad_kredit_id`,
`message_id`, `doc_num`, `contragent_id`, `firm_id`.

### TripOrder — создание выезда → см. `04a-triporder.md`

---

## Статистика

### LastChangeOrder — список изменившихся ID заказов ⭐ (для синхронизации статусов)
`LastChangeOrder&SessionID=` → `last_orders[]`: `cur_id` (порядковый номер изменения),
`dttm`, `dor_id`, `contr_id`, `status_id` (1/3/4/5), `cur_sclad_id`, `sclad_to`, `sclad_kredit_id`.

---

## Устаревшие
- **Receipt** — больше не поддерживается. Замена: `ReceiptOnline`. (Возвращал `{png, dor_id}`, путь `https://www.himinfo.ru/upload_files/<png>.pdf`).
