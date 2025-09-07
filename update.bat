@echo off
setlocal enabledelayedexpansion

REM --- Configuration ---
set REPO=Ventexx/Stashhub
set API=https://api.github.com/repos/%REPO%/releases/latest
set ZIP_URL=https://github.com/%REPO%/archive/refs/tags
set TMP_DIR=%TEMP%\stashhub_update

REM --- Check for global_settings.json ---
if not exist global_settings.json (
    echo [ERROR] global_settings.json not found.
    echo Run the app once before trying to update.
    pause
    exit /b 1
)

REM --- Extract current version ---
for /f "tokens=2 delims=:," %%a in ('findstr /i "appVersion" global_settings.json') do (
    set "CURRENT_VERSION=%%~a"
)
set CURRENT_VERSION=%CURRENT_VERSION:"=%
set CURRENT_VERSION=%CURRENT_VERSION: =%

echo Current version: %CURRENT_VERSION%

REM --- Get latest release info ---
echo Fetching latest release information...
for /f "usebackq tokens=* delims=" %%a in (`powershell -Command ^
    "$release = Invoke-RestMethod '%API%'; $release.name"`) do (
    set "LATEST_NAME=%%a"
)

for /f "usebackq tokens=* delims=" %%a in (`powershell -Command ^
    "$release = Invoke-RestMethod '%API%'; $release.tag_name"`) do (
    set "LATEST_TAG=%%a"
)

set LATEST_NAME=%LATEST_NAME:"=%
set LATEST_TAG=%LATEST_TAG:"=%

echo Latest release: %LATEST_NAME%
echo Latest tag: %LATEST_TAG%

REM --- Compare versions (exact match) ---
if "%CURRENT_VERSION%"=="%LATEST_NAME%" (
    echo Already up to date.
    pause
    exit /b 0
)

if "%CURRENT_VERSION%"=="%LATEST_TAG%" (
    echo Already up to date.
    pause
    exit /b 0
)

echo %CURRENT_VERSION% | findstr /i "dev" >nul
if %errorlevel%==0 (
    echo Running development build. No update performed.
    pause
    exit /b 0
)

echo Update available. Fetching new release...

REM --- Create backup ---
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
for /f "tokens=1-2 delims=/:" %%a in ("%TIME%") do (set mytime=%%a%%b)
set mytime=%mytime: =0%
set BACKUP_DIR=backup_%mydate%_%mytime%

echo Creating backup in %BACKUP_DIR%...
mkdir "%BACKUP_DIR%" 2>nul

REM Backup user data
if exist IMG xcopy "IMG" "%BACKUP_DIR%\IMG\" /E /I /Q /H >nul 2>&1
if exist Profiles xcopy "Profiles" "%BACKUP_DIR%\Profiles\" /E /I /Q /H >nul 2>&1
if exist global_settings.json copy "global_settings.json" "%BACKUP_DIR%\" >nul 2>&1
if exist changelog.json copy "changelog.json" "%BACKUP_DIR%\" >nul 2>&1

REM --- Download and extract ---
echo Downloading release...
rmdir /s /q "%TMP_DIR%" 2>nul
mkdir "%TMP_DIR%"

powershell -Command ^
    "try { Invoke-WebRequest '%ZIP_URL%/%LATEST_TAG%.zip' -OutFile '%TMP_DIR%\latest.zip' -ErrorAction Stop } catch { Write-Host 'Download failed'; exit 1 }"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to download release zip.
    pause
    exit /b 1
)

echo Extracting files...
powershell -Command ^
    "try { Expand-Archive -Path '%TMP_DIR%\latest.zip' -DestinationPath '%TMP_DIR%' -Force -ErrorAction Stop } catch { Write-Host 'Extraction failed'; exit 1 }"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to extract release zip.
    pause
    exit /b 1
)

REM --- Find the extracted directory ---
set SRC_DIR=
for /d %%i in ("%TMP_DIR%\Stashhub-*") do (
    set SRC_DIR=%%i
    goto :found_dir
)

:found_dir
if "%SRC_DIR%"=="" (
    echo [ERROR] Could not find extracted Stashhub directory.
    pause
    exit /b 1
)

echo Found source directory: %SRC_DIR%

REM --- Create exclude list for xcopy ---
>exclude_temp.txt echo IMG
>>exclude_temp.txt echo Profiles
>>exclude_temp.txt echo global_settings.json
>>exclude_temp.txt echo changelog.json
>>exclude_temp.txt echo update.bat
>>exclude_temp.txt echo update.sh
>>exclude_temp.txt echo %BACKUP_DIR%

echo Updating application files...

REM --- Copy new/updated files (excluding user data) ---
xcopy "%SRC_DIR%\*" "%CD%\" /E /H /Y /EXCLUDE:exclude_temp.txt >nul

REM --- Restore user data ---
echo Restoring user data...
if exist "%BACKUP_DIR%\IMG" (
    xcopy "%BACKUP_DIR%\IMG" "IMG\" /E /I /Q /H /Y >nul 2>&1
)
if exist "%BACKUP_DIR%\Profiles" (
    xcopy "%BACKUP_DIR%\Profiles" "Profiles\" /E /I /Q /H /Y >nul 2>&1
)
if exist "%BACKUP_DIR%\global_settings.json" (
    copy "%BACKUP_DIR%\global_settings.json" "global_settings.json" >nul 2>&1
)

REM --- Update version in global_settings.json ---
if exist global_settings.json (
    echo Updating version number...
    powershell -Command ^
        "$content = Get-Content 'global_settings.json' -Raw; $content = $content -replace '\"appVersion\"\s*:\s*\"[^\"]*\"', '\"appVersion\": \"%LATEST_NAME%\"'; Set-Content 'global_settings.json' -Value $content -NoNewline"
)

REM --- Cleanup ---
rmdir /s /q "%TMP_DIR%" 2>nul
del exclude_temp.txt 2>nul

echo.
echo ========================================
echo Update complete!
echo Updated from: %CURRENT_VER%
echo Updated to: %LATEST_VER%
echo Backup created in: %BACKUP_DIR%
echo.
echo If anything went wrong, restore from
echo the backup directory.
echo ========================================
echo.
pause

endlocal