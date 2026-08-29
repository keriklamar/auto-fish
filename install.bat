@echo off
REM ==========================================================================
REM  Auto Fish - установка панели в Adobe Premiere Pro (CEP-расширение)
REM  Нужен только установленный Premiere. Node/Python/админ-права НЕ нужны.
REM  Закрой Premiere -> запусти этот файл -> открой Premiere ->
REM  Window -> Extensions -> Auto Fish
REM ==========================================================================
setlocal EnableExtensions

set "SRC=%~dp0"
set "EXTROOT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXTROOT%\auto_fish"

echo.
echo   Auto Fish - установка
echo   Откуда: %SRC%
echo   Куда:   %DEST%
echo.

if not exist "%SRC%CSXS\manifest.xml" (
    echo   ОШИБКА: рядом с install.bat нет CSXS\manifest.xml.
    echo   Запускай install.bat из распакованной папки Auto Fish целиком.
    echo.
    pause
    exit /b 1
)

if not exist "%EXTROOT%" mkdir "%EXTROOT%"

if exist "%DEST%" (
    echo   Удаляю прошлую версию...
    rmdir /s /q "%DEST%"
)

REM снести старую панель-мост из эпохи PyQt-приложения, если осталась
if exist "%EXTROOT%\auto_fish_bridge" (
    echo   Удаляю устаревшую панель auto_fish_bridge...
    rmdir /s /q "%EXTROOT%\auto_fish_bridge"
)

mkdir "%DEST%"

REM node_modules нужен для работы - копируем всё, кроме dev-файлов
robocopy "%SRC%." "%DEST%" /E /NFL /NDL /NJH /NJS /NP ^
    /XD spike .git "всякое" ^
    /XF install.bat uninstall.bat "*.log" ".gitignore" ".gitattributes" >nul
if errorlevel 8 (
    echo.
    echo   ОШИБКА копирования. Обычно причина - открытый Premiere. Закрой его и повтори.
    echo.
    pause
    exit /b 1
)

REM PlayerDebugMode=1 - разрешает Premiere грузить неподписанное расширение.
REM Ставим для нескольких версий CSXS-рантайма (лишние ветки безвредны).
for %%V in (6 7 8 9 10 11 12) do (
    reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

echo.
echo   ГОТОВО.
echo   1) Полностью закрой и заново открой Premiere Pro.
echo   2) Меню Window  ^>  Extensions  ^>  Auto Fish
echo.
pause
endlocal
