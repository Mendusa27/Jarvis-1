#!/usr/bin/env python3
"""
JARVIS bilgisayar ajanı — telefondaki JARVIS'ten gelen komutları bilgisayarında çalıştırır.
Ek kurulum gerekmez (sadece Python 3.8+). Windows, macOS ve Linux'ta çalışır.

Kullanım:
    python jarvis_pc.py                  # ilk çalıştırmada URL ve gizli anahtarı sorar, kaydeder
    python jarvis_pc.py --reset          # ayarları sıfırla

Güvenlik: Sadece aşağıdaki sınırlı komutları çalıştırır (uygulama/link açma, dosya arama,
dosyayı Gmail TASLAĞINA ekleme, ekran kilitleme, mesaj gösterme). Komut satırı çalıştırmaz,
dosya silmez, hiçbir şeyi kendiliğinden göndermez.
"""
import base64, json, os, platform, subprocess, sys, time, unicodedata, urllib.request, webbrowser
from pathlib import Path

CFG = Path.home() / ".jarvis_pc.json"
OS = platform.system()  # Windows / Darwin / Linux
SEARCH_DIRS = [Path.home() / d for d in ("Desktop", "Masaüstü", "Documents", "Belgeler", "Downloads", "İndirilenler")]
MAX_MAIL_MB = 20


def norm(s):
    s = str(s).replace("İ", "i").replace("I", "ı").lower().replace("ı", "i")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def load_cfg():
    if "--reset" in sys.argv and CFG.exists():
        CFG.unlink()
    if CFG.exists():
        return json.loads(CFG.read_text("utf-8"))
    print("JARVIS bilgisayar ajanı kurulumu")
    url = input("Apps Script web uygulaması URL (…/exec): ").strip()
    tok = input("Gizli anahtar (Code.gs içindeki TOKEN): ").strip()
    cfg = {"url": url, "token": tok}
    CFG.write_text(json.dumps(cfg), "utf-8")
    return cfg


def call(cfg, action, **data):
    body = json.dumps({"token": cfg["token"], "action": action, **data}).encode("utf-8")
    req = urllib.request.Request(cfg["url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode("utf-8"))
    if not j.get("ok"):
        raise RuntimeError(j.get("error", "hata"))
    return j


# ---------------- komutlar ----------------
def notify(msg):
    print("JARVIS:", msg)
    try:
        if OS == "Windows":
            import ctypes, threading
            threading.Thread(target=lambda: ctypes.windll.user32.MessageBoxW(0, msg, "J.A.R.V.I.S.", 0x40 | 0x40000), daemon=True).start()
        elif OS == "Darwin":
            subprocess.Popen(["osascript", "-e", f'display notification {json.dumps(msg)} with title "JARVIS"'])
        else:
            subprocess.Popen(["notify-send", "JARVIS", msg])
    except Exception:
        pass
    return {"ok": True}


def open_app(name):
    q = norm(name)
    if OS == "Windows":
        roots = [Path(os.environ.get("ProgramData", "C:/ProgramData")) / "Microsoft/Windows/Start Menu/Programs",
                 Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs", Path.home() / "Desktop"]
        best = None
        for r in roots:
            if not r.exists():
                continue
            for p in r.rglob("*.lnk"):
                n = norm(p.stem)
                score = 3 if n == q else 2 if n.startswith(q) else 1 if q in n else 0
                if score and (not best or score > best[0]):
                    best = (score, p)
        if best:
            os.startfile(str(best[1]))
            return {"ok": True, "acildi": best[1].stem}
        subprocess.Popen(["cmd", "/c", "start", "", name], shell=False)
        return {"ok": True, "denendi": name}
    if OS == "Darwin":
        r = subprocess.run(["open", "-a", name], capture_output=True, text=True)
        return {"ok": r.returncode == 0, "hata": r.stderr.strip() or None}
    try:
        subprocess.Popen([name.lower()])
        return {"ok": True}
    except FileNotFoundError:
        return {"ok": False, "hata": "Uygulama bulunamadı"}


def find_files(query, limit=10):
    q = norm(query)
    hits = []
    for base in SEARCH_DIRS:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(base):
            if root.count(os.sep) - str(base).count(os.sep) > 4:
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "AppData")]
            for f in files:
                if q in norm(f):
                    p = Path(root) / f
                    try:
                        hits.append((p.stat().st_mtime, p))
                    except OSError:
                        pass
    hits.sort(reverse=True)
    return [p for _, p in hits[:limit]]


def mail_file(cfg, query, to):
    files = find_files(query, 1)
    if not files:
        return {"ok": False, "hata": f'"{query}" adında dosya bulunamadı (Masaüstü/Belgeler/İndirilenler).'}
    f = files[0]
    size = f.stat().st_size / 1e6
    if size > MAX_MAIL_MB:
        return {"ok": False, "hata": f"Dosya {size:.1f} MB; Gmail eki için çok büyük."}
    b64 = base64.b64encode(f.read_bytes()).decode()
    call(cfg, "mailDraftFile", to=to or "", subject=f.stem, body="Merhaba,\n\nEkte paylaşıyorum.\n\nBurak", fileName=f.name, fileB64=b64)
    return {"ok": True, "dosya": f.name, "not": "Gmail'de taslak hazır; kontrol edip gönder."}


def lock():
    if OS == "Windows":
        import ctypes
        ctypes.windll.user32.LockWorkStation()
    elif OS == "Darwin":
        subprocess.run(["pmset", "displaysleepnow"])
    else:
        subprocess.run(["loginctl", "lock-session"])
    return {"ok": True}


def run(cfg, cmd):
    a, arg, arg2 = cmd.get("action"), cmd.get("arg", ""), cmd.get("arg2", "")
    if a == "notify":
        return notify(arg or "Merhaba Burak")
    if a == "open_app":
        return open_app(arg)
    if a == "open_url":
        url = arg if arg.startswith("http") else "https://" + arg
        webbrowser.open(url)
        return {"ok": True}
    if a == "find_file":
        fs = find_files(arg)
        return {"ok": True, "dosyalar": [str(p) for p in fs]}
    if a == "mail_file":
        return mail_file(cfg, arg, arg2)
    if a == "lock":
        return lock()
    return {"ok": False, "hata": "Bilinmeyen komut: " + str(a)}


def main():
    cfg = load_cfg()
    print(f"JARVIS ajanı çalışıyor ({OS}). Kapatmak için Ctrl+C.")
    fails = 0
    while True:
        try:
            for c in call(cfg, "pcPull").get("cmds", []):
                print("→", c["cmd"])
                try:
                    res = run(cfg, c["cmd"])
                except Exception as e:
                    res = {"ok": False, "hata": str(e)}
                call(cfg, "pcDone", id=c["id"], result=res)
                print("  ", res)
            fails = 0
            time.sleep(4)
        except KeyboardInterrupt:
            print("Görüşürüz Burak.")
            return
        except Exception as e:
            fails += 1
            print("Bağlantı hatası:", e)
            time.sleep(min(60, 5 * fails))


if __name__ == "__main__":
    main()
