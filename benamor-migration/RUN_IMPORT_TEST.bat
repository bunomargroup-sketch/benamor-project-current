@echo off
rem ============================================================
rem  Benamor POS - 2026 cutover import helper
rem  Run this file inside the "benamor-migration" folder.
rem  It asks for the Supabase SESSION POOLER connection parts
rem  (works on IPv4 networks; direct db.<ref>.supabase.co is IPv6-only).
rem ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where psql >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [X] psql not found. Install PostgreSQL "Command Line Tools" first:
  echo      https://www.postgresql.org/download/windows/
  echo.
  pause
  exit /b 1
)
echo.
echo ------------------------------------------------------------
echo  psql found:
psql --version
echo ------------------------------------------------------------
echo.
echo  Open Supabase -^> your project -^> Connect (top bar) -^>
echo  "Session pooler". Copy the parts from there.
echo  ^(User looks like: postgres.blbffayoivvzdgbcriqe^)
echo.
set /p PGHOST=Host [example: aws-0-eu-west-1.pooler.supabase.com] :
set /p PGUSER=User [example: postgres.blbffayoivvzdgbcriqe] :
set /p PGPASSWORD=Password :
set PGDATABASE=postgres
set PGPORT=5432
set PGCLIENTENCODING=UTF8

echo.
echo Testing connection to %PGHOST% ...
psql -c "select version();"
if errorlevel 1 (
  echo.
  echo  [X] CONNECTION FAILED. Check host / user / password and try again.
  echo      Nothing was touched.
  pause
  exit /b 1
)

:menu
echo.
echo ------------------------------------------------------------
echo  Connected to: %PGHOST%  as %PGUSER%
echo ------------------------------------------------------------
echo   1 = prepare an EMPTY test project ^(run 56 migrations + current customers^)
echo   2 = DRY RUN the 2026 import  ^(writes NOTHING - safe anywhere^)
echo   3 = COMMIT the 2026 import to THIS database
echo   4 = exit
echo ------------------------------------------------------------
set /p CH=choice [1/2/3/4] :

if "%CH%"=="1" goto prepare
if "%CH%"=="2" goto dryrun
if "%CH%"=="3" goto commit
if "%CH%"=="4" goto end
goto menu

:prepare
echo.
echo Running migrations 0001..0056 ...
for %%f in ("%~dp0..\supabase\migrations\*.sql") do (
  echo   %%~nxf
  psql -q -v ON_ERROR_STOP=1 -f "%%~ff" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  [X] FAILED at %%~nxf - re-run with: psql -f "%%~ff" to see the error
    pause
    goto menu
  )
)
echo Migrations OK. Loading current customers ...
psql -v ON_ERROR_STOP=1 -f "%~dp0..\new discussion github\sql\pos-customers-import.sql" >nul 2>&1
if errorlevel 1 (
  echo  [X] customers import failed - run it manually to see the error
  pause
  goto menu
)
echo  [OK] test database prepared.
pause
goto menu

:dryrun
echo.
echo DRY RUN - a report will open in Notepad. Nothing will be written.
psql -v DRY_RUN=1 -f "%~dp0import_2026_cutover.sql" > "%~dp0result.txt" 2>&1
if errorlevel 1 ( echo  [X] the import script reported an ERROR - see result.txt ) else ( echo  [OK] script finished - see result.txt )
notepad "%~dp0result.txt"
goto menu

:commit
echo.
echo  *** You are about to WRITE the 2026 import to: %PGHOST% ***
set /p GO=Type YES to confirm :
if /i not "%GO%"=="YES" ( echo  Aborted - nothing committed. & pause & goto menu )
psql -v DRY_RUN=0 -f "%~dp0import_2026_cutover.sql" >> "%~dp0result.txt" 2>&1
if errorlevel 1 ( echo  [X] the import script reported an ERROR - see result.txt ) else ( echo  [OK] COMMITTED - see result.txt )
notepad "%~dp0result.txt"
goto menu

:end
endlocal
