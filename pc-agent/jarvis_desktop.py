#!/usr/bin/env python3
"""
T.I.T.U.S. — Bilgisayar (Windows) sürümü
Sadece konuşarak bilgisayarı kontrol et: "Hey Titus" de (ya da Ctrl+Alt+J'ye bas), söyle, Titus yapsın.

Kurulum: JARVIS-masaustu-kur.bat dosyasına çift tıkla (Python 3.10+ gerekir).
Çalıştırma: JARVIS-masaustu.bat

Neler yapar:
  • Uygulama / site / dosya açar, dosya arar, dosyayı Gmail taslağına ekler
  • Yazı yazar, kısayol tuşlarına basar, pencere değiştirir, medyayı ve sesi kontrol eder
  • Ekrana bakıp ne gördüğünü anlatır ("ekranda ne var?", "bu hatayı açıkla")
  • Panodaki metni okur/düzenler (özetle, çevir, düzelt)
  • Telefondaki Titus ile aynı hatırlatıcı/görev/not listesini kullanır (Google bağlıysa)
  • Telefondan gelen bilgisayar komutlarını da çalıştırır (eski ajanın yerine geçer)
Güvenlik: Komut satırı çalıştırmaz, dosya silmez. Kapatma/yeniden başlatma gibi işlemler için sesli onay ister.
"""
import base64, io, json, os, platform, queue, struct, sys, threading, time, urllib.request, urllib.error, wave, webbrowser
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jarvis_pc as agent  # dosya arama, uygulama açma, mail eki, kilit, telefon kuyruğu

CFG = Path.home() / ".jarvis_desktop.json"
MODELS_DIR = Path.home() / ".jarvis_models"
OS = platform.system()
RATE = 16000
GEMINI = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"]
VOSK_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"

try:
    import numpy as np
    import sounddevice as sd
except ImportError:
    print("Eksik paket. Önce JARVIS-masaustu-kur.bat'ı çalıştır.")
    sys.exit(1)
try:
    import pyautogui
    pyautogui.FAILSAFE = True
except Exception:
    pyautogui = None
try:
    import pyperclip
except Exception:
    pyperclip = None
try:
    import keyboard
except Exception:
    keyboard = None


# ---------------- ayarlar ----------------
DEFAULTS = {"gemini_key": "", "groq_key": "", "url": "", "token": "", "name": "Burak", "hotkey": "ctrl+alt+j", "wake": True, "voice": "Charon", "sesli": True}
GUI = bool(os.environ.get("TITUS_GUI"))


def load_cfg():
    if "--reset" in sys.argv and CFG.exists():
        CFG.unlink()
    if CFG.exists():
        return {**DEFAULTS, **json.loads(CFG.read_text("utf-8"))}
    if GUI:  # pencereli sürüm: ayarlar ekrandan girilir
        return dict(DEFAULTS)
    print("=== T.I.T.U.S. bilgisayar kurulumu ===")
    c = {
        "gemini_key": input("Gemini API anahtarı (telefonda girdiğin ile aynı olabilir): ").strip(),
        "groq_key": input("Groq anahtarı (isteğe bağlı, daha hızlı ses tanıma; boş geçebilirsin): ").strip(),
        "url": input("Google Apps Script URL (…/exec) — telefonla senkron için, boş geçebilirsin: ").strip(),
        "token": "",
        "name": input("Adın [Burak]: ").strip() or "Burak",
        "hotkey": "ctrl+alt+j",
        "wake": True,
        "voice": "Charon",
    }
    if c["url"]:
        c["token"] = input("Gizli anahtar (Code.gs içindeki TOKEN): ").strip()
    CFG.write_text(json.dumps(c, ensure_ascii=False, indent=1), "utf-8")
    print(f"Kaydedildi: {CFG}")
    return c


C = load_cfg()
AG = {"url": C.get("url"), "token": C.get("token")}


def save_cfg(new):
    """Ayarları kaydeder ve çalışan uygulamaya uygular."""
    C.update({k: v for k, v in new.items() if k in DEFAULTS})
    AG["url"], AG["token"] = C.get("url"), C.get("token")
    CFG.write_text(json.dumps(C, ensure_ascii=False, indent=1), "utf-8")


# Arayüz bu fonksiyonu değiştirir: olay türleri "durum", "titus", "sen", "arac", "hata"
def ON_EVENT(kind, data):
    pass


def emit(kind, data=""):
    try:
        ON_EVENT(kind, data)
    except Exception:
        pass


# ---------------- http ----------------
def post_json(url, body, headers=None, timeout=60):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "ignore")[:300]
        err = RuntimeError(f"HTTP {e.code}: {msg}")
        err.status = e.code
        raise err


def gemini(contents, tools=None, system=None, max_tokens=1200):
    last = None
    for m in GEMINI:
        body = {"contents": contents, "generationConfig": {"temperature": 0.5, "maxOutputTokens": max_tokens}}
        if "2.5" in m:
            body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
        elif "lite" in m:
            body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": "minimal"}
        else:
            body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": "low"}
        if tools:
            body["tools"] = tools
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        try:
            j = post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={C['gemini_key']}", body)
            return j["candidates"][0].get("content", {"parts": []})
        except RuntimeError as e:
            last = e
            if getattr(e, "status", 0) == 400 and "thinking" in str(e).lower():
                try:
                    body["generationConfig"].pop("thinkingConfig", None)
                    j = post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={C['gemini_key']}", body)
                    return j["candidates"][0].get("content", {"parts": []})
                except RuntimeError as e2:
                    last = e2
            if getattr(last, "status", 0) in (404, 429, 500, 503) or "model" in str(last).lower():
                continue
            raise
    raise last


# ---------------- ses: kayıt ----------------
def beep(up=True):
    try:
        t = np.linspace(0, 0.12, int(24000 * 0.12), False)
        f = 880 if up else 520
        sd.play((np.sin(2 * np.pi * f * t) * 0.25).astype(np.float32), 24000)
        sd.wait()
    except Exception:
        pass


def record(max_sec=15, silence=1.1):
    """Konuşma bitene kadar kaydeder (sessizlik algılama)."""
    frames, q = [], queue.Queue()
    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=1600, callback=lambda d, *_: q.put(d.copy())):
        start, last_voice, noise, heard = time.time(), time.time(), None, False
        while time.time() - start < max_sec:
            d = q.get()
            frames.append(d)
            lvl = float(np.sqrt(np.mean(d.astype(np.float32) ** 2)))
            if noise is None or len(frames) < 4:
                noise = lvl if noise is None else (noise + lvl) / 2
                continue
            if lvl > max(noise * 2.5, 350):
                last_voice, heard = time.time(), True
            if heard and time.time() - last_voice > silence:
                break
            if not heard and time.time() - start > 6:
                break
    pcm = np.concatenate(frames).tobytes() if frames else b""
    return pcm if heard else b""


def wav_bytes(pcm, rate=RATE):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
    return b.getvalue()


def transcribe(pcm):
    wav = wav_bytes(pcm)
    if C.get("groq_key"):
        try:
            bnd = "----jarvis" + str(int(time.time()))
            parts = []
            for k, v in (("model", "whisper-large-v3-turbo"), ("language", "tr"), ("response_format", "json")):
                parts.append(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
            parts.append(f'--{bnd}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + wav + b"\r\n")
            parts.append(f"--{bnd}--\r\n".encode())
            req = urllib.request.Request("https://api.groq.com/openai/v1/audio/transcriptions", data=b"".join(parts),
                                         headers={"Authorization": "Bearer " + C["groq_key"], "Content-Type": "multipart/form-data; boundary=" + bnd})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())["text"].strip()
        except Exception as e:
            print("Groq ses tanıma hatası, Gemini'ye geçiyorum:", e)
    c = gemini([{"role": "user", "parts": [{"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(wav).decode()}},
                                           {"text": "Bu ses kaydında söyleneni aynen yaz (Türkçe ya da İngilizce olabilir). Sadece metni yaz; konuşma yoksa boş bırak."}]}], max_tokens=300)
    return "".join(p.get("text", "") for p in c.get("parts", []) if not p.get("thought")).strip()


# ---------------- ses: konuşma ----------------
SPEAKING = threading.Event()


def speak(text):
    text = text.strip()
    if not text:
        return
    print("Titus:", text)
    emit("titus", text)
    if not C.get("sesli", True) or not C.get("gemini_key"):
        return
    SPEAKING.set()
    emit("durum", "konuşuyor")
    try:
        for m in TTS_MODELS:
            try:
                j = post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={C['gemini_key']}", {
                    "contents": [{"role": "user", "parts": [{"text": "Sakin, kendinden emin, hafif İngiliz uşağı zarafetinde, doğal Türkçe oku: " + text[:1200]}]}],
                    "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": C.get("voice", "Charon")}}}}}, timeout=40)
                d = j["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
                pcm = np.frombuffer(base64.b64decode(d), dtype=np.int16)
                sd.play(pcm, 24000); sd.wait()
                return
            except Exception:
                continue
        try:
            import pyttsx3
            e = pyttsx3.init()
            for v in e.getProperty("voices"):
                if "tr" in (v.id + v.name).lower() or "turk" in v.name.lower():
                    e.setProperty("voice", v.id)
            e.say(text); e.runAndWait()
        except Exception:
            pass
    finally:
        SPEAKING.clear()
        emit("durum", "hazır")


def stop_speaking():
    try:
        sd.stop()
    except Exception:
        pass


# ---------------- telefonla ortak veri ----------------
def state_load():
    return agent.call(AG, "load").get("data") or {}


def state_add(kind, item):
    s = state_load()
    s.setdefault(kind, []).append(item)
    s["updatedAt"] = int(time.time() * 1000)
    agent.call(AG, "save", data=s)


def uid():
    return base64.b32encode(os.urandom(5)).decode().lower()


# ---------------- PC araçları ----------------
def screen_jpeg(max_w=1400):
    from PIL import ImageGrab
    im = ImageGrab.grab(all_screens=False)
    if im.width > max_w:
        im = im.resize((max_w, int(im.height * max_w / im.width)))
    b = io.BytesIO(); im.convert("RGB").save(b, "JPEG", quality=70)
    return base64.b64encode(b.getvalue()).decode()


def windows_list():
    try:
        import pygetwindow as gw
        return [w for w in gw.getAllWindows() if w.title.strip() and w.visible]
    except Exception:
        return []


PENDING = {}  # onay bekleyen tehlikeli işlemler


def t_power(a):
    act = a.get("islem")
    if not a.get("onay"):
        PENDING["power"] = act
        return {"onay_gerekli": True, "soru": f"Bilgisayarı {act} için onay ver: 'evet' de."}
    cmds = {"kapat": "shutdown /s /t 5", "yeniden_baslat": "shutdown /r /t 5", "uyut": "rundll32.exe powrprof.dll,SetSuspendState 0,1,0"}
    if OS == "Windows" and act in cmds:
        os.system(cmds[act])
        return {"ok": True}
    return {"hata": "Sadece Windows'ta"}


def t_media(a):
    keys = {"oynat_durdur": "playpause", "sonraki": "nexttrack", "onceki": "prevtrack", "ses_ac": "volumeup", "ses_kis": "volumedown", "sessiz": "volumemute"}
    k = keys.get(a.get("islem"))
    if not k or not pyautogui:
        return {"hata": "Desteklenmiyor"}
    for _ in range(int(a.get("kac", 1)) if "ses_" in a.get("islem", "") else 1):
        pyautogui.press(k)
    return {"ok": True}


def t_type(a):
    if not pyautogui:
        return {"hata": "pyautogui yok"}
    txt = a.get("metin", "")
    if pyperclip:  # Türkçe karakterler için pano üzerinden yapıştır
        old = None
        try: old = pyperclip.paste()
        except Exception: pass
        pyperclip.copy(txt); time.sleep(0.05); pyautogui.hotkey("ctrl", "v"); time.sleep(0.15)
        if old is not None:
            try: pyperclip.copy(old)
            except Exception: pass
    else:
        pyautogui.write(txt, interval=0.01)
    if a.get("enter"):
        pyautogui.press("enter")
    return {"ok": True}


def t_keys(a):
    if not pyautogui:
        return {"hata": "pyautogui yok"}
    ks = [k.strip().lower() for k in a.get("tuslar", "").replace("+", " ").split() if k.strip()]
    alias = {"windows": "win", "kontrol": "ctrl", "sekme": "tab", "sil": "delete", "geri": "backspace", "yukari": "up", "asagi": "down", "sol": "left", "sag": "right", "giris": "enter"}
    ks = [alias.get(k, k) for k in ks]
    pyautogui.hotkey(*ks) if len(ks) > 1 else pyautogui.press(ks[0])
    return {"ok": True}


def t_window(a):
    ws = windows_list()
    if a.get("islem") == "listele":
        return {"pencereler": [w.title for w in ws][:25]}
    q = agent.norm(a.get("ad", ""))
    for w in ws:
        if q and q in agent.norm(w.title):
            try:
                if a.get("islem") == "kapat": w.close()
                elif a.get("islem") == "kucult": w.minimize()
                elif a.get("islem") == "buyut": w.maximize()
                else:
                    if w.isMinimized: w.restore()
                    w.activate()
                return {"ok": True, "pencere": w.title}
            except Exception as e:
                return {"hata": str(e)}
    return {"hata": "Pencere bulunamadı"}


def t_look(a):
    img = screen_jpeg()
    c = gemini([{"role": "user", "parts": [{"inlineData": {"mimeType": "image/jpeg", "data": img}},
                                           {"text": (a.get("soru") or "Ekranda ne var? Kısaca anlat.") + " Türkçe, kısa ve net cevap ver."}]}], max_tokens=700)
    return {"cevap": "".join(p.get("text", "") for p in c.get("parts", []) if not p.get("thought"))}


def t_click_on(a):
    """Ekranda tarif edilen öğeye tıklar (Gemini görüşüyle konum bulur)."""
    if not pyautogui:
        return {"hata": "pyautogui yok"}
    from PIL import ImageGrab
    im = ImageGrab.grab(all_screens=False)
    W, H = im.size
    b = io.BytesIO(); im.convert("RGB").resize((min(W, 1400), int(H * min(W, 1400) / W))).save(b, "JPEG", quality=75)
    c = gemini([{"role": "user", "parts": [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(b.getvalue()).decode()}},
                                           {"text": f'Bu ekran görüntüsünde "{a.get("hedef")}" öğesinin merkezini bul. SADECE JSON: {{"x":0-1000,"y":0-1000}} (görüntü genişliği/yüksekliği 1000 kabul). Bulamazsan {{"x":-1}}.'}]}], max_tokens=100)
    t = "".join(p.get("text", "") for p in c.get("parts", []))
    try:
        j = json.loads(t[t.index("{"): t.rindex("}") + 1])
    except Exception:
        return {"hata": "Konum anlaşılamadı"}
    if j.get("x", -1) < 0:
        return {"hata": "Ekranda bulunamadı"}
    x, y = int(j["x"] / 1000 * W), int(j["y"] / 1000 * H)
    pyautogui.click(x, y, clicks=2 if a.get("cift") else 1)
    return {"ok": True, "x": x, "y": y}


def t_clip(a):
    if not pyperclip:
        return {"hata": "pyperclip yok"}
    if a.get("yaz") is not None and a.get("yaz") != "":
        pyperclip.copy(a["yaz"]); return {"ok": True}
    return {"pano": (pyperclip.paste() or "")[:6000]}


def t_open_file(a):
    fs = agent.find_files(a.get("ad", ""), 1)
    if not fs:
        return {"hata": "Dosya bulunamadı (Masaüstü/Belgeler/İndirilenler)"}
    os.startfile(str(fs[0])) if OS == "Windows" else webbrowser.open(fs[0].as_uri())
    return {"ok": True, "dosya": fs[0].name}


def t_reminder(a):
    if not AG["url"]:
        return {"hata": "Telefon senkronu kapalı (kurulumda Apps Script URL girilmedi)."}
    state_add("reminders", {"id": uid(), "text": a["text"], "due": a["due"], "done": False, "repeat": a.get("repeat", "none")})
    return {"ok": True, "not": "Telefonuna da senkronlandı; telefon açıldığında bildirim kurulur."}


def t_task(a):
    if not AG["url"]:
        return {"hata": "Telefon senkronu kapalı"}
    state_add("tasks", {"id": uid(), "text": a["text"], "done": False, "date": a.get("date", ""), "project": a.get("project", "")})
    return {"ok": True}


def t_note(a):
    if not AG["url"]:
        return {"hata": "Telefon senkronu kapalı"}
    state_add("notes", {"id": uid(), "text": a["text"], "at": datetime.now().strftime("%Y-%m-%dT%H:%M")})
    return {"ok": True}


def t_list(a):
    if not AG["url"]:
        return {"hata": "Telefon senkronu kapalı"}
    s = state_load()
    return {"hatirlaticilar": [r for r in s.get("reminders", []) if not r.get("done")][:15],
            "gorevler": [t for t in s.get("tasks", []) if not t.get("done")][:15]}


def t_phone(a):
    return {"hata": "Telefonu bilgisayardan kontrol etmek bu sürümde yok; telefondaki Titus'a söyle."}


def P(t, d="", e=None):
    o = {"type": t, "description": d}
    if e: o["enum"] = e
    return o


TOOLS = {
    "uygulama_ac": ({"ad": P("STRING", "Uygulama adı (Chrome, Word, Spotify, VS Code…)")}, ["ad"], lambda a: agent.open_app(a["ad"])),
    "site_ac": ({"adres": P("STRING", "Site adresi ya da arama")}, ["adres"], lambda a: (webbrowser.open(a["adres"] if "." in a["adres"] and " " not in a["adres"] else "https://www.google.com/search?q=" + urllib.parse.quote(a["adres"])), {"ok": True})[1]),
    "dosya_ara": ({"ad": P("STRING", "Dosya adının bir kısmı")}, ["ad"], lambda a: {"dosyalar": [str(p) for p in agent.find_files(a["ad"])]}),
    "dosya_ac": ({"ad": P("STRING", "Dosya adının bir kısmı")}, ["ad"], t_open_file),
    "dosyayi_maile_ekle": ({"ad": P("STRING", "Dosya adı"), "kime": P("STRING", "E-posta (isteğe bağlı)")}, ["ad"], lambda a: agent.mail_file(AG, a["ad"], a.get("kime", "")) if AG["url"] else {"hata": "Google bağlantısı yok"}),
    "yazi_yaz": ({"metin": P("STRING", "Aktif pencereye yazılacak metin"), "enter": P("BOOLEAN", "Sonunda Enter")}, ["metin"], t_type),
    "tusa_bas": ({"tuslar": P("STRING", "ör. 'ctrl+s', 'alt+tab', 'win+d', 'enter', 'f5'")}, ["tuslar"], t_keys),
    "pencere": ({"islem": P("STRING", "", ["odakla", "kapat", "kucult", "buyut", "listele"]), "ad": P("STRING", "Pencere başlığının bir kısmı")}, ["islem"], t_window),
    "ekrana_bak": ({"soru": P("STRING", "Ekranla ilgili soru")}, [], t_look),
    "ekranda_tikla": ({"hedef": P("STRING", "Tıklanacak buton/yazı/simge tarifi"), "cift": P("BOOLEAN", "Çift tık")}, ["hedef"], t_click_on),
    "medya": ({"islem": P("STRING", "", ["oynat_durdur", "sonraki", "onceki", "ses_ac", "ses_kis", "sessiz"]), "kac": P("NUMBER", "Ses için kaç adım")}, ["islem"], t_media),
    "pano": ({"yaz": P("STRING", "Panoya kopyalanacak metin (boşsa panoyu okur)")}, [], t_clip),
    "ekrani_kilitle": ({}, [], lambda a: agent.lock()),
    "guc": ({"islem": P("STRING", "", ["kapat", "yeniden_baslat", "uyut"]), "onay": P("BOOLEAN", "Burak açıkça onayladıysa true")}, ["islem"], t_power),
    "hatirlatici_ekle": ({"text": P("STRING", "Ne"), "due": P("STRING", "YYYY-MM-DDTHH:mm"), "repeat": P("STRING", "", ["none", "daily", "weekly", "monthly"])}, ["text", "due"], t_reminder),
    "gorev_ekle": ({"text": P("STRING", "Görev"), "date": P("STRING", "YYYY-MM-DD")}, ["text"], t_task),
    "not_al": ({"text": P("STRING", "Not")}, ["text"], t_note),
    "liste": ({}, [], t_list),
}
import urllib.parse  # noqa: E402

DECL = [{"functionDeclarations": [{"name": n, "description": {
    "uygulama_ac": "Bilgisayarda uygulama açar.", "site_ac": "Tarayıcıda site açar ya da Google'da arar.", "dosya_ara": "Bilgisayarda dosya arar.",
    "dosya_ac": "Dosyayı açar.", "dosyayi_maile_ekle": "Dosyayı Gmail taslağına ekler.", "yazi_yaz": "Aktif pencereye metin yazar (mail, mesaj, belge).",
    "tusa_bas": "Klavye kısayoluna basar.", "pencere": "Pencereleri yönetir.", "ekrana_bak": "Ekran görüntüsü alıp ne olduğunu anlar. Ekrandaki hatalar, sayfalar, görseller hakkında sorularda kullan.",
    "ekranda_tikla": "Ekrandaki bir düğmeye/yazıya tıklar.", "medya": "Müzik/video ve ses düzeyi kontrolü.", "pano": "Panoyu okur ya da panoya yazar.",
    "ekrani_kilitle": "Ekranı kilitler.", "guc": "Bilgisayarı kapatır/yeniden başlatır/uyutur. Önce Burak'tan sözlü onay al, onay verirse onay=true ile çağır.",
    "hatirlatici_ekle": "Hatırlatıcı ekler (telefondaki Titus ile ortak).", "gorev_ekle": "Görev ekler.", "not_al": "Not alır.", "liste": "Açık hatırlatıcı ve görevleri listeler."}[n],
    **({"parameters": {"type": "OBJECT", "properties": props, "required": req}} if props else {})} for n, (props, req, _) in TOOLS.items()]}]


def system_prompt():
    now = datetime.now()
    return (f"Sen Titus'sun; {C.get('name', 'Burak')}'ın kişisel asistanısın ve şu an onun Windows bilgisayarındasın. "
            f"Şu an: {now.strftime('%Y-%m-%d %H:%M, %A')}. Türkçe konuş (İngilizce sorulursa İngilizce). "
            "Cevapların sesli okunacak: kısa, doğal, en fazla 2-3 cümle; madde işareti ve emoji kullanma. "
            "Bilgisayarda bir şey yapılması istenince MUTLAKA araç kullan, yapmadan 'yaptım' deme. "
            "Birden çok adım gerekiyorsa sırayla araçları çağır (ör. uygulamayı aç → bekle → yaz). "
            "Ekranda ne olduğunu bilmen gerekiyorsa ekrana_bak kullan. "
            "Mail/mesaj yazdırılınca kendiliğinden göndermeye basma; Burak 'gönder' derse bas.")


HIST = []


def think(text):
    HIST.append({"role": "user", "parts": [{"text": text}]})
    del HIST[:-16]
    if PENDING.get("power") and agent.norm(text).strip(" .!") in ("evet", "onayliyorum", "evet yap", "tamam"):
        r = t_power({"islem": PENDING.pop("power"), "onay": True})
        return "Tamam, şimdi yapıyorum." if r.get("ok") else r.get("hata", "Yapamadım.")
    for _ in range(7):
        c = gemini(HIST, DECL, system_prompt())
        parts = c.get("parts", [])
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        HIST.append({"role": "model", "parts": parts or [{"text": ""}]})
        if not calls:
            return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip() or "Tamam."
        resp = []
        for fc in calls:
            name, args = fc["name"], fc.get("args", {})
            print(f"  ⚙ {name} {json.dumps(args, ensure_ascii=False)[:120]}")
            emit("arac", name)
            try:
                r = TOOLS[name][2](args) if name in TOOLS else {"hata": "Bilinmeyen araç"}
                if name in ("uygulama_ac", "site_ac", "dosya_ac"):
                    time.sleep(1.2)
            except Exception as e:
                r = {"hata": str(e)}
            resp.append({"functionResponse": {"name": name, "response": r if isinstance(r, dict) else {"sonuc": r}}})
        HIST.append({"role": "user", "parts": resp})
    return "İşlemleri yaptım."


# ---------------- uyandırma: kısayol ve "Hey Titus" ----------------
TRIGGER = threading.Event()
BUSY = threading.Lock()


def ensure_vosk():
    try:
        import vosk  # noqa: F401
    except ImportError:
        return None
    d = MODELS_DIR / "vosk-model-small-en-us-0.15"
    if not d.exists():
        print("'Hey Titus' için ses modeli indiriliyor (bir kez, ~40 MB)…")
        MODELS_DIR.mkdir(exist_ok=True)
        z = MODELS_DIR / "m.zip"
        urllib.request.urlretrieve(VOSK_URL, z)
        import zipfile
        with zipfile.ZipFile(z) as f:
            f.extractall(MODELS_DIR)
        z.unlink()
    return d


def wake_loop():
    d = ensure_vosk()
    if not d:
        print("(Vosk kurulu değil; sadece kısayol tuşu çalışır.)")
        return
    import vosk
    vosk.SetLogLevel(-1)
    model = vosk.Model(str(d))
    grammar = json.dumps(["hey titus", "titus", "hey", "hello", "tight", "tie", "focus", "status", "jarvis", "[unk]"])
    rec = vosk.KaldiRecognizer(model, RATE, grammar)
    rec.SetWords(True)
    q = queue.Queue()
    print("👂 'Hey Titus' dinleniyor.")
    while True:
        try:
            with sd.RawInputStream(samplerate=RATE, blocksize=4000, dtype="int16", channels=1, callback=lambda d, *_: q.put(bytes(d))):
                while True:
                    data = q.get()
                    if BUSY.locked() or SPEAKING.is_set():
                        rec.Reset(); continue
                    if rec.AcceptWaveform(data):
                        r = json.loads(rec.Result())
                        words = r.get("result", [])
                        txt = r.get("text", "")
                        conf = min([w.get("conf", 0) for w in words] or [0])
                        if "titus" in txt and (txt.startswith("hey") or conf > 0.95) and conf > 0.85:
                            TRIGGER.set()
                            break
        except Exception as e:
            print("Mikrofon hatası:", e); time.sleep(3)


def hotkey_setup():
    if not keyboard:
        print("(keyboard paketi yok; kısayol çalışmaz)")
        return
    try:
        keyboard.add_hotkey(C.get("hotkey", "ctrl+alt+j"), TRIGGER.set)
        print(f"⌨  Kısayol: {C.get('hotkey', 'ctrl+alt+j')}")
    except Exception as e:
        print("Kısayol kurulamadı:", e)


def phone_queue_loop():
    if not AG["url"]:
        return
    fails = 0
    while True:
        try:
            for c in agent.call(AG, "pcPull").get("cmds", []):
                cmd = c["cmd"]
                print("📱 telefondan:", cmd)
                try:
                    if cmd.get("action") == "ask":  # telefondan serbest komut: "bilgisayarda şunu yap"
                        with BUSY:
                            res = {"ok": True, "cevap": think(cmd.get("arg", ""))}
                    else:
                        res = agent.run(AG, cmd)
                except Exception as e:
                    res = {"ok": False, "hata": str(e)}
                agent.call(AG, "pcDone", id=c["id"], result=res)
            fails = 0
            time.sleep(4)
        except Exception as e:
            fails += 1
            time.sleep(min(60, 5 * fails))


def converse():
    """Bir tur dinle–düşün–konuş; cevap soruyla bitiyorsa tekrar dinler."""
    with BUSY:
        for turn in range(4):
            beep(True)
            emit("durum", "dinliyor")
            pcm = record()
            beep(False)
            if not pcm:
                emit("durum", "hazır")
                return
            emit("durum", "anlıyor")
            try:
                text = transcribe(pcm)
            except Exception as e:
                emit("durum", "hazır"); speak("Seni duyamadım."); print(e); return
            if not text or len(text) < 2:
                emit("durum", "hazır")
                return
            print("Sen:", text)
            emit("sen", text)
            emit("durum", "düşünüyor")
            if agent.norm(text).strip(" .!") in ("tesekkurler", "tamam", "sag ol", "kapat", "gorusuruz"):
                speak("Rica ederim."); return
            try:
                reply = think(text)
            except Exception as e:
                reply = "Bir sorun oldu: " + str(e)[:80]
            speak(reply)
            if not reply.rstrip().endswith("?"):
                emit("durum", "hazır")
                return


def main():
    if not C.get("gemini_key"):
        print("Gemini anahtarı yok. python jarvis_desktop.py --reset ile yeniden kur."); return
    print("=== T.I.T.U.S. bilgisayarda hazır ===")
    hotkey_setup()
    if C.get("wake", True):
        threading.Thread(target=wake_loop, daemon=True).start()
    threading.Thread(target=phone_queue_loop, daemon=True).start()
    if "--text" in sys.argv:  # klavyeyle deneme modu
        while True:
            t = input("Sen> ").strip()
            if t: speak(think(t))
    h = datetime.now().hour
    speak(("Günaydın" if 5 <= h < 12 else "İyi akşamlar" if h >= 18 else "Merhaba") + f" {C.get('name', 'Burak')}. Bilgisayarda hazırım.")
    while True:
        TRIGGER.wait()
        TRIGGER.clear()
        try:
            converse()
        except Exception as e:
            print("Hata:", e)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Görüşürüz.")
