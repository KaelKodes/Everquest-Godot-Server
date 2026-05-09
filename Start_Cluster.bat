@echo off
cd /d "%~dp0"
title EQMUD Cluster Server (Multi-Process)
echo Starting EQMUD Server Cluster (login + world + zone nodes from this folder)...
echo.
npm run cluster
pause
