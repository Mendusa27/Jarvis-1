@echo off
chcp 65001 >nul
title TITUS kurulum
echo TITUS bilgisayar surumu kuruluyor...
where python >nul 2>nul || (echo Python bulunamadi. python.org adresinden Python 3.10+ kur, kurarken "Add python.exe to PATH" kutusunu isaretle. & pause & exit /b)
python -m pip install --upgrade pip
for /f "usebackq delims=" %%p in ("%~dp0requirements.txt") do (
  echo --- %%p
  python -m pip install --upgrade "%%p" || echo [UYARI] %%p kurulamadi, Titus bu parca olmadan da calisir.
)
python "%~dp0kisayol_olustur.py"
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:47821/api/quit -Method Post -Body {} -TimeoutSec 2 | Out-Null}catch{}"
echo.
echo Kurulum bitti. Masaustundeki Titus simgesine cift tikla.
pause
