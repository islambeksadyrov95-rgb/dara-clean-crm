"""Tkinter wizard for the DaraClean Agbis agent installer.

Thin GUI over installer.py's functions (passed in via `ns` to avoid a circular import). Steps:
find Agbis → choose mode (Startup / always-on SYSTEM task) → install → verify.
Tkinter ships with Python and is bundled by PyInstaller.
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
    install_dir_for = ns["install_dir_for"]
    cleanup_existing = ns["cleanup_existing"]
    autostart = ns["autostart"]
    elevate = ns["_elevate"]

    state = {"found": None}
    always_on = None  # set after root exists
    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("660x500")
    always_on = tk.BooleanVar(value=False)

    ttk.Label(root, text=APP_TITLE, font=("Segoe UI", 13, "bold")).pack(pady=(12, 4))
    info = ttk.Label(root, text="Шаг 1. Найдём Агбис на этом компьютере.", wraplength=620)
    info.pack(pady=4)

    log = tk.Text(root, height=15, wrap="word")
    log.pack(fill="both", expand=True, padx=12, pady=8)

    ttk.Checkbutton(
        root, variable=always_on,
        text="Запускать всегда — даже когда никто не вошёл в систему (служба, нужны права администратора)",
    ).pack(anchor="w", padx=12)

    btns = ttk.Frame(root)
    btns.pack(fill="x", padx=12, pady=(4, 12))

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
            if filedialog.askdirectory(title="Папка Агбиса"):
                found = discover_agbis()
        if not found:
            say("ОШИБКА: Агбис не найден. Запусти установщик на офисном ПК, где работает Агбис.")
            set_busy(False)
            return
        state["found"] = found
        say(f"  Агбис: {found['agbis_root']}")
        say(f"  Firebird: {found['fb_dsn']}")
        info.configure(text="Шаг 2. Выбери режим (галочка ниже) и нажми «Установить».")
        btn_find.pack_forget()
        btn_install.pack(side="right")
        set_busy(False)

    def _install_thread(mode):
        try:
            install_dir = install_dir_for(mode)
            cleanup_existing()  # one-agent guarantee: clear any previous install/mode first
            say(f"Установка в {install_dir} [{mode}] ...")
            do_install(state["found"], install_dir, mode)
            say("Файлы скопированы, конфиг записан, автозапуск настроен.")
            say("Проверка подключения (Firebird + Supabase)...")
            code, out = verify(install_dir)
            say(out.strip())
            if code != 0:
                say("ОШИБКА проверки — см. вывод выше.")
                return
            if mode == "startup":
                autostart.start_startup_daemon()
                say("Готово! Агент запущен и будет стартовать при входе в систему.")
            else:
                say("Готово! Служба установлена (SYSTEM, ONSTART) — агент работает даже без входа в систему.")
            say("ВАЖНО: в системе должен быть РОВНО ОДИН агент (депо 3) — выключи агента на других машинах.")
            info.configure(text="Готово. Можно закрыть окно.")
        except Exception as e:
            say(f"ОШИБКА установки: {e}")
        finally:
            set_busy(False)

    def step_install():
        set_busy(True)
        mode = "task" if always_on.get() else "startup"
        # Admin needed to create a SYSTEM task OR to clear an existing one (one-agent guarantee on reinstall).
        need_admin = mode == "task" or autostart.task_exists()
        if need_admin and not autostart.is_admin():
            say("Нужны права администратора (служба / снятие старой службы). Запрашиваю (подтвердите UAC)...")
            if elevate(["--silent"] + (["--task"] if mode == "task" else [])):
                say("Установка продолжается с правами администратора в отдельном окне.")
                say("Результат — в логе установщика. Это окно можно закрыть.")
            else:
                say("Не удалось получить права администратора. Попробуй запустить установщик «от имени администратора».")
            set_busy(False)
            return
        threading.Thread(target=lambda: _install_thread(mode), daemon=True).start()

    btn_find = ttk.Button(btns, text="Найти Агбис", command=step_find)
    btn_find.pack(side="right")
    btn_install = ttk.Button(btns, text="Установить", command=step_install)
    ttk.Button(btns, text="Закрыть", command=root.destroy).pack(side="left")

    root.mainloop()
    return 0
