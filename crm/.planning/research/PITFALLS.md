# Domain Pitfalls — Dara Clean CRM

**Domain:** CRM повторных продаж (Next.js + Supabase + Vercel)
**Researched:** 2026-05-14
**Context:** Greenfield, дедлайн завтра, 21K записей из Excel, 3-5 менеджеров одновременно

---

## Critical Pitfalls

Ошибки, которые приводят к переписыванию или потере данных.

---

### P1: ISR-кэш Supabase отдаёт чужую сессию

**Что идёт не так:** Next.js кэширует ответы страниц. Если страница триггерит refresh токена Supabase, в кэш попадает `Set-Cookie` с чужим JWT. Следующий пользователь, которому отдали кэш, залогинивается как предыдущий.

**Почему происходит:** ISR (Incremental Static Regeneration) кэширует headers, включая `Set-Cookie`. Supabase обновляет токены через cookie.

**Последствия:** Один менеджер видит данные другого. Audit trail сломан. В CRM с финансами это критично.

**Prevention:**
- На всех authenticated страницах: `export const dynamic = 'force-dynamic'`
- Никогда не включать ISR на route где есть auth или session refresh
- В middleware: всегда использовать `supabase.auth.getClaims()`, не `getSession()` — `getSession()` не валидирует JWT подпись на сервере

**Detection:** Разные пользователи видят одинаковые данные, или в логах auth появляется один `user_id` для разных сессий.

**Phase:** Фаза 1 (Auth setup). Настроить сразу, до любого контента.

---

### P2: Телефоны в Excel хранятся в 7 разных форматах — дедупликация не работает

**Что идёт не так:** База Агбис — 21 388 строк, собиравшихся вручную с 2025 по 2026. Один клиент может встречаться как `+7 707 123 4567`, `87071234567`, `77071234567`, `7071234567`, `707-123-45-67`, `(707)1234567` и как число с плавающей точкой `77071234567.0` (Excel конвертирует длинные числа).

**Почему происходит:** Excel не имеет типа "телефон" — ячейки хранятся как текст или число в зависимости от того, как их ввели. При экспорте числа могут конвертироваться в float, теряя ведущие нули.

**Последствия:** `SELECT * FROM clients WHERE phone = '+77071234567'` не найдёт клиента с `87071234567`. Дедупликация пропускает дублей. Два менеджера звонят одному клиенту, не зная об этом.

**Prevention:**
1. Normalization pipeline перед вставкой в Supabase:
   ```python
   import re
   def normalize_kz_phone(raw):
       digits = re.sub(r'\D', '', str(raw))
       # убрать .0 если Excel конвертировал в float
       digits = digits.rstrip('0').rstrip('.') if '.' in str(raw) else digits
       if len(digits) == 10:          # 7071234567 → добавить 7
           digits = '7' + digits
       if len(digits) == 11 and digits.startswith('8'):
           digits = '7' + digits[1:]  # 87071234567 → 77071234567
       if len(digits) == 11 and digits.startswith('7'):
           return '+' + digits         # +77071234567
       return None  # невалидный, логировать
   ```
2. Хранить в БД только E.164 формат (`+77071234567`)
3. Перед импортом: `SELECT COUNT(*) WHERE phone IS NULL` — должно быть 0 после нормализации
4. Дедупликация по нормализованному номеру: `INSERT ... ON CONFLICT (phone) DO UPDATE`

**Detection:** После импорта: `SELECT phone, COUNT(*) FROM clients GROUP BY phone HAVING COUNT(*) > 1` — должно быть пусто.

**Phase:** Фаза импорта (до вставки в БД). Весь pipeline нормализации — до первого INSERT.

---

### P3: openpyxl падает на невалидном XML цветов — импорт не запускается вообще

**Что идёт не так:** База Агбис.xlsx содержит невалидные значения цветов в XML (уже задокументировано в PROJECT.md). `openpyxl` бросает исключение при открытии файла, до чтения первой строки данных.

**Почему происходит:** Excel позволяет форматирование, которое нарушает схему XML (нестандартные ARGB значения, references на theme colors без theme XML). openpyxl строгий парсер.

**Последствия:** Импорт 21K записей не происходит вообще. CRM запускается с пустой базой.

**Prevention — monkey-patch до загрузки файла:**
```python
from openpyxl.styles.colors import Color
_original_validate = Color.__init__

def _patched_init(self, rgb=None, indexed=None, auto=None, theme=None, tint=0.0, index=None, type=None):
    try:
        _original_validate(self, rgb=rgb, indexed=indexed, auto=auto, 
                          theme=theme, tint=tint, index=index, type=type)
    except Exception:
        self.rgb = "FF000000"  # чёрный по умолчанию
        self.type = "rgb"

Color.__init__ = _patched_init
```
Альтернатива: использовать `xlrd` для `.xls` или `pandas` с `engine='openpyxl'` и `data_only=True` — pandas частично изолирует ошибки форматирования.

**Detection:** Запустить импорт на тестовых данных первым делом. Fail fast.

**Phase:** Фаза 1, первое что делается. Не начинать разработку CRM пока не убедились что файл читается.

---

### P4: Supabase Free Tier паузит проект через 7 дней

**Что идёт не так:** При 0 database activity 7 дней подряд Supabase автоматически паузит проект. Менеджеры открывают CRM — 503.

**Почему происходит:** Free tier политика. Dashboard визиты и кэшированные API-запросы не считаются активностью — только реальные запросы к БД.

**Последствия:** CRM недоступна для менеджеров без предупреждения.

**Prevention:**
- Для production: перейти на Pro ($25/мес) **до** боевого запуска — нет смысла рисковать ради $25
- Для разработки: GitHub Action cron каждые 5 дней делает простой SELECT
- Альтернатива: Vercel Cron Job раз в 3 дня пингует Supabase

**Detection:** Настроить Supabase email alert или Uptime Robot на URL проекта.

**Phase:** Фаза деплоя (до передачи менеджерам).

---

### P5: Serverless + Supabase = connection exhaustion под нагрузкой

**Что идёт не так:** Vercel Serverless Functions (каждый API route в Next.js) открывают новое соединение с PostgreSQL при каждом invocation. При 5 менеджерах одновременно + фоновые запросы можно исчерпать 60 прямых соединений Free tier.

**Почему происходит:** Serverless не держит постоянные соединения. Каждый холодный старт = новое соединение.

**Последствия:** `FATAL: sorry, too many clients already` — запросы начинают падать случайным образом.

**Prevention:**
- Использовать **Supabase Pooler (Supavisor)** вместо прямого подключения: порт 6543, transaction mode
- В `DATABASE_URL` использовать pooler URL (берётся из Supabase Dashboard → Settings → Database → Connection Pooling)
- Supabase JS клиент (`@supabase/supabase-js`) использует PostgREST API, а не прямой TCP — для него это не проблема. Проблема только если используется `pg` / `Prisma` / `Drizzle` напрямую.
- Если только `@supabase/supabase-js` — проблема маловероятна при 3-5 пользователях.

**Detection:** В Supabase Dashboard → Database → Connections — мониторить active connections в пиковые часы.

**Phase:** Фаза деплоя. Проверить архитектуру клиента до старта.

---

## Moderate Pitfalls

---

### P6: Два менеджера звонят одному клиенту одновременно

**Что идёт не так:** Менеджер А открыл карточку клиента X и начал звонить. Менеджер Б видит этого же клиента в своём списке звонков и тоже звонит. Клиент раздражён двойным звонком.

**Почему происходит:** CRM показывает список клиентов за N дней без механизма блокировки. Нет понятия "в процессе звонка".

**Prevention:**
- Поле `locked_by` (user_id) + `locked_at` (timestamp) в таблице clients
- При открытии карточки: `UPDATE clients SET locked_by = auth.uid(), locked_at = now() WHERE id = $id AND (locked_by IS NULL OR locked_at < now() - interval '10 minutes')`
- Возвращает 0 rows если уже заблокирован — показать "Иванов сейчас звонит этому клиенту"
- Auto-release: locked_at устаревает через 10 минут (менеджер мог закрыть вкладку)
- Pessimistic lock (UPDATE ... RETURNING) — атомарная операция, race condition исключён

**Detection:** В логах звонков: `SELECT client_id, COUNT(DISTINCT manager_id) FROM call_logs GROUP BY client_id, DATE(called_at) HAVING COUNT(DISTINCT manager_id) > 1`

**Phase:** Фаза CRM (список звонков). Реализовать при создании карточки клиента.

---

### P7: RLS с auth.uid() — service role key обходит все политики

**Что идёт не так:** Если создать Supabase клиент с `service_role` ключом (например для импорта), и случайно использовать его в клиентском коде — все RLS политики игнорируются. Любой пользователь видит данные всех клиентов.

**Почему происходит:** `service_role` key — bypass всего RLS. Это намеренная фича для admin операций.

**Prevention:**
- `service_role` key — только в server-side код (API routes, Server Actions)
- `anon` key — в клиентский код и middleware
- В `.env.local`: `SUPABASE_SERVICE_ROLE_KEY` (без `NEXT_PUBLIC_`)
- Правило: никогда `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`

**Detection:** Проверить все `createClient()` вызовы в компонентах — должны использовать `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Phase:** Фаза 1 (Auth + RLS setup).

---

### P8: auth.uid() в RLS без индекса — таблица 21K строк тормозит

**Что идёт не так:** RLS политика вида `WHERE user_id = auth.uid()` на таблице без индекса по `user_id` делает seq scan по всем 21K записям при каждом запросе.

**Почему происходит:** PostgreSQL не может использовать индекс если его нет. RLS применяется к каждому row.

**Prevention:**
- Создать индекс сразу при создании таблицы: `CREATE INDEX idx_clients_assigned_to ON clients(assigned_to)`
- Обернуть в `(SELECT auth.uid())` вместо прямого вызова — позволяет PostgreSQL кэшировать результат per-statement:
  `(SELECT auth.uid()) = assigned_to`

**Detection:** В Supabase SQL Editor: `EXPLAIN ANALYZE SELECT * FROM clients WHERE ...` — смотреть на Seq Scan vs Index Scan.

**Phase:** Фаза 1 (Schema design). Индексы — при создании таблиц.

---

### P9: Floating-point ошибки в финансовых расчётах

**Что идёт не так:** JavaScript: `0.1 + 0.2 === 0.30000000000000004`. Скидка 10% от 17 000 тг = `1700.0000000000002`. В калькуляторе мотивации накапливается погрешность при суммировании многих заказов.

**Почему происходит:** IEEE 754 floating-point — стандарт JS/PostgreSQL для double precision.

**Последствия:** Менеджер видит KPI 15 000.01 тг вместо 15 000 тг — путается. Финансовый план показывает копейки. При суммировании 21K записей погрешность может стать заметной.

**Prevention:**
- KZT — целочисленная валюта (тенге без копеек). Хранить в БД как `INTEGER` (тиины) или просто округлять до целых тенге
- Все расчёты скидок: `Math.round(price * discountRate)` — никогда просто `price * 0.1`
- Для отображения: `new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })`
- В PostgreSQL: `NUMERIC(15, 2)` вместо `FLOAT8` для денежных полей

**Detection:** Тест: `let sum = 0; for(let i = 0; i < 100; i++) sum += 170; console.log(sum === 17000)` — должен быть true.

**Phase:** Фаза Schema + Фаза финансового калькулятора.

---

### P10: OpenRouter timeout без fallback блокирует UI

**Что идёт не так:** Менеджер нажимает "Сгенерировать WhatsApp сообщение" — OpenRouter отвечает через 15 секунд или не отвечает вообще (3 outage за 8 месяцев по данным мониторинга). UI завис, менеджер нервничает, жмёт повторно, создаёт дублирующие запросы.

**Почему происходит:** OpenRouter — внешний сервис без SLA. Upstream модели (Claude, GPT) тоже могут временно быть недоступны.

**Prevention:**
- Server Action с таймаутом: `AbortController` + `setTimeout(5000)`
- Fallback: массив шаблонов под каждый тип услуги (ковры/шторы/мебель/клининг) — если OpenRouter упал, отдать шаблон
- OpenRouter поддерживает `models: ['primary', 'fallback']` — использовать встроенный failover
- UI: кнопка "Генерировать" → spinner с текстом "Обычно 3-5 сек..." → если > 8 сек — показать шаблон с кнопкой "Попробовать снова"
- Дешёвая модель для этой задачи: `google/gemini-flash-1.5` (~$0.0001/сообщение) вместо GPT-4

**Detection:** Логировать response time каждого OpenRouter запроса. Если p95 > 5 сек — пересмотреть модель.

**Phase:** Фаза WhatsApp генерации. Fallback шаблоны — до интеграции OpenRouter.

---

### P11: Vercel preview deployments ломают Supabase Redirect URLs

**Что идёт не так:** При каждом git push Vercel создаёт preview URL вида `dara-clean-git-feat-abc123.vercel.app`. Supabase Auth требует точного совпадения Redirect URI. Авторизация в preview работает → редирект на 404.

**Почему происходит:** OAuth/Auth callback должен быть в whitelist Supabase. Preview URLs — динамические.

**Prevention:**
- В Supabase Auth → URL Configuration → Redirect URLs: добавить wildcard `https://*-your-project.vercel.app/**`
- Supabase + Vercel интеграция автоматически синхронизирует main domain при подключении через Vercel marketplace
- Site URL выставить на production URL, не на localhost

**Detection:** После первого деплоя сразу протестировать login flow на production URL.

**Phase:** Фаза деплоя (первый deploy).

---

## Minor Pitfalls

---

### P12: Кириллица в Excel — encoding проблемы при импорте

**Что идёт не так:** При чтении xlsx через pandas/openpyxl на Windows с системной локалью cp1251, имена клиентов превращаются в `????` или `Ð˜Ñ Ð¼Ð°Ð½`.

**Prevention:**
- openpyxl читает xlsx в UTF-8 (формат xlsx внутри — XML). Проблем обычно нет.
- Если используется CSV экспорт из Excel — явно указать `encoding='utf-8-sig'` (с BOM, как сохраняет Excel)
- Проверить после импорта: `SELECT name FROM clients WHERE name ~ '[^\\x00-\\x7F]' LIMIT 5` — должны быть кириллические имена, не мусор

**Phase:** Фаза импорта. Валидация после первого тестового прогона.

---

### P13: NEXT_PUBLIC_ переменные замораживаются при build

**Что идёт не так:** `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY` инлайнятся в JavaScript bundle во время `next build`. Если изменить переменные в Vercel Dashboard без нового деплоя — клиентский код использует старые значения.

**Prevention:**
- После изменения env variables в Vercel — всегда делать Redeploy (не просто Save)
- Supabase URL и anon key меняются редко, но этот паттерн важен знать

**Phase:** Общий знак для всего проекта.

---

### P14: Supabase 500MB лимит с данными 21K клиентов + история звонков

**Что идёт не так:** 21K записей клиентов + заказы + логи звонков + WhatsApp история могут не уложиться в 500MB Free tier.

**Оценка объёма:**
- 21K clients × ~1 KB = ~21 MB
- История звонков: 21K × 12 мес × ~0.5 KB = ~126 MB в год
- Итого с индексами и метаданными: ~200-300 MB в первый год

**Prevention:**
- 500MB — вероятно хватит на год, но мониторить в Supabase Dashboard → Settings → Usage
- При достижении 80%: перейти на Pro ($25/мес) — включает 8 GB storage
- Не хранить WhatsApp сообщения полным текстом если они длинные — только template_id + variables

**Phase:** Фаза мониторинга (post-launch).

---

### P15: Дата заказа из Excel — timezone ambiguity

**Что идёт не так:** Excel хранит даты как числа (serial date). При чтении через pandas дата `2025-07-01` может стать `2025-06-30 21:00:00` из-за UTC offset Алматы (+5).

**Prevention:**
- При чтении: `pd.read_excel(..., parse_dates=['date_col'])` + `df['date'] = df['date'].dt.tz_localize('Asia/Almaty')`
- Хранить в Supabase как `TIMESTAMPTZ` (не `TIMESTAMP`)
- Display клиентам: всегда Алматы timezone

**Phase:** Фаза импорта.

---

## Phase-Specific Warnings

| Phase | Тема | Вероятный Pitfall | Mitigation |
|-------|------|-------------------|------------|
| Фаза 1: Setup | Auth + RLS | ISR кэш отдаёт чужую сессию (P1) | `force-dynamic` на всех auth pages |
| Фаза 1: Setup | Schema | Нет индекса по phone/user_id → RLS тормозит (P8) | Индексы при CREATE TABLE |
| Фаза 1: Setup | Security | service_role key в клиентском коде (P7) | Code review checklist |
| Фаза 2: Импорт | Excel parsing | openpyxl падает на цветах, импорт не стартует (P3) | Monkey-patch первым делом |
| Фаза 2: Импорт | Нормализация | 7 форматов телефонов → дедупликация не работает (P2) | normalize_kz_phone pipeline |
| Фаза 2: Импорт | Encoding | Кириллица → мусор при неправильном encoding (P12) | Валидация после импорта |
| Фаза 3: CRM | Multi-user | Два менеджера звонят одному клиенту (P6) | locked_by + locked_at |
| Фаза 4: WhatsApp | External API | OpenRouter timeout блокирует UI (P10) | Fallback templates + 5s timeout |
| Фаза 5: Финансы | Calculations | Floating-point в скидках и KPI (P9) | Math.round + INTEGER в БД |
| Фаза 6: Deploy | Vercel | Preview URLs ломают Supabase auth redirect (P11) | Wildcard в Redirect URLs |
| Фаза 6: Deploy | Supabase | Connection exhaustion (P5) | Проверить pooler URL |
| Post-launch | Supabase | Проект паузится через 7 дней (P4) | Pro tier или cron ping |

---

## Sources

- [Supabase RLS Performance Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
- [Supabase Connection Management](https://supabase.com/docs/guides/database/connection-management)
- [Next.js + Supabase Auth SSR Issue: ISR caches Set-Cookie](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [OpenRouter Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [Supabase Free Tier: 7-day pause policy](https://supabase.com/pricing)
- [Vercel Supabase Integration: Redirect URL wildcards](https://supabase.com/blog/using-supabase-with-vercel)
- [Supabase Pooling with Next.js](https://needthisdone.com/blog/supabase-connection-pooling-production-nextjs)
- [Telephone numbers in Kazakhstan](https://en.wikipedia.org/wiki/Telephone_numbers_in_Kazakhstan)
