# Инвентаризация источников → канонический JSON

**Полная инструкция по сборке, командам и критериям:** [`RUNBOOK.md`](RUNBOOK.md).

Кодировки: CSV читается как UTF-8-sig, UTF-8, cp1251 (`io_utils.decode_csv_bytes`).

## Google Ads (`маркетинг/Google/.../Временной_ряд(...).csv`)

| Колонка исходника | Поле `marketingDaily` |
|-------------------|------------------------|
| Дата | `date` (ISO после разбора русской даты) |
| Расходы | `spend` (KZT/валюта кабинета, без конвертации) |
| Клики | `clicks`; `leads` оценочно от кликов |
| — | `channel` = `google`, `channelLabel` = `Google Ads` |

## 2GIS

Файл `connections-daily.xlsx` (или аналог): `python merge_build.py ... --two-gis путь/к/файлу.xlsx` — парсер ищет колонки **дата** + **расход**/клики/показы (`two_gis_connections.py`). Список листов: `python list_workbook_sheets.py Финансы.xlsx`.

## Продажи (шаблон)

Файл: `dashboard/data/templates/sales_import_template.csv` — колонки на кириллице, одна строка = сделка.

## Финансы

Файл `Финансы DaraClean 2025-2026.xlsx`: лист с колонками **дата** + **план** → `plans.daily`. При другой структуре — править `finance_workbook.records_to_daily_plans`.

## PDF

Таблицы извлекаются `pdfplumber` (`io_utils.extract_pdf_tables`); сканы без текста не поддерживаются.
