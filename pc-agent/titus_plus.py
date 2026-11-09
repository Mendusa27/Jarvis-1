"""
Titus v2.5 eklentileri — 10 fazın bilgisayar tarafı.
Hafıza, internette arama, belge okuma, klasör düzenleme, çok adımlı ekran ajanı,
yerel hatırlatıcı/zamanlayıcı + Windows bildirimi, sabah brifingi, telefona gönderme, sistem kontrolü.
Hepsi ücretsiz servislerle çalışır. Hiçbir araç dosya silmez.
"""
import base64, io, json, os, re, shutil, subprocess, threading, time, urllib.parse, urllib.request, uuid, webbrowser
from datetime import datetime, timedelta
from pathlib import Path

J = None          # jarvis_desktop modülü (setup ile gelir)
P = None          # parametre tanımı yardımcısı
AGENT_STOP = threading.Event()
NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def _id():
    return uuid.uuid4().hex[:10]


def _now():
    return datetime.now().strftime("%Y-%m-%dT%H:%M")


def _parse_due(s):
    s = str(s or "").strip().replace(" ", "T")
    for f in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:len(datetime.now().strftime(f))], f)
        except Exception:
            pass
    return None


# ======================= FAZ 9: Windows bildirimi =======================
def toast(title, msg):
    if os.name != "nt":
        J.log("bilgi", f"bildirim: {title} — {msg}"); return
    q = lambda x: str(x).replace("'", "''")[:240]
    ps = ("[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;"
          "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
          f"$e=$t.GetElementsByTagName('text');$e.Item(0).AppendChild($t.CreateTextNode('{q(title)}'))|Out-Null;$e.Item(1).AppendChild($t.CreateTextNode('{q(msg)}'))|Out-Null;"
          "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($t))")
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], creationflags=NO_WINDOW)
    except Exception as e:
        J.log("uyarı", f"bildirim gösterilemedi: {e}")


# ======================= FAZ 3: kalıcı hafıza =======================
def mem_list():
    return J.jload("hafiza.json", [])


def mem_add(text):
    text = str(text).strip()
    if not text:
        return {"hata": "Boş bilgi"}
    m = mem_list()
    if any(x["t"].lower() == text.lower() for x in m):
        return {"ok": True, "not": "Zaten biliyordum."}
    m.append({"t": text[:300], "at": _now()}); J.jsave("hafiza.json", m[-200:])
    return {"ok": True}


def mem_del(q):
    m = mem_list()
    if isinstance(q, int) or str(q).isdigit():
        i = int(q)
        if 0 <= i < len(m):
            gone = m.pop(i); J.jsave("hafiza.json", m); return {"ok": True, "silinen": gone["t"]}
        return {"hata": "Böyle bir kayıt yok"}
    ql = str(q).lower()
    keep = [x for x in m if ql not in x["t"].lower()]
    J.jsave("hafiza.json", keep)
    return {"ok": True, "silinen_sayi": len(m) - len(keep)}


def mem_hook():
    try:
        m = mem_list()
        txt = ""
        if m:
            txt += "\nBURAK HAKKINDA KALICI HAFIZAN (gerektiğinde kullan, her cevapta sayma): " + " | ".join(x["t"] for x in m[-40:])
        txt += ("\nBurak kendisi, tercihleri, insanlar ya da projeleri hakkında kalıcı bir bilgi verirse ya da 'bunu hatırla' derse hafizaya_al kullan."
                " Ekranda çok adımlı bir iş istenirse (bir sitede arama yapmak, form doldurmak, menülerde gezinmek) ekran_gorevi kullan.")
        due = [r for r in rem_list() if not r.get("done")]
        if due:
            txt += "\nYAKLAŞAN HATIRLATICILAR: " + "; ".join(f"{r['due']} {r['text']}" for r in sorted(due, key=lambda r: r["due"])[:6])
        return txt
    except Exception:
        return ""


# ======================= FAZ 6: internette arama (Google) =======================
def web_search(a):
    q = str(a.get("soru") or a.get("q") or "").strip()
    if not q:
        return {"hata": "Ne arayayım?"}
    body = {"contents": [{"role": "user", "parts": [{"text": q}]}], "tools": [{"google_search": {}}],
            "systemInstruction": {"parts": [{"text": f"Bugün {datetime.now():%d.%m.%Y}. Soruyu Google aramasıyla güncel olarak cevapla. Türkçe, kısa (en fazla 5 cümle), rakam ve tarihleri net ver."}]},
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 900}}
    last = None
    for m in J.GEMINI:
        try:
            j = J.post_json(J._gem_url(m), body, timeout=50)
            c = (j.get("candidates") or [{}])[0]
            txt = J.gemini_text(c.get("content"))
            src = []
            for ch in (c.get("groundingMetadata") or {}).get("groundingChunks", [])[:5]:
                w = ch.get("web") or {}
                if w.get("title"):
                    src.append(w["title"])
            if txt:
                return {"cevap": txt, "kaynaklar": src}
        except Exception as e:
            last = e
            if getattr(e, "status", 0) not in (404, 429, 500, 503, 0, 400):
                break
    return {"hata": "Arama yapılamadı: " + J.friendly(last) if last else "Sonuç bulunamadı"}


# ======================= FAZ 7: belge zekâsı =======================
TEXT_EXT = {".txt", ".md", ".csv", ".json", ".log", ".py", ".js", ".html", ".xml", ".srt", ".ini"}


def read_doc(path, limit=60000):
    p = Path(path); ext = p.suffix.lower()
    if ext in TEXT_EXT:
        for enc in ("utf-8", "cp1254", "latin-1"):
            try:
                return p.read_text(encoding=enc)[:limit]
            except Exception:
                continue
    if ext == ".pdf":
        from pypdf import PdfReader
        r = PdfReader(str(p)); out = []
        for pg in r.pages[:80]:
            out.append(pg.extract_text() or "")
            if sum(map(len, out)) > limit:
                break
        return "\n".join(out)[:limit]
    if ext == ".docx":
        import docx
        d = docx.Document(str(p))
        return "\n".join(par.text for par in d.paragraphs)[:limit]
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(str(p), read_only=True, data_only=True); out = []
        for ws in wb.worksheets[:5]:
            out.append(f"## {ws.title}")
            for row in ws.iter_rows(max_row=400, values_only=True):
                out.append(" | ".join("" if v is None else str(v) for v in row))
        return "\n".join(out)[:limit]
    if ext == ".pptx":
        raise RuntimeError("PowerPoint okuma bu sürümde yok; PDF olarak kaydedip ver.")
    raise RuntimeError(f"{ext or 'bu'} türünü okuyamıyorum (metin, PDF, Word, Excel okuyabilirim).")


def find_one(name):
    p = Path(os.path.expandvars(str(name).strip('" ')))
    if p.is_file():
        return p
    fs = J.agent.find_files(str(name), 1)
    return fs[0] if fs else None


def doc_tool(a):
    f = find_one(a.get("ad", ""))
    if not f:
        return {"hata": "Dosyayı bulamadım (Masaüstü, Belgeler, İndirilenler'e baktım). Tam adını söyler misin?"}
    text = read_doc(f)
    if not text.strip():
        return {"hata": "Dosyada okunabilir yazı yok (taranmış PDF olabilir). Ekranda açıp 'ekrana bak' diyebilirsin."}
    soru = a.get("soru") or "Bu belgeyi Türkçe, kısa ve net özetle: ana fikir, önemli noktalar, varsa tarih/rakam/yapılacaklar."
    c = J.gemini([{"role": "user", "parts": [{"text": f"BELGE: {f.name}\n-----\n{text}\n-----\n{soru}"}]}], max_tokens=1200, temperature=0.3)
    return {"dosya": f.name, "cevap": J.gemini_text(c)}


CATS = {"Resimler": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp", ".svg"}, "Videolar": {".mp4", ".mov", ".avi", ".mkv", ".webm"},
        "Müzik": {".mp3", ".wav", ".m4a", ".flac", ".ogg"}, "Belgeler": {".pdf", ".doc", ".docx", ".txt", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".odt", ".rtf"},
        "Arşivler": {".zip", ".rar", ".7z", ".tar", ".gz"}, "Programlar": {".exe", ".msi", ".apk", ".bat"}}
FOLDERS = {"indirilenler": "Downloads", "downloads": "Downloads", "masaüstü": "Desktop", "masaustu": "Desktop", "desktop": "Desktop", "belgeler": "Documents", "documents": "Documents"}


def organize(a):
    key = J.agent.norm(a.get("klasor") or "indirilenler").strip()
    base = Path.home() / FOLDERS.get(key, a.get("klasor") or "Downloads")
    if not base.is_dir():
        return {"hata": f"{base} klasörünü bulamadım"}
    plan = {}
    for f in base.iterdir():
        if f.is_file() and not f.name.startswith(("~", ".")) and not f.name.lower().endswith((".lnk", ".ini", ".crdownload", ".part")):
            cat = next((c for c, ex in CATS.items() if f.suffix.lower() in ex), "Diğer")
            plan.setdefault(cat, []).append(f)
    if not plan:
        return {"sonuc": "Klasör zaten düzenli, taşınacak dosya yok."}
    if not a.get("onay"):
        return {"onay_gerekli": True, "plan": {k: len(v) for k, v in plan.items()}, "soru": f"{base.name} klasöründeki {sum(map(len, plan.values()))} dosyayı türlerine göre alt klasörlere taşıyayım mı? Hiçbir şey silinmez, istersen geri alırım."}
    moved = []
    for cat, files in plan.items():
        d = base / cat; d.mkdir(exist_ok=True)
        for f in files:
            dst = d / f.name; i = 1
            while dst.exists():
                dst = d / f"{f.stem} ({i}){f.suffix}"; i += 1
            try:
                shutil.move(str(f), str(dst)); moved.append([str(dst), str(f)])
            except Exception as e:
                J.log("uyarı", f"taşınamadı {f.name}: {e}")
    J.jsave("son_tasima.json", moved)
    return {"ok": True, "tasinan": len(moved)}


def organize_undo(a):
    moved = J.jload("son_tasima.json", [])
    n = 0
    for dst, src in moved:
        try:
            if Path(dst).exists() and not Path(src).exists():
                shutil.move(dst, src); n += 1
        except Exception:
            pass
    J.jsave("son_tasima.json", [])
    return {"ok": True, "geri_alinan": n}


# ======================= FAZ 8: çok adımlı ekran ajanı =======================
AGENT_RULES = """Sen bir Windows bilgisayarı fareyle ve klavyeyle kullanan dikkatli bir asistansın. Her adımda ekran görüntüsüne bakıp TEK bir sonraki eylemi seçersin.
Kurallar: Ödeme/satın alma yapma, şifre ya da kart bilgisi yazma, mesaj/mail/form GÖNDERME, bir şey silme — bunlar gerekiyorsa eylem "sor" de ve nedenini yaz.
Giriş yapmak gerekiyorsa "sor" de. Aynı şeyi 3 kez denedin ve olmadıysa "sor" de. Görev bitince "bitti" de ve sonucu "ozet"e yaz (bulduğun bilgiyi de yaz).
Koordinatlar ekranın 0-1000 ölçeğinde (sol üst 0,0; sağ alt 1000,1000).
SADECE JSON: {"dusunce":"kısa","eylem":"tikla|cift_tikla|sag_tikla|yaz|tus|kaydir|bekle|ac|bitti|sor","x":0,"y":0,"metin":"","tuslar":"","yon":"asagi|yukari","ozet":""}"""


def screen_task(a):
    pg = J.pyautogui
    if not pg:
        return {"hata": "Ekran kontrolü için pyautogui kurulu değil (1-KUR.bat'ı çalıştır)."}
    goal = str(a.get("gorev", "")).strip()
    if not goal:
        return {"hata": "Görev ne?"}
    from PIL import ImageGrab
    AGENT_STOP.clear()
    hk = None
    if J.keyboard:
        try: hk = J.keyboard.add_hotkey("esc", AGENT_STOP.set)
        except Exception: hk = None
    steps, last_actions = [], []
    J.emit("durum", "çalışıyor")
    try:
        for i in range(int(a.get("adim") or 15)):
            if AGENT_STOP.is_set() or J.LIVE_STOP.is_set():
                return {"durduruldu": True, "yapilanlar": steps}
            im = ImageGrab.grab(all_screens=False)
            w = min(im.width, 1280)
            b = io.BytesIO(); im.convert("RGB").resize((w, int(im.height * w / im.width))).save(b, "JPEG", quality=70)
            hist = "\n".join(f"{k + 1}. {s}" for k, s in enumerate(steps[-10:])) or "(henüz yok)"
            c = J.gemini([{"role": "user", "parts": [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(b.getvalue()).decode()}},
                                                     {"text": f"GÖREV: {goal}\nYAPTIKLARIN:\n{hist}\nSıradaki tek eylem?"}]}],
                         system=AGENT_RULES, max_tokens=400, json_mode=True, temperature=0.2)
            t = J.gemini_text(c)
            try:
                d = json.loads(t[t.index("{"): t.rindex("}") + 1])
            except Exception:
                steps.append("(anlaşılmayan cevap)"); continue
            act = d.get("eylem", "")
            J.emit("arac", "ekran: " + (d.get("dusunce") or act)[:70])
            if act == "bitti":
                return {"ok": True, "sonuc": d.get("ozet") or "Bitti.", "adim": i + 1}
            if act == "sor":
                return {"durdu": True, "soru": d.get("ozet") or d.get("dusunce") or "Devam etmek için onayın gerekiyor.", "yapilanlar": steps}
            sw, sh = pg.size()
            x, y = int(float(d.get("x", 500)) / 1000 * sw), int(float(d.get("y", 500)) / 1000 * sh)
            if act in ("tikla", "cift_tikla", "sag_tikla"):
                pg.click(x, y, clicks=2 if act == "cift_tikla" else 1, button="right" if act == "sag_tikla" else "left")
            elif act == "yaz":
                J.t_type({"metin": d.get("metin", ""), "enter": False})
            elif act == "tus":
                J.t_keys({"tuslar": d.get("tuslar", "enter")})
            elif act == "kaydir":
                pg.moveTo(x, y); pg.scroll(-600 if d.get("yon", "asagi") != "yukari" else 600)
            elif act == "ac":
                tgt = d.get("metin", "")
                (webbrowser.open(tgt if tgt.startswith("http") else "https://" + tgt) if "." in tgt and " " not in tgt else J.agent.open_app(tgt))
                time.sleep(2)
            elif act == "bekle":
                time.sleep(min(5, float(d.get("metin") or 2) if str(d.get("metin", "")).replace(".", "").isdigit() else 2))
            sig = f"{act}:{d.get('x')}:{d.get('y')}:{d.get('metin', '')}"
            last_actions.append(sig)
            steps.append(f"{act} {d.get('metin') or d.get('tuslar') or ''} ({d.get('dusunce', '')[:60]})".strip())
            if last_actions[-4:].count(sig) >= 3:
                return {"durdu": True, "soru": "Aynı yerde takıldım, ekranda neyin değişmesi gerektiğini söyler misin?", "yapilanlar": steps}
            time.sleep(0.9)
        return {"durdu": True, "soru": "Adım sınırına geldim, devam edeyim mi?", "yapilanlar": steps}
    finally:
        if hk is not None:
            try: J.keyboard.remove_hotkey(hk)
            except Exception: pass
        J.emit("durum", "hazır")


# ======================= FAZ 9: hatırlatıcı, zamanlayıcı, brifing =======================
def rem_list():
    return J.jload("hatirlaticilar.json", [])


def rem_save(lst):
    J.jsave("hatirlaticilar.json", lst[-300:])


def rem_add(a):
    due = _parse_due(a.get("due"))
    if not due:
        return {"hata": "Zamanı anlayamadım; 'yarın 9:30' gibi söyler misin?"}
    if due < datetime.now() - timedelta(minutes=1) and a.get("repeat", "none") == "none":
        return {"hata": f"{due:%d.%m %H:%M} geçmişte kalıyor; doğru gün ve saati söyler misin?"}
    r = {"id": _id(), "text": str(a.get("text", "Hatırlatma"))[:200], "due": due.strftime("%Y-%m-%dT%H:%M"), "done": False, "repeat": a.get("repeat", "none")}
    lst = rem_list(); lst.append(r); rem_save(lst)
    phone = ""
    if J.AG.get("url"):
        try:
            J.state_add("reminders", {"id": r["id"], "text": r["text"], "due": r["due"], "done": False, "repeat": r["repeat"]}); phone = " Telefona da eklendi."
        except Exception as e:
            J.log("uyarı", f"telefona eklenemedi: {e}")
    return {"ok": True, "zaman": r["due"], "not": "Bilgisayarda bildirim ve sesle hatırlatacağım." + phone}


def rem_done(q):
    lst = rem_list(); n = 0
    for r in lst:
        if not r["done"] and (r["id"] == q or str(q).lower() in r["text"].lower()):
            r["done"] = True; n += 1
    rem_save(lst)
    return {"ok": n > 0, "kapatilan": n}


def timer_add(a):
    sec = float(a.get("saniye") or 0) + float(a.get("dakika") or 0) * 60 + float(a.get("saat") or 0) * 3600
    if sec <= 0:
        return {"hata": "Kaç dakika?"}
    due = datetime.now() + timedelta(seconds=sec)
    r = {"id": _id(), "text": "⏱ " + (a.get("etiket") or "Zamanlayıcı bitti"), "due": due.strftime("%Y-%m-%dT%H:%M:%S"), "done": False, "repeat": "none"}
    lst = rem_list(); lst.append(r); rem_save(lst)
    return {"ok": True, "bitis": due.strftime("%H:%M:%S")}


def _due_dt(r):
    for f in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(r["due"], f)
        except Exception:
            pass
    return None


def scheduler():
    while True:
        try:
            lst = rem_list(); changed = False; now = datetime.now()
            for r in lst:
                d = _due_dt(r)
                if r.get("done") or not d or d > now:
                    continue
                if now - d < timedelta(hours=12):  # bilgisayar kapalıyken kaçanları yarım gün içinde yine söyle
                    toast("Titus hatırlatıyor", r["text"])
                    J.emit("hatirlatma", r["text"])
                    if not J.BUSY.locked():
                        threading.Thread(target=J.speak, args=(f"{J.C.get('name', 'Burak')}, hatırlatma: {r['text'].lstrip('⏱ ')}",), daemon=True).start()
                rep = r.get("repeat", "none")
                if rep in ("daily", "weekly", "monthly"):
                    step = {"daily": timedelta(days=1), "weekly": timedelta(days=7), "monthly": timedelta(days=30)}[rep]
                    while d <= now:
                        d += step
                    r["due"] = d.strftime("%Y-%m-%dT%H:%M")
                else:
                    r["done"] = True
                changed = True
            if changed:
                rem_save(lst)
        except Exception as e:
            J.log("hata", f"hatırlatıcı zamanlayıcısı: {e}")
        time.sleep(5)


WMO = {0: "açık", 1: "çoğunlukla açık", 2: "parçalı bulutlu", 3: "kapalı", 45: "sisli", 48: "sisli", 51: "hafif çiseleme", 53: "çiseleme", 55: "yoğun çiseleme",
       61: "hafif yağmurlu", 63: "yağmurlu", 65: "kuvvetli yağmurlu", 71: "hafif karlı", 73: "karlı", 75: "yoğun karlı", 80: "sağanak", 81: "sağanak", 82: "kuvvetli sağanak", 95: "gök gürültülü fırtına"}


def weather():
    lat, lon = J.C.get("lat") or 41.0082, J.C.get("lon") or 28.9784
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m"
           "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1")
    with urllib.request.urlopen(url, timeout=12) as r:
        j = json.loads(r.read().decode())
    cur, d = j["current"], j["daily"]
    return {"sehir": J.C.get("city") or "İstanbul", "simdi": f"{round(cur['temperature_2m'])}°C, {WMO.get(cur['weather_code'], 'değişken')}", "hissedilen": round(cur["apparent_temperature"]),
            "en_dusuk": round(d["temperature_2m_min"][0]), "en_yuksek": round(d["temperature_2m_max"][0]), "yagmur_ihtimali": d["precipitation_probability_max"][0]}


def brief(a=None):
    data = {"tarih": datetime.now().strftime("%d.%m.%Y %A %H:%M")}
    try: data["hava"] = weather()
    except Exception as e: J.log("uyarı", f"hava: {e}")
    today = datetime.now().date()
    data["bugunku_hatirlaticilar"] = [f"{r['due'][11:16]} {r['text']}" for r in rem_list() if not r["done"] and (_due_dt(r) or datetime.max).date() == today]
    if J.AG.get("url"):
        try:
            b = J.agent.call(J.AG, "briefData")
            data["takvim"] = b.get("etkinlikler"); data["mailler"] = [f"{m.get('kimden')}: {m.get('konu')}" for m in (b.get("mailler") or [])[:6]]
            if b.get("geceRaporu"): data["gece_raporu"] = (b["geceRaporu"] or {}).get("text")
            st = J.state_load()
            data["acik_gorevler"] = [t["text"] for t in st.get("tasks", []) if not t.get("done")][:8]
        except Exception as e:
            J.log("uyarı", f"brifing telefon verisi: {e}")
    c = J.gemini([{"role": "user", "parts": [{"text": "Bu verilerden Burak'a sesli okunacak, doğal ve sıcak bir brifing yap (en fazla 6 cümle, liste yok): selam, hava, bugün yapılacaklar/takvim, önemli mailler, kısa bir öneri.\n" + json.dumps(data, ensure_ascii=False)[:6000]}]}], max_tokens=700)
    return {"brifing": J.gemini_text(c) or "Bugün için kayıtlı bir şey yok."}


# ======================= FAZ 10: telefonla bağlantı =======================
def to_phone(a):
    msg = str(a.get("metin", "")).strip()
    if not msg:
        return {"hata": "Ne göndereyim?"}
    sent = []
    if J.AG.get("url"):
        try:
            J.state_add("notes", {"id": _id(), "text": "💻 " + msg, "at": _now()}); sent.append("Titus notlarına")
        except Exception as e:
            J.log("uyarı", f"telefon notu: {e}")
    if J.C.get("ntfy"):
        try:
            req = urllib.request.Request("https://ntfy.sh/" + urllib.parse.quote(J.C["ntfy"]), data=msg.encode("utf-8"), headers={"Title": "Titus (bilgisayar)"})
            urllib.request.urlopen(req, timeout=10); sent.append("bildirim olarak")
        except Exception as e:
            J.log("uyarı", f"ntfy: {e}")
    if not sent:
        return {"hata": "Telefon bağlantısı kurulu değil (Ayarlar → Telefonla bağlantı)."}
    return {"ok": True, "gonderildi": " ve ".join(sent)}


def phone_lists():
    if not J.AG.get("url"):
        return {"bagli": False}
    st = J.state_load()
    return {"bagli": True, "gorevler": [t for t in st.get("tasks", []) if not t.get("done")][:40],
            "hatirlaticilar": [r for r in st.get("reminders", []) if not r.get("done")][:40]}


# ======================= FAZ 1: sistem kontrolü =======================
def selftest(a=None):
    res = []
    def add(name, ok, detail=""):
        res.append({"ad": name, "ok": None if ok is None else bool(ok), "detay": str(detail)[:200]})
    try:
        urllib.request.urlopen("https://www.google.com/generate_204", timeout=6); add("İnternet", True)
    except Exception as e:
        add("İnternet", False, e)
    if J.C.get("gemini_key"):
        try:
            c = J.gemini([{"role": "user", "parts": [{"text": "Sadece 'tamam' yaz."}]}], max_tokens=20)
            add("Gemini beyni", True, f"model: {J.GOOD_MODEL['m']}")
        except Exception as e:
            add("Gemini beyni", False, J.friendly(e) + f" ({getattr(e, 'msg', e)})")
    else:
        add("Gemini beyni", False, "Anahtar girilmemiş")
    if J.C.get("groq_key"):
        try:
            J.post_json("https://api.groq.com/openai/v1/chat/completions", {"model": "llama-3.1-8b-instant", "messages": [{"role": "user", "content": "ok"}], "max_tokens": 3},
                        headers={"Authorization": "Bearer " + J.C["groq_key"]}, timeout=15)
            add("Groq yedek beyin", True)
        except Exception as e:
            add("Groq yedek beyin", False, getattr(e, "msg", e))
    else:
        add("Groq yedek beyin", None, "İsteğe bağlı — anahtar girilmemiş")
    try:
        import sounddevice as sd
        devs = sd.query_devices(); ins = [d for d in devs if d.get("max_input_channels", 0) > 0]; outs = [d for d in devs if d.get("max_output_channels", 0) > 0]
        add("Mikrofon", bool(ins), (sd.query_devices(kind="input") or {}).get("name", "") if ins else "Mikrofon bulunamadı")
        add("Hoparlör", bool(outs), (sd.query_devices(kind="output") or {}).get("name", "") if outs else "Ses çıkışı bulunamadı")
    except Exception as e:
        add("Ses aygıtları", False, e)
    for mod, name in (("websockets", "Canlı sohbet paketi"), ("vosk", "'Titus' uyandırma paketi"), ("pyautogui", "Ekran kontrolü"), ("pypdf", "PDF okuma"), ("docx", "Word okuma"), ("requests", "Hızlı bağlantı")):
        try:
            __import__(mod); add(name, True)
        except Exception:
            add(name, False, "Kurulu değil — 1-KUR.bat'ı yeniden çalıştır")
    if J.AG.get("url"):
        try:
            J.agent.call(J.AG, "ping"); add("Telefon bağlantısı", True)
        except Exception as e:
            add("Telefon bağlantısı", False, e)
    else:
        add("Telefon bağlantısı", None, "İsteğe bağlı — kurulmamış")
    return {"sonuclar": res}


# ======================= kurulum =======================
def setup(jd):
    global J, P
    J = jd; P = jd.P
    jd.AGENT_STOP = AGENT_STOP
    # Faz 3: geçmişi diskten yükle (sohbet kaldığı yerden sürsün)
    try:
        h = jd.jload("gecmis.json", [])
        if isinstance(h, list):
            jd.HIST[:] = jd.clean_hist(h, 30)
    except Exception:
        pass
    jd.MEMORY_HOOK.append(mem_hook)
    reg = jd.register
    reg("hafizaya_al", "Burak hakkında kalıcı bir bilgiyi hafızaya kaydeder (tercih, kişi, proje, alışkanlık).", {"bilgi": P("STRING", "Kaydedilecek bilgi, kısa ve net")}, ["bilgi"], lambda a: mem_add(a.get("bilgi", "")))
    reg("hafizadan_sil", "Hafızadaki bir bilgiyi siler.", {"arama": P("STRING", "Silinecek bilginin içinden bir kelime")}, ["arama"], lambda a: mem_del(a.get("arama", "")))
    reg("hafiza_listele", "Hafızadaki bilgileri listeler.", {}, [], lambda a: {"hafiza": [x["t"] for x in mem_list()]})
    reg("internette_ara", "Google'da arayıp güncel bilgiyle cevaplar (haber, fiyat, maç, hava, kişi, yer, açılış saatleri…).", {"soru": P("STRING", "Aranacak soru")}, ["soru"], web_search)
    reg("belge_oku", "Bilgisayardaki bir belgeyi (PDF, Word, Excel, metin) okuyup özetler ya da hakkındaki soruyu cevaplar.", {"ad": P("STRING", "Dosya adı ya da tam yolu"), "soru": P("STRING", "Belgeyle ilgili soru (boşsa özet)")}, ["ad"], doc_tool)
    reg("klasor_duzenle", "Bir klasördeki dosyaları türlerine göre alt klasörlere taşır (silmez). Önce onaysız çağır, planı Burak'a söyle; onaylarsa onay=true ile tekrar çağır.", {"klasor": P("STRING", "İndirilenler, Masaüstü ya da Belgeler"), "onay": P("BOOLEAN", "Burak onayladıysa true")}, [], organize)
    reg("klasor_geri_al", "Son klasör düzenlemesini geri alır.", {}, [], organize_undo)
    reg("ekran_gorevi", "Bilgisayarda çok adımlı bir işi ekrana bakarak fare/klavyeyle yapar (ör. 'Chrome'da sahibinden'de Kadıköy kiralık daire ara', 'YouTube'da şu şarkıyı aç'). Burak Esc'ye basarsa durur.", {"gorev": P("STRING", "Yapılacak iş, ayrıntılı"), "adim": P("NUMBER", "En fazla adım (varsayılan 15)")}, ["gorev"], screen_task)
    reg("hatirlatici_ekle", "Hatırlatıcı kurar: bilgisayarda zamanı gelince bildirim ve sesle hatırlatır; telefon bağlıysa telefona da ekler.", {"text": P("STRING", "Ne hatırlatılacak"), "due": P("STRING", "YYYY-MM-DDTHH:mm"), "repeat": P("STRING", "", ["none", "daily", "weekly", "monthly"])}, ["text", "due"], rem_add)
    reg("hatirlaticilar", "Bilgisayardaki açık hatırlatıcıları listeler.", {}, [], lambda a: {"hatirlaticilar": [f"{r['due']} {r['text']}" for r in rem_list() if not r["done"]]})
    reg("hatirlatici_kapat", "Bir hatırlatıcıyı tamamlandı yapar / iptal eder.", {"arama": P("STRING", "Hatırlatıcının içinden bir kelime")}, ["arama"], lambda a: rem_done(a.get("arama", "")))
    reg("zamanlayici_kur", "Geri sayım zamanlayıcısı kurar (bitince bildirim ve ses).", {"dakika": P("NUMBER", "Dakika"), "saniye": P("NUMBER", "Saniye"), "etiket": P("STRING", "Ne için")}, [], timer_add)
    reg("sabah_brifingi", "Hava, bugünkü hatırlatıcılar, takvim, mailler ve görevlerden kısa bir brifing hazırlar.", {}, [], brief)
    reg("hava_durumu", "Şu anki ve bugünkü hava durumu.", {}, [], lambda a: weather())
    reg("telefona_gonder", "Bir notu, linki ya da metni Burak'ın telefonuna gönderir.", {"metin": P("STRING", "Gönderilecek metin")}, ["metin"], to_phone)
    reg("sistem_kontrolu", "Titus'un bağlantılarını ve parçalarını kontrol eder (internet, Gemini, mikrofon, paketler…).", {}, [], selftest)
    threading.Thread(target=scheduler, daemon=True).start()
    # bağlantıyı önceden ısıt: ilk komut daha hızlı cevaplansın
    def warm():
        try:
            if jd.C.get("gemini_key") and jd.requests:
                jd._sess().get(f"https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key={jd.C['gemini_key']}", timeout=8)
        except Exception:
            pass
    threading.Thread(target=warm, daemon=True).start()
    jd.log("bilgi", f"Titus {jd.VERSION} hazır — {len(jd.TOOLS)} araç")
