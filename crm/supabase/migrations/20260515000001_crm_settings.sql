-- Migration 004: CRM settings — configurable discounts and scripts
-- Admin can edit from /settings page

CREATE TABLE IF NOT EXISTS public.crm_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;

-- Все видят настройки
CREATE POLICY "authenticated can read settings"
  ON public.crm_settings FOR SELECT TO authenticated USING (true);

-- Только admin может менять
CREATE POLICY "admin can update settings"
  ON public.crm_settings FOR ALL TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Скидки по сегментам (%)
INSERT INTO public.crm_settings (key, value) VALUES
  ('discounts', '{
    "new": 5,
    "repeat": 5,
    "regular": 10,
    "at_risk": 10,
    "lost": 15
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Скрипты звонков по сегментам
INSERT INTO public.crm_settings (key, value) VALUES
  ('scripts', '{
    "Новый": "Здравствуйте, {имя}! Меня зовут [имя менеджера], компания Dara Clean. Вы обращались к нам {дней} дней назад. Хотела уточнить — всё ли понравилось? Сейчас для вас действует скидка {скидка}% на повторный заказ.",
    "Повторный": "Здравствуйте, {имя}! Это [имя менеджера] из Dara Clean. Вы наш постоянный клиент — спасибо, что выбираете нас. С последнего заказа прошло {дней} дней. Готовы запланировать следующую чистку? Для вас скидка {скидка}%.",
    "Постоянный": "Здравствуйте, {имя}! [Имя менеджера], Dara Clean. Как наш VIP-клиент, хотели сообщить о персональной скидке {скидка}% на любую услугу. Какую услугу планируете?",
    "В риске": "Здравствуйте, {имя}! Это [имя менеджера] из Dara Clean. Давно не обращались — хотели узнать, может пора освежить ковры или мебель? Для вас специальное предложение — скидка {скидка}%.",
    "Потерянный": "Здравствуйте, {имя}! [Имя менеджера], Dara Clean. Мы обновили качество сервиса и хотели пригласить вас снова. Для возвращающихся клиентов скидка {скидка}% на первый заказ. Действует 7 дней."
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Дневной план звонков
INSERT INTO public.crm_settings (key, value) VALUES
  ('day_target', '40'::jsonb)
ON CONFLICT (key) DO NOTHING;
