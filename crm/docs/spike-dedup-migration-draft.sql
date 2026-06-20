-- DRAFT — спайк #3, НЕ применённая миграция. Не класть в supabase/migrations до ревью.
-- Цель: сделать кросс-источниковый дедуп (vpbx_calls <-> call_logs) вообще возможным.
--
-- ПРОВЕРЕНО 2026-06-18 против прода (service-role count):
--   call_logs: НЕТ колонок started_at, direction (а также language, scenario_tags, transcript_segments, transcription_status).
--   external_call_id заполнен у 0 из 11 строк (100% NULL) -> как ключ связи СЕЙЧАС бесполезен.
--   total call_logs=11, transcript NOT NULL=4 (это 4 demo); vpbx_calls=16, is_recorded=0, transcript=0.
--   => дедуп на текущей схеме построить нельзя; нужна эта миграция ПЕРЕД дедупом.
--   НО: vpbx is_recorded=0 (Beeline-запись выкл) -> сейчас VPBX ничего не транскрибирует -> двойного счёта пока НЕТ.
--      Дедуп обязателен ПЕРЕД включением Beeline-записи, не раньше.

-- 1) Колонки, нужные ключу дедупа.
alter table call_logs add column if not exists started_at timestamptz;
alter table call_logs add column if not exists direction text
  check (direction is null or direction in ('inbound','outbound','internal'));

-- 2) Бэкофилл started_at из created_at для legacy (истинный старт неизвестен -> приближение).
update call_logs set started_at = created_at where started_at is null;

-- 3) direction для legacy надёжно не восстановить (нет источника) -> NULL.
--    Заполнять ВПЕРЁД: из VPBX-события (events.ts callType) и из имени MicroSIP-файла ('-incoming-' => inbound).

-- 4) Индекс под оконный поиск дедупа.
create index if not exists idx_call_logs_manager_started on call_logs (manager_id, started_at desc);

-- КЛЮЧ ДЕДУПА (на стороне приложения, в pipeline, ДО транскрипции):
--   связать запись с уже оценённым звонком по: тот же manager_id И тот же нормализованный телефон клиента
--   И started_at в пределах +/-60с. Если строка vpbx_calls и строка call_logs описывают ОДИН физический
--   звонок -> скорить ОДИН раз.
-- ВАЖНО: при external_call_id 100% NULL единственная связка сегодня = (менеджер, телефон, окно времени).
--   Чтобы сделать надёжно ВПЕРЁД — заполнять external_call_id (или общий call_uid) для ВСЕХ звонков
--   (сейчас его ставит только исходящий click-to-call; входящие и MicroSIP оставляют NULL).
