# Entity Map — Dara Clean

> Автогенерация: 2026-05-14. Обновлять после изменения сущностей (`/entity-map`).

## Архитектура данных

```
Excel (Финансы, Продажи, Marketing CSVs)
    ↓ ETL (merge_build.py)
dashboard-data.json
    ↓
├─→ Dashboard SPA (window.* globals)
└─→ Telegram Bot (Google Sheets live)
        ↓ write
    Google Sheets "Ежедневно"
```

---

## Сущности

### Transaction
- **Источник:** `Продажи/Отчет по оплатам групп услуг.xlsx` → ETL → `dashboard-data.json`
- **Тип:** `EntryRow` (`Telegram Bot/src/sheetsClient.ts`)
- **Поля:** date, operationType, paymentType, amount, category, article, manager, comment
- **Читает:** Dashboard (SalesFunnel, SalesDashboard, CashLedger), Bot (stats.ts)
- **Пишет:** Bot wizard.ts → Google Sheets "Ежедневно"
- **Связан с:** Manager (N:1), Client (N:1), CostBlock (через EXPENSE_TO_BLOCK)

### DDS (ДДС / Cash Flow)
- **Источник:** Excel "ДДС 2025", "ДДС 2026" → ETL finance_dds.py → `dashboard-data.json`
- **Тип:** `DdsCategory` (`Telegram Bot/src/sheetsClient.ts`)
- **Поля:** label, values[12], total, children[], isHeader
- **Читает:** Dashboard (FinanceDashboard, FinanceData), Bot (dds.ts)
- **Связан с:** CostBlock (агрегация по 6 блокам), Transaction (источник строк)

### Manager
- **Источник:** Sales sheet → ETL → `dashboard-data.json`
- **Поля:** id, name, phone, email, active
- **Читает:** SalesDashboard (renderManagers), SalesFunnel (manager stats)
- **Связан с:** Transaction (1:N), Client (через заказы)

### Client
- **Источник:** Sales sheet → ETL → `dashboard-data.json`
- **Поля:** id, name, isNew, crmId, lastOrderDate, lifetimeValue
- **Читает:** SalesFunnel (new vs repeat), UnitEconomics (LTV)
- **Связан с:** Transaction (1:N), Manager (N:1)

### MarketingDaily
- **Источник:** Google Ads CSV, 2GIS XLSX, Yandex CSV → ETL → `dashboard-data.json`
- **Поля:** date, channel, channelLabel, spend, spendKzt, impressions, clicks, leads
- **Читает:** SalesDashboard (renderChannels), CostModel (CAC)
- **Дедупликация:** ETL `_dedup_marketing_daily()` по (date, channel)
- **Связан с:** Channel (N:1)

### Channel (маркетинговый канал)
- **Определён:** `dashboard/js/cost-model.js` FACTS.channels[5]
- **Поля:** id, label, budgetMonth, inquiries, orders, newPct
- **Каналы:** google, 2gis, yandex, instagram, tiktok
- **Читает:** CostModel (computeCAC), SalesDashboard (renderChannels)
- **Связан с:** MarketingDaily (1:N)

### CostBlock (блок расходов)
- **Определён:** `dashboard/js/finance-data.js` BLOCK_META + EXPENSE_TO_BLOCK
- **Блоки:** production, logistics, marketing, sales, taxes, overhead
- **Поля:** color, icon, factTotal, sharePct
- **Маппинг:** 200+ наименований статей → 6 блоков (EXPENSE_TO_BLOCK)
- **Читает:** FinanceDashboard (cost tree), CostModel (margin)
- **Связан с:** DDS (агрегация), Transaction (классификация)

### PlanParams (план продаж)
- **Определён:** `dashboard/js/sales-funnel.js` loadPlanParams()
- **Хранение:** localStorage key `dc-goals` или `dashboard-data.json` plans.funnel
- **Поля:** yearRevenue, yearOrders, targetConversion, growthPct, seasonal[12]
- **Читает:** SalesFunnel (decompPlan), SalesDashboard (renderPlan)

### AccessRecord (доступ Telegram)
- **Источник:** Google Sheets "Доступ"
- **Тип:** `AccessRecord` (`Telegram Bot/src/access.ts`)
- **Поля:** chatId, username, displayName, role, status, addedBy, addedAt, inviteCode
- **Роли:** superadmin, admin
- **Суперадмин:** @Islambek_Sadyrov (неизменяемый)
- **Кеш:** 30 секунд TTL в памяти
- **Читает:** middleware requireAccess, access-panel.ts
- **Пишет:** onboarding.ts, access-panel.ts

### DraftEntry (черновик записи)
- **Тип:** `DraftEntry` (`Telegram Bot/src/types.ts`)
- **Поля:** operationType?, paymentType?, category?, article?, employee?, amount?, comment?, dateIso?
- **Хранение:** ctx.session (in-memory, теряется при рестарте)
- **Читает/Пишет:** wizard.ts (7-шаговый диалог)
- **Связан с:** Transaction (превращается в EntryRow при сохранении)

### FinancialHealth
- **Тип:** `FinancialHealth` (`Telegram Bot/src/sheetsClient.ts`)
- **Поля:** income7d, expense7d, burnRate, trend, monthlyNet, topExpenses
- **Читает:** balance.ts (отображение), reminder.ts (проверка)
- **Связан с:** Transaction (агрегация "Ежедневно")

### GeoLocation
- **Источник:** `scripts/geocode-2gis-v2.js` → `dashboard/data/geocoded-addresses.json`
- **Поля:** address, normalized, orders, lat, lng
- **Читает:** HeatmapDashboard (2GIS MapGL визуализация)
- **Связан с:** Client (через адрес)

---

## Операции с пересечениями

### Wizard: добавление записи (Telegram Bot)
**Трогает:** DraftEntry → Transaction (EntryRow) → Google Sheets "Ежедневно"
**Файлы:** `Telegram Bot/src/handlers/wizard.ts`, `Telegram Bot/src/sheetsClient.ts`
**Шаги:** 7 (дата → тип операции → тип оплаты → сумма → категория → статья → комментарий)
**Валидация:** справочник из "Справочник", parseRuNumber() для суммы
**Риск:** изменение колонок "Ежедневно" ломает и запись, и чтение статистики

### ETL: сборка dashboard-data.json
**Трогает:** Transaction, Client, Manager, Product, MarketingDaily, DDS, PlanParams
**Файлы:** `etl/merge_build.py`, `etl/finance_dds.py`, `etl/sales_from_sheet.py`, `etl/marketing_*.py`
**Риск:** 7 сущностей из 5+ источников. Ошибка в одном парсере ломает весь JSON

### Sales Funnel: compute()
**Трогает:** Transaction, Manager, Client, Channel, PlanParams
**Файлы:** `dashboard/js/sales-funnel.js`, `dashboard/js/sales-dashboard.js`
**Риск:** зависит от структуры dashboard-data.json (transactions[], clients[], managers[])

### Cost Model: computeAll()
**Трогает:** CostBlock, Channel, Transaction (через FACTS)
**Файлы:** `dashboard/js/cost-model.js`
**Риск:** FACTS захардкожены (2025). Обновление требует ручной правки

### Finance Dashboard: рендер
**Трогает:** DDS, CostBlock, Transaction (через FinanceData)
**Файлы:** `dashboard/js/finance-dashboard.js`, `dashboard/js/finance-data.js`
**Риск:** EXPENSE_TO_BLOCK маппинг (200+ строк) — новая статья расхода не попадёт в блок

### Access Control: полный цикл
**Трогает:** AccessRecord
**Файлы:** `Telegram Bot/src/access.ts`, `handlers/onboarding.ts`, `handlers/access-panel.ts`, `index.ts` (middleware)
**3 пути:** /start запрос, добавление по @username, инвайт-код
**Риск:** кеш 30 сек — изменения в Sheets не сразу видны боту

---

## Хранилища данных

| Хранилище | Тип | Сущности | Доступ |
|-----------|-----|----------|--------|
| Google Sheets "Ежедневно" | Live DB | Transaction | Bot R/W |
| Google Sheets "Справочник" | Dictionary | categories, articles | Bot R |
| Google Sheets "ДДС 20XX" | Report | DDS | Bot R, ETL R |
| Google Sheets "Доступ" | Auth | AccessRecord | Bot R/W |
| Google Sheets "Лимиты" | Budget | limits | Bot R |
| `dashboard-data.json` | Static snapshot | Transaction, Client, Manager, MarketingDaily, DDS | Dashboard R |
| `geocoded-addresses.json` | Static snapshot | GeoLocation | Dashboard R |
| localStorage `dc-*` | Browser | PlanParams, ScenarioEngine state | Dashboard R/W |
| ctx.session (memory) | Volatile | DraftEntry | Bot R/W |

---

## Window Globals (Dashboard)

| Global | Модуль | Зависит от |
|--------|--------|-----------|
| `window.DC.fmt` | main.js | — |
| `window.DashboardData` | main.js (fetch) | dashboard-data.json |
| `window.FinanceFullData` | main.js (fetch) | finance-full-data.json |
| `window.FinanceData` | finance-data.js | DashboardData |
| `window.DaraCostModel` | cost-model.js | — (FACTS hardcoded) |
| `window.SalesFunnel` | sales-funnel.js | DashboardData |
| `window.SalesDashboard` | sales-dashboard.js | SalesFunnel, DashboardData |
| `window.Router` | router.js | — |

**Порядок загрузки (index.html):** data globals → business logic → render modules → router → main.js
