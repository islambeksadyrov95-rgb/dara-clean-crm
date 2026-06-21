' DaraClean Agbis binding+cancel agent — autostart launcher.
' Runs binding/agent-run.cmd HIDDEN (no console window) and detached at user logon.
' Install: copy this file into the user's Startup folder
'   (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup).
' MUST run on the admin machine that has Firebird/Agbis (127.0.0.1:3050) — never on Vercel.
CreateObject("WScript.Shell").Run "cmd /c ""D:\Mind map\Dara Clean\crm\binding\agent-run.cmd""", 0, False
