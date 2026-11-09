#!/usr/bin/env python3
"""
T.I.T.U.S. — Bilgisayar için pencereli arayüz.
Çift tıkla açılır; sohbet, büyük konuş düğmesi, hızlı komutlar ve ayarlar tek pencerede.
Ek paket gerekmez: arayüz bilgisayardaki Edge'de uygulama penceresi olarak açılır.
"""
import json, os, subprocess, sys, threading, time, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ["TITUS_GUI"] = "1"
HERE = Path(__file__).resolve().parent
PORT = 47821
URL = f"http://127.0.0.1:{PORT}/"


def open_window():
    """Edge/Chrome'u adres çubuğu olmadan, uygulama penceresi gibi açar."""
    cands = []
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", ""), os.environ.get("LOCALAPPDATA", "")):
            cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe"]
    for exe in cands:
        if exe.exists():
            try:
                subprocess.Popen([str(exe), f"--app={URL}", "--window-size=460,800", "--window-position=60,40"])
                return
            except Exception:
                pass
    webbrowser.open(URL)


# zaten açıksa sadece pencereyi göster
try:
    import urllib.request
    urllib.request.urlopen(URL + "api/ping", timeout=0.6)
    open_window()
    sys.exit(0)
except SystemExit:
    raise
except Exception:
    pass

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

EVENTS, LOCK = [], threading.Lock()
STATE = {"durum": "hazır", "n": 0}


def on_event(kind, data):
    if kind == "durum":
        STATE["durum"] = data
    with LOCK:
        STATE["n"] += 1
        EVENTS.append({"id": STATE["n"], "k": kind, "d": data, "t": time.strftime("%H:%M")})
        if len(EVENTS) > 400:
            del EVENTS[:-300]


J.ON_EVENT = on_event


def run_text(text):
    def work():
        with J.BUSY:
            on_event("sen", text)
            on_event("durum", "düşünüyor")
            try:
                reply = J.think(text)
            except Exception as e:
                reply = "Bir sorun oldu: " + str(e)[:120]
            J.speak(reply)
            on_event("durum", "hazır")
    threading.Thread(target=work, daemon=True).start()


def listen_now():
    if J.BUSY.locked():
        J.stop_speaking(); return
    J.TRIGGER.set()


def masked(v):
    return ("•" * 8 + v[-4:]) if v and len(v) > 8 else ("•" * len(v) if v else "")


def public_cfg():
    c = dict(J.C)
    for k in ("gemini_key", "groq_key", "token"):
        c[k] = masked(c.get(k, ""))
    c["autostart"] = startup_link().exists()
    return c


def startup_link():
    return Path(os.environ.get("APPDATA", str(Path.home()))) / "Microsoft/Windows/Start Menu/Programs/Startup/Titus.lnk"


def set_autostart(on):
    if os.name != "nt":
        return
    lnk = startup_link()
    if not on:
        lnk.unlink(missing_ok=True); return
    pyw = Path(sys.executable).with_name("pythonw.exe")
    ps = (f'$s=(New-Object -ComObject WScript.Shell).CreateShortcut("{lnk}");$s.TargetPath="{pyw}";'
          f'$s.Arguments=\'"{HERE / "titus_gui.py"}" --arka\';$s.WorkingDirectory="{HERE}";$s.Save()')
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self.send(200, PAGE.encode("utf-8"), "text/html")
        if self.path.startswith("/api/ping"):
            return self.send(200, {"ok": True})
        if self.path.startswith("/api/state"):
            since = int((self.path.split("since=") + ["0"])[1] or 0)
            with LOCK:
                ev = [e for e in EVENTS if e["id"] > since]
            return self.send(200, {"durum": STATE["durum"], "olaylar": ev, "hazir": bool(J.C.get("gemini_key")), "ayar": public_cfg()})
        self.send(404, {"hata": "yok"})

    def do_POST(self):
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
            J.stop_speaking(); return self.send(200, {"ok": True})
        if p == "/api/config":
            new = {}
            for k, v in body.items():
                if k in ("gemini_key", "groq_key", "token") and (not v or str(v).startswith("•")):
                    continue  # değiştirilmemiş gizli alan
                new[k] = v
            if "autostart" in body:
                set_autostart(bool(body["autostart"]))
            J.save_cfg(new)
            return self.send(200, {"ok": True, "ayar": public_cfg()})
        if p == "/api/clear":
            J.HIST.clear()
            with LOCK:
                EVENTS.clear()
            return self.send(200, {"ok": True})
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
            on_event("hata", str(e)[:150])
        on_event("durum", "hazır")


PAGE = r"""<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Titus</title>
<style>
:root{--bg:#0a0304;--panel:rgba(34,9,11,.85);--line:rgba(255,72,72,.22);--red:#ff3b3b;--red2:#ff9b8f;--txt:#fff0ee;--dim:#bf948f;--ok:#3ee68a}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:radial-gradient(ellipse at 50% -10%,#2c0a0d 0%,var(--bg) 60%);color:var(--txt);font:15px/1.45 "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden;user-select:none}
body:before{content:"";position:fixed;inset:0;background-image:linear-gradient(rgba(255,59,59,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,59,59,.035) 1px,transparent 1px);background-size:28px 28px;pointer-events:none}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 6px;position:relative}
.logo{font-weight:800;letter-spacing:.35em;color:var(--red);font-size:18px}.logo small{display:block;letter-spacing:.2em;color:var(--dim);font-size:10px;font-weight:600}
.clock{text-align:right;font-weight:700;color:var(--red2);font-size:18px}.clock small{display:block;color:var(--dim);font-size:11px;font-weight:500}
.iconbtn{background:none;border:1px solid var(--line);color:var(--dim);width:36px;height:36px;border-radius:10px;cursor:pointer;font-size:17px}.iconbtn:hover{color:var(--txt);border-color:var(--red)}
.top{display:flex;flex-direction:column;align-items:center;padding:6px 0 4px;position:relative}
.orb{width:132px;height:132px;border-radius:50%;position:relative;cursor:pointer;border:none;background:none;padding:0}
.orb .ring{position:absolute;inset:0;border-radius:50%;border:2px dashed rgba(255,59,59,.45)}
.orb .arc{position:absolute;inset:12px;border-radius:50%;border:4px solid transparent;border-top-color:var(--red);border-bottom-color:var(--red);animation:spin 6s linear infinite}
.orb .core{position:absolute;inset:36px;border-radius:50%;background:radial-gradient(circle at 45% 40%,#ffd0c8,#ff3b3b 45%,#9a1414 80%);box-shadow:0 0 40px rgba(255,59,59,.6),0 0 90px rgba(255,59,59,.25);transition:transform .25s}
.orb:hover .core{transform:scale(1.06)}
body.dinliyor .orb .core{animation:pulse .9s ease-in-out infinite}body.dinliyor .orb .arc{animation-duration:1.4s}
body.düşünüyor .orb .arc,body.anlıyor .orb .arc{animation-duration:.8s;border-left-color:var(--red2)}
body.konuşuyor .orb .core{animation:pulse .5s ease-in-out infinite alternate}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
.status{margin-top:8px;letter-spacing:.35em;font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase}
.hint{color:var(--dim);font-size:12px;margin-top:2px}
.chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;padding:8px 14px}
.chip{background:rgba(255,59,59,.08);border:1px solid var(--line);color:var(--txt);padding:6px 11px;border-radius:999px;cursor:pointer;font:13px inherit;font-family:inherit}.chip:hover{border-color:var(--red)}
#log{flex:1;overflow-y:auto;padding:6px 16px 10px;display:flex;flex-direction:column;gap:8px;user-select:text}
.m{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
.m.t{background:var(--panel);border:1px solid var(--line);align-self:flex-start}.m.t b{display:block;color:var(--red);font-size:10px;letter-spacing:.2em;margin-bottom:2px}
.m.s{background:linear-gradient(180deg,#e03030,#9a1414);align-self:flex-end}
.m.a{align-self:center;color:var(--dim);font-size:12px;padding:2px 8px}
.m.e{align-self:center;color:#ff9f43;font-size:13px;border:1px solid rgba(255,159,67,.4);background:rgba(255,159,67,.08)}
.bar{display:flex;gap:8px;padding:10px 14px 14px}
.bar input{flex:1;background:rgba(10,2,3,.82);border:1px solid var(--line);color:var(--txt);border-radius:12px;padding:0 14px;height:46px;font:15px inherit;font-family:inherit;outline:none}.bar input:focus{border-color:var(--red)}
.btn{background:linear-gradient(180deg,#e03030,#9a1414);border:1px solid #ff6a5e;color:#fff;border-radius:12px;min-width:46px;height:46px;cursor:pointer;font-size:18px;font-family:inherit}
.btn.ghost{background:none;border-color:var(--line);color:var(--txt);font-size:14px;padding:0 14px}
#set{position:fixed;inset:0;background:rgba(10,2,3,.97);display:none;flex-direction:column;z-index:5}
#set.on{display:flex}#set .in{overflow-y:auto;padding:4px 18px 18px;flex:1;user-select:text}
#set h2{margin:0;font-size:15px;letter-spacing:.25em;color:var(--red)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:12px}
.card h3{margin:0 0 8px;font-size:11px;letter-spacing:.25em;color:var(--red2)}
label.f{display:block;color:var(--dim);font-size:12px;margin:8px 0 4px}
.f+input,.card input[type=text],.card input[type=password],.card select{width:100%;background:rgba(10,2,3,.82);border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:0 12px;height:40px;font:14px inherit;font-family:inherit;outline:none}
.tg{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0}.tg small{display:block;color:var(--dim);font-size:12px}
.sw{appearance:none;width:46px;height:26px;border-radius:20px;background:#3d2224;position:relative;flex:none;border:1px solid var(--line);cursor:pointer}
.sw:before{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#c9a8a5;transition:.2s}.sw:checked{background:#9a1414}.sw:checked:before{left:22px;background:var(--red)}
.note{color:var(--dim);font-size:12px;margin-top:6px}.note a{color:var(--red2)}
.welcome{margin:auto;text-align:center;color:var(--dim);padding:20px}.welcome b{color:var(--txt)}
::-webkit-scrollbar{width:8px}::-webkit-scrollbar-thumb{background:rgba(255,59,59,.25);border-radius:8px}
</style></head><body class="hazır">
<header><div class="logo">T.I.T.U.S.<small>BİLGİSAYAR ASİSTANI</small></div>
<div style="display:flex;gap:10px;align-items:center"><div class="clock" id="clk"></div><button class="iconbtn" id="gear" title="Ayarlar">⚙</button></div></header>
<div class="top"><button class="orb" id="orb" title="Konuşmak için tıkla"><span class="ring"></span><span class="arc"></span><span class="core"></span></button>
<div class="status" id="st">HAZIR</div><div class="hint" id="hk">Tıkla, “Hey Titus” de ya da Ctrl+Alt+J</div></div>
<div class="chips">
<button class="chip" data-q="Ekranda ne var? Kısaca anlat.">👁 Ekranda ne var</button>
<button class="chip" data-q="Panodaki metni özetle.">📋 Panoyu özetle</button>
<button class="chip" data-q="Chrome'u aç.">🌐 Chrome</button>
<button class="chip" data-q="Açık pencereleri listele.">🪟 Pencereler</button>
<button class="chip" data-q="Sesi biraz kıs.">🔉 Sesi kıs</button>
<button class="chip" data-q="Müziği durdur ya da devam ettir.">⏯ Müzik</button>
<button class="chip" data-q="Açık hatırlatıcı ve görevlerimi söyle.">✅ Görevlerim</button>
<button class="chip" data-q="Ekranı kilitle.">🔒 Kilitle</button>
</div>
<div id="log"></div>
<div class="bar"><input id="q" placeholder="Titus'a yaz…" autocomplete="off"><button class="btn" id="send" title="Gönder">➤</button></div>

<div id="set"><header><h2>AYARLAR</h2><button class="iconbtn" id="close">✕</button></header><div class="in">
<div class="card"><h3>ANAHTARLAR</h3>
<label class="f">Gemini API anahtarı (zorunlu)</label><input type="password" id="gemini_key" placeholder="AIza…">
<div class="note">Telefondakiyle aynısını kullanabilirsin. Yoksa: <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a></div>
<label class="f">Groq anahtarı (isteğe bağlı — daha hızlı ses tanıma)</label><input type="password" id="groq_key" placeholder="gsk_…">
</div>
<div class="card"><h3>TELEFONLA BAĞLANTI (İSTEĞE BAĞLI)</h3>
<label class="f">Apps Script adresi (…/exec)</label><input type="text" id="url" placeholder="https://script.google.com/macros/s/…/exec">
<label class="f">Gizli anahtar (TOKEN)</label><input type="password" id="token">
<div class="note">Girersen telefondaki hatırlatıcı ve görevleri ortak kullanırsın, telefondan “bilgisayarda şunu yap” diyebilirsin.</div></div>
<div class="card"><h3>SEN VE SES</h3>
<label class="f">Adın</label><input type="text" id="name">
<label class="f">Ses</label><select id="voice"><option>Charon</option><option>Orus</option><option>Fenrir</option><option>Puck</option><option>Iapetus</option><option>Algenib</option><option>Kore</option><option>Aoede</option></select>
<label class="f">Kısayol tuşu (değişince Titus'u yeniden başlat)</label><input type="text" id="hotkey">
<div class="tg"><span>Sesli cevap<small>Kapalıysa sadece yazıyla cevap verir</small></span><input type="checkbox" class="sw" id="sesli"></div>
<div class="tg"><span>“Hey Titus” ile uyan<small>Değişince Titus'u yeniden başlat</small></span><input type="checkbox" class="sw" id="wake"></div>
<div class="tg"><span>Windows açılınca başlat<small>Arka planda hazır bekler</small></span><input type="checkbox" class="sw" id="autostart"></div>
</div>
<div style="display:flex;gap:8px;margin-top:14px"><button class="btn" id="save" style="flex:1;font-size:15px">Kaydet</button></div>
<div style="display:flex;gap:8px;margin-top:8px"><button class="btn ghost" id="clear" style="flex:1">Sohbeti temizle</button><button class="btn ghost" id="quit" style="flex:1">Titus'u kapat</button></div>
<div class="note" style="text-align:center;margin-top:10px">Pencereyi kapatsan da Titus arka planda dinlemeye devam eder. Tamamen kapatmak için “Titus'u kapat”.</div>
</div></div>
<script>
const $=s=>document.querySelector(s), log=$("#log"); let since=0, cfg={}, first=true;
const api=(p,b)=>fetch("/api/"+p,{method:b?"POST":"GET",headers:{"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
function add(cls,txt,tag){const d=document.createElement("div");d.className="m "+cls;if(tag){const b=document.createElement("b");b.textContent=tag;d.appendChild(b);}d.appendChild(document.createTextNode(txt));log.appendChild(d);log.scrollTop=log.scrollHeight;}
const TOOL={uygulama_ac:"uygulama açılıyor",site_ac:"site açılıyor",dosya_ara:"dosya aranıyor",dosya_ac:"dosya açılıyor",dosyayi_maile_ekle:"maile ekleniyor",yazi_yaz:"yazıyor",tusa_bas:"tuşa basılıyor",pencere:"pencere",ekrana_bak:"ekrana bakıyor",ekranda_tikla:"tıklıyor",medya:"medya",pano:"pano",ekrani_kilitle:"kilitleniyor",guc:"güç",hatirlatici_ekle:"hatırlatıcı",gorev_ekle:"görev",not_al:"not",liste:"liste"};
async function poll(){try{const r=await api("state?since="+since);
  document.body.className=r.durum.replace(/\s/g,"");$("#st").textContent=r.durum.toUpperCase();
  for(const e of r.olaylar){since=e.id;if(e.k==="titus")add("t",e.d,"TITUS");else if(e.k==="sen")add("s",e.d);else if(e.k==="arac")add("a","⚙ "+(TOOL[e.d]||e.d));else if(e.k==="hata")add("e",e.d);}
  cfg=r.ayar; $("#hk").textContent="Tıkla"+(cfg.wake?", “Hey Titus” de":"")+" ya da "+(cfg.hotkey||"ctrl+alt+j").toUpperCase().replace(/\+/g," + ");
  if(first){first=false; if(!r.hazir){log.innerHTML='<div class="welcome"><b>Hoş geldin!</b><br>Başlamak için ⚙ Ayarlar\'dan Gemini anahtarını gir.</div>'; openSet();} else if(!r.olaylar.length) add("t","Merhaba "+(cfg.name||"")+". Bilgisayarda hazırım. Ne yapalım?","TITUS");}
}catch(e){$("#st").textContent="BAĞLANTI YOK";} setTimeout(poll,400);}
function send(t){t=(t||$("#q").value).trim();if(!t)return;$("#q").value="";api("send",{text:t}).then(r=>{if(r.hata){add("e",r.hata);openSet();}});}
$("#send").onclick=()=>send();$("#q").onkeydown=e=>{if(e.key==="Enter")send();};
document.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>send(b.dataset.q));
$("#orb").onclick=()=>api("listen",{}).then(r=>{if(r.hata){add("e",r.hata);openSet();}});
function openSet(){for(const k of ["gemini_key","groq_key","url","token","name","hotkey","voice"])$("#"+k).value=cfg[k]||"";for(const k of ["sesli","wake","autostart"])$("#"+k).checked=!!cfg[k];$("#set").classList.add("on");}
$("#gear").onclick=openSet;$("#close").onclick=()=>$("#set").classList.remove("on");
$("#save").onclick=async()=>{const b={};for(const k of ["gemini_key","groq_key","url","token","name","hotkey","voice"])b[k]=$("#"+k).value.trim();for(const k of ["sesli","wake","autostart"])b[k]=$("#"+k).checked;
  const r=await api("config",b);cfg=r.ayar;$("#set").classList.remove("on");if(log.querySelector(".welcome")){log.innerHTML="";add("t","Hazırım "+(cfg.name||"")+". Konuşmak için kırmızı küreye tıkla ya da yaz.","TITUS");} else add("a","✓ Ayarlar kaydedildi");};
$("#clear").onclick=async()=>{await api("clear",{});log.innerHTML="";since=0;$("#set").classList.remove("on");};
$("#quit").onclick=async()=>{await api("quit",{});document.body.innerHTML='<div class="welcome" style="margin-top:40vh">Titus kapatıldı. Bu pencereyi kapatabilirsin.</div>';};
document.addEventListener("keydown",e=>{if(e.key==="Escape"){$("#set").classList.remove("on");api("stop",{});}});
function tick(){const d=new Date();$("#clk").innerHTML=d.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})+"<small>"+d.toLocaleDateString("tr-TR",{day:"numeric",month:"long",weekday:"long"})+"</small>";}
tick();setInterval(tick,15000);poll();$("#q").focus();
</script></body></html>"""


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    J.hotkey_setup()
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
