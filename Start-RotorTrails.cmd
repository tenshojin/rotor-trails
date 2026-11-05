@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "ROTOR_CHECK=0"
if /i "%~1"=="--check" set "ROTOR_CHECK=1"
set "ROTOR_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined ROTOR_NODE set "ROTOR_NODE=%%N"
if not defined ROTOR_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "ROTOR_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined ROTOR_NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "ROTOR_NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined ROTOR_NODE for /d %%D in ("%ProgramFiles%\WindowsApps\OpenAI.CodexPrimaryRuntime.*") do if exist "%%~D\dependencies\node\bin\node.exe" set "ROTOR_NODE=%%~D\dependencies\node\bin\node.exe"
if not defined ROTOR_NODE (
  echo Node.js was not found. Install Node.js from https://nodejs.org/ and try again.
  echo Supported: Node.js 20.19.0 or later in the 20.x line, or 22.12.0 or later.
  goto failed
)
"%ROTOR_NODE%" -e "const [major, minor] = process.versions.node.split('.').map(Number); if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23)) { console.error('Unsupported Node.js ' + process.versions.node + '. Use 20.19+ in the 20.x line, or 22.12+. Node.js 21.x is not supported.'); process.exit(1); }"
if errorlevel 1 goto failed
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencies are missing. Run npm install in this folder first.
  goto failed
)
if not exist "node_modules\typescript\bin\tsc" (
  echo Dependencies are incomplete. Run npm install in this folder first.
  goto failed
)
echo Checking and building the current Rotor Trails source...
"%ROTOR_NODE%" node_modules\typescript\bin\tsc --noEmit -p tsconfig.json
if errorlevel 1 goto failed
"%ROTOR_NODE%" node_modules\vite\bin\vite.js build
if errorlevel 1 goto failed
if "%ROTOR_CHECK%"=="1" (
  echo Rotor Trails check passed. The current build is ready in dist.
  exit /b 0
)
echo Starting Rotor Trails. Keep this window open while playing. Press Ctrl+C to stop.
echo Local address: http://127.0.0.1:4185/
"%ROTOR_NODE%" node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4185 --strictPort --open
if errorlevel 1 goto preview_failed
exit /b 0
:preview_failed
echo Preview could not start. If port 4185 is already in use, close the previous
echo Rotor Trails window, or open http://127.0.0.1:4185/ if the game is already running.
echo The port stays fixed so your browser settings and progress remain together.
:failed
echo Rotor Trails could not start. See the message above.
if not "%ROTOR_CHECK%"=="1" pause
exit /b 1
