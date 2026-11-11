"""Titus v3.1 (bilgisayar) — Yeni Faz 1 + Yeni Faz 2.

Sayfa okuma, TDK sözlük, kod yaz-çalıştır-düzelt (Python), Excel/PDF/PowerPoint, linkli sayfa yayınlama,
uzun çok adımlı işler, büyük belge/klasör okuma, otomatik hata raporu (GitHub), arka planda kendini kontrol,
konum, sadece Türkçe konuşma, çift konuşma engeli.
"""
import json, os, re, sys, time, threading, subprocess, tempfile, hashlib, html as _html
from pathlib import Path
from datetime import datetime

J = TS = None
BUGQ = []
LANG = {"tr": True}


def _req():
    import requests
    return requests


# ---------------- web sayfası ----------------
def page_text(url):
    if not re.match(r"^https?://", url or ""):
        url = "https://" + str(url)
    try:
        r = _req().get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0 (Titus)"})
        r.raise_for_status()
        h = r.text
    except Exception:
        if not J.AG.get("url"):
            raise
        return J.agent.call(J.AG, "fetchText", url=url).get("text", "")
    t = re.search(r"<title[^>]*>(.*?)</title>", h, re.S | re.I)
    h = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</h\d>", "\n", h)
    txt = _html.unescape(re.sub(r"<[^>]+>", " ", h))
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n\s*\n+", "\n\n", txt).strip()
    return (("BAŞLIK: " + _html.unescape(t.group(1).strip()) + "\n") if t else "") + txt


def read_big(text, q, label="Metin"):
    CH = 60000
    parts = [text[i:i + CH] for i in range(0, len(text), CH)][:12]
    if len(parts) <= 1:
        return TS.ask_text(f"{label}:\n{text}\n\nİSTEK: {q or 'Tamamını oku ve önemli noktalarıyla Türkçe özetle.'}\nSadece bu içeriğe dayan.", max_tokens=2500)
    notes = []
    for i, p in enumerate(parts):
        notes.append(f"[Bölüm {i + 1}] " + TS.ask_text(f"{label} — bölüm {i + 1}/{len(parts)}:\n{p}\n\nBu bölümden şu istekle ilgili her şeyi madde madde çıkar: {q or 'genel özet'}", max_tokens=1200))
    return TS.ask_text(f"Uzun {label.lower()} {len(parts)} bölümde incelendi:\n" + "\n\n".join(notes) + f"\n\nİSTEK: {q or 'kapsamlı Türkçe özet'}\nEksiksiz cevap ver.", max_tokens=3000)


def t_page(a):
    t = page_text(a.get("url", ""))
    return {"url": a.get("url"), "uzunluk": len(t), "cevap": read_big(t, a.get("soru"), "Web sayfası")}


# ---------------- TDK ----------------
def t_dict(a):
    w = str(a.get("kelime", "")).strip().lower()
    try:
        raw = _req().get("https://sozluk.gov.tr/gts", params={"ara": w}, timeout=15, headers={"User-Agent": "Mozilla/5.0"}).json()
    except Exception:
        raw = None
    if isinstance(raw, list) and raw:
        e = raw[0]
        return {"kaynak": "TDK Güncel Türkçe Sözlük", "kelime": e.get("madde"), "koken": e.get("lisan", ""),
                "anlamlar": [{"anlam": x.get("anlam"), "ornek": ((x.get("orneklerListe") or [{}])[0] or {}).get("ornek", "")} for x in (e.get("anlamlarListe") or [])[:8]],
                "atasozu": [x.get("madde") for x in (e.get("atasozu") or [])[:5]]}
    if isinstance(raw, dict):
        return {"kelime": w, "bulunamadi": True, "not": "TDK'da bu yazımla yok; yazımı kontrol et."}
    return {"kaynak": "yapay zekâ (TDK'ya ulaşılamadı)", "metin": TS.ask_text(f'"{w}" kelimesinin Türkçe anlamlarını ve bir örnek cümleyi kısaca yaz.', max_tokens=400)}


# ---------------- kod yaz + çalıştır + düzelt (Python) ----------------
CODE_DIR = Path.home() / "Documents" / "Titus" / "kod"


def code_run(task, allow_pip=False):
    CODE_DIR.mkdir(parents=True, exist_ok=True)
    code, err, log = "", "", []
    for i in range(5):
        prompt = (f"Python 3 ile şu işi yapan TAM bir program yaz: {task}\n"
                  f"Çalışma klasörü: {CODE_DIR} (dosya okuyup yazabilirsin, başka yeri silme/değiştirme).\n"
                  + (f"Önceki deneme hata verdi:\n{err[-2500:]}\nÖnceki kod:\n{code}\nHatayı bul ve düzelt.\n" if err else "")
                  + "Sonucu print ile yazdır. Gerekirse dosya üret ve yolunu yazdır. Sadece kod, açıklama yok.")
        code = re.sub(r"^\s*```[a-z]*\s*|```\s*$", "", TS.ask_text(prompt, max_tokens=6000).strip())
        if re.search(r"shutil\.rmtree\(|os\.remove\(['\"]?[A-Z]:|format\s+c:|rm\s+-rf|del\s+/[sq]", code, re.I):
            err = "güvenlik: silme işlemi yasak"
            log.append("✗ " + err)
            continue
        p = CODE_DIR / f"titus_{datetime.now():%Y%m%d_%H%M%S}.py"
        p.write_text(code, "utf-8")
        try:
            r = subprocess.run([sys.executable, str(p)], capture_output=True, text=True, timeout=120, cwd=str(CODE_DIR))
        except subprocess.TimeoutExpired:
            err = "120 sn süre aşıldı"
            log.append("✗ süre")
            continue
        miss = re.search(r"No module named '([\w\.]+)'", r.stderr or "")
        if miss and allow_pip:
            subprocess.run([sys.executable, "-m", "pip", "install", miss.group(1).split(".")[0]], capture_output=True, timeout=300)
            log.append("📦 " + miss.group(1))
            err = r.stderr
            continue
        if r.returncode == 0:
            log.append("✓")
            return {"ok": True, "cikti": (r.stdout or "")[-4000:], "dosya": str(p), "denemeler": log}
        err = (r.stderr or r.stdout)[-3000:]
        log.append("✗ " + err.strip().splitlines()[-1][:120] if err.strip() else "✗")
    return {"hata": "Kod 5 denemede çalışmadı: " + err[-400:], "dosya": str(p) if code else "", "denemeler": log}


# ---------------- Excel / PDF / PowerPoint ----------------
def make_xlsx(a):
    from openpyxl import Workbook
    j = TS.ask_json(f'"{a.get("istek")}" için Excel tablosu. {TS.user_ctx()}\nJSON: {{"sayfalar":[{{"ad":"Sayfa1","satirlar":[["Başlık",...],[...]],"formuller":[{{"hucre":"C2","formul":"=A2*B2"}}]}}]}}')
    wb = Workbook()
    wb.remove(wb.active)
    for sh in (j.get("sayfalar") or [])[:6]:
        ws = wb.create_sheet(str(sh.get("ad", "Sayfa"))[:30])
        for row in sh.get("satirlar") or []:
            ws.append(row)
        for f in sh.get("formuller") or []:
            if re.match(r"^[A-Z]+\d+$", str(f.get("hucre", ""))):
                ws[f["hucre"]] = f["formul"] if str(f["formul"]).startswith("=") else "=" + str(f["formul"])
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = 18
    if not wb.sheetnames:
        return {"hata": "Tablo üretilemedi."}
    p = TS.out_dir() / f"{TS.safe(a.get('baslik') or a.get('istek'))[:40]}.xlsx"
    wb.save(p)
    TS.open_path(p)
    return {"ok": True, "dosya": str(p)}


def _font(size, bold=False):
    from PIL import ImageFont
    for f in (["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"] if bold else ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]):
        for d in ("C:/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/", ""):
            try:
                return ImageFont.truetype(d + f, size)
            except Exception:
                pass
    return ImageFont.load_default()


def make_pdf(a):
    from PIL import Image, ImageDraw
    text = a.get("icerik") or TS.ask_text(f'"{a.get("istek") or a.get("baslik")}" için düzenli Türkçe belge yaz (# başlıklar, - maddeler). {TS.user_ctx()}', max_tokens=4000)
    W, H, M = 1240, 1754, 110
    pages = []

    def newp():
        im = Image.new("RGB", (W, H), "white")
        return im, ImageDraw.Draw(im)
    im, d = newp()
    y = M
    d.text((M, y), str(a.get("baslik", "Belge")), fill="#b3121f", font=_font(54, True))
    y += 120
    for raw in str(text).split("\n"):
        h = re.match(r"^(#{1,3})\s+(.*)", raw)
        t = re.sub(r"^(#{1,3})\s+", "", raw).replace("**", "")
        t = re.sub(r"^\s*[-*•]\s+", "• ", t)
        size = (40 if h and len(h.group(1)) == 1 else 34) if h else 28
        f = _font(size, bool(h))
        words, line, lines = t.split(), "", []
        for w in words:
            tt = (line + " " + w).strip()
            if d.textlength(tt, font=f) > W - 2 * M and line:
                lines.append(line)
                line = w
            else:
                line = tt
        lines.append(line)
        for ln in lines:
            if y + size * 1.45 > H - M:
                pages.append(im)
                im, d = newp()
                y = M
            d.text((M, y), ln, fill="#b3121f" if h else "#111111", font=f)
            y += int(size * 1.45)
        y += 14 if h else 6
    pages.append(im)
    p = TS.out_dir() / f"{TS.safe(a.get('baslik'))[:50]}.pdf"
    pages[0].save(p, save_all=True, append_images=pages[1:], resolution=150)
    TS.open_path(p)
    return {"ok": True, "dosya": str(p), "sayfa": len(pages)}


def make_pptx(a):
    try:
        from pptx import Presentation
        from pptx.util import Pt
        from pptx.dml.color import RGBColor
    except Exception:
        return {"hata": "PowerPoint için 'python-pptx' gerekli: 1-KUR.bat'ı bir kez çalıştır."}
    j = TS.ask_json(f'"{a.get("konu")}" için {int(a.get("slayt") or 8)} slaytlık sunum. {TS.user_ctx()}\nJSON: {{"baslik":"","slaytlar":[{{"baslik":"","maddeler":["..."],"not":"konuşmacı notu"}}]}}')
    pr = Presentation()
    s0 = pr.slides.add_slide(pr.slide_layouts[0])
    s0.shapes.title.text = j.get("baslik") or a.get("konu", "Sunum")
    s0.placeholders[1].text = f"{J.C.get('name', 'Burak')} · {datetime.now():%d.%m.%Y}"
    for sl in (j.get("slaytlar") or [])[:20]:
        s = pr.slides.add_slide(pr.slide_layouts[1])
        s.shapes.title.text = sl.get("baslik", "")
        s.shapes.title.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xB3, 0x12, 0x1F)
        tf = s.placeholders[1].text_frame
        tf.clear()
        for k, m in enumerate(sl.get("maddeler") or []):
            para = tf.paragraphs[0] if k == 0 else tf.add_paragraph()
            para.text = m
            para.font.size = Pt(22)
        if sl.get("not"):
            s.notes_slide.notes_text_frame.text = sl["not"]
    p = TS.out_dir() / f"{TS.safe(j.get('baslik') or a.get('konu'))[:50]}.pptx"
    pr.save(p)
    TS.open_path(p)
    return {"ok": True, "dosya": str(p), "slayt": len(pr.slides)}


# ---------------- linkli sayfa ----------------
def t_publish(a):
    html = a.get("html") or re.sub(r"^\s*```[a-z]*\s*|```\s*$", "", TS.ask_text(f"Tek dosyalık, mobil uyumlu, şık HTML sayfası yaz: {a.get('istek') or a.get('baslik')}. {TS.user_ctx()} Koyu tema, kırmızı vurgu, Türkçe, dış bağlantı yok. Sadece kod.", max_tokens=14000).strip())
    if not J.AG.get("url"):
        p = TS.out_dir() / f"{TS.safe(a.get('baslik'))}.html"
        p.write_text(html, "utf-8")
        return {"ok": True, "dosya": str(p), "not": "Google bağlı olmadığı için sadece dosya olarak kaydedildi."}
    r = J.agent.call(J.AG, "publishPage", title=a.get("baslik", "Titus"), html=html)
    return {"ok": True, "link": r.get("url"), "not": "Linki olan herkes açabilir."}


# ---------------- büyük belge / klasör ----------------
def file_text(p):
    p = Path(p)
    ext = p.suffix.lower()
    try:
        if ext == ".pdf":
            from pypdf import PdfReader
            return "\n".join((pg.extract_text() or "") for pg in PdfReader(str(p)).pages)
        if ext == ".docx":
            import docx
            return "\n".join(par.text for par in docx.Document(str(p)).paragraphs)
        if ext in (".xlsx", ".xlsm"):
            from openpyxl import load_workbook
            wb = load_workbook(str(p), read_only=True, data_only=True)
            return "\n".join("\t".join("" if c is None else str(c) for c in row) for ws in wb.worksheets for row in ws.iter_rows(values_only=True))
        if ext in (".txt", ".md", ".csv", ".json", ".py", ".js", ".html", ".css", ".java", ".gs", ".xml", ".srt", ".fdx", ".fountain"):
            return p.read_text("utf-8", errors="ignore")
    except Exception as e:
        return f"(okunamadı: {e})"
    return ""


def t_folder(a):
    path = Path(str(a.get("yol", "")).strip('" '))
    if not path.exists():
        return {"hata": f"Bulunamadı: {path}"}
    files = [path] if path.is_file() else [f for f in path.rglob("*") if f.is_file() and f.suffix.lower() in (".pdf", ".docx", ".xlsx", ".txt", ".md", ".csv", ".json", ".py", ".js", ".html", ".java", ".gs", ".fountain", ".srt")][:200]
    all_t, used = "", 0
    for f in files:
        t = file_text(f)
        if t.strip():
            all_t += f"\n\n===== {f.relative_to(path) if path.is_dir() else f.name} =====\n{t}"
            used += 1
        if len(all_t) > 720000:
            break
    if not all_t:
        return {"hata": "Okunabilir dosya yok."}
    return {"dosya": used, "uzunluk": len(all_t), "cevap": read_big(all_t, a.get("soru"), "Klasör içeriği")}


# ---------------- uzun iş ----------------
def long_job(a):
    goal = a.get("hedef", "")
    p = TS.ask_json(f'Hedef: "{goal}". {TS.user_ctx()}\nBilgisayardaki Titus araçlarıyla yapılabilir 3-10 adıma böl. JSON: {{"baslik":"","adimlar":["..."]}}')
    steps = (p.get("adimlar") or [goal])[:10]
    jobs = J.jload("uzun_isler.json", [])
    job = {"id": hashlib.md5((goal + str(time.time())).encode()).hexdigest()[:8], "baslik": p.get("baslik") or goal, "adimlar": steps, "sonuc": []}
    jobs.append(job)
    J.jsave("uzun_isler.json", jobs[-10:])
    return _continue(job)


def _continue(job):
    for i in range(len(job["sonuc"]), len(job["adimlar"])):
        ctx = "\n".join(f"ADIM {k + 1} SONUCU: {str(s)[:1200]}" for k, s in enumerate(job["sonuc"]))
        try:
            r = J.think(f"UZUN İŞ: {job['baslik']}\n{ctx}\n\nŞİMDİ ADIM {i + 1}/{len(job['adimlar'])}: {job['adimlar'][i]}\nBu adımı araçlarınla gerçekten yap, sonucu kısaca yaz.")
        except Exception as e:
            if "429" in str(e) or "kota" in str(e).lower():
                job["durdu"] = time.time()
                _save_job(job)
                threading.Timer(3600, lambda: _continue(job)).start()
                return {"ok": False, "duraklatildi": True, "not": "Kota doldu; 1 saat sonra kaldığım yerden devam edeceğim."}
            r = "HATA: " + J.friendly(e)
        job["sonuc"].append(r)
        _save_job(job)
    rep = TS.ask_text(f"Uzun iş bitti: {job['baslik']}\n" + "\n".join(f"{k + 1}. {job['adimlar'][k]} → {str(s)[:1000]}" for k, s in enumerate(job["sonuc"])) + "\nKısa Türkçe bitiş raporu yaz.", max_tokens=1500)
    job["bitti"] = True
    _save_job(job)
    return {"ok": True, "metin": rep, "belge": TS.save_docx("Uzun iş — " + job["baslik"], rep)}


def _save_job(job):
    jobs = [j for j in J.jload("uzun_isler.json", []) if j.get("id") != job["id"]] + [job]
    J.jsave("uzun_isler.json", jobs[-10:])


# ---------------- konum (bilgisayar: internet bağlantısından yaklaşık) ----------------
def t_where(a):
    try:
        j = _req().get("https://ipapi.co/json/", timeout=10).json()
        return {"yaklasik": True, "sehir": j.get("city"), "bolge": j.get("region"), "ulke": j.get("country_name"), "not": "Bilgisayar konumu internet bağlantısından yaklaşık bulunur; tam adres için telefondaki Titus'a 'neredeyim' de."}
    except Exception as e:
        return {"hata": f"Konum bulunamadı: {e}"}


# ---------------- hata raporu ----------------
def _hook_log():
    base = J.log

    def log(level, msg):
        base(level, msg)
        if level == "hata" and "Telefon bağlı" not in str(msg):
            BUGQ.append({"at": datetime.now().strftime("%Y-%m-%dT%H:%M"), "ver": J.VERSION, "type": "bilgisayar", "detail": str(msg)[:300]})
            del BUGQ[:-40]
    J.log = log


def flush_bugs():
    if not BUGQ or not J.AG.get("url") or not J.C.get("bug_reports", True):
        return {"gonderilen": 0}
    items = list(BUGQ)
    try:
        r = J.agent.call(J.AG, "bugReport", items=items, device="bilgisayar")
        del BUGQ[:len(items)]
        return {"gonderilen": len(items), "github": r.get("github")}
    except Exception as e:
        return {"hata": str(e)}


def t_suggest(a):
    if not J.AG.get("url"):
        return {"hata": "Google bağlantısı gerekli."}
    r = J.agent.call(J.AG, "bugReport", items=[{"at": datetime.now().strftime("%Y-%m-%dT%H:%M"), "ver": J.VERSION, "type": "öneri", "detail": f"{a.get('baslik')} — {a.get('aciklama')}"}], device="bilgisayar", oneri=True)
    return {"ok": True, "github": r.get("github")}


# ---------------- arka planda kendini kontrol ----------------
HEALTH = {}


def health(deep=False):
    res = []
    try:
        ok = bool(TS.ask_text("Sadece 'tamam' yaz.", max_tokens=8))
        res.append(("Beyin (Gemini)", ok, ""))
    except Exception as e:
        res.append(("Beyin (Gemini)", False, J.friendly(e)))
    for acc in TS.accounts():
        try:
            TS.acc_call(acc, "ping")
            res.append(("Google: " + acc["n"], True, ""))
        except Exception as e:
            res.append(("Google: " + acc["n"], False, str(e)[:100]))
    for mod in ("numpy", "requests", "docx", "openpyxl", "pypdf", "PIL", "imageio_ffmpeg"):
        try:
            __import__(mod)
        except Exception:
            res.append((f"Paket {mod}", False, "1-KUR.bat'ı çalıştır"))
    if deep:
        r = TS.calc("2+2")
        res.append(("Hesap sandığı", not r.get("hata"), r.get("hata", "")))
        try:
            pcm = J._tts("Ses testi.")
            res.append(("Doğal ses", pcm is not None, "" if pcm is not None else "telefon/Windows sesi kullanılıyor"))
        except Exception as e:
            res.append(("Doğal ses", False, str(e)[:80]))
    bad = [r for r in res if not r[1]]
    prev = set(HEALTH.get("bad", []))
    HEALTH.update({"at": datetime.now().strftime("%Y-%m-%d %H:%M"), "res": res, "bad": [b[0] for b in bad]})
    fresh = [b for b in bad if b[0] not in prev]
    if fresh:
        msg = " · ".join(f"{b[0]}: {b[2] or 'çalışmıyor'}" for b in fresh)
        J.emit("titus", "🩺 Otomatik kontrol: " + msg)
        for b in fresh:
            J.log("hata", f"sağlık: {b[0]}: {b[2]}")
    flush_bugs()
    return {"ok": not bad, "kontroller": len(res), "sorunlu": [f"{b[0]}: {b[2]}" for b in bad]}


def _bg():
    time.sleep(90)
    n = 0
    while True:
        try:
            if J.C.get("auto_check", True):
                health(deep=(n % 8 == 0))
            else:
                flush_bugs()
        except Exception as e:
            J.log("uyarı", f"oto kontrol: {e}")
        n += 1
        time.sleep(3 * 3600)


def _bugloop():
    while True:
        time.sleep(1800)
        try:
            flush_bugs()
        except Exception:
            pass


# ---------------- dil + çift konuşma ----------------
def lang_hook():
    if LANG["tr"]:
        return ("\n\nDİL KURALI (EN ÖNEMLİ KURAL): HER ZAMAN YALNIZCA TÜRKÇE KONUŞ VE YAZ; kullanıcı başka dilde yazsa ya da kaynak İngilizce olsa bile cevap Türkçe. "
                "Sadece kullanıcı açıkça 'İngilizce konuş' derse değiştir. Araç çağırmadan önce 'yapıyorum' gibi ön cümle söyleme; işi yapınca tek kısa cevap ver.")
    return f"\n\nDİL KURALI: Kullanıcı {J.C.get('lang_lock')} konuşmanı istedi; 'Türkçe konuş' diyene kadar o dilde konuş."


def _hook_speak():
    base = J.speak
    last = {"t": "", "at": 0}

    def speak(text, *a, **k):
        key = re.sub(r"\W+", " ", str(text or "").lower()).strip()
        if key and key == last["t"] and time.time() - last["at"] < 8:
            return
        last.update(t=key, at=time.time())
        return base(text, *a, **k)
    J.speak = speak


def _hook_think():
    base = J.think

    def think(text, files=None):
        l = str(text or "").strip().replace("İ", "i").replace("I", "ı").lower()
        m = re.match(r"^(?:bundan sonra |artık |lütfen )?(ingilizce|almanca|fransızca|ispanyolca|türkçe) (konuş|konuşalım|cevap ver|yaz)", l)
        if m:
            LANG["tr"] = m.group(1) == "türkçe"
            J.save_cfg({"lang_lock": m.group(1).capitalize()})
            return "Tamam, bundan sonra yalnızca Türkçe konuşuyorum." if LANG["tr"] else f"Tamam, {m.group(1).capitalize()} konuşuyorum. Türkçeye dönmek için 'Türkçe konuş' de."
        return base(text, files) if files is not None else base(text)
    J.think = think


def setup(jd, p, ts):
    global J, TS
    J, TS = jd, ts
    for k, v in {"lang_lock": "Türkçe", "auto_check": True, "bug_reports": True}.items():
        jd.DEFAULTS.setdefault(k, v)
        jd.C.setdefault(k, v)
    LANG["tr"] = str(jd.C.get("lang_lock", "Türkçe")).lower().startswith("t")
    reg = jd.register
    reg("sayfa_oku", "Bir web sayfasını/linki açıp içeriğin TAMAMINI okur ve soruya göre cevaplar/özetler.", {"url": p("STRING", "Link"), "soru": p("STRING", "Ne isteniyor")}, ["url"], t_page)
    reg("turkce_sozluk", "TDK Güncel Türkçe Sözlük'te anlam, köken, örnek, atasözü arar.", {"kelime": p("STRING", "Kelime")}, ["kelime"], t_dict)
    reg("kod_calistir", "Python kodu yazar, ÇALIŞTIRIR, hata verirse kendisi düzeltip tekrar dener (veri işleme, dosya dönüştürme, hesap, otomasyon). Belgeler/Titus/kod klasöründe çalışır.", {"gorev": p("STRING", "Kodun yapacağı iş"), "paket_kur": p("BOOLEAN", "Eksik paketi kursun mu")}, ["gorev"], lambda a: code_run(a.get("gorev", ""), bool(a.get("paket_kur"))))
    reg("excel_olustur", "Formüllü, çok sayfalı Excel (.xlsx) hazırlar.", {"baslik": p("STRING", "Dosya adı"), "istek": p("STRING", "Tabloda ne olsun")}, ["istek"], make_xlsx)
    reg("pdf_olustur", "Düzenli PDF belge hazırlar.", {"baslik": p("STRING", "Başlık"), "icerik": p("STRING", "Metin (ops.)"), "istek": p("STRING", "İçerik yoksa ne yazılsın")}, ["baslik"], make_pdf)
    reg("sunum_olustur", "PowerPoint (.pptx) sunum hazırlar.", {"konu": p("STRING", "Konu"), "slayt": p("NUMBER", "Slayt sayısı")}, ["konu"], make_pptx)
    reg("sayfa_yayinla", "Web sayfası hazırlayıp herkese açık linkle yayınlar (ücretsiz, Google üzerinden).", {"baslik": p("STRING", "Başlık"), "istek": p("STRING", "Sayfada ne olsun"), "html": p("STRING", "Hazır HTML (ops.)")}, ["baslik"], t_publish)
    reg("klasor_oku", "Bilgisayardaki bir klasörü ya da büyük dosyayı (PDF, Word, Excel, metin, kod) baştan sona okuyup soruyu cevaplar.", {"yol": p("STRING", "Klasör/dosya yolu"), "soru": p("STRING", "Ne isteniyor")}, ["yol"], t_folder)
    reg("uzun_is", "Saatler sürebilecek çok adımlı büyük işi adım adım araçlarla yürütür; kota dolarsa kaldığı yerden devam eder.", {"hedef": p("STRING", "İş")}, ["hedef"], long_job)
    reg("konumum", "Bilgisayarın yaklaşık konumunu (şehir) bulur.", {}, [], t_where)
    reg("gelistirme_onerisi", "Titus için eksik/hata/fikri geliştiriciye (GitHub) öneri olarak gönderir.", {"baslik": p("STRING", "Başlık"), "aciklama": p("STRING", "Açıklama")}, ["baslik", "aciklama"], t_suggest)
    reg("kendini_kontrol_et", "Titus'un parçalarını test eder ve raporlar.", {}, [], lambda a: health(True))
    TS.PC_FN.update({
        "readpage": lambda a: t_page({"url": str(a.get("girdi", "")).split("|")[0].strip(), "soru": "|".join(str(a.get("girdi", "")).split("|")[1:])}),
        "dict": lambda a: t_dict({"kelime": a.get("girdi")}),
        "coderun": lambda a: (lambda r: {"metin": r.get("cikti"), **r} if r.get("ok") else r)(code_run(a.get("girdi", ""))),
        "xlsx": lambda a: make_xlsx({"istek": a.get("girdi")}),
        "pdf": lambda a: make_pdf({"baslik": str(a.get("girdi", ""))[:60], "istek": a.get("girdi")}),
        "publish": lambda a: t_publish({"baslik": str(a.get("girdi", ""))[:50], "istek": a.get("girdi")}),
        "bigdoc": lambda a: t_folder({"yol": a.get("girdi", "")}) if os.path.exists(str(a.get("girdi", "")).strip('" ')) else {"hata": "Klasör ya da dosya yolunu yaz (ör. C:\\Users\\Burak\\Documents\\Senaryolar)."},
        "longjob": lambda a: long_job({"hedef": a.get("girdi")}),
        "whereami": t_where,
        "suggest": lambda a: t_suggest({"baslik": str(a.get("girdi", ""))[:60], "aciklama": a.get("girdi")}),
        "bugreport": lambda a: flush_bugs(),
        "autocheck": lambda a: health(True),
        "langlock": lambda a: {"metin": J.think(a.get("girdi") or "Türkçe konuş")},
    })
    jd.MEMORY_HOOK.append(lang_hook)
    _hook_log()
    _hook_speak()
    _hook_think()
    threading.Thread(target=_bg, daemon=True).start()
    threading.Thread(target=_bugloop, daemon=True).start()
