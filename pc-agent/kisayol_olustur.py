"""Masaüstüne Titus kısayolu oluşturur (1-KUR.bat çağırır)."""
import os, subprocess, sys
from pathlib import Path
here = Path(__file__).resolve().parent
pyw = Path(sys.executable).with_name("pythonw.exe")
if not pyw.exists():
    pyw = Path(sys.executable)
desk = Path(os.path.expandvars(r"%USERPROFILE%")) / "Desktop"
try:
    out = subprocess.run(["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], capture_output=True, text=True).stdout.strip()
    if out:
        desk = Path(out)
except Exception:
    pass
q = lambda s: str(s).replace("'", "''")
ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{q(desk / 'Titus.lnk')}');"
      f"$s.TargetPath='{q(pyw)}';$s.Arguments='\"{q(here / 'titus_gui.py')}\"';"
      f"$s.WorkingDirectory='{q(here)}';$s.IconLocation='{q(here / 'titus.ico')}';$s.Description='Titus kişisel asistan';$s.Save()")
r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], capture_output=True, text=True)
print("Masaüstüne Titus kısayolu eklendi." if r.returncode == 0 else "Kısayol oluşturulamadı: " + r.stderr[:300])
