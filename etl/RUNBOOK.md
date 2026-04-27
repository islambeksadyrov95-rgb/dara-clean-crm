# RUNBOOK: сборка dashboard-data.json (DaraClean)

## Оглавление

1. [Результат и назначение](#1-результат-и-назначение)
2. [Каталог файлов → merge](#2-каталог-файлов--merge)
3. [Глоссарий](#3-глоссарий)
4. [meta.assumptions и warnings](#4-metaassumptions-и-warnings)
5. [Команда сборки](#5-команда-сборки)
6. [Preflight](#6-preflight)
7. [Курс USD/KZT](#7-курс-usdkzt)
8. [Продажи: лист и колонки](#8-продажи-лист-и-колонки)
9. [Дедупликация Google](#9-дедупликация-google)
10. [Логика mktDaily и KZT на фронте](#10-логика-mktdaily-и-kzt-на-фронте)
11. [Валидация](#11-валидация)
12. [Золотой снапшот](#12-золотой-снапшот)
13. [E2E дашборда](#13-e2e-дашборда) (при загрузке `dashboard-data.json` фильтр дат подставляется по `meta.sourceRanges`)
14. [Ручная сверка месяца](#14-ручная-сверка-месяца)
15. [Ежемесячное обновление](#15-ежемесячное-обновление)

---

## 1. Результат и назначение

Артефакт: [`dashboard/data/dashboard-data.json`](../dashboard/data/dashboard-data.json) — единый вход для SPA [`dashboard/index.html`](../dashboard/index.html).

Использование: открыть дашборд (локальный сервер или `file://`), данные подхватываются из JSON. После обновления выгрузок — пересобрать JSON одной командой (раздел 5).

---

## 2. Каталог файлов → merge

| Источник | Файл / маска | Аргумент | Поле JSON |
|----------|--------------|----------|-----------|
| Google Ads | `маркетинг/Google/**/Временной_ряд*.csv` или один merged CSV | `--google` | `marketingDaily` (`channel=google`), расход в **KZT** (из USD × курс) |
| 2GIS | `маркетинг/2Gis/connections-daily.xlsx` | `--two-gis` | `marketingDaily` (`2gis`) |
| Яндекс | `маркетинг/Яндекс/*.csv` (без шаблонов) | `--yandex` | `marketingDaily` (`yandex`) |
| Продажи | `Продажи/Отчет по оплатам групп услуг.xlsx` (после проверки листа) | `--sales`, `--sales-sheet`, `--sales-header-row` | `transactions`, справочники |
| Финансы | `Финансы/Финансы DaraClean 2025-2026.xlsx` | `--finance`, `--finance-sheet` | `plans.daily`, `lossReasons` |

Не подставлять в merge второй файл 2GIS (`2gis_consolidated_daily.xlsx`) — иначе дубль метрик. Шаблон `yandex_metrica_daily_template.csv` исключается автоматически.

---

## 3. Глоссарий

- **Лид (маркетинг):** эвристика в парсерах (`leads`), не CRM-лид.
- **Клики Яндекса:** визиты/сессии из CSV → в поле `clicks` для графиков.
- **Воронка продаж (блок 7):** этапы из `funnelStage` сделок.
- **Дневная воронка в маркетинге:** `funnelSnapshots` по сделкам по дням — см. подсказку в `index.html`.

---

## 4. meta.assumptions и warnings

После сборки в JSON:

- `meta.buildTime` — UTC ISO.
- `meta.sourceRanges` — min/max дат по marketing, transactions, plans.
- `meta.warnings` — FX, дедуп, прочее.
- `meta.skippedYandexFiles` — файлы CSV Яндекса с ошибкой парсинга.
- `meta.salesPivotSynthesized` — выручка из сводного отчёта по группам (не построчные сделки CRM).
- `meta.assumptions` — валюта исходного Google (USD), флаг конвертации в KZT, путь к кэшу курсов, политика дедупа.

**Финансы (план по дням):** [`finance_workbook.py`](finance_workbook.py) сначала **объединяет все** листы с шаблоном «вторая строка — колонка B = дата» и ненулевой суммой (например «Октябрь», «Ноябрь»). При совпадении даты суммы складываются. Если таких листов нет — fallback по таблице «дата + план» как раньше. В JSON: `meta.financeMonthSheets`.

---

## 5. Команда сборки

Из корня проекта `Dara Clean` (подставьте свои пути при необходимости):

```powershell
python etl/merge_build.py `
  --google "маркетинг/Google" `
  --two-gis "маркетинг/2Gis/connections-daily.xlsx" `
  --yandex "маркетинг/Яндекс" `
  --sales "Продажи/Отчет по оплатам групп услуг.xlsx" `
  --sales-sheet 0 `
  --sales-header-row 0 `
  --finance "Финансы/Финансы DaraClean 2025-2026.xlsx" `
  --finance-sheet 0 `
  -o "dashboard/data/dashboard-data.json"
```

---

## 6. Preflight

```powershell
python etl/preflight_sources.py --sales "Продажи/Отчет по оплатам групп услуг.xlsx" --finance "Финансы/Финансы DaraClean 2025-2026.xlsx"
```

Проверьте первую строку заголовков и наличие колонок даты/суммы.

---

## 7. Курс USD/KZT

- Файл: [`etl/data/nbrk_usd_kzt.json`](data/nbrk_usd_kzt.json).
- Заполнение: `python etl/seed_nbrk_rates.py` (заглушка) или `python etl/fetch_nbrk_rates.py --from ... --to ...` при рабочем парсере НБ.
- Логика: [`etl/fx_usd_kzt.py`](fx_usd_kzt.py) — при отсутствии даты берётся предыдущий известный курс.

---

## 8. Продажи: лист и колонки

Ожидается **одна строка = одна сделка**, заголовки: дата, сумма, клиент, продукт, менеджер, статус, этап (опц.), **план** (опц.), источник, сегмент. Колонки **план** в источнике нет — в JSON `planAmount: 0`; на дашборде план по продуктам/менеджерам не показывается. **KPI «План»** в шапке берётся из **`plans.daily`** финансов за выбранные даты (лист «Октябрь» и др.), а не из выдуманного 95% от факта.

Если структура отчёта другая — укажите `--sales-sheet` и `--sales-header-row` или подготовьте нормализованный xlsx.

**Сводный отчёт «Отчет по оплатам групп услуг»** (блоки `--- Таблица N ---`, строки «Итого за DD.MM.YYYY»): если плоская таблица не распознана, [`sales_from_sheet.py`](sales_from_sheet.py) строит синтетические строки по **группе изделий × день** (сумма = Нал + Безнал). В JSON: `meta.salesPivotSynthesized: true`.

---

## 9. Дедупликация Google

Политика: **суммирование** строк с одинаковой парой `(date, channel)` после склейки всех источников. Предупреждение в `meta.warnings`, если были дубли.

---

## 10. Логика mktDaily и KZT на фронте

В [`dashboard/js/analytics.js`](../dashboard/js/analytics.js) по каждому дню:

- `spendKzt` — сумма полей `spend` со строк, у которых `spendCurrency !== USD/RUB` (в т.ч. Google после конвертации в KZT).
- `spendUsd` / `spendRub` — отдельные оси.
- `spendKztMarketingTotal` — дублирует итог расхода в тенге для явного сравнения с выручкой (KZT).

---

## 11. Валидация

```powershell
python etl/validate_payload.py dashboard/data/dashboard-data.json
python etl/smoke_pivot_finance.py
```

Второй скрипт проверяет разбор свода продаж и склейку листов финансов (нужны файлы в `Продажи/` и `Финансы/`).

---

## 12. Золотой снапшот

Сохраните эталонные числа после первой «правильной» сборки: число строк `marketingDaily`, сумма `spend` по каналу google, hash файла. Шаблон: [`etl/golden_metrics.example.json`](golden_metrics.example.json).

---

## 13. E2E дашборда

1. Собрать JSON (раздел 5).
2. Открыть `dashboard/index.html` (локальный сервер или `file://`).
3. Убедиться, что подставился общий диапазон дат по `meta.sourceRanges` (маркетинг + сделки + план); при необходимости расширить вручную.
4. Проверить KPI, блок «Маркетинг и финансы по дням», таблицу каналов и строку статуса данных (свод продаж / листы плана).

---

## 14. Ручная сверка месяца

Выберите один месяц в фильтре; сравните сумму расхода Google в KZT (из выгрузки или JSON) с суммой `spend` по строкам `channel=google` за те же даты (с учётом курса).

---

## 15. Ежемесячное обновление

1. Положить новые CSV Google / обновить xlsx 2GIS, Яндекс, продажи, финансы.
2. При необходимости расширить `nbrk_usd_kzt.json` (`fetch` или `seed`).
3. Запустить `preflight_sources.py` при смене структуры Excel.
4. `merge_build.py` → `validate_payload.py` → при желании `smoke_pivot_finance.py`.
5. Открыть дашборд и проверить `meta.warnings` в JSON при аномалиях.

---

См. также [`DATA_SOURCES.md`](DATA_SOURCES.md).
