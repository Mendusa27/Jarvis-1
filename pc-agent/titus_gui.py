#!/usr/bin/env python3
"""
T.I.T.U.S. — Bilgisayar için pencereli arayüz (v2.5).
Sekmeler: Sohbet · Görevler · Hafıza · Günlük · Ayarlar.
Ek paket gerekmez: arayüz bilgisayardaki Edge/Chrome'da uygulama penceresi olarak açılır.
"""
import json, os, subprocess, sys, threading, time, traceback, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ["TITUS_GUI"] = "1"
HERE = Path(__file__).resolve().parent
PORT = 47821
URL = f"http://127.0.0.1:{PORT}/"
GUI_VERSION = "2.6"


def open_window():
    """Edge/Chrome'u adres çubuğu olmadan, uygulama penceresi gibi açar."""
    cands = []
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", ""), os.environ.get("LOCALAPPDATA", "")):
            cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe"]
    for exe in cands:
        if exe.exists():
            try:
                subprocess.Popen([str(exe), f"--app={URL}", "--window-size=480,820", "--window-position=60,30"])
                return
            except Exception:
                pass
    webbrowser.open(URL)


def _ping():
    try:
        with urllib.request.urlopen(URL + "api/ping", timeout=0.8) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


# --- tek kopya: aynı sürüm açıksa sadece pencereyi göster; ESKİ sürüm açıksa kapatıp yenisini başlat ---
old = _ping()
if old is not None:
    if old.get("v") == GUI_VERSION and "--yeniden" not in sys.argv:
        open_window(); sys.exit(0)
    try:
        urllib.request.urlopen(urllib.request.Request(URL + "api/quit", data=b"{}", headers={"Content-Type": "application/json"}), timeout=2)
    except Exception:
        pass
    for _ in range(30):  # eski kopya kapanana kadar bekle
        time.sleep(0.2)
        if _ping() is None:
            break

try:
    sys.path.insert(0, str(HERE))
    import jarvis_desktop as J
except BaseException as e:  # eksik paket vb.
    try:
        import tkinter, tkinter.messagebox
        r = tkinter.Tk(); r.withdraw()
        tkinter.messagebox.showerror("Titus", f"Titus başlatılamadı:\n{e}\n\nÖnce 1-KUR.bat dosyasını çalıştır.")
    except Exception:
        print(e)
    sys.exit(1)

try:
    import titus_plus as TP
except Exception:
    TP = None
try:
    import titus_extra as TX
except Exception:
    TX = None

EVENTS, LOCK = [], threading.Lock()
STATE = {"durum": "hazır", "n": 0}
CHAT_FILE = "sohbet.json"
SAVED_KINDS = ("sen", "titus", "arac", "hata", "hatirlatma")


def _persist():
    try:
        with LOCK:
            keep = [{k: v for k, v in e.items() if k != "gizli"} for e in EVENTS if e["k"] in SAVED_KINDS][-150:]
        J.jsave(CHAT_FILE, keep)
    except Exception:
        pass


def on_event(kind, data):
    if kind == "durum":
        STATE["durum"] = data
    with LOCK:
        STATE["n"] += 1
        EVENTS.append({"id": STATE["n"], "k": kind, "d": data, "t": time.strftime("%H:%M")})
        if len(EVENTS) > 500:
            del EVENTS[:-350]
    if kind in ("titus", "hata", "hatirlatma", "tur_son"):
        threading.Thread(target=_persist, daemon=True).start()


# önceki sohbeti geri yükle
for e in J.jload(CHAT_FILE, []):
    if isinstance(e, dict) and e.get("k") in SAVED_KINDS:
        STATE["n"] += 1
        EVENTS.append({"id": STATE["n"], "k": e["k"], "d": e.get("d", ""), "t": e.get("t", ""), "eski": True})

_base_emit_hook = J.ON_EVENT


LIVE_BUF = {"sen": "", "titus": ""}


def _hook(kind, data):
    on_event(kind, data)
    # canlı sohbetin tamamlanan turunu kalıcı kayda çevir (pencereyi yeniden açınca görünsün)
    if kind == "sen_canli":
        LIVE_BUF["sen"] = data
    elif kind == "titus_canli":
        LIVE_BUF["titus"] = data
    elif kind == "tur_son":
        with LOCK:
            for k in ("sen", "titus"):
                if LIVE_BUF[k]:
                    STATE["n"] += 1
                    EVENTS.append({"id": STATE["n"], "k": k, "d": LIVE_BUF[k], "t": time.strftime("%H:%M"), "eski": True, "gizli": True})
        LIVE_BUF["sen"] = LIVE_BUF["titus"] = ""
        threading.Thread(target=_persist, daemon=True).start()


J.ON_EVENT = _hook


def run_text(text):
    if J.LIVE_CHAT and J.LIVE_CHAT.send_text(text):
        return
    def work():
        with J.BUSY:
            on_event("sen", text)
            on_event("durum", "düşünüyor")
            try:
                reply = J.think(text)
            except Exception as e:
                J.log("hata", f"cevap verilemedi: {getattr(e, 'status', '')} {getattr(e, 'msg', e)}\n{traceback.format_exc()[-1500:]}")
                reply = J.friendly(e)
            J.speak(reply)
            on_event("durum", "hazır")
    threading.Thread(target=work, daemon=True).start()


def listen_now():
    if J.BUSY.locked():  # sohbet sürüyorsa küreye tıklamak sohbeti/işi bitirir
        J.LIVE_STOP.set(); J.stop_speaking()
        if getattr(J, "AGENT_STOP", None):
            J.AGENT_STOP.set()
        if J.LIVE_CHAT:
            J.LIVE_CHAT.player.clear()
        return
    J.TRIGGER.set()


def masked(v):
    return ("•" * 8 + v[-4:]) if v and len(v) > 8 else ("•" * len(v) if v else "")


def public_cfg():
    c = dict(J.C)
    for k in ("gemini_key", "groq_key", "token", "cf_token"):
        c[k] = masked(c.get(k, ""))
    c["autostart"] = startup_link().exists()
    c["version"] = J.VERSION
    return c


def startup_link():
    return Path(os.environ.get("APPDATA", str(Path.home()))) / "Microsoft/Windows/Start Menu/Programs/Startup/Titus.lnk"


def set_autostart(on):
    if os.name != "nt":
        return
    lnk = startup_link()
    if not on:
        try: lnk.unlink()
        except FileNotFoundError: pass
        return
    pyw = Path(sys.executable).with_name("pythonw.exe")
    if not pyw.exists():
        pyw = Path(sys.executable)
    q = lambda s: str(s).replace("'", "''")
    ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{q(lnk)}');$s.TargetPath='{q(pyw)}';"
          f"$s.Arguments='\"{q(HERE / 'titus_gui.py')}\" --arka';$s.WorkingDirectory='{q(HERE)}';$s.IconLocation='{q(HERE / 'titus.ico')}';$s.Save()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)


CITIES = {"istanbul": (41.0082, 28.9784), "ankara": (39.9334, 32.8597), "izmir": (38.4237, 27.1428), "kütahya": (39.4242, 29.9833), "kutahya": (39.4242, 29.9833),
          "bursa": (40.1885, 29.0610), "antalya": (36.8969, 30.7133), "eskişehir": (39.7767, 30.5206), "eskisehir": (39.7767, 30.5206)}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        try:
            self._get()
        except Exception as e:
            J.log("hata", f"arayüz GET {self.path}: {e}")
            self.send(200, {"hata": str(e)})

    def do_POST(self):
        try:
            self._post()
        except Exception as e:
            J.log("hata", f"arayüz POST {self.path}: {e}\n{traceback.format_exc()[-800:]}")
            self.send(200, {"hata": J.friendly(e)})

    def _get(self):
        p = self.path
        if p in ("/", "/index.html"):
            return self.send(200, PAGE.encode("utf-8"), "text/html")
        if p.startswith("/api/ping"):
            return self.send(200, {"ok": True, "v": GUI_VERSION})
        if p.startswith("/api/state"):
            since = int((p.split("since=") + ["0"])[1] or 0)
            with LOCK:
                ev = [e for e in EVENTS if e["id"] > since and not (e.get("gizli") and since > 0)]
            return self.send(200, {"durum": STATE["durum"], "olaylar": ev, "hazir": bool(J.C.get("gemini_key")), "ayar": public_cfg()})
        if p.startswith("/api/log"):
            return self.send(200, {"log": [list(x) for x in J.LOG[-300:]]})
        if p.startswith("/api/apps"):
            return self.send(200, {"apps": TX.apps() if TX else []})
        if p.startswith("/api/memory"):
            return self.send(200, {"hafiza": TP.mem_list() if TP else []})
        if p.startswith("/api/tasks"):
            out = {"yerel": [r for r in (TP.rem_list() if TP else []) if not r.get("done")]}
            if "telefon=1" in p and TP:
                try:
                    out["telefon"] = TP.phone_lists()
                except Exception as e:
                    out["telefon"] = {"bagli": True, "hata": J.friendly(e)}
            return self.send(200, out)
        self.send(404, {"hata": "yok"})

    def _post(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}
        p = self.path
        if p == "/api/send":
            t = str(body.get("text", "")).strip()
            if t:
                if not J.C.get("gemini_key"):
                    return self.send(200, {"hata": "Önce Ayarlar'dan Gemini anahtarını gir."})
                run_text(t)
            return self.send(200, {"ok": True})
        if p == "/api/listen":
            if not J.C.get("gemini_key"):
                return self.send(200, {"hata": "Önce Ayarlar'dan Gemini anahtarını gir."})
            listen_now(); return self.send(200, {"ok": True})
        if p == "/api/stop":
            J.stop_speaking()
            if getattr(J, "AGENT_STOP", None):
                J.AGENT_STOP.set()
            if J.LIVE_CHAT:
                J.LIVE_CHAT.player.clear()
            return self.send(200, {"ok": True})
        if p == "/api/config":
            new = {}
            for k, v in body.items():
                if k in ("gemini_key", "groq_key", "token", "cf_token") and (not v or str(v).startswith("•")):
                    continue  # değiştirilmemiş gizli alan
                new[k] = v.strip() if isinstance(v, str) else v
            city = str(new.get("city", "")).strip().lower()
            if city in CITIES:
                new["lat"], new["lon"] = CITIES[city]
            if "autostart" in body:
                set_autostart(bool(body["autostart"]))
            J.save_cfg(new)
            J.log("bilgi", "Ayarlar kaydedildi")
            return self.send(200, {"ok": True, "ayar": public_cfg()})
        if p == "/api/clear":
            J.HIST.clear(); J.save_hist()
            with LOCK:
                EVENTS.clear()
            J.jsave(CHAT_FILE, [])
            return self.send(200, {"ok": True})
        if p == "/api/pair":
            r = TX.apply_pair(body.get("code", ""))
            r["ayar"] = public_cfg()
            return self.send(200, r)
        if p == "/api/app/open":
            return self.send(200, TX.open_app(body.get("k", "")))
        if p == "/api/app/add":
            n, u = str(body.get("n", "")).strip(), str(body.get("u", "")).strip()
            if n and u:
                J.save_cfg({"apps": (J.C.get("apps") or []) + [{"n": n, "u": u if u.startswith("http") else "https://" + u}]})
            return self.send(200, {"ok": True})
        if p == "/api/app/del":
            lst = list(J.C.get("apps") or []); i = int(body.get("i", -1))
            if 0 <= i < len(lst):
                lst.pop(i); J.save_cfg({"apps": lst})
            return self.send(200, {"ok": True})
        if p == "/api/selftest":
            return self.send(200, TP.selftest() if TP else {"sonuclar": []})
        if p == "/api/memory/del":
            return self.send(200, TP.mem_del(int(body.get("i", -1))))
        if p == "/api/memory/add":
            return self.send(200, TP.mem_add(body.get("t", "")))
        if p == "/api/task/add":
            return self.send(200, TP.rem_add({"text": body.get("text", ""), "due": body.get("due", ""), "repeat": body.get("repeat", "none")}))
        if p == "/api/task/done":
            return self.send(200, TP.rem_done(body.get("id", "")))
        if p == "/api/quit":
            self.send(200, {"ok": True})
            threading.Timer(0.3, lambda: os._exit(0)).start()
            return
        self.send(404, {"hata": "yok"})


def trigger_loop():
    while True:
        J.TRIGGER.wait()
        J.TRIGGER.clear()
        if not J.C.get("gemini_key"):
            on_event("hata", "Önce Ayarlar'dan Gemini anahtarını gir.")
            continue
        try:
            J.converse()
        except Exception as e:
            J.log("hata", f"sohbet: {e}\n{traceback.format_exc()[-1200:]}")
            on_event("hata", J.friendly(e))
        on_event("durum", "hazır")


PAGE = r"""<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Titus</title>
<style>
:root{--bg:#0a0304;--panel:rgba(34,9,11,.85);--line:rgba(255,72,72,.22);--red:#ff3b3b;--red2:#ff9b8f;--txt:#fff0ee;--dim:#bf948f;--ok:#3ee68a;--warn:#ff9f43}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:radial-gradient(ellipse at 50% -10%,#2c0a0d 0%,var(--bg) 60%);color:var(--txt);font:15px/1.45 "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden;user-select:none}
body:before{content:"";position:fixed;inset:0;background-image:linear-gradient(rgba(255,59,59,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,59,59,.035) 1px,transparent 1px);background-size:28px 28px;pointer-events:none}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px 4px;position:relative}
.logo{font-weight:800;letter-spacing:.35em;color:var(--red);font-size:18px}.logo small{display:block;letter-spacing:.2em;color:var(--dim);font-size:10px;font-weight:600}
.clock{text-align:right;font-weight:700;color:var(--red2);font-size:18px}.clock small{display:block;color:var(--dim);font-size:11px;font-weight:500}
.view{display:none;flex:1;flex-direction:column;min-height:0;position:relative}.view.on{display:flex}
.top{display:flex;flex-direction:column;align-items:center;padding:4px 0 2px}
.orb{width:120px;height:120px;border-radius:50%;position:relative;cursor:pointer;border:none;background:none;padding:0}
.orb .ring{position:absolute;inset:0;border-radius:50%;border:2px dashed rgba(255,59,59,.45)}
.orb .arc{position:absolute;inset:11px;border-radius:50%;border:4px solid transparent;border-top-color:var(--red);border-bottom-color:var(--red);animation:spin 6s linear infinite}
.orb .core{position:absolute;inset:33px;border-radius:50%;background:radial-gradient(circle at 45% 40%,#ffd0c8,#ff3b3b 45%,#9a1414 80%);box-shadow:0 0 40px rgba(255,59,59,.6),0 0 90px rgba(255,59,59,.25);transition:transform .25s}
.orb:hover .core{transform:scale(1.06)}
body.dinliyor .orb .core{animation:pulse .9s ease-in-out infinite}body.dinliyor .orb .arc{animation-duration:1.4s}
body.düşünüyor .orb .arc,body.anlıyor .orb .arc,body.çalışıyor .orb .arc{animation-duration:.8s;border-left-color:var(--red2)}
body.konuşuyor .orb .core{animation:pulse .5s ease-in-out infinite alternate}
body.bağlanıyor .orb .arc{animation-duration:.6s;border-left-color:var(--red2);border-right-color:var(--red2)}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
.status{margin-top:6px;letter-spacing:.35em;font-size:11px;font-weight:700;color:var(--dim)}
.hint{color:var(--dim);font-size:12px;margin-top:2px;padding:0 18px;text-align:center}
.chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;padding:8px 12px 4px}
.chip{background:rgba(255,59,59,.08);border:1px solid var(--line);color:var(--txt);padding:5px 10px;border-radius:999px;cursor:pointer;font:13px inherit;font-family:inherit}.chip:hover{border-color:var(--red)}
#log{flex:1;overflow-y:auto;padding:6px 16px 8px;display:flex;flex-direction:column;gap:8px;user-select:text}
.m{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
.m.t{background:var(--panel);border:1px solid var(--line);align-self:flex-start}.m.t b{display:block;color:var(--red);font-size:10px;letter-spacing:.2em;margin-bottom:2px}
.m.s{background:linear-gradient(180deg,#e03030,#9a1414);align-self:flex-end}
.m.a{align-self:center;color:var(--dim);font-size:12px;padding:2px 8px}
.m.e{align-self:center;color:var(--warn);font-size:13px;border:1px solid rgba(255,159,67,.4);background:rgba(255,159,67,.08);cursor:pointer}
.m.r{align-self:center;border:1px solid var(--red);background:rgba(255,59,59,.12)}
.m.old{opacity:.6}
.bar{display:flex;gap:8px;padding:8px 14px 8px}
.bar input,.in input[type=text],.in input[type=password],.in input[type=datetime-local],.in select,.in textarea{width:100%;background:rgba(10,2,3,.82);border:1px solid var(--line);color:var(--txt);border-radius:12px;padding:0 13px;height:44px;font:15px inherit;font-family:inherit;outline:none}
.in textarea{height:auto;padding:10px 13px;min-height:70px}
.bar input:focus,.in input:focus{border-color:var(--red)}
.btn{background:linear-gradient(180deg,#e03030,#9a1414);border:1px solid #ff6a5e;color:#fff;border-radius:12px;min-width:44px;height:44px;cursor:pointer;font-size:16px;font-family:inherit;padding:0 14px}
.btn.ghost{background:none;border-color:var(--line);color:var(--txt);font-size:14px}.btn.sm{height:34px;font-size:13px;padding:0 10px;border-radius:10px;min-width:0}
.in{overflow-y:auto;padding:4px 16px 16px;flex:1;user-select:text}
h2{margin:6px 0 0;font-size:13px;letter-spacing:.25em;color:var(--red)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:12px}
.card h3{margin:0 0 8px;font-size:11px;letter-spacing:.25em;color:var(--red2)}
label.f{display:block;color:var(--dim);font-size:12px;margin:8px 0 4px}
.tg{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0}.tg small{display:block;color:var(--dim);font-size:12px}
.sw{appearance:none;width:46px;height:26px;border-radius:20px;background:#3d2224;position:relative;flex:none;border:1px solid var(--line);cursor:pointer}
.sw:before{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#c9a8a5;transition:.2s}.sw:checked{background:#9a1414}.sw:checked:before{left:22px;background:var(--red)}
.note{color:var(--dim);font-size:12px;margin-top:6px}.note a{color:var(--red2)}
.row{display:flex;gap:8px;align-items:center}
.item{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,72,72,.12)}.item:last-child{border-bottom:none}
.item .t{flex:1;min-width:0}.item .meta{color:var(--dim);font-size:12px}
.x{background:none;border:none;color:var(--dim);cursor:pointer;font-size:16px}.x:hover{color:var(--red)}
.empty{color:var(--dim);text-align:center;padding:14px;font-size:13px}
.lg{font:12px/1.4 Consolas,monospace;white-space:pre-wrap;word-break:break-word;padding:5px 0;border-bottom:1px solid rgba(255,72,72,.08)}
.lg.hata{color:#ff8a80}.lg.uyarı{color:var(--warn)}.lg .tm{color:var(--dim)}
.ok{color:var(--ok)}.no{color:#ff8a80}
nav{display:flex;border-top:1px solid var(--line);background:rgba(10,2,3,.9)}
nav button{flex:1;background:none;border:none;color:var(--dim);padding:8px 0 10px;cursor:pointer;font:11px inherit;font-family:inherit}
nav button i{display:block;font-style:normal;font-size:18px;margin-bottom:2px}nav button.on{color:var(--red)}
.appgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.app{position:relative;background:rgba(255,59,59,.07);border:1px solid var(--line);border-radius:12px;padding:10px 4px 8px;color:var(--txt);display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;font-family:inherit;cursor:pointer}
.app:hover{border-color:var(--red)}.app i{font-style:normal;font-size:26px}.app b{font-size:12px;line-height:1.15}.app small{font-size:10px;color:var(--dim);line-height:1.15}.app.off{opacity:.55}.app .x{position:absolute;top:2px;right:6px}
.welcome{margin:auto;text-align:center;color:var(--dim);padding:20px}.welcome b{color:var(--txt)}
::-webkit-scrollbar{width:8px}::-webkit-scrollbar-thumb{background:rgba(255,59,59,.25);border-radius:8px}
</style></head><body class="hazır">
<header><div class="logo">T.I.T.U.S.<small id="sub">BİLGİSAYAR ASİSTANI</small></div><div class="clock" id="clk"></div></header>

<section class="view on" id="v-chat">
<div class="top"><button class="orb" id="orb" title="Konuşmak için tıkla"><span class="ring"></span><span class="arc"></span><span class="core"></span></button>
<div class="status" id="st">HAZIR</div><div class="hint" id="hk">Tıkla, “Titus” de ya da Ctrl+Alt+J</div></div>
<div class="chips">
<button class="chip" data-q="Sabah brifingimi ver.">☀️ Brifing</button>
<button class="chip" data-q="Ekranda ne var? Kısaca anlat.">👁 Ekranda ne var</button>
<button class="chip" data-q="Panodaki metni özetle.">📋 Panoyu özetle</button>
<button class="chip" data-q="İndirilenler klasörünü düzenle.">🗂 İndirilenleri düzenle</button>
<button class="chip" data-q="Bugün gündemde ne var? İnternetten bak, kısaca anlat.">📰 Gündem</button>
<button class="chip" data-q="Okunmamış maillerimi özetle, önemli olan var mı?">✉️ Mailler</button>
<button class="chip" data-q="Ekranı kilitle.">🔒 Kilitle</button>
</div>
<div id="log"></div>
<div class="bar"><input id="q" placeholder="Titus'a yaz… (Esc: sustur / durdur)" autocomplete="off"><button class="btn" id="send" title="Gönder">➤</button></div>
</section>

<section class="view" id="v-tasks"><div class="in">
<h2>GÖREVLER</h2>
<div class="card"><h3>YENİ HATIRLATICI</h3><div class="row"><input type="text" id="tText" placeholder="Ne hatırlatayım?"></div>
<div class="row" style="margin-top:8px"><input type="datetime-local" id="tDue" style="flex:1;min-width:0"><select id="tRep" style="width:108px;flex:none"><option value="none">Bir kez</option><option value="daily">Her gün</option><option value="weekly">Her hafta</option><option value="monthly">Her ay</option></select><button class="btn sm" id="tAdd" style="flex:none">Ekle</button></div>
<div class="note">Zamanı gelince Windows bildirimi gelir ve Titus sesli söyler. Sohbette “yarın 10'da annemi aramayı hatırlat” da diyebilirsin.</div></div>
<div class="card"><h3>BİLGİSAYARDAKİLER</h3><div id="tLocal"></div></div>
<div class="card"><h3>TELEFONDAKİLER</h3><div id="tPhone"><div class="empty">Yükleniyor…</div></div><button class="btn ghost sm" id="tRef" style="margin-top:8px">↻ Yenile</button></div>
</div></section>

<section class="view" id="v-mem"><div class="in">
<h2>HAFIZA</h2>
<div class="card"><h3>TITUS SENİN HAKKINDA NE BİLİYOR</h3><div class="note" style="margin-top:0">Sohbette “bunu hatırla: …” dediğinde ya da kendinle ilgili kalıcı bir şey söylediğinde buraya eklenir. İstemediğini sil.</div>
<div class="row" style="margin-top:8px"><input type="text" id="mText" placeholder="Elle ekle (ör. Kahveyi şekersiz içerim)"><button class="btn sm" id="mAdd">Ekle</button></div>
<div id="mList" style="margin-top:6px"></div></div>
</div></section>

<section class="view" id="v-logs"><div class="in">
<h2>GÜNLÜK</h2>
<div class="card"><h3>SİSTEM KONTROLÜ</h3><div class="note" style="margin-top:0">Bir şey çalışmıyorsa önce buna bas: internet, Gemini, mikrofon, paketler tek tek denenir.</div>
<button class="btn sm" id="selfBtn" style="margin-top:8px">🩺 Kontrol et</button><div id="selfOut" style="margin-top:8px"></div></div>
<div class="card"><h3>KAYITLAR</h3><div class="row"><button class="btn ghost sm" id="lgRef">↻ Yenile</button><button class="btn ghost sm" id="lgCopy">📋 Kopyala</button><label class="row" style="color:var(--dim);font-size:12px;gap:6px"><input type="checkbox" id="lgErr"> sadece hatalar</label></div>
<div id="lgList" style="margin-top:8px"></div></div>
</div></section>

<section class="view" id="v-set"><div class="in">
<h2>AYARLAR</h2>
<div class="card"><h3>TELEFONDAN TEK KODLA BAĞLAN (ÖNERİLEN)</h3>
<div class="note" style="margin-top:0">Telefondaki Titus → Ayarlar → “Bilgisayarı bağla” → “Bağlantı kodu oluştur”. Kodu buraya yapıştır: anahtarlar, Gmail, takvim, KADRO ve görevler tek seferde gelir.</div>
<textarea id="pairIn" placeholder="TITUS1.…" style="margin-top:8px"></textarea><button class="btn sm" id="pairGo" style="margin-top:8px">🔗 Bağla</button><div class="note" id="pairOut"></div></div>
<div class="card"><h3>ANAHTARLAR</h3>
<label class="f">Gemini API anahtarı (zorunlu)</label><input type="password" id="gemini_key" placeholder="AIza…">
<div class="note">Telefondakiyle aynısını kullanabilirsin. Yoksa: <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a></div>
<label class="f">Groq anahtarı (isteğe bağlı — hızlı ses tanıma + Gemini kotası dolunca yedek beyin)</label><input type="password" id="groq_key" placeholder="gsk_…">
<div class="note">Ücretsiz: <a href="https://console.groq.com/keys" target="_blank">console.groq.com/keys</a></div>
</div>
<div class="card"><h3>TELEFONLA BAĞLANTI (İSTEĞE BAĞLI)</h3>
<label class="f">Apps Script adresi (…/exec)</label><input type="text" id="url" placeholder="https://script.google.com/macros/s/…/exec">
<label class="f">Gizli anahtar (TOKEN)</label><input type="password" id="token">
<label class="f">ntfy konusu (telefona anlık bildirim için, isteğe bağlı)</label><input type="text" id="ntfy" placeholder="ör. titus-burak-4821">
<div class="note">Telefondaki ntfy uygulamasında aynı konuya abone olursan “telefona gönder” anında bildirim olarak gelir.</div></div>
<div class="card"><h3>GÖRSEL VE UYGULAMA ADRESLERİ (İSTEĞE BAĞLI)</h3>
<label class="f">Cloudflare hesap kimliği (Account ID)</label><input type="text" id="cf_account">
<label class="f">Cloudflare API token (Workers AI)</label><input type="password" id="cf_token">
<div class="note">Boş bırakırsan görsel ve video için anahtarsız ücretsiz servis kullanılır (biraz daha yavaş: 15 sn'de 1 görsel).</div>
<label class="f">KADRO adresi</label><input type="text" id="kadro_url" placeholder="https://….netlify.app/#KODUN">
<label class="f">Recast Audition adresi</label><input type="text" id="audition_url" placeholder="https://recast-audition.netlify.app/#KODUN">
<label class="f">KADRO tablo kimliği (kadroda arama için)</label><input type="text" id="kadro_sheet"></div>
<div class="card"><h3>SEN VE SES</h3>
<label class="f">Adın</label><input type="text" id="name">
<label class="f">Şehir (hava durumu için: İstanbul, Ankara, İzmir, Kütahya, Bursa, Antalya, Eskişehir)</label><input type="text" id="city" placeholder="İstanbul">
<label class="f">Ses</label><select id="voice"><option>Charon</option><option>Orus</option><option>Fenrir</option><option>Puck</option><option>Iapetus</option><option>Algenib</option><option>Kore</option><option>Aoede</option></select>
<label class="f">Kısayol tuşu (değişince Titus'u yeniden başlat)</label><input type="text" id="hotkey">
<div class="tg"><span>Sesli cevap<small>Kapalıysa sadece yazıyla cevap verir</small></span><input type="checkbox" class="sw" id="sesli"></div>
<div class="tg"><span>Sesle uyan<small>“Titus” deyince sohbet başlar (değişince yeniden başlat)</small></span><input type="checkbox" class="sw" id="wake"></div>
<div class="tg"><span>Sadece “Hey Titus” ile uyan<small>Çok yanlış uyanırsa aç</small></span><input type="checkbox" class="sw" id="wake_strict"></div>
<div class="tg"><span>Kesintisiz canlı sohbet<small>Tek bağlantı, doğal akış, araya girebilirsin (önerilen)</small></span><input type="checkbox" class="sw" id="canli"></div>
<div class="tg"><span>Kulaklık kullanıyorum<small>Titus konuşurken hafif sesle de sözünü kesebilirsin</small></span><input type="checkbox" class="sw" id="kulaklik"></div>
<label class="f">Sessiz kalınca sohbet kaç saniyede kapansın</label><input type="text" id="live_idle">
<div class="tg"><span>Windows açılınca başlat<small>Arka planda hazır bekler</small></span><input type="checkbox" class="sw" id="autostart"></div>
</div>
<div class="row" style="margin-top:14px"><button class="btn" id="save" style="flex:1">Kaydet</button></div>
<div class="row" style="margin-top:8px"><button class="btn ghost" id="clear" style="flex:1">Sohbeti temizle</button><button class="btn ghost" id="quit" style="flex:1">Titus'u kapat</button></div>
<div class="note" style="text-align:center;margin-top:10px">Pencereyi kapatsan da Titus arka planda dinler. Tamamen kapatmak için “Titus'u kapat”. <span id="ver"></span></div>
</div></section>

<section class="view" id="v-apps"><div class="in">
<h2>UYGULAMALARIM</h2><div class="note">Birlikte yaptığımız uygulamalar. Tıkla, açılsın — ya da “Titus, Senaryo Masası'nı aç” de. Claude hesabınla giriş yapılı tarayıcıda açılır.</div>
<div id="apList"></div>
<div class="card"><h3>UYGULAMA EKLE</h3><div class="row"><input type="text" id="apN" placeholder="Ad" style="max-width:130px"><input type="text" id="apU" placeholder="https://…"><button class="btn sm" id="apAdd" style="flex:none">Ekle</button></div></div>
</div></section>

<nav><button data-v="chat" class="on"><i>◉</i>Sohbet</button><button data-v="apps"><i>🧩</i>Uygulamalar</button><button data-v="tasks"><i>✓</i>Görevler</button><button data-v="mem"><i>🧠</i>Hafıza</button><button data-v="logs"><i>🩺</i>Günlük</button><button data-v="set"><i>⚙</i>Ayarlar</button></nav>
<script>
const $=s=>document.querySelector(s), log=$("#log"); let since=0, cfg={}, first=true, liveU=null, liveT=null, view="chat";
const api=(p,b)=>fetch("/api/"+p,{method:b?"POST":"GET",headers:{"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function add(cls,txt,tag){const d=document.createElement("div");d.className="m "+cls;if(tag){const b=document.createElement("b");b.textContent=tag;d.appendChild(b);}d.appendChild(document.createTextNode(txt));log.appendChild(d);log.scrollTop=log.scrollHeight;return d;}
const BOOLS=["sesli","wake","wake_strict","canli","kulaklik","autostart"], TEXTS=["gemini_key","groq_key","url","token","name","hotkey","voice","live_idle","city","ntfy","cf_account","cf_token","kadro_url","audition_url","kadro_sheet"];
const TOOL={mailleri_oku:"mailler okunuyor",mail_taslagi:"mail taslağı hazırlanıyor",takvim:"takvim",takvime_ekle:"takvime ekleniyor",kadro_ara:"kadroda arıyor",telefonda_yap:"telefona iletiliyor",gorsel_uret:"görsel üretiliyor",video_olustur:"video hazırlanıyor",uygulamam_ac:"uygulama açılıyor",uygulama_ac:"uygulama açılıyor",site_ac:"site açılıyor",dosya_ara:"dosya aranıyor",dosya_ac:"dosya açılıyor",dosyayi_maile_ekle:"maile ekleniyor",yazi_yaz:"yazıyor",tusa_bas:"tuşa basılıyor",pencere:"pencere",ekrana_bak:"ekrana bakıyor",ekranda_tikla:"tıklıyor",medya:"medya",pano:"pano",ekrani_kilitle:"kilitleniyor",guc:"güç",hatirlatici_ekle:"hatırlatıcı kuruluyor",gorev_ekle:"görev",not_al:"not",liste:"liste",hafizaya_al:"hafızaya alındı",hafizadan_sil:"hafızadan silindi",hafiza_listele:"hafıza",internette_ara:"internette arıyor",belge_oku:"belge okunuyor",klasor_duzenle:"klasör düzenleniyor",klasor_geri_al:"geri alınıyor",ekran_gorevi:"ekranda çalışıyor (Esc: dur)",hatirlaticilar:"hatırlatıcılar",hatirlatici_kapat:"hatırlatıcı kapatıldı",zamanlayici_kur:"zamanlayıcı kuruldu",sabah_brifingi:"brifing hazırlanıyor",hava_durumu:"hava durumu",telefona_gonder:"telefona gönderiliyor",sistem_kontrolu:"sistem kontrolü"};
function show(v){view=v;document.querySelectorAll(".view").forEach(x=>x.classList.toggle("on",x.id==="v-"+v));document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
  if(v==="apps")loadApps(); if(v==="tasks")loadTasks(true); if(v==="mem")loadMem(); if(v==="logs")loadLogs(); if(v==="set")fillSet(); if(v==="chat")setTimeout(()=>$("#q").focus(),50);}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>show(b.dataset.v));
async function poll(){try{const r=await api("state?since="+since);
  document.body.className=r.durum.replace(/\s/g,"");$("#st").textContent=r.durum.toLocaleUpperCase("tr-TR");
  for(const e of r.olaylar){since=e.id; const old=e.eski?" old":"";
    if(e.k==="titus")add("t"+old,e.d,"TITUS");else if(e.k==="sen")add("s"+old,e.d);else if(e.k==="arac")add("a"+old,"⚙ "+(TOOL[e.d]||e.d));
    else if(e.k==="hata"){const d=add("e"+old,e.d+"  ›");d.title="Ayrıntı için Günlük";d.onclick=()=>show("logs");}
    else if(e.k==="hatirlatma"){add("r"+old,"⏰ "+e.d);}
    else if(e.k==="sen_canli"){if(!liveU){liveU=add("s","");} liveU.lastChild.textContent=e.d;log.scrollTop=log.scrollHeight;}
    else if(e.k==="titus_canli"){if(liveU)liveU=null; if(!liveT){liveT=add("t","","TITUS");} liveT.lastChild.textContent=e.d;log.scrollTop=log.scrollHeight;}
    else if(e.k==="tur_son"){liveU=null;liveT=null;}}
  cfg=r.ayar; const busy=r.durum!=="hazır"; $("#sub").textContent="BİLGİSAYAR ASİSTANI · v"+(cfg.version||"");
  $("#hk").textContent=busy?"Sohbet açık — konuşmaya devam et. Bitirmek için “görüşürüz” de, küreye tıkla ya da Esc.":"Tıkla"+(cfg.wake?(cfg.wake_strict?", “Hey Titus” de":", “Titus” de"):"")+" ya da "+(cfg.hotkey||"ctrl+alt+j").toUpperCase().replace(/\+/g," + ");
  if(first){first=false; if(!r.hazir){log.insertAdjacentHTML("beforeend",'<div class="welcome"><b>Hoş geldin!</b><br>Başlamak için ⚙ Ayarlar\'dan Gemini anahtarını gir.</div>'); show("set");} else if(!r.olaylar.length) add("t","Merhaba "+(cfg.name||"")+". Bilgisayarda hazırım. Ne yapalım?","TITUS");}
}catch(e){$("#st").textContent="BAĞLANTI YOK";} setTimeout(poll,350);}
function send(t){t=(t||$("#q").value).trim();if(!t)return;$("#q").value="";api("send",{text:t}).then(r=>{if(r.hata){add("e",r.hata);if(/anahtar/.test(r.hata))show("set");}});}
$("#send").onclick=()=>send();$("#q").onkeydown=e=>{if(e.key==="Enter")send();};
document.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>send(b.dataset.q));
$("#orb").onclick=()=>api("listen",{}).then(r=>{if(r.hata){add("e",r.hata);show("set");}});
function fillSet(){for(const k of TEXTS)$("#"+k).value=cfg[k]??"";for(const k of BOOLS)$("#"+k).checked=!!cfg[k];$("#ver").textContent="Sürüm "+(cfg.version||"");}
$("#save").onclick=async()=>{const b={};for(const k of TEXTS)b[k]=$("#"+k).value.trim();b.live_idle=Math.max(10,Math.min(300,+$("#live_idle").value||45));for(const k of BOOLS)b[k]=$("#"+k).checked;
  const r=await api("config",b);if(r.hata){alert(r.hata);return;}cfg=r.ayar;const w=log.querySelector(".welcome");if(w){w.remove();add("t","Hazırım "+(cfg.name||"")+". Konuşmak için kırmızı küreye tıkla, “Titus” de ya da yaz.","TITUS");} else add("a","✓ Ayarlar kaydedildi");show("chat");};
$("#clear").onclick=async()=>{await api("clear",{});log.innerHTML="";since=0;show("chat");};
$("#quit").onclick=async()=>{await api("quit",{});document.body.innerHTML='<div class="welcome" style="margin-top:40vh">Titus kapatıldı. Bu pencereyi kapatabilirsin.</div>';};
document.addEventListener("keydown",e=>{if(e.key==="Escape")api("stop",{});});
// görevler
function fmtDue(s){if(!s)return"";const d=new Date(s);if(isNaN(d))return s;return d.toLocaleString("tr-TR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}
const REP={daily:"her gün",weekly:"her hafta",monthly:"her ay"};
async function loadTasks(phone){const r=await api("tasks"+(phone?"?telefon=1":""));
  $("#tLocal").innerHTML=(r.yerel||[]).sort((a,b)=>a.due<b.due?-1:1).map(x=>`<div class="item"><div class="t">${esc(x.text)}<div class="meta">${fmtDue(x.due)}${REP[x.repeat]?" · "+REP[x.repeat]:""}</div></div><button class="x" data-done="${x.id}" title="Tamamlandı">✓</button></div>`).join("")||'<div class="empty">Kurulu hatırlatıcı yok.</div>';
  if(phone){const t=r.telefon||{}; $("#tPhone").innerHTML=!t.bagli?'<div class="empty">Telefon bağlı değil (Ayarlar → Telefonla bağlantı).</div>':t.hata?`<div class="empty">${esc(t.hata)}</div>`:
    ((t.hatirlaticilar||[]).map(x=>`<div class="item"><div class="t">⏰ ${esc(x.text)}<div class="meta">${fmtDue(x.due)}</div></div></div>`).join("")+(t.gorevler||[]).map(x=>`<div class="item"><div class="t">☐ ${esc(x.text)}<div class="meta">${esc(x.project||"")} ${x.date?fmtDue(x.date):""}</div></div></div>`).join(""))||'<div class="empty">Telefonda açık iş yok.</div>';}
  document.querySelectorAll("[data-done]").forEach(b=>b.onclick=async()=>{await api("task/done",{id:b.dataset.done});loadTasks(false);});}
$("#tAdd").onclick=async()=>{const t=$("#tText").value.trim(),d=$("#tDue").value;if(!t||!d)return alert("Ne ve ne zaman?");const r=await api("task/add",{text:t,due:d,repeat:$("#tRep").value});if(r.hata)return alert(r.hata);$("#tText").value="";loadTasks(false);};
$("#tRef").onclick=()=>loadTasks(true);
// uygulamalar
async function loadApps(){const r=await api("apps");const A=r.apps||[];const cats=[...new Set(A.map(a=>a.c))];
  $("#apList").innerHTML=cats.map(c=>`<div class="card"><h3>${esc(c.toLocaleUpperCase("tr-TR"))}</h3><div class="appgrid">${A.filter(a=>a.c===c).map(a=>`<button class="app${a.url?"":" off"}" data-app="${esc(a.k)}"><i>${a.e}</i><b>${esc(a.n)}</b><small>${esc(a.url?a.d:"adres gir (Ayarlar)")}</small>${a.custom!==undefined?`<span class="x" data-apdel="${a.custom}">✕</span>`:""}</button>`).join("")}</div></div>`).join("");
  document.querySelectorAll("[data-app]").forEach(b=>b.onclick=async e=>{if(e.target.dataset.apdel!==undefined){await api("app/del",{i:+e.target.dataset.apdel});return loadApps();}const r=await api("app/open",{k:b.dataset.app});if(r.hata){alert(r.hata);if(/adres/.test(r.hata))show("set");}});}
$("#apAdd").onclick=async()=>{const n=$("#apN").value.trim(),u=$("#apU").value.trim();if(!n||!u)return;await api("app/add",{n,u});$("#apN").value="";$("#apU").value="";loadApps();};
$("#pairGo").onclick=async()=>{const r=await api("pair",{code:$("#pairIn").value.trim()});if(r.hata){$("#pairOut").textContent="✗ "+r.hata;return;}cfg=r.ayar;$("#pairIn").value="";fillSet();$("#pairOut").textContent="✓ Bağlandı: "+(r.gelenler||[]).join(", ");const w=log.querySelector(".welcome");if(w)w.remove();};
// hafıza
async function loadMem(){const r=await api("memory");$("#mList").innerHTML=(r.hafiza||[]).map((x,i)=>`<div class="item"><div class="t">${esc(x.t)}<div class="meta">${fmtDue(x.at)}</div></div><button class="x" data-mdel="${i}" title="Sil">✕</button></div>`).reverse().join("")||'<div class="empty">Henüz bir şey kaydedilmedi.</div>';
  document.querySelectorAll("[data-mdel]").forEach(b=>b.onclick=async()=>{await api("memory/del",{i:+b.dataset.mdel});loadMem();});}
$("#mAdd").onclick=async()=>{const t=$("#mText").value.trim();if(!t)return;await api("memory/add",{t});$("#mText").value="";loadMem();};
// günlük
let LG=[];async function loadLogs(){const r=await api("log");LG=r.log||[];const only=$("#lgErr").checked;
  $("#lgList").innerHTML=LG.filter(x=>!only||x[1]==="hata").slice().reverse().map(x=>`<div class="lg ${esc(x[1])}"><span class="tm">${esc(x[0])} [${esc(x[1])}]</span> ${esc(x[2])}</div>`).join("")||'<div class="empty">Kayıt yok — her şey yolunda.</div>';}
$("#lgRef").onclick=loadLogs;$("#lgErr").onchange=loadLogs;
$("#lgCopy").onclick=()=>{const t=LG.map(x=>x.join(" ")).join("\n");navigator.clipboard.writeText(t).then(()=>add("a","✓ Günlük panoya kopyalandı"),()=>{});};
$("#selfBtn").onclick=async()=>{$("#selfOut").innerHTML='<div class="empty">Kontrol ediliyor…</div>';const r=await api("selftest",{});
  $("#selfOut").innerHTML=(r.sonuclar||[]).map(x=>`<div class="item"><div class="t"><span class="${x.ok===null?"":x.ok?"ok":"no"}">${x.ok===null?"–":x.ok?"✓":"✗"}</span> ${esc(x.ad)}<div class="meta">${esc(x.detay)}</div></div></div>`).join("");loadLogs();};
function tick(){const d=new Date();$("#clk").innerHTML=d.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})+"<small>"+d.toLocaleDateString("tr-TR",{day:"numeric",month:"long",weekday:"long"})+"</small>";}
tick();setInterval(tick,15000);poll();$("#q").focus();setInterval(()=>{if(view==="tasks")loadTasks(false);if(view==="logs")loadLogs();},8000);
</script></body></html>"""


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    J.log("bilgi", f"Arayüz açıldı (v{GUI_VERSION})")
    try:
        J.hotkey_setup()
    except Exception as e:
        J.log("uyarı", f"kısayol: {e}")
    if J.C.get("wake", True):
        threading.Thread(target=J.wake_loop, daemon=True).start()
    threading.Thread(target=J.phone_queue_loop, daemon=True).start()
    threading.Thread(target=trigger_loop, daemon=True).start()
    if "--arka" not in sys.argv:
        open_window()
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
