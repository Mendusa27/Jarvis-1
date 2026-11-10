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

VERSION = "2.7"
CFG = Path.home() / ".jarvis_desktop.json"
DATA = Path.home() / ".titus"
DATA.mkdir(exist_ok=True)
LOG = []  # (saat, seviye, mesaj) — arayüzdeki Günlük sekmesi


def log(level, msg):
    line = (time.strftime("%H:%M:%S"), level, str(msg))
    LOG.append(line)
    del LOG[:-400]
    try:
        with open(DATA / "gunluk.txt", "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d')} {line[0]} [{level}] {line[2]}\n")
        if (DATA / "gunluk.txt").stat().st_size > 2_000_000:
            (DATA / "gunluk.txt").replace(DATA / "gunluk-eski.txt")
    except Exception:
        pass


def jload(name, default):
    try:
        return json.loads((DATA / name).read_text("utf-8"))
    except Exception:
        return default


def jsave(name, obj):
    try:
        tmp = DATA / (name + ".tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), "utf-8")
        tmp.replace(DATA / name)
    except Exception as e:
        log("hata", f"{name} kaydedilemedi: {e}")
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
DEFAULTS = {"gemini_key": "", "groq_key": "", "url": "", "token": "", "name": "Burak", "hotkey": "ctrl+alt+j", "wake": True, "voice": "Charon", "sesli": True, "canli": True, "kulaklik": False, "live_idle": 45, "wake_strict": False, "city": "İstanbul", "lat": 41.0082, "lon": 28.9784, "ntfy": "", "groq_model": ""}
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
    if kind == "hata":
        log("hata", data)
    try:
        ON_EVENT(kind, data)
    except Exception:
        pass


# ---------------- http ----------------
try:
    import requests
    _TL = threading.local()

    def _sess():
        if not hasattr(_TL, "s"):
            _TL.s = requests.Session()  # bağlantıyı açık tutar: her istekte yeniden el sıkışma yok
        return _TL.s
except Exception:
    requests = None


class ApiError(RuntimeError):
    def __init__(self, status, msg, raw=""):
        super().__init__(f"HTTP {status}: {msg}")
        self.status, self.msg, self.raw = status, msg, raw


def _err_msg(code, text):
    try:
        return json.loads(text)["error"]["message"]
    except Exception:
        return text[:500]


def post_json(url, body, headers=None, timeout=60):
    h = {"Content-Type": "application/json", **(headers or {})}
    if requests:
        try:
            r = _sess().post(url, data=json.dumps(body).encode("utf-8"), headers=h, timeout=timeout)
        except requests.exceptions.RequestException as e:
            _TL.__dict__.pop("s", None)
            raise ApiError(0, "Bağlantı hatası: " + str(e)[:200])
        if r.status_code >= 400:
            raise ApiError(r.status_code, _err_msg(r.status_code, r.text), r.text[:4000])
        return r.json()
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        t = e.read().decode("utf-8", "ignore")
        raise ApiError(e.code, _err_msg(e.code, t), t[:4000])
    except urllib.error.URLError as e:
        raise ApiError(0, "Bağlantı hatası: " + str(e.reason)[:200])


def friendly(e):
    """Hatayı Burak'ın anlayacağı dile çevirir (ayrıntı Günlük'te)."""
    st, m = getattr(e, "status", None), str(getattr(e, "msg", e))
    low = m.lower()
    if "api key not valid" in low or "api_key_invalid" in low or st == 403:
        return "Gemini anahtarı geçersiz görünüyor. Ayarlar'dan anahtarı kontrol et."
    if st == 429 or "quota" in low or "resource_exhausted" in low:
        return "Ücretsiz kullanım kotası şu an dolu. Birkaç dakika sonra tekrar dene" + ("; bu arada Groq ile devam ediyorum." if C.get("groq_key") else "; Ayarlar'a Groq anahtarı eklersen yedek beyinle devam ederim.")
    if st == 0 or "bağlantı" in low:
        return "İnternete ulaşamadım. Bağlantını kontrol eder misin?"
    if st and st >= 500:
        return "Google tarafında geçici bir sorun var, birazdan tekrar dene."
    return "Beklenmedik bir sorun oldu; ayrıntısı Günlük sekmesinde."


def _gem_url(m):
    return f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={C['gemini_key']}"


GOOD_MODEL = {"m": None}


def gemini(contents, tools=None, system=None, max_tokens=1200, json_mode=False, temperature=0.5):
    """Gemini'ye istek atar; model yoksa/kota doluysa sıradaki ücretsiz modele geçer."""
    if not C.get("gemini_key"):
        raise ApiError(401, "Gemini anahtarı girilmemiş")
    last = None
    order = [GOOD_MODEL["m"]] + GEMINI if GOOD_MODEL["m"] else GEMINI
    for m in [x for i, x in enumerate(order) if x and x not in order[:i]]:
        gc = {"temperature": temperature, "maxOutputTokens": max_tokens}
        if json_mode:
            gc["responseMimeType"] = "application/json"
        gc["thinkingConfig"] = {"thinkingBudget": 0} if "2.5" in m else {"thinkingLevel": "minimal" if "lite" in m else "low"}
        body = {"contents": contents, "generationConfig": gc}
        if tools:
            body["tools"] = tools
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        for attempt in (1, 2):
            try:
                j = post_json(_gem_url(m), body)
                GOOD_MODEL["m"] = m
                cands = j.get("candidates") or []
                if not cands:
                    fb = (j.get("promptFeedback") or {}).get("blockReason")
                    raise ApiError(200, "Boş cevap" + (f" ({fb})" if fb else ""))
                return cands[0].get("content") or {"parts": []}
            except ApiError as e:
                last = e
                if e.status == 400 and "thinking" in e.msg.lower() and attempt == 1:
                    gc.pop("thinkingConfig", None); continue
                break
        e = last
        if e.status in (404, 429, 500, 502, 503, 504, 0, 200) or ("model" in e.msg.lower() and e.status == 400 and "not found" in e.msg.lower()):
            log("uyarı", f"{m}: {e.status} {e.msg[:160]} → sıradaki model")
            continue
        log("hata", f"{m}: {e.status} {e.msg}")
        raise e
    raise last


def gemini_text(c):
    return "".join(p.get("text", "") for p in (c or {}).get("parts", []) if not p.get("thought")).strip()


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


TTS_OK = {"m": None, "off_until": 0}
STOP_TALK = threading.Event()


def _tts(text):
    """Metni Gemini'nin doğal sesiyle PCM'e çevirir; olmazsa None."""
    if time.time() < TTS_OK["off_until"]:
        return None
    order = [TTS_OK["m"]] + TTS_MODELS if TTS_OK["m"] else TTS_MODELS
    for m in [x for i, x in enumerate(order) if x and x not in order[:i]]:
        try:
            j = post_json(_gem_url(m), {
                "contents": [{"role": "user", "parts": [{"text": "Sakin, sıcak, kendinden emin ve doğal bir Türkçeyle söyle: " + text[:900]}]}],
                "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": C.get("voice", "Charon")}}}}}, timeout=40)
            part = next(p for p in j["candidates"][0]["content"]["parts"] if p.get("inlineData"))
            TTS_OK["m"] = m
            return np.frombuffer(base64.b64decode(part["inlineData"]["data"]), dtype=np.int16)
        except ApiError as e:
            if e.status == 429:
                TTS_OK["off_until"] = time.time() + 600; log("uyarı", "Ses kotası doldu, 10 dk Windows sesine geçiyorum"); return None
        except Exception as e:
            log("uyarı", f"ses {m}: {str(e)[:120]}")
    TTS_OK["off_until"] = time.time() + 120
    return None


def _chunks(text):
    """Uzun cevabı cümle gruplarına böler: ilk parça hemen çalarken diğerleri hazırlanır."""
    import re as _re
    parts = [x.strip() for x in _re.split(r"(?<=[.!?…])\s+", text) if x.strip()]
    out, cur = [], ""
    for p in parts:
        if cur and len(cur) + len(p) > (140 if not out else 320):
            out.append(cur); cur = p
        else:
            cur = (cur + " " + p).strip()
    if cur:
        out.append(cur)
    return out or [text]


def _sapi(text):
    try:
        import pyttsx3
        e = pyttsx3.init()
        for v in e.getProperty("voices"):
            if "tr" in (v.id + v.name).lower() or "turk" in v.name.lower():
                e.setProperty("voice", v.id)
        e.say(text); e.runAndWait()
    except Exception as ex:
        log("uyarı", f"Windows sesi: {ex}")


def speak(text):
    text = (text or "").strip()
    if not text:
        return
    print("Titus:", text)
    emit("titus", text)
    if not C.get("sesli", True) or not C.get("gemini_key"):
        return
    SPEAKING.set(); STOP_TALK.clear()
    emit("durum", "konuşuyor")
    try:
        chunks = _chunks(text)
        q = queue.Queue()

        def producer():
            for c in chunks:
                if STOP_TALK.is_set():
                    break
                q.put((c, _tts(c)))
            q.put(None)
        threading.Thread(target=producer, daemon=True).start()
        while True:
            item = q.get()
            if item is None or STOP_TALK.is_set():
                break
            c, pcm = item
            if pcm is None:
                _sapi(c)
            else:
                sd.play(pcm, 24000); sd.wait()
    finally:
        SPEAKING.clear()
        emit("durum", "hazır")


def stop_speaking():
    STOP_TALK.set()
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

TOOL_DESC = {
    "uygulama_ac": "Bilgisayarda uygulama açar.", "site_ac": "Tarayıcıda site açar ya da Google'da arar.", "dosya_ara": "Bilgisayarda dosya arar.",
    "dosya_ac": "Dosyayı açar.", "dosyayi_maile_ekle": "Dosyayı Gmail taslağına ekler.", "yazi_yaz": "Aktif pencereye metin yazar (mail, mesaj, belge).",
    "tusa_bas": "Klavye kısayoluna basar.", "pencere": "Pencereleri yönetir.", "ekrana_bak": "Ekran görüntüsü alıp ne olduğunu anlar. Ekrandaki hatalar, sayfalar, görseller hakkında sorularda kullan.",
    "ekranda_tikla": "Ekrandaki bir düğmeye/yazıya tıklar.", "medya": "Müzik/video ve ses düzeyi kontrolü.", "pano": "Panoyu okur ya da panoya yazar.",
    "ekrani_kilitle": "Ekranı kilitler.", "guc": "Bilgisayarı kapatır/yeniden başlatır/uyutur. Önce Burak'tan sözlü onay al, onay verirse onay=true ile çağır.",
    "hatirlatici_ekle": "Hatırlatıcı ekler (telefondaki Titus ile ortak).", "gorev_ekle": "Görev ekler.", "not_al": "Not alır.", "liste": "Açık hatırlatıcı ve görevleri listeler."}
DECL = [{"functionDeclarations": []}]


def rebuild_decl():
    DECL[0]["functionDeclarations"] = [{"name": n, "description": TOOL_DESC.get(n, n), **({"parameters": {"type": "OBJECT", "properties": props, "required": req}} if props else {})}
                                       for n, (props, req, _) in TOOLS.items()]


def register(name, desc, props, req, fn):
    """Yeni araç ekler (ya da aynı adlıyı değiştirir)."""
    def safe(a, _fn=fn, _n=name):
        try:
            return _fn(a or {})
        except Exception as e:
            log("hata", f"araç {_n}: {e}")
            return {"hata": str(e)[:200]}
    TOOLS[name] = (props, req, safe)
    TOOL_DESC[name] = desc
    rebuild_decl()


rebuild_decl()
MEMORY_HOOK = []  # titus_plus: sistem talimatına eklenecek metinler (hafıza, hatırlatıcılar)


def system_prompt():
    now = datetime.now()
    return (f"Sen Titus'sun; {C.get('name', 'Burak')}'ın kişisel asistanısın ve şu an onun Windows bilgisayarındasın. "
            f"Şu an: {now.strftime('%Y-%m-%d %H:%M, %A')}. Türkçe konuş (İngilizce sorulursa İngilizce). "
            "Cevapların sesli okunacak: kısa, doğal, en fazla 2-3 cümle; madde işareti ve emoji kullanma. "
            "Bilgisayarda bir şey yapılması istenince MUTLAKA araç kullan, yapmadan 'yaptım' deme. "
            "Birden çok adım gerekiyorsa sırayla araçları çağır (ör. uygulamayı aç → bekle → yaz). "
            "Ekranda ne olduğunu bilmen gerekiyorsa ekrana_bak kullan. "
            "Mail/mesaj yazdırılınca kendiliğinden göndermeye basma; Burak 'gönder' derse bas. "
            "Güncel bilgi (haber, fiyat, hava, maç, kim kimdir) gerekiyorsa internette_ara kullan; tahmin etme."
            + "".join(f() for f in MEMORY_HOOK if callable(f)))


HIST = []  # açılışta titus_plus diskten yükler


def _is_call(h):
    return h.get("role") == "model" and any("functionCall" in p for p in h.get("parts", []))


def _is_resp(h):
    return h.get("role") == "user" and any("functionResponse" in p for p in h.get("parts", []))


def _has_text(h):
    return any((p.get("text") or "").strip() for p in h.get("parts", []) if not p.get("thought"))


def clean_hist(hist, keep=18):
    """Gemini'nin kabul ettiği sıraya getirir: her araç çağrısının hemen ardından cevabı gelir,
    yarım kalmış/boş turlar atılır, geçmiş her zaman kullanıcının yazdığı bir mesajla başlar."""
    out, i = [], 0
    while i < len(hist):
        h = hist[i]
        if _is_call(h):
            if i + 1 < len(hist) and _is_resp(hist[i + 1]):
                out += [h, hist[i + 1]]; i += 2; continue
            i += 1; continue  # cevabı olmayan çağrı
        if _is_resp(h):
            i += 1; continue  # çağrısı olmayan cevap
        if not _has_text(h):
            i += 1; continue
        if out and out[-1]["role"] == h["role"] and not _is_call(out[-1]) and not _is_resp(out[-1]):
            out[-1] = {"role": h["role"], "parts": out[-1]["parts"] + [p for p in h["parts"] if (p.get("text") or "").strip()]}
        else:
            out.append(h)
        i += 1
    out = out[-keep:]
    while out and not (out[0]["role"] == "user" and not _is_resp(out[0])):
        out.pop(0)
    return out


CTX_FILES = {"parts": [], "left": 0, "names": []}


def _file_parts(files):
    """Eklenen dosyaları Gemini parçalarına çevirir; sonraki 4 soruda da bağlamda tutar."""
    if files:
        parts, names = [], []
        for f in files[:8]:
            try:
                parts += MEDIA.file_to_parts(f) if MEDIA else []
                names.append(f.get("name", "dosya"))
            except Exception as e:
                emit("hata", str(e))
        CTX_FILES.update(parts=parts, left=4, names=names)
        return parts
    if CTX_FILES["left"] > 0 and CTX_FILES["parts"]:
        CTX_FILES["left"] -= 1
        return CTX_FILES["parts"]
    return []


def clear_files():
    CTX_FILES.update(parts=[], left=0, names=[])
    if MEDIA:
        MEDIA.CUR["imgs"] = []


MEDIA = None


def think(text, files=None):
    fparts = _file_parts(files)
    if fparts:
        text = (text or "Bu dosyayı incele.") + f"\n[Ekli: {', '.join(CTX_FILES['names'])}]"
    if PENDING.get("power") and agent.norm(text).strip(" .!") in ("evet", "onayliyorum", "evet yap", "tamam"):
        r = t_power({"islem": PENDING.pop("power"), "onay": True})
        return "Tamam, şimdi yapıyorum." if r.get("ok") else r.get("hata", "Yapamadım.")
    base = clean_hist(HIST)
    try:
        try:
            return _think(base, text, fparts)
        except ApiError as e:
            if e.status != 400 or "api key" in e.msg.lower():
                raise
            log("uyarı", "Sohbet geçmişi Gemini'ye uymadı, temiz geçmişle yeniden deniyorum: " + e.msg[:200])
            return _think([], text, fparts)
    except ApiError as e:
        if C.get("groq_key") and not fparts and e.status in (0, 429, 500, 502, 503, 504, 200, 400):
            log("uyarı", f"Gemini olmadı ({e.status}), Groq yedek beyinle devam")
            try:
                return groq_think(base, text)
            except Exception as g:
                log("hata", f"Groq da olmadı: {g}")
        raise


def _json_schema(o):
    if isinstance(o, dict):
        return {k: (v.lower() if k == "type" and isinstance(v, str) else _json_schema(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [_json_schema(x) for x in o]
    return o


def groq_think(base, text):
    """Yedek beyin: Gemini kotası dolunca ücretsiz Groq (Llama) ile aynı araçları kullanır."""
    tools = [{"type": "function", "function": {"name": n, "description": TOOL_DESC.get(n, n),
              "parameters": _json_schema({"type": "OBJECT", "properties": props, "required": req})}} for n, (props, req, _) in TOOLS.items()]
    msgs = [{"role": "system", "content": system_prompt()}]
    for h in base:
        t = " ".join(p.get("text", "") for p in h.get("parts", []) if p.get("text"))
        if t.strip() and not _is_call(h) and not _is_resp(h):
            msgs.append({"role": "assistant" if h["role"] == "model" else "user", "content": t})
    msgs.append({"role": "user", "content": text})
    for _ in range(6):
        j = post_json("https://api.groq.com/openai/v1/chat/completions", {"model": C.get("groq_model") or "llama-3.3-70b-versatile", "messages": msgs, "tools": tools, "temperature": 0.4, "max_tokens": 900},
                      headers={"Authorization": "Bearer " + C["groq_key"]}, timeout=40)
        m = j["choices"][0]["message"]
        calls = m.get("tool_calls") or []
        if not calls:
            reply = (m.get("content") or "Tamam.").strip()
            HIST[:] = clean_hist(base + [{"role": "user", "parts": [{"text": text}]}, {"role": "model", "parts": [{"text": reply}]}], 30)
            save_hist()
            return reply
        msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except Exception:
                args = {}
            emit("arac", name)
            r = TOOLS[name][2](args) if name in TOOLS else {"hata": "Bilinmeyen araç"}
            msgs.append({"role": "tool", "tool_call_id": c.get("id", name), "content": json.dumps(r, ensure_ascii=False)[:6000]})
    return "İşlemleri yaptım."


def save_hist():
    try:
        jsave("gecmis.json", [h for h in clean_hist(HIST, 30) if not _is_call(h) and not _is_resp(h)])
    except Exception:
        pass


def _strip(conv):
    """Geçmişe dosya verisini (base64) yazma; yerine kısa not koy."""
    out = []
    for h in conv:
        parts = [p for p in h.get("parts", []) if "inlineData" not in p and not (p.get("text", "").startswith("[") and len(p.get("text", "")) > 4000)]
        if len(parts) != len(h.get("parts", [])) and not any(p.get("text") for p in parts):
            parts = [{"text": "(dosya eklendi)"}] + parts
        out.append({**h, "parts": parts})
    return out


def _think(base, text, fparts=None):
    conv = base + [{"role": "user", "parts": list(fparts or []) + [{"text": text}]}]
    for _ in range(7):
        c = gemini(conv, DECL, system_prompt())
        parts = [p for p in c.get("parts", []) if p]
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            reply = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip() or "Tamam."
            conv.append({"role": "model", "parts": [{"text": reply}]})
            HIST[:] = clean_hist(_strip(conv), 30)  # sadece başarılı turlar geçmişe yazılır (dosyalar hariç)
            save_hist()
            return reply
        conv.append({"role": "model", "parts": parts})
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
            fr = {"name": name, "response": r if isinstance(r, dict) else {"sonuc": r}}
            if fc.get("id"):
                fr["id"] = fc["id"]
            resp.append({"functionResponse": fr})
        conv.append({"role": "user", "parts": resp})
    HIST[:] = clean_hist(_strip(conv), 30)
    save_hist()
    return "İşlemleri yaptım."


# ---------------- uyandırma: kısayol ve "Hey Titus" ----------------
TRIGGER = threading.Event()
LIVE_STOP = threading.Event()  # canlı sohbeti dışarıdan bitirmek için
LIVE_CHAT = None
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
    grammar = json.dumps(["hey titus", "okay titus", "titus", "hey", "okay", "hello", "tight", "tie", "ties", "tidy", "titles", "focus", "lotus", "status", "notice", "this", "is", "it", "us", "jarvis", "[unk]"])
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
                        tw = [w for w in words if w.get("word") == "titus"]
                        tconf = tw[0].get("conf", 0) if tw else 0
                        hey = txt.startswith(("hey", "okay"))
                        if tw and ((hey and tconf > 0.8) or (not C.get("wake_strict") and tconf > 0.9)):
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
    """Sohbet: önce kesintisiz canlı moda geçer; olmazsa sırayla dinle–düşün–konuş döngüsü (her seferinde 'Titus' demeden)."""
    with BUSY:
        try:
            import titus_live
            if titus_live.run_live(sys.modules[__name__]):
                return
        except Exception as e:
            print("canlı mod yok:", e)
        beep(True)
        quiet = 0
        for turn in range(40):
            emit("durum", "dinliyor")
            pcm = record(max_sec=20)
            if not pcm:
                quiet += 1
                if quiet >= 2 or LIVE_STOP.is_set():
                    break
                continue
            quiet = 0
            emit("durum", "anlıyor")
            try:
                text = transcribe(pcm)
            except Exception as e:
                emit("hata", "Ses anlaşılamadı: " + str(e)[:80]); continue
            if not text or len(text) < 2:
                continue
            print("Sen:", text)
            emit("sen", text)
            if agent.norm(text).strip(" .!") in ("tesekkurler", "sag ol", "kapat", "gorusuruz", "bu kadar", "tamam bu kadar"):
                speak("Rica ederim, buradayım."); break
            emit("durum", "düşünüyor")
            try:
                reply = think(text)
            except Exception as e:
                reply = "Bir sorun oldu: " + str(e)[:80]
            speak(reply)
            if LIVE_STOP.is_set():
                break
        beep(False)
        emit("durum", "hazır")


try:
    import titus_plus  # noqa: F401  (10 fazın eklentileri: hafıza, arama, belgeler, ekran ajanı, hatırlatıcılar…)
    titus_plus.setup(sys.modules[__name__])
except Exception as _e:
    log("hata", f"eklentiler yüklenemedi: {_e}")


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
