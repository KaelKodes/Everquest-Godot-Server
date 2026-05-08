@echo off
echo ========================================================
echo               EQMUD Server Environment Setup
echo ========================================================
echo.

:: 1. Check for Node.js and NPM
echo [1/3] Checking Node.js installation...
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed or not in PATH. Please install Node.js.
    pause
    exit /b
)
echo Installing Node.js dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install Node dependencies.
    pause
    exit /b
)
echo Dependencies installed successfully.
echo.

:: 2. Setup .env file
echo [2/3] Checking configuration...
if not exist .env (
    if exist .env.example (
        echo Creating .env file from .env.example...
        copy .env.example .env >nul
        echo [WARNING] Please edit .env to add your EQEMU_PASSWORD before starting the server.
    ) else (
        echo [WARNING] No .env or .env.example found. You will need to create a .env file manually.
    )
) else (
    echo .env file already exists.
)
echo.

:: 3. Check for Docker and setup Redis
echo [3/3] Checking Docker installation for Redis...
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Docker is not installed or not in PATH.
    echo Please install Docker Desktop to automatically run the Redis server.
    echo You will need to start Redis manually before booting the decoupled server.
    pause
    exit /b
)

:: Check if Redis container already exists
docker inspect eqmud-redis >nul 2>nul
if %ERRORLEVEL% eq 0 (
    echo Starting existing eqmud-redis container...
    docker start eqmud-redis
) else (
    echo Downloading and starting new eqmud-redis container...
    docker run -d --name eqmud-redis -p 6379:6379 redis:latest
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to start Redis container. Is Docker Desktop running?
    ) else (
        echo Redis container started successfully.
    )
)

echo.
echo ========================================================
echo Setup complete! 
echo Make sure your PEQ Database container is running.
echo You can now boot the master server using: node master.js
echo ========================================================
pause
