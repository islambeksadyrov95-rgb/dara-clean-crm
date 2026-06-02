# DESIGN — Dara Clean CRM

Source of truth for the visual system. Direction chosen 2026-06-03: **B «Attio / Notion»** — light, airy, friendly modern SaaS CRM. Goal: «выглядит как профессиональный software».

## Aesthetic
- Светлый, воздушный, много white space. Мягкие тени вместо жирных границ.
- Тёплая нейтральная база + один холодный акцент (синий). Семантика — мягкие тинты.
- Плотность — комфортная (desktop-кокпит), не «душно».

## Color tokens
- Page background (content): `#fcfcfb` (тёплый off-white)
- Card: `#ffffff`, border `#ebe9e4` (тёплый серый), shadow `0 1px 2px rgba(0,0,0,.04)`
- Sidebar: bg `#f7f6f3`, border-right `#ebe9e4`, текст `#5c5950`; активный пункт = белая «плашка» + тень + синий маркер
- Accent (выбор/ссылки/фокус/активная навигация): blue `#2563eb` (hover/bg `#eff6ff`, text `#1d4ed8`)
- Ink (текст): `#1f2937`; muted `#9b9892`
- Semantic (сегменты/статусы): из `lib/segments.ts` — Новый=blue, Повторный=teal, Постоянный=green, В риске=amber, Потерянный=red (тинты 50/700)
- Status: ok=emerald, warn=amber, danger=red (50/700)

## Typography
- Inter (`--font-sans`). Заголовок страницы 20px/700. Секции 13–14px/600. Подписи 12px muted. Микро-лейблы — минимум, без `text-[10px] uppercase` пачками.

## Layout shell
- Грид `[15rem | 1fr]`: sidebar слева + main.
- Sidebar группы: **Работа** (Диалоги*, Очередь, Воронка*, Клиенты, Заказы*, Коммуникации) · **Аналитика** (Дашборд, Моя мотивация*) · **Админ, только admin** (Импорт, Настройки, Команда*). `*` = «скоро» (disabled placeholder).
- Ролевой доступ: агент видит Работа + Моя мотивация; admin — всё.
- Topbar тонкий: поиск (placeholder) + пользователь + выход.
- Активный пункт: белый фон, мягкая тень, синий левый маркер/точка.

## Components
- shadcn/ui (Card/Table/Badge/Button/Input/Checkbox/Select/Label/Textarea).
- Контейнеры таблиц/карточек: `rounded-xl border bg-card shadow-sm`.
- Кнопки: primary — тёмная (near-black); ссылочные/навигация-актив — синий акцент.
- Прогресс-бары: тонкие (h-1.5/h-2), цвет по смыслу (звонки=blue, заказы=green, выручка=sky).

## Do / Don't
- DO: воздух, мягкие тени, единая палитра, минимум границ.
- DON'T: пёстрые `*-100/*-800` бейджи (заменено тинтами 50/700), жирные рамки, эмодзи в UI, инлайн-стили (кроме вычисляемой ширины бара).

## Status
Реализуется: токены (globals.css/shell) → `sidebar.tsx` + `layout.tsx` → раскатка. Контент-экраны уже переведены на rounded-xl + bg-card + shadow-sm + общую палитру.
