@echo off
cd /d "%~dp0"
echo Open http://localhost:3000  (or the port npx prints)
npx --yes serve .
