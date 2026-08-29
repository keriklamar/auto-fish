@echo off
REM ===========================================================================
REM  Auto Fish - удаление панели из Adobe Premiere Pro
REM ===========================================================================
setlocal EnableExtensions
set "DEST=%APPDATA%\Adobe\CEP\extensions\auto_fish"

echo.
if exist "%DEST%" (
    echo   Удаляю: %DEST%
    rmdir /s /q "%DEST%"
    echo   Готово. Перезапусти Premiere.
) else (
    echo   Панель не найдена - похоже, уже удалена.
)
echo.
echo   PlayerDebugMode в реестре не трогаем - им пользуются и другие расширения.
echo.
pause
endlocal
