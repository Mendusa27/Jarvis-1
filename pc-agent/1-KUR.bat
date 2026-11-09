@echo off
chcp 65001 >nul
title TITUS kurulum
echo TITUS bilgisayar surumu kuruluyor...
where python >nul 2>nul || (echo Python bulunamadi. python.org adresinden Python 3.10+ kur, kurarken "Add python.exe to PATH" kutusunu isaretle. & pause & exit /b)
python -m pip install --upgrade pip
python -m pip install -r "%~dp0requirements.txt"
python "%~dp0kisayol_olustur.py"
echo.
echo Kurulum bitti. Masaustundeki Titus simgesine cift tikla.
pause
