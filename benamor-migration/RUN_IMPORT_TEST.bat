@echo off
rem ============================================================
rem  Benamor POS - 2026 cutover import helper
rem  Run this file inside the "benamor-migration" folder.
rem  It asks for the Supabase SESSION POOLER connection parts
rem  (works on IPv4 networks; direct db.<ref>.supabase.co is IPv6-only).
rem ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem ---- use the NEWEST installed PostgreSQL version (a 13x pg_dump cannot back up a 17.x server)
set PGBIN=
for /l %%v in (99,-1,8) do (
  if not defined PGBIN if exist "C:\Program Files\PostgreSQL\%%v\bin\psql.exe" set "PGBIN=C:\Program Files\PostgreSQL\%%v\bin"
)
if defined PGBIN (
  set "PSQL=%PGBIN%\psql.exe" & set "PGDUMP=%PGBIN%\pg_dump.exe"
) else (
  where psql >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  [X] psql not found. Install PostgreSQL 17 "Command Line Tools" first:
    echo      https://www.postgresql.org/download/windows/
    echo.
    pause
    exit /b 1
  )
  set "PSQL=psql" & set "PGDUMP=pg_dump"
)
echo.
echo ------------------------------------------------------------
echo  PostgreSQL tools used: %PGBIN%  ^(empty = from PATH^)
"%PSQL%" --version
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
"%PSQL%" -c "select version();"
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
echo   5 = BACKUP this database to a file FIRST  ^(pg_dump -Fc^)
echo   6 = DRY RUN composite-products import  ^(690 kit rows^)
echo   7 = COMMIT composite-products import  ^(asks YES first^)
echo   4 = exit
echo ------------------------------------------------------------
set /p CH=choice [1/2/3/5/6/7/4] :

if "%CH%"=="1" goto prepare
if "%CH%"=="2" goto dryrun
if "%CH%"=="3" goto commit
if "%CH%"=="5" goto backup
if "%CH%"=="6" goto compdry
if "%CH%"=="7" goto compcommit
if "%CH%"=="4" goto end
goto menu

:backup
set BAKFILE=%~dp0backup_before_import.dump
echo.
echo Creating backup: %BAKFILE%
"%PGDUMP%" -Fc -f "%BAKFILE%"
if errorlevel 1 (
  echo  [X] BACKUP FAILED - do NOT run option 3 without a good backup.
  pause
  goto menu
)
echo  [OK] backup written. Keep this file somewhere safe.
pause
goto menu

:prepare
echo.
echo Running migrations 0001..0056 ...
for %%f in ("%~dp0..\supabase\migrations\*.sql") do (
  echo   %%~nxf
  "%PSQL%" -q -v ON_ERROR_STOP=1 -f "%%~ff" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  [X] FAILED at %%~nxf - re-run with: psql -f "%%~ff" to see the error
    pause
    goto menu
  )
)
echo Migrations OK. Loading current customers ...
"%PSQL%" -v ON_ERROR_STOP=1 -f "%~dp0..\new discussion github\sql\pos-customers-import.sql" >nul 2>&1
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
"%PSQL%" -v DRY_RUN=1 -f "%~dp0import_2026_cutover.sql" > "%~dp0result.txt" 2>&1
if errorlevel 1 ( echo  [X] the import script reported an ERROR - see result.txt ) else ( echo  [OK] script finished - see result.txt )
notepad "%~dp0result.txt"
goto menu

:commit
echo.
echo  *** You are about to WRITE the 2026 import to: %PGHOST% ***
set /p GO=Type YES to confirm :
if /i not "%GO%"=="YES" ( echo  Aborted - nothing committed. & pause & goto menu )
"%PSQL%" -v DRY_RUN=0 -f "%~dp0import_2026_cutover.sql" >> "%~dp0result.txt" 2>&1
if errorlevel 1 ( echo  [X] the import script reported an ERROR - see result.txt ) else ( echo  [OK] COMMITTED - see result.txt )
notepad "%~dp0result.txt"
goto menu

:compdry
echo.
echo DRY RUN composite import - a report will open in Notepad. Nothing will be written.
"%PSQL%" -v DRY_RUN=1 -f "%~dp0import_composites.sql" > "%~dp0result_composites.txt" 2>&1
if errorlevel 1 ( echo  [X] the script reported an ERROR - see result_composites.txt ) else ( echo  [OK] script finished - see result_composites.txt )
notepad "%~dp0result_composites.txt"
goto menu

:compcommit
echo.
echo  *** You are about to WRITE the composite import to: %PGHOST% ***
set /p GO2=Type YES to confirm :
if /i not "%GO2%"=="YES" ( echo  Aborted - nothing committed. & pause & goto menu )
"%PSQL%" -v DRY_RUN=0 -f "%~dp0import_composites.sql" >> "%~dp0result_composites.txt" 2>&1
if errorlevel 1 ( echo  [X] the script reported an ERROR - see result_composites.txt ) else ( echo  [OK] COMMITTED - see result_composites.txt )
notepad "%~dp0result_composites.txt"
goto menu

:end
endlocal
