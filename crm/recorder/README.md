# Dual-channel call recorder (Dara Clean)

Пишет каждый звонок **двумя раздельными каналами** — менеджер (микрофон) и клиент
(WASAPI loopback вывода гарнитуры). Это решает «наложение»: когда оба говорят разом,
голоса в разных каналах и не смешиваются. Выход — два моно-WAV 16 кГц:
`YYYYMMDD-HHMMSS__manager.wav` и `__client.wav` в папку `Record call/`.

## Требования
- Windows + Python 3.11
- `python -m pip install pyaudiowpatch`
- **Гарнитура** (закрытые наушники) — иначе голос клиента из колонок попадёт в микрофон.
- Во время звонка на наушниках не должно играть ничего лишнего (музыка/видео):
  loopback снимает ВСЁ, что выводится на устройство.

## Запуск

Демон (рекомендуется) — сам ловит начало/конец каждого звонка:
```
cd "D:\Mind map\Dara Clean\crm\recorder"
python recorder.py --watch --out "../Record call"
```
Оставь окно открытым. Каждый звонок автоматически пишется в два файла. Ctrl+C — выход.

Ручной режим (для теста одного звонка):
```
python recorder.py --out "../Record call"          # пиши, потом Ctrl+C
python recorder.py --out "../Record call" --seconds 20   # фикс. 20 секунд
```

## Автозапуск (Планировщик задач Windows)
`Task Scheduler -> Create Task -> Triggers: At log on -> Actions: Start a program`:
- Program: `python` (или полный путь к `python.exe`)
- Arguments: `recorder.py --watch --out "../Record call"`
- Start in: `D:\Mind map\Dara Clean\crm\recorder`

Не служба Windows (Session 0 не видит per-user аудио) — именно задача "при входе".

## Настройка детекции (если нужно)
`watch(start_rms, silence_rms, silence_sec, min_call_sec)` в `recorder.py`:
- `start_rms` (350) — порог «звонок начался» по громкости канала клиента.
- `silence_rms` (150) / `silence_sec` (2.5) — сколько тишины = «звонок закончился».
- `min_call_sec` (3.0) — короче не сохраняем.

## Что ещё не сделано (CRM-сторона, отдельный шаг)
- `lib/recordings/sync-client.ts`: распознать суффиксы `__manager/__client`, грузить
  оба файла как каналы одного звонка.
- Пайплайн: транскрибировать каждый канал отдельно, склеить по таймкодам в диалог
  «Менеджер/Клиент». См. `crm/docs/call-service-architecture.md` (Фаза 4).
- Упаковка в `.exe` (PyInstaller) для раздачи на ПК без Python.
