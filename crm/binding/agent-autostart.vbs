' DaraClean Agbis binding+cancel agent — autostart launcher (dev/admin source machine).
' Runs binding/agent-run.cmd HIDDEN (no console) and detached at user logon.
' Install: copy this file into the Startup folder
'   (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup).
' Because it is COPIED out of the repo, it cannot self-locate — set the one path below.
' (agent-run.cmd itself is self-locating; this is the ONLY absolute path to maintain.)
' The office PC uses installer-generated autostart (installer/autostart.py), not this template.
' MUST run on the admin machine that has Firebird/Agbis (127.0.0.1:3050) — never on Vercel.
Dim runCmd
runCmd = "D:\Mind map\Dara Clean\crm\binding\agent-run.cmd"   ' <-- edit this if the repo moves
CreateObject("WScript.Shell").Run "cmd /c """ & runCmd & """", 0, False
