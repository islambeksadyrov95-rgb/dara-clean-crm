# DaraClean Finance Telegram Bot

## Важно: безопасность токена
Вы уже показали токен в чате. Срочно перевыпустите его в BotFather командой `/revoke` и используйте новый токен.

## Архитектура
- **Telegram bot (Node.js + TypeScript + grammY)**: ведёт диалог, показывает кнопки, отправляет данные в API
- **Google Sheets + Apps Script Web App**: REST API для чтения справочников и добавления операций

## Автономно без компьютера (без сервера)
Можно вообще не запускать Node.js бот. Вместо этого бот может работать **целиком внутри Google Apps Script** через Telegram Webhook.

Файл для этого: `apps-script/TelegramWebhookBot.gs`

Шаги:
1. В Apps Script откройте Project Settings → Script properties:
   - `BOT_TOKEN` = токен Telegram бота
   - `TZ` = `Asia/Almaty` (опционально)
2. Deploy → New deployment → Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
3. После деплоя запустите функцию `setWebhook()` один раз (в редакторе Apps Script)

После этого бот работает автономно на стороне Google.

## 1) Настройка Apps Script (в вашей таблице)
1. Откройте Google Sheet → Extensions → Apps Script
2. Вставьте код из `apps-script/Code.gs`
3. В `CONFIG.apiKey` задайте секретный ключ (любой сложный)
4. Проверьте названия листов:
   - `Справочник` — лист со справочниками
   - `External` — лист куда добавлять операции (можете поменять)
5. Deploy → New deployment → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Скопируйте URL вида `https://script.google.com/macros/s/.../exec`

### Формат записи (куда пишем)
`External` получит колонки в таком порядке:
1. dateIso
2. operationType
3. paymentType
4. category
5. article
6. employee
7. amount
8. comment
9. chatId
10. userId
11. username
12. createdAtIso

## 2) Настройка бота
1. Скопируйте `.env.example` в `.env` и заполните:
   - `BOT_TOKEN`
   - `APPS_SCRIPT_BASE_URL` (URL Web App)
   - `APPS_SCRIPT_API_KEY` (тот же ключ что в `CONFIG.apiKey`)

## 3) Запуск локально

```bash
npm i
npm run dev
```

## Команды в Telegram
- `/start` — приветствие
- `/add` — добавить операцию
- `/cancel` — отменить ввод
- `/dict` — обновить справочники (если вы поменяли лист `Справочник`)
- `/last` — последние 10 операций
- `/stats` — статистика за текущий месяц

