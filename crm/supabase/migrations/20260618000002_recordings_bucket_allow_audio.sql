-- Бакет call-recordings отклонял audio/mpeg → ВСЕ mp3-аплоады MicroSIP падали молча
-- (uploadEntry ловил ошибку storage, запись помечалась НЕ загруженной, синк давал 0 записей).
-- Старые .webm проходили (webm был в allowed_mime_types), а mp3 от MicroSIP — нет.
-- Разрешаем аудио-типы, которые реально пишут MicroSIP/CRM. Бакет приватный + RLS на local/<uid>/.
--
-- DOWN: вернуть прежний список (был без audio/mpeg) — но он и был багом, откат не нужен.

update storage.buckets
set allowed_mime_types = array[
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac'
]
where id = 'call-recordings';
