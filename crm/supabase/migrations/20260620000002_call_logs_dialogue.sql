-- Поканальная диаризация: диалог «Менеджер/Клиент», собранный из двух каналов
-- записи recorder.py (__manager.wav = микрофон, __client.wav = loopback). Канал =
-- говорящий, сегменты склеиваются по таймкодам. Хранится ОТДЕЛЬНО от плоского
-- transcript (тот остаётся для скоринга и поиска). NULL для моно-записей (MicroSIP
-- mp3) — у них диалога нет, показываем плоский текст.
--
-- Формат: jsonb-массив [{ "speaker": "manager"|"client", "text": "...",
--                          "start": <sec>, "end": <sec> }] по возрастанию start.
alter table public.call_logs add column if not exists dialogue jsonb;
