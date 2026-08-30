@echo off
REM ==========================================================================
REM  Сборка AutoFishSetup.exe (Inno Setup).
REM  Результат: installer\dist\AutoFishSetup.exe
REM ==========================================================================
setlocal EnableExtensions
set "HERE=%~dp0"
set "REPO=%HERE%.."
set "STAGING=%HERE%staging"

echo === 1/2  Готовлю чистый набор файлов ===
if exist "%STAGING%" rmdir /s /q "%STAGING%"
mkdir "%STAGING%"

REM только то, что реально едет в панель: tracked-файлы минус spike/ и installer/
REM (они помечены export-ignore в .gitattributes). Cyrillic-папки не мешают.
git -C "%REPO%" archive --worktree-attributes HEAD | tar -x -C "%STAGING%"
if errorlevel 1 (
    echo   ОШИБКА: git archive / tar. Убедись, что репозиторий не пуст и tar доступен.
    pause
    exit /b 1
)
if not exist "%STAGING%\CSXS\manifest.xml" (
    echo   ОШИБКА: в staging нет CSXS\manifest.xml — что-то не так с архивом.
    pause
    exit /b 1
)

echo === 2/2  Компилирую установщик ===
set "ISCC="
for %%P in (
    "%ProgramFiles%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
    "D:\Program Files\Inno Setup 6\ISCC.exe"
) do if exist "%%~P" set "ISCC=%%~P"
if not defined ISCC for %%I in (ISCC.exe) do if exist "%%~$PATH:I" set "ISCC=%%~$PATH:I"
if not defined ISCC (
    echo   ОШИБКА: не найден ISCC.exe. Установи Inno Setup 6: https://jrsoftware.org/isdl.php
    pause
    exit /b 1
)

"%ISCC%" /Q "%HERE%auto_fish.iss"
if errorlevel 1 (
    echo   ОШИБКА компиляции Inno Setup.
    pause
    exit /b 1
)

echo.
echo   ГОТОВО:  %HERE%dist\AutoFishSetup.exe
echo.
pause
endlocal
