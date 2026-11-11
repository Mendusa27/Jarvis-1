"""Titus v3.0 — bilgisayardaki yetenek sistemi (Faz 1–10 kataloğu + çoklu Gmail + bilgisayara özel yetenekler).

Telefondaki ile aynı katalog (skills.json). Davranış modları ve yapay zekâ görevleri burada doğrudan çalışır;
bilgisayara özel yetenekler (müzik, ses efekti, 3D, ekran videosu, yapışkan not, kısayollar, hızlı pencere)
burada uygulanır; telefona özel olanlar telefondaki Titus'a iletilir.
"""
import json, os, re, sys, time, threading, subprocess, tempfile, zipfile, shutil, base64, unicodedata
from pathlib import Path
from datetime import datetime

J = None  # jarvis_desktop
P = None
TX = None  # titus_extra
HERE = Path(__file__).resolve().parent
SKILLS = []
VERSION_URL = "https://raw.githubusercontent.com/Mendusa27/Jarvis-1/main/indir/version.json"
ZIP_URL = "https://github.com/Mendusa27/Jarvis-1/raw/main/indir/TITUS-bilgisayar.zip"

TR = str.maketrans("çğıöşüâîûÇĞİÖŞÜ", "cgiosuaiuCGIOSU")


def deacc(s):
    return str(s or "").translate(TR).lower()


def toks(s):
    return [w for w in re.sub(r"[^a-z0-9 ]+", " ", deacc(s)).split() if len(w) >= 3]


def load_skills():
    global SKILLS
    for p in (HERE / "skills.json", HERE.parent / "www" / "skills.json"):
        if p.exists():
            SKILLS = json.loads(p.read_text("utf-8"))
            break
    user = J.jload("kendi_yetenekler.json", []) if J else []
    SKILLS += [{"id": "u-" + u["id"], "faz": 99, "n": u["n"], "k": "ask", "w": bool(u.get("w")), "f": False, "d": False, "no": False, "on": False, "durum": "tam", "a": u["a"], "not": "Kendi eklediğin"} for u in user]
    return SKILLS


def score(s, q):
    qt = toks(q)
    if not qt:
        return 0
    nt, at = toks(s["n"]), toks(s["a"])
    sc = 0
    for w in qt:
        p = w[:5]
        if any(x.startswith(p) or p.startswith(x[:5]) for x in nt):
            sc += 3
        elif any(x.startswith(p) for x in at):
            sc += 1
    if deacc(s["n"]) == deacc(q):
        sc += 20
    return sc / ((len(qt) + 1) ** 0.5)


def find(q):
    nq = deacc(q)
    for s in SKILLS:
        if s["id"] == q or deacc(s["n"]) == nq:
            return s, []
    sc = sorted(((score(s, q), s) for s in SKILLS), key=lambda x: -x[0])
    sc = [x for x in sc if x[0] > 0]
    return (sc[0][1] if sc and sc[0][0] >= 1.2 else None), [x[1]["n"] for x in sc[:5]]


def mode_on(s):
    return s["k"] == "mode" and J.C.get("modes", {}).get(s["id"], s.get("on", False))


# ---------------- yardımcılar ----------------
def ask_text(prompt, search=False, files=None, max_tokens=3500):
    parts = list(files or []) + [{"text": prompt}]
    tools = [{"google_search": {}}] if search else None
    c = J.gemini([{"role": "user", "parts": parts}], tools=tools, max_tokens=max_tokens, temperature=0.6)
    return J.gemini_text(c)


def ask_json(prompt, files=None):
    c = J.gemini([{"role": "user", "parts": list(files or []) + [{"text": prompt + "\n\nSADECE geçerli JSON döndür."}]}], max_tokens=4000, json_mode=True, temperature=0.4)
    t = J.gemini_text(c)
    m = re.search(r"[\[{][\s\S]*[\]}]", t)
    return json.loads(m.group(0)) if m else {}


def user_ctx():
    try:
        import titus_plus as TP
        mem = "; ".join(x["t"] for x in TP.mem_list()[:25])
    except Exception:
        mem = ""
    return f"Kullanıcı: {J.C.get('name', 'Burak')}. İstanbul'da oyuncu; Recast Talent House'da çalışıyor; barda gece vardiyaları; uygulama/oyun geliştiriyor. Şu an {datetime.now():%Y-%m-%d %H:%M}." + (f"\nBildiklerin: {mem}" if mem else "")


def out_dir(sub="Belgeler"):
    base = Path.home() / ("Documents" if sub == "Belgeler" else sub)
    d = base / "Titus"
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe(name):
    return re.sub(r'[\\/:*?"<>|]+', "", str(name))[:60].strip() or "titus"


def save_docx(title, text):
    try:
        import docx
    except Exception:
        p = out_dir() / f"{safe(title)}.txt"
        p.write_text(title + "\n\n" + text, "utf-8")
        return str(p)
    d = docx.Document()
    d.add_heading(title, 0)
    for line in str(text).split("\n"):
        l = line.replace("**", "").rstrip()
        if not l.strip():
            continue
        m = re.match(r"^(#{1,3})\s+(.*)", l)
        if m:
            d.add_heading(m.group(2), 1 if len(m.group(1)) == 1 else 2)
        elif re.match(r"^\s*([-*•]|\d+[.)])\s+", l):
            d.add_paragraph(re.sub(r"^\s*([-*•]|\d+[.)])\s+", "", l), style="List Bullet")
        else:
            d.add_paragraph(l)
    p = out_dir() / f"{safe(title)} {datetime.now():%Y-%m-%d %H%M}.docx"
    d.save(p)
    return str(p)


def open_path(p):
    try:
        if sys.platform.startswith("win"):
            os.startfile(p)  # noqa
        else:
            subprocess.Popen(["xdg-open", str(p)])
    except Exception:
        pass


def to_phone(text, kind="ask"):
    if not J.AG.get("url"):
        return {"hata": "Telefon bağlantısı yok (Ayarlar'a telefondaki bağlantı kodunu yapıştır)."}
    J.agent.call(J.AG, "phPush", kind=kind, text=text)
    return {"ok": True, "not": "Telefondaki Titus'a iletildi (telefon açıkken ~1 dk içinde yapar)."}


def files_ctx():
    try:
        return list(J.CTX_FILES.get("parts") or [])
    except Exception:
        return []


# ---------------- çoklu Gmail ----------------
def accounts():
    out = []
    if J.AG.get("url"):
        out.append({"n": J.C.get("main_acc_name") or "Ana hesap", "u": J.AG["url"], "t": J.AG["token"], "e": J.C.get("main_email", ""), "main": True})
    for a in J.C.get("accounts", []) or []:
        if a.get("u") and a.get("t"):
            out.append(a)
    return out


def pick_accounts(h):
    al = accounts()
    if not h or re.search(r"tüm|hepsi|bütün|all", str(h).lower()):
        return al
    n = deacc(h)
    f = [a for a in al if deacc(a["n"]) in n or n in deacc(a["n"]) or n in deacc(a.get("e", "")) or ("ana" in n and a.get("main"))]
    return f or al


def acc_call(a, action, **kw):
    return J.agent.call({"url": a["u"], "token": a["t"]}, action, **kw)


def t_mail_multi(a):
    accs = pick_accounts(a.get("hesap"))
    if not accs:
        return {"hata": "Gmail bağlı değil."}
    res = []
    for acc in accs:
        try:
            r = acc_call(acc, "gmail", query=a.get("sorgu") or "is:unread in:inbox", max=int(a.get("adet") or 8))
            res.append({"hesap": acc["n"] + (f" <{acc['e']}>" if acc.get("e") else ""), "mailler": r.get("mailler", [])})
        except Exception as e:
            res.append({"hesap": acc["n"], "hata": str(e)[:160]})
    return res[0] if len(res) == 1 else {"hesaplar": res}


def t_draft_multi(a):
    al = accounts()
    acc = pick_accounts(a["hesap"])[0] if a.get("hesap") else (al[0] if al else None)
    if not acc:
        return {"hata": "Gmail bağlı değil."}
    r = acc_call(acc, "gmailDraft", to=a.get("kime", ""), subject=a.get("konu", ""), body=a.get("metin", ""))
    return {"ok": True, "hesap": acc["n"], "not": r.get("not", "Taslak hazır.")}


# ---------------- güncelleme ----------------
def check_update(apply=False):
    import requests
    try:
        v = requests.get(VERSION_URL, timeout=20).json()
    except Exception as e:
        return {"hata": f"Sürüm bilgisi alınamadı: {e}"}
    new = str(v.get("pc", "0"))
    cur = J.VERSION
    newer = [int(x) for x in new.split(".")] > [int(x) for x in cur.split(".")]
    if not newer:
        return {"ok": True, "guncel": True, "surum": cur}
    if not apply:
        return {"ok": True, "yeni": new, "surum": cur, "not": "Yeni sürüm var; 'güncelle' de, indirip kurayım."}
    tmp = Path(tempfile.mkdtemp())
    try:
        r = requests.get(ZIP_URL, timeout=180)
        r.raise_for_status()
        z = tmp / "t.zip"
        z.write_bytes(r.content)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(tmp / "x")
        src = tmp / "x"
        subs = [p for p in src.iterdir() if p.is_dir()]
        if not (src / "jarvis_desktop.py").exists() and len(subs) == 1:
            src = subs[0]
        for f in src.iterdir():
            if f.is_file():
                shutil.copy2(f, HERE / f.name)
        J.log("bilgi", f"Güncellendi: {cur} → {new}")
        gui = HERE / "titus_gui.py"
        if gui.exists():
            subprocess.Popen([sys.executable, str(gui), "--yeniden"], cwd=str(HERE))
            threading.Timer(2.0, lambda: os._exit(0)).start()
        return {"ok": True, "guncellendi": new, "not": "Titus yeniden başlıyor."}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------- hesap sandığı (python) ----------------
def calc(q):
    err, code = "", ""
    for _ in range(3):
        code = ask_text(f"Şu isteği Python ile HESAPLA: \"{q}\"\n{('Önceki kod hata verdi: ' + err + chr(10) + code) if err else ''}\nSadece çalıştırılabilir Python kodu yaz; sonucu en sonda print(json.dumps({{'cevap': 'Türkçe kısa sonuç', 'tablo': [[...]]}}, ensure_ascii=False)) ile yazdır. Sadece standart kütüphane (math, json, datetime, statistics). İnternet, dosya yok. Açıklama yazma.", max_tokens=2500)
        code = re.sub(r"^\s*```[a-z]*\s*|```\s*$", "", code.strip())
        if "import json" not in code:
            code = "import json\n" + code
        if re.search(r"\b(os|subprocess|socket|shutil|requests|urllib|open\()", code):
            err = "yasak modül/işlem"
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(code)
        try:
            r = subprocess.run([sys.executable, "-I", f.name], capture_output=True, text=True, timeout=15)
            line = (r.stdout.strip().splitlines() or [""])[-1]
            if r.returncode == 0 and line.startswith("{"):
                return json.loads(line)
            err = (r.stderr or "boş çıktı")[-400:]
        except subprocess.TimeoutExpired:
            err = "süre aşıldı"
        finally:
            os.unlink(f.name)
    return {"hata": "Hesaplanamadı: " + err}


# ---------------- derin araştırma ----------------
def grounded(prompt):
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "tools": [{"google_search": {}}], "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1800}}
    for m in J.GEMINI:
        try:
            j = J.post_json(J._gem_url(m), body, timeout=60)
            c = (j.get("candidates") or [{}])[0]
            src = [{"title": (g.get("web") or {}).get("title", ""), "uri": (g.get("web") or {}).get("uri", "")} for g in (c.get("groundingMetadata") or {}).get("groundingChunks", []) if g.get("web")]
            return J.gemini_text(c.get("content")), src
        except Exception as e:
            if getattr(e, "status", 0) not in (404, 429, 500, 503, 0, 400):
                raise
    return "", []


def research(q, step=lambda s: None):
    step("plan")
    plan = ask_json(f'Araştırma konusu: "{q}". {user_ctx()}\n4-6 alt soru üret. JSON: {{"baslik":"","alt":["..."]}}')
    subs = plan.get("alt") or [q]
    found, srcs = [], []
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda s: (s, *grounded(f"Araştır, Türkçe bilgi yoğun cevap ver: {s} (ana konu: {q})")), subs))
    for s, t, src in res:
        nums = []
        for x in src:
            if x not in srcs:
                srcs.append(x)
            nums.append(srcs.index(x) + 1)
        found.append(f"### {s}\n{t}\nKaynaklar: {nums}")
    step("rapor")
    rep = ask_text(f"\"{plan.get('baslik') or q}\" için kapsamlı Türkçe rapor yaz: # Özet / # Bulgular ([n] kaynak numaralı) / # Çelişen bilgiler / # Kaynak güvenilirliği (1-5 puan) / # Sonuç. Uydurma ekleme.\n\n" + "\n\n".join(found) + "\n\nKAYNAKLAR:\n" + "\n".join(f"[{i + 1}] {s['title']}" for i, s in enumerate(srcs)), max_tokens=6000)
    path = save_docx("Araştırma — " + (plan.get("baslik") or q)[:50], rep + "\n\n# Kaynaklar\n" + "\n".join(f"- [{i + 1}] {s['title']} {s['uri']}" for i, s in enumerate(srcs)))
    return {"metin": rep, "belge": path, "kaynak": len(srcs)}


# ---------------- bilgisayara özel yetenekler ----------------
def hf_gen(spaces, prompt, kind):
    """Ücretsiz Hugging Face alanlarını sırayla dener; dosya yolunu döndürür."""
    from gradio_client import Client
    tok = J.C.get("hf_token") or None
    last = None
    for sp in spaces:
        try:
            c = Client(sp, hf_token=tok) if tok else Client(sp)
            api = c.view_api(return_format="dict", print_info=False) or {}
            for name, ep in (api.get("named_endpoints") or {}).items():
                params = ep.get("parameters", [])
                comps = [str(p.get("component", "")).lower() for p in params]
                if kind == "3d" and "image" not in comps:
                    continue
                if kind != "3d" and not any(c in ("textbox", "text") for c in comps):
                    continue
                args, ok, used = [], True, False
                for p, comp in zip(params, comps):
                    if comp in ("textbox", "text") and not used:
                        args.append(prompt); used = True
                    elif comp == "image" and kind == "3d":
                        from gradio_client import handle_file
                        args.append(handle_file(prompt)); used = True
                    elif p.get("parameter_has_default"):
                        args.append(p.get("parameter_default"))
                    else:
                        ok = False; break
                if not ok:
                    continue
                res = c.predict(*args, api_name=name)
                f = res[0] if isinstance(res, (list, tuple)) else res
                if isinstance(f, dict):
                    f = f.get("path") or f.get("value") or f.get("url")
                if f and os.path.exists(str(f)):
                    return str(f), sp
            last = RuntimeError(f"{sp}: uygun uç yok")
        except Exception as e:
            last = e
            J.log("uyarı", f"HF {sp}: {str(e)[:160]}")
    raise RuntimeError(f"Ücretsiz üretim alanlarına şu an ulaşılamadı ({str(last)[:120]}). Ayarlar'a ücretsiz Hugging Face token ekleyip tekrar dene.")


def music(a, kind="music"):
    q = a.get("girdi") or a.get("istek") or "calm cinematic piano background"
    en = ask_text("Translate to a short English audio generation prompt, only output the prompt: " + q, max_tokens=120)
    spaces = ["facebook/MusicGen", "ehristoforu/MusicGen", "fffiloni/MusicGen"] if kind == "music" else ["haoheliu/AudioLDM_48K_Text-to-sound", "declare-lab/tango2", "haoheliu/audioldm2-text2audio-text2music"]
    f, sp = hf_gen(spaces, en, kind)
    ext = Path(f).suffix or ".wav"
    dst = out_dir("Music") / f"{safe(q)}{ext}"
    shutil.copy2(f, dst)
    open_path(dst)
    return {"ok": True, "dosya": str(dst), "motor": sp}


def model3d(a):
    img = (a.get("dosya") or "").strip('"')
    if not img or not os.path.exists(img):
        names = getattr(J, "CTX_FILES", {}).get("names") or []
        img = next((n for n in names if os.path.exists(str(n)) and str(n).lower().endswith((".png", ".jpg", ".jpeg", ".webp"))), "")
    if not img:
        return {"hata": "3D'ye çevrilecek görseli sürükleyip bırak (ya da dosya yolunu yaz)."}
    f, sp = hf_gen(["stabilityai/TripoSR", "TencentARC/InstantMesh", "JeffreyXiang/TRELLIS"], img, "3d")
    dst = out_dir("Documents") / f"{safe(Path(img).stem)}-3d{Path(f).suffix or '.glb'}"
    shutil.copy2(f, dst)
    return {"ok": True, "dosya": str(dst), "motor": sp}


def screen_video(a):
    """Ekranı kaydeder (+ isteğe bağlı sesli anlatım) → MP4."""
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    sec = int(re.findall(r"\d+", str(a.get("girdi") or "30"))[0]) if re.findall(r"\d+", str(a.get("girdi") or "")) else 30
    sec = max(5, min(sec, 600))
    narr = re.sub(r"^\D*\d+\s*(sn|saniye|dk|dakika)?\s*", "", str(a.get("girdi") or "")).strip()
    out = out_dir("Videos") / f"egitim-{datetime.now():%Y%m%d-%H%M%S}.mp4"
    src = ["-f", "gdigrab", "-framerate", "15", "-i", "desktop"] if sys.platform.startswith("win") else ["-f", "x11grab", "-framerate", "15", "-i", os.environ.get("DISPLAY", ":0")]
    J.emit("arac", f"ekran kaydı: {sec} sn")
    raw = out.with_suffix(".raw.mp4")
    subprocess.run([ff, "-y", *src, "-t", str(sec), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", str(raw)], capture_output=True, timeout=sec + 60)
    if not raw.exists():
        return {"hata": "Ekran kaydı alınamadı."}
    if narr:
        pcm = J._tts(narr)
        if pcm is not None:
            import wave
            wav = out.with_suffix(".wav")
            with wave.open(str(wav), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm.tobytes())
            subprocess.run([ff, "-y", "-i", str(raw), "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-shortest", str(out)], capture_output=True, timeout=300)
            wav.unlink(missing_ok=True); raw.unlink(missing_ok=True)
    if raw.exists():
        raw.rename(out)
    open_path(out)
    return {"ok": True, "dosya": str(out)}


NOTES_FILE = "yapiskan_notlar.json"


def sticky(a):
    text = str(a.get("girdi") or "").strip()
    notes = J.jload(NOTES_FILE, [])
    if text:
        notes.append({"t": text, "at": datetime.now().strftime("%Y-%m-%d %H:%M")})
        J.jsave(NOTES_FILE, notes[-30:])

    def ui():
        try:
            import tkinter as tk
            r = tk.Tk(); r.title("Titus notları"); r.attributes("-topmost", True); r.geometry("300x340+40+40"); r.configure(bg="#2a0b0e")
            box = tk.Text(r, bg="#1a0507", fg="#ffe5e1", insertbackground="#ff3b3b", font=("Segoe UI", 11), wrap="word", relief="flat")
            box.pack(fill="both", expand=True, padx=6, pady=6)
            box.insert("1.0", "\n".join(f"• {n['t']}" for n in J.jload(NOTES_FILE, [])))
            def kaydet():
                lines = [l.lstrip("• ").strip() for l in box.get("1.0", "end").split("\n") if l.strip()]
                J.jsave(NOTES_FILE, [{"t": l, "at": datetime.now().strftime("%Y-%m-%d %H:%M")} for l in lines])
                r.destroy()
            tk.Button(r, text="Kaydet ve kapat", command=kaydet, bg="#9a1414", fg="white", relief="flat").pack(fill="x")
            r.mainloop()
        except Exception as e:
            J.log("uyarı", f"not panosu: {e}")
    threading.Thread(target=ui, daemon=True).start()
    return {"ok": True, "not": "Not panosu açıldı" + (" ve not eklendi." if text else "."), "notlar": [n["t"] for n in notes[-10:]]}


HOTKEYS = {"ctrl+alt+j": "Titus'u dinlet", "ctrl+alt+t": "Titus penceresini aç (hızlı pencere)", "ctrl+alt+n": "Yapışkan not panosu", "ctrl+alt+y": "Yetenekler sekmesi"}


def show_window(tab=None):
    try:
        G = sys.modules.get("__main__")
        if not hasattr(G, "open_window"):
            G = sys.modules.get("titus_gui")
        if G and hasattr(G, "open_window"):
            G.open_window()
    except Exception as e:
        J.log("uyarı", f"pencere: {e}")


def hotkeys_setup():
    try:
        import keyboard
    except Exception:
        return
    for combo, fn in (("ctrl+alt+t", lambda: show_window()), ("ctrl+alt+n", lambda: sticky({})), ("ctrl+alt+y", lambda: show_window("skills"))):
        try:
            keyboard.add_hotkey(combo, fn)
        except Exception:
            pass


def shortcuts(a):
    return {"kisayollar": [f"{k}: {v}" for k, v in HOTKEYS.items()]}


def app_factory(a):
    g = a.get("girdi") or ""
    html = ask_text(f"Tek dosyalık, bağımsız, mobil uyumlu HTML uygulaması/oyunu yaz. İSTEK: {g}. CSS ve JS aynı dosyada, dış bağlantı yok, Türkçe, koyu tema kırmızı vurgu. Sadece <!DOCTYPE html> ile başlayan kodu döndür.", max_tokens=16000)
    html = re.sub(r"^\s*```[a-z]*\s*|```\s*$", "", html.strip())
    if "<html" not in html.lower():
        return {"hata": "Uygulama kodu üretilemedi."}
    p = out_dir() / f"{safe(g)[:30] or 'uygulama'}.html"
    p.write_text(html, "utf-8")
    open_path(p)
    return {"ok": True, "dosya": str(p)}


def self_test(a=None):
    out, bad = [], []
    for s in SKILLS:
        k = s["k"]
        if k.startswith("fn:") and k[3:] not in PC_FN and k[3:] not in PHONE_ONLY_OK:
            pass  # telefona iletilir
    try:
        t = ask_text("Sadece 'tamam' yaz.", max_tokens=10)
        out.append("✓ Gemini" if t else "✗ Gemini boş")
    except Exception as e:
        out.append("✗ Gemini: " + J.friendly(e))
    for acc in accounts():
        try:
            r = acc_call(acc, "ping")
            out.append(f"✓ Google {acc['n']} {r.get('email', '')}")
        except Exception as e:
            out.append(f"✗ Google {acc['n']}: {str(e)[:100]}")
    r = calc("2+2")
    out.append("✓ Hesap sandığı" if not r.get("hata") else "✗ Hesap sandığı: " + r["hata"])
    by = {}
    for s in SKILLS:
        by[s["durum"]] = by.get(s["durum"], 0) + 1
    return {"metin": f"{len(SKILLS)} yetenek (tam {by.get('tam', 0)}, yapay zekâ {by.get('yz', 0)}, kısmi {by.get('kısmi', 0)}, yok {by.get('yok', 0)}).\n" + "\n".join(out)}


PC_ONLY_NAMES = {
    "müzik üretici": lambda a: music(a, "music"), "ses efekti üretici": lambda a: music(a, "sfx"), "görselden 3d model": model3d,
    "bilgisayarda hızlı pencere": lambda a: (show_window(), {"ok": True, "not": "Kısayol: Ctrl+Alt+T"})[1],
    "bilgisayarda klavye kısayolları": shortcuts, "yan yana pencere": lambda a: {"ok": True, "not": "Pencere genişken sohbet ve yetenekler iki sütun görünür (Titus penceresini büyüt)."},
    "bilgisayarda not panosu": sticky, "eğitim videosu yapıcı": screen_video,
}
PC_FN = {
    "research": lambda a: research(a.get("girdi") or ""),
    "calc": lambda a: (lambda r: {"metin": r.get("cevap"), **r} if not r.get("hata") else r)(calc(a.get("girdi") or "")),
    "appfactory": app_factory,
    "selftest": self_test,
    "update": lambda a: check_update(apply=bool(re.search(r"güncelle|kur|yükle", str(a.get("girdi") or "").lower()))),
    "accounts": lambda a: {"hesaplar": [f"{x['n']} {x.get('e', '')}" for x in accounts()]},
    "savechat": lambda a: {"belge": save_docx("Sohbet", "\n".join(f"{'Burak' if h.get('role') == 'user' else 'Titus'}: " + " ".join(p.get("text", "") for p in h.get("parts", [])) for h in J.HIST))},
    "summary": lambda a: {"metin": ask_text("Üç seviyede özetle (# Tek cümle / # Paragraf / # Detaylı):\n" + (a.get("girdi") or "(ekteki dosya)"), files=files_ctx())},
    "doublecheck": lambda a: {"metin": ask_text("Bu cevabı bağımsız doğrula, gerekirse internette kontrol et; 'Doğru/Kısmen/Yanlış' ile başla: " + (a.get("girdi") or ""), search=True)},
    "team": lambda a: research(a.get("girdi") or ""),
    "brain": lambda a: {"metin": ask_text(f"Kullanıcının hafızası: {user_ctx()}\nSoru: {a.get('girdi')}\nSadece bilinenlere dayanarak cevap ver.")},
    "findphone": lambda a: to_phone("", "ring") if J.AG.get("url") else {"hata": "Telefon bağlı değil."},
}
PHONE_ONLY_OK = set()


def run_skill(name, girdi=""):
    if not SKILLS:
        load_skills()
    s, alts = find(name)
    if not s:
        return {"hata": "Bu adla yetenek bulamadım", "benzerler": alts}
    k = s["k"]
    if k == "mode":
        l = str(girdi).lower()
        off = bool(re.search(r"kapat|kapa\b|iptal|istemiyorum|durdur|pasif", l))
        modes = dict(J.C.get("modes", {}))
        modes[s["id"]] = (not mode_on(s)) if re.search(r"değiştir|tersine", l) else not off
        J.save_cfg({"modes": modes})
        return {"yetenek": s["n"], "durum": "açık" if modes[s["id"]] else "kapalı"}
    a = {"girdi": girdi}
    if k.startswith("fn:"):
        fn = k[3:]
        if fn == "pconly":
            f = PC_ONLY_NAMES.get(s["n"].lower().replace("i̇", "i"))
            if not f:
                for key, val in PC_ONLY_NAMES.items():
                    if deacc(key) == deacc(s["n"]):
                        f = val
            return {"yetenek": s["n"], **(f(a) if f else {"hata": "Bu bilgisayar yeteneği henüz yok."})}
        if fn in PC_FN:
            return {"yetenek": s["n"], **PC_FN[fn](a)}
        r = to_phone(f'yetenek_calistir aracını kullan: ad="{s["n"]}", girdi="{girdi}"')
        return {"yetenek": s["n"], **r, "not": "Bu yetenek telefondaki Titus'ta çalışıyor; oraya ilettim."}
    if k.startswith("tool:"):
        tool = k.split(":")[1]
        pcmap = {"bilgisayara_soyle": "ekran_gorevi", "gorsel_uret": "gorsel_uret", "fotograf_montaj": "fotograf_montaj", "bilgi_ara": "belge_oku"}
        t = pcmap.get(tool)
        if t and t in J.TOOLS:
            arg = {"ekran_gorevi": "gorev", "gorsel_uret": "istek", "fotograf_montaj": "istek", "belge_oku": "soru"}.get(t, "istek")
            return {"yetenek": s["n"], **(J.TOOLS[t][2]({arg: girdi or s["a"]}) or {})}
        r = to_phone(f'yetenek_calistir aracını kullan: ad="{s["n"]}", girdi="{girdi}"')
        return {"yetenek": s["n"], **r}
    # ask
    prompt = f"GÖREV — {s['n']}: {s['a']}\n\n{user_ctx()}\n\nKULLANICININ İSTEĞİ: {girdi or '(ek girdi yok)'}\n\nTürkçe yaz; gerekirse başlık ve maddeler. Uydurma bilgi verme."
    txt = ask_text(prompt, search=bool(s.get("w")), files=files_ctx() if s.get("f") else None)
    out = {"yetenek": s["n"], "metin": txt}
    if s.get("d"):
        out["belge"] = save_docx(s["n"], txt)
    return out


def mem_hook():
    if not SKILLS:
        return ""
    modes = [s["a"] for s in SKILLS if mode_on(s)]
    s = ("\nDAVRANIŞ KURALLARIN:\n" + "\n".join("- " + m for m in modes)) if modes else ""
    s += "\nYETENEK SİSTEMİ: 360+ yeteneğin var (araştırma, belge, koçluk, finans, oyunculuk, oyun geliştirme...). İstek bir yeteneğe uyuyorsa yetenek_calistir kullan; emin değilsen yetenek_ara. Birden fazla Gmail hesabı bağlı olabilir: mailleri_oku'da hesap parametresi."
    return s


def setup(jd, p, tx=None):
    global J, P, TX
    J, P, TX = jd, p, tx
    for k, v in {"accounts": [], "modes": {}, "main_email": "", "main_acc_name": "", "hf_token": ""}.items():
        jd.DEFAULTS.setdefault(k, v)
        jd.C.setdefault(k, v)
    load_skills()
    reg = jd.register
    reg("yetenek_calistir", "Titus'un 360+ yeteneğinden birini çalıştırır (ör. 'Derin araştırma modu', 'Müzik üretici', 'Eğitim videosu yapıcı', 'Monolog kütüphanesi', 'Hesap, tablo ve grafik çalışma alanı'). Davranış modlarını açıp kapatır.",
        {"ad": p("STRING", "Yetenek adı (yaklaşık olabilir)"), "girdi": p("STRING", "Yeteneğe verilecek istek")}, ["ad"], lambda a: run_skill(a.get("ad", ""), a.get("girdi", "")))
    reg("yetenek_ara", "Yeteneklerde arar.", {"arama": p("STRING", "Ne aranıyor")}, ["arama"],
        lambda a: {"yetenekler": [f"{s['n']} (Faz {s['faz']}, {s['durum']}): {s['a']}" for _, s in sorted(((score(s, a.get('arama', '')), s) for s in SKILLS), key=lambda x: -x[0])[:8] if _ > 0]})
    reg("mailleri_oku", "Gmail'den mailleri getirir; BİRDEN FAZLA HESAP bağlı olabilir (hesap: ad/e-posta ya da 'tümü', varsayılan tümü).", {"sorgu": p("STRING", "Gmail arama"), "adet": p("NUMBER", "Hesap başına kaç"), "hesap": p("STRING", "Hangi hesap")}, [], t_mail_multi)
    reg("mail_taslagi", "Gmail'de taslak hazırlar (göndermez). hesap ile hangi hesaptan yazılacağını seç.", {"kime": p("STRING", "Alıcı"), "konu": p("STRING", "Konu"), "metin": p("STRING", "Metin"), "hesap": p("STRING", "Hangi hesaptan")}, ["konu", "metin"], t_draft_multi)
    reg("telefonu_caldir", "Kaybolan telefonu bulmak için telefonu yüksek sesle çaldırır.", {}, [], lambda a: to_phone("", "ring"))
    reg("titusu_guncelle", "Bilgisayardaki Titus'un yeni sürümü var mı bakar; 'kur' denirse indirip kurar ve yeniden başlar.", {"kur": p("BOOLEAN", "İndirip kursun mu")}, [], lambda a: check_update(apply=bool(a.get("kur"))))
    jd.MEMORY_HOOK.append(mem_hook)
    hotkeys_setup()
    def auto_upd():
        time.sleep(40)
        try:
            r = check_update(False)
            if r.get("yeni"):
                jd.emit("titus", f"⬆️ Titus bilgisayar sürümü {r['yeni']} hazır. 'Titus'u güncelle' de, kurayım.")
        except Exception:
            pass
    threading.Thread(target=auto_upd, daemon=True).start()
