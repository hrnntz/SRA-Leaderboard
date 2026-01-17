@echo off
REM SRA Leaderboard Start Script
REM Opens browser and starts the server

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║         SRA Leaderboard - Starting                          ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Start the server and open browser
echo Starting server...
echo.
start http://localhost:3000
timeout /t 2 /nobreak
start http://localhost:3000/admin
npm start
