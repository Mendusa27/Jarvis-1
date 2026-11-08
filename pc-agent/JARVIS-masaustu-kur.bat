@echo off
title Titus kurulum
echo Titus bilgisayar surumu kuruluyor...
where python >nul 2>nul || (echo Python bulunamadi. python.org adresinden Python 3.10+ kur, kurarken "Add python to PATH" kutusunu isaretle. & pause & exit /b)
python -m pip install --upgrade pip
python -m pip install -r "%~dp0requirements.txt"
echo.
echo Kurulum bitti. Simdi JARVIS-masaustu.bat ile baslat.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath(\"Desktop\")+\"\\JARVIS.lnk\"); $s.TargetPath=\"%~dp0JARVIS-masaustu.bat\"; $s.WorkingDirectory=\"%~dp0\"; $s.Save()"
echo Masaustune Titus kisayolu eklendi.
pause
