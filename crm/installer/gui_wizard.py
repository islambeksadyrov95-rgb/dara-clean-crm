"""Tkinter wizard for the DaraClean Agbis agent installer.

Thin GUI over installer.py's functions (passed in via `ns` to avoid a circular import). Three steps:
find Agbis → install → verify. Tkinter ships with Python and is bundled by PyInstaller.
"""

import os
import pathlib
import threading
import tkinter as tk
from tkinter import filedialog, ttk

APP_TITLE = "Установка агента DaraClean (Агбис)"


def run(ns):
    discover_agbis = ns["discover_agbis"]
    do_install = ns["do_install"]
    verify = ns["verify"]
    start_daemon = ns["start_daemon"]
    APP_NAME = ns["APP_NAME"]

    state = {"found": None}
    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("640x460")

    ttk.Label(root, text=APP_TITLE, font=("Segoe UI", 13, "bold")).pack(pady=(12, 4))
    info = ttk.Label(root, text="Шаг 1. Найдём Агбис на этом компьютере.", wraplength=600)
    info.pack(pady=4)

    log = tk.Text(root, height=16, wrap="word")
    log.pack(fill="both", expand=True, padx=12, pady=8)

    btns = ttk.Frame(root)
    btns.pack(fill="x", padx=12, pady=(0, 12))

    def say(msg):
        log.insert("end", msg + "\n")
        log.see("end")
        root.update_idletasks()

    def set_busy(b):
        for w in btns.winfo_children():
            w.configure(state="disabled" if b else "normal")

    def step_find():
        set_busy(True)
        say("Поиск Агбиса...")
        found = discover_agbis()
        if not found:
            say("Агбис не найден. Укажи папку Агбиса вручную (где LicensingService.ini).")
            d = filedialog.askdirectory(title="Папка Агбиса")
            if d:
                ini = pathlib.Path(d) / "LicensingService.ini"
                if ini.exists():
                    # reuse discovery on the chosen root
                    os.environ["AGBIS_ROOT_HINT"] = d
                found = discover_agbis()
        if not found:
            say("ОШИБКА: Агбис не найден. Запусти установщик на офисном ПК, где работает Агбис.")
            set_busy(False)
            return
        state["found"] = found
        say(f"  Агбис: {found['agbis_root']}")
        say(f"  Firebird: {found['fb_dsn']}")
        info.configure(text="Шаг 2. Установить агента и автозапуск.")
        btn_find.pack_forget()
        btn_install.pack(side="right")
        set_busy(False)

    def _install_thread():
        try:
            install_dir = pathlib.Path(os.environ["LOCALAPPDATA"]) / APP_NAME
            say(f"Установка в {install_dir} ...")
            do_install(state["found"], install_dir, with_autostart=True)
            say("Файлы скопированы, конфиг записан, автозапуск установлен.")
            say("Проверка подключения (Firebird + Supabase)...")
            code, out = verify(install_dir)
            say(out.strip())
            if code != 0:
                say("ОШИБКА проверки — см. вывод выше. Автозапуск НЕ стартуем.")
                set_busy(False)
                return
            start_daemon()
            say("Готово! Агент запущен и будет стартовать при входе в систему.")
            say("ВАЖНО: выключи агента на своей машине — в системе должен быть РОВНО ОДИН агент (депо 3).")
            info.configure(text="Готово. Можно закрыть окно.")
        except Exception as e:
            say(f"ОШИБКА установки: {e}")
        finally:
            set_busy(False)

    def step_install():
        set_busy(True)
        threading.Thread(target=_install_thread, daemon=True).start()

    btn_find = ttk.Button(btns, text="Найти Агбис", command=step_find)
    btn_find.pack(side="right")
    btn_install = ttk.Button(btns, text="Установить", command=step_install)
    ttk.Button(btns, text="Закрыть", command=root.destroy).pack(side="left")

    root.mainloop()
    return 0
