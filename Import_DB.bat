@echo off
cd /d "%~dp0"
title EQMUD - Import Database
echo ========================================================
echo                EQMUD - Import Database
echo ========================================================
echo Applies a peq dump (from Dump_DB.bat on the dev host)
echo to the local MariaDB container.
echo.
echo Usage (optional): pass a specific .sql path
echo   Import_DB.bat path\to\dump.sql
echo Without args, the newest .sql in server\dumps\ is used.
echo.
node tools/import_db.js %*
echo.
pause
