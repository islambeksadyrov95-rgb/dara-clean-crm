# Agbis API — Команды БЕЗ сессии (no_session)

> Источник: https://doc.minihim.ru/api/no_session — последнее изменение 12.05.2026
> Команды получения общих данных из стандартных справочников. Сессия НЕ требуется.
> Базовый путь Dara Clean: `https://himinfo.org/cl/daraclean_838936e8/api/`

## Общее
- Метод: `GET`. Ответ — JSON. Заголовки не требуются.
- Все значения параметров — URL-encoded (`encodeURIComponent` / `urlencode`).
- Текстовые значения в ответах приходят **URL-encoded** (напр. `name` = `%D0%9A%D0%BB%D0%B8%D0%B5%D0%BD%D1%82%D1%8B`) — нужно декодировать на нашей стороне.

---

## Авторизация / регистрация / восстановление пароля

### ModernLogin — авторизация клиента по телефону (клиентская сессия)
Используется вместе с `ModernRegistration`.
```
GET .../api/?ModernLogin={"phone":"+79123456789","pwd":"<SHA1>"}
```
- `phone` — телефон клиента (обяз.)
- `pwd` — пароль, SHA1 (обяз.)

Ответ: `{ "error":0, "Session_id":"...", "contr_id":"10013", "promo_code_friend":"" }`
- `error` 0 успех / 1 ошибка; `Msg` — текст при ошибке
- `Session_id` — ID клиентской сессии; `contr_id` — ID клиента; `promo_code_friend` — промо-код.

### AuthByAddon — авторизация клиента по доп. реквизиту (клиентская сессия)
```
GET .../api/?AuthByAddon={"id_addon":100245,"login":"00000001","psw":"<SHA1>"}
```
- `id_addon` — вн. номер доп. реквизита (обяз.); `login` — значение реквизита (обяз.); `psw` — SHA1 (обяз.)
Ответ как у ModernLogin.

### ModernRegistration — регистрация клиента в ЛК
⚠ Лимит: не более 3 запросов / 10 сек с одного IP.
```
GET .../api/?ModernRegistration={"fio":"Тест Тестовый","phone":"+79123456789","email":"test@test.com"}
```
- `phone` — телефон/логин (обяз.); `fio`, `email`, `gender` (0 муж/1 жен), `birthday`, `address` — необяз.
- `agree_to_receive_sms` — согласие на смс о готовности (опция `GL_DISABLE_ALLOW_SMS`)
- `agree_to_receive_adv_sms` — согласие на рекламные смс (опция `GL_DISABLE_ALLOW_SPAMSMS`)
- `agree_sms_order_reps` — согласие на квитанцию/изменения (опция `GL_DISABLE_ALLOW_SMS_ORDER_REPS`)
- `registered_from` — источник: 1 МП ХимчисткаИнфо, 2 Чистомат, 3 Агент химчистки, 4 ЛК, 5 ПМП, 6 Коммерческое API, 7 web-форма консьержа/выездов, 8 брендированное приложение. Пользовательские значения > 1000 (iOS 1001, Android 1002).

Ответ успех: `{ "error":0, "Msg":"СМС сообщение с кодом отправлено" }`
Телефон занят: `{ "error":1, "Msg":"...уже зарегистрирован...", "contr_id":"1234", "exists":"1" }`

### ModernRememberPwd — восстановление пароля клиента
⚠ Лимит: не более 3 запросов / 10 сек с одного IP.
```
GET .../api/?ModernRememberPwd={"phone":"+79123456789"}
```
Ответ: `{ "error":0, "Msg":"СМС сообщение с кодом отправлено" }`

### Login — авторизация ПОЛЬЗОВАТЕЛЯ (пользовательская сессия) ⭐
Возвращает `Session_id` для команд с пользовательской сессией.
- Сессия активна **10 минут**. Потом `error = 3` → выполнить `RefreshSession` и повторить.
- Иначе — `429 Too many requests` на 2 минуты.
```
GET .../api/?Login={"User":"Пользователь","Pwd":"<SHA1>","AsUser":"1"}
```
- `User` — имя пользователя Агбис.Химчистка (Справочники → Пользователи), обяз. Рекомендуется **отдельный пользователь под API**.
- `Pwd` — пароль, SHA-1 (обяз.)
- `AsUser` — признак коммерческого API, всегда `"1"` (обяз.)

Ответ: `{ "error":0, "Session_id":"...", "Refresh_id":"...", "User_ID":"123" }`

### RefreshSession — обновление пользовательской сессии без авторизации
```
GET .../api/?RefreshSession={"Refresh_ID":"<Refresh_id из Login>"}
```
Ответ: `{ "error":0, "Session_id":"<новый>", "Refresh_id":"<новый>" }`

### ExecutedApiCount — статистика выполненных коммерческих команд
```
GET .../api/?ExecutedApiCount
```
Ответ: `{ "error":0, "date_list":[ {"date":"02.12.2017","count":"15"}, ... ] }`

---

## Справочная информация

### api_version — версия API (параметров нет)
```
GET .../api/?api_version  →  {"api_version":"1.4"}
```
⚠ Боевой Dara Clean сейчас возвращает `1.3`.

### ContrTree — группы клиентов
```
GET .../api/?ContrTree
```
Ответ `list[]`: `folder_id`, `parent_id`, `name`, `price_id` (ID прайс-листа группы).

### PriceList — прайс-лист
```
GET .../api/?PriceList={"price_id":"12"}
```
- `price_id` — ID прайс-листа (необяз.; по умолчанию розничный)
- `tovar_type` — 0 все, 1 только товары, 2 только услуги (по умолч.)

Ответ `price_list[]`:
`id`, `folder_id`, `tovar_type` (1 товар/2 услуга), `code` (артикул), `name`, `unit`, `price`,
`group_p` (родит. группа), `group_c` (группа услуги), `top_parent` (верхняя группа),
`order_addon_pack_id` (комплект доп. реквизитов), `sort_index`, `is_price_editable`,
`is_not_for_discount`, `is_repair`, `is_percent_price` (цена как % от другой услуги),
`additional_text`, `short_name`, `index`, `image_id`, `own_times` (собств. сроки 1/0),
`duration` (срок, дней), `price_id`.

### PriceTree — группы прайс-листа
```
GET .../api/?PriceTree={"id":"12"}
```
- `id` — ID прайс-листа (**обязательный** — без него `error 105`).
Ответ `price[]`: `folder_id`, `parent`, `name`, `duration`, `comm`, `sort_index`.

### AddonTypes — доп. реквизиты
```
GET .../api/?AddonTypes
```
Ответ `addon_types[]`: `id`, `group_id` (1 Описание изделия, 2 Дефекты изделия, 3 Дефекты сырья, 4 Предупреждения, 5 Иные дефекты),
`descr`, `value_type` (0 целое, 1 строка, 2 логич., 3 дата, 5 веществ., 6 метка, 7 строк. с ценой+кол-вом, 8 строк. с коэф., 9 фигура),
`default_int/str/bool/date/flt`, `comments`, `multisel`, `font_color`, `font_bold`, `specify_wp`,
`addon_str_values[]` (для value_type 1,7,8,9): `id`, `value_str`, `value_flt`
(для 9: value_flt = тип фигуры 1 Квадрат, 2 Прямоугольник, 3 Круг, 4 Овал).

### AddonPacks — комплекты доп. реквизитов
```
GET .../api/?AddonPacks
```
Ответ `addon_packs[]`: `id`, `name`, `addon_types[]` (массив ID реквизитов из AddonTypes).

### ReceptionCenters — склады (приёмные пункты)
```
GET .../api/?ReceptionCenters={"with_photo":"1","folders":"1,2,3","lang_id":"0"}
```
- `with_photo`, `folders`, `lang_id` — все необяз.
Ответ `list[]`: `id`, `name`, `address`, `working_hours`, `phone`, `group`, `location` (гео),
`cabinet` (склад Чистомат), `folder_id`, `name_for_clients`, `use_himinfo` (0/1), `city`, `comment`,
`metro`, `district_id`, `working_days`, `is_work_shop` (склад=цех), `sclad_is_mobil`,
`sclad_not_automated`, `photo` (base64), `sclad_type_id`.

### Regions — регионы (районы)
```
GET .../api/?Regions  →  { "error":0, "regions":[ {"id":"1002","name":"test"} ] }
```

### GetStatusOrder — статус заказа по номеру
```
GET .../api/?GetStatusOrder={"doc_num":"12345"}
```
Ответ: `{ "error":0, "Msg":"<статус>", "sclad_to":"123", "status_id":"4" }`

---

## Работа с выездами

### TripsHr — свободное время НАЧАЛА выезда на дату
```
GET .../api/?TripsHr={"date":"01.01.2020","car_id":"2","id":"123"}
```
- `date` (обяз., формат `21.12.2020`); `id` — ID выезда (при редактировании); `region_id`; `car_id` — моб. склад.
Ответ `hr[]` — массив свободного времени (`"00:00"`, `"01:00"`, ...).

### TripsHrTo — свободное время ОКОНЧАНИЯ выезда на дату
```
GET .../api/?TripsHrTo={"date":"01.01.2020","hr_to":"12:00","car_id":"2","id":"123"}
```
- `date`, `hr_to` (обяз.); `id`, `region_id`, `car_id` — необяз.
Ответ `hr_to[]` — массив свободного времени окончания.

### Cars — список выездных машин (выездные ПП)
```
GET .../api/?Cars
```
Ответ `cars[]`: `id`, `name`, `address`, `phone`, `price_list_id`.

---

## Промо-коды

### PromoCode — проверка промо-кода
```
GET .../api/?PromoCode={"promo":"123"}
```
Ответ: `{ "error":0, "promo_code_id":"10021", "working_address":[ {"id":1004,"promo_code_id":10021,"address":"..."} ] }`
