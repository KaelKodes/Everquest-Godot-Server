@echo off
cd /d "%~dp0"
title EQMUD - Dump Database
echo ========================================================
echo                 EQMUD - Dump Database
echo ========================================================
echo Snapshots the live MariaDB (default: akk-stack-mariadb-1)
echo into server\dumps\^<DB^>_^<timestamp^>.sql for transport
echo to the public/LAN tester host.
echo.
node tools/dump_db.js
echo.
pause
