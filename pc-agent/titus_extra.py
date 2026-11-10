"""
Titus v2.6 — bilgisayar eklentileri:
Gmail / takvim / KADRO (telefonla aynı Google bağlantısı), telefonla iki yönlü bağlantı ve tek kodla eşleştirme,
görsel ve video üretimi (ücretsiz servisler), birlikte yaptığımız uygulamaların merkezi.
"""
import base64, io, json, os, shutil, subprocess, tempfile, threading, time, urllib.parse, urllib.request, webbrowser, wave
from datetime import datetime
from pathlib import Path

J = None
P = None
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
EXTRA_KEYS = {"cf_account": "", "cf_token": "", "kadro_sheet": "", "audition_sheet": "", "kadro_url": "", "audition_url": "", "apps": []}

A_ = lambda i: "https://claude.ai/artifact/" + i
MY_APPS = [
    ("audition", "Recast Audition", "🎬", "İş", A_("FDqkLhxBpP3Ar4tQNB94AZ"), "İş gönder, self-tape topla, müşteriye ilet", "audition_url"),
    ("kadro", "KADRO", "🗂", "İş", "", "Oyuncu kadrosu yönetimi", "kadro_url"),
    ("selftape", "Self-Tape Okuyucu", "🎥", "İş", A_("WWFaSsPAaqAqGw7VtsLWa4"), "Karşı replikleri okur, kayıt alır", None),
    ("kesit", "Kesit Kurgu", "✂️", "İş", A_("G4rD1YYkTbvbLwEBdF64RC"), "Video kurgu, showreel sihirbazı", None),
    ("senaryo", "Senaryo Masası", "📝", "İş", A_("99uPyFnzRmmpUeKt4t4PJR"), "Senaryo yazım uygulaması", None),
    ("casting", "Casting Masası", "📋", "İş", A_("NiR7qT4pgoADJ1zEb2Yn9h"), "Ajanslar için casting uygulaması", None),
    ("atolye", "Atölye Paneli", "🎭", "İş", A_("C8FbAfv2WYKh8tqcSNqrJE"), "Atölye yönetimi ve başvuru", None),
    ("acik", "Açık Stüdyo Paneli", "🏛", "İş", A_("YMexZbTmac9CRh8r2smsvi"), "React Açık Stüdyo ekip paneli", None),
    ("react", "React Açık Stüdyo", "🎟", "İş", A_("HpVUQ5bCFjrsv7nsD9wnLv"), "Atölye başvuru ve görüşme", None),
    ("transfer", "Recast Transfer", "📦", "İş", A_("KBbdKXsqeav5esRQKVNaCJ"), "Dosya gönderim demosu", None),
    ("uyku", "Uyku Transı", "🌙", "Gelişim", A_("EusyDvvPxqhnCbNR43Dmdv"), "Kişisel uyku hipnozu", None),
    ("replik", "Replik", "🇬🇧", "Gelişim", A_("G2gUa5nS94jq73nQwrNTuG"), "İngilizce öğrenme", None),
    ("okuma", "Okuma Atölyesi", "📖", "Gelişim", A_("D38iR4tvyrMuuU96ckyNcm"), "Hızlı okuma antrenmanı", None),
    ("filiz", "Filiz", "🌱", "Gelişim", A_("KA3KdDnUfAXhvCX4ty5gcL"), "Bütçeye göre iş planı", None),
    ("kira", "Kira Radarı", "🏠", "Gelişim", A_("GBKEb7uVfknigTC7BWeD9R"), "Kiralık ilan takibi", None),
    ("saha", "Saha Yıldızı", "⚽", "Oyun", A_("Nb1Zu1BdRdTXTRNmF68QPx"), "Futbol kariyer oyunu", None),
    ("galerici", "Galerici", "🚗", "Oyun", A_("W17Y3E6HiXmRAG7KR6xChH"), "3D araba al-sat simülatörü", None),
    ("cephe", "Cephe 1921", "🎖", "Oyun", A_("MR82LwnzN7SjeG76EgmL3E"), "Kurtuluş Savaşı oyunu", None),
    ("sahnede", "Burak Sahnede", "🌟", "Oyun", A_("5uMBKKnvas6ePSqpqHnVJw"), "Oyuncu hayat simülasyonu", None),
    ("okey", "Istaka Okey", "🀄", "Oyun", A_("U9sk8xD2q8mAnsHaUEZDbx"), "Okey ve 101", None),
    ("tarih", "Tarihin İçinde", "🏺", "Oyun", A_("9YxPr8pSwrD4HgRAMTMfhH"), "Tarihî hayat ve strateji oyunu", None),
    ("istiklal", "İstiklal Harbi", "🇹🇷", "Oyun", A_("DBp1JFcUWU1Rw39Nt7nEDr"), "Harekât ve hayat oyunu", None),
]


def apps():
    out = [{"k": k, "n": n, "e": e, "c": c, "url": (J.C.get(key) if key else "") or u, "d": d} for k, n, e, c, u, d, key in MY_APPS]
    for i, a in enumerate(J.C.get("apps") or []):
        out.append({"k": f"c{i}", "n": a.get("n", ""), "e": "🔗", "c": "Eklediklerim", "url": a.get("u", ""), "d": a.get("u", "")[:40], "custom": i})
    return out


def open_app(q):
    nq = J.agent.norm(str(q or "")).strip()
    al = apps()
    a = (next((x for x in al if x["k"] == q), None) or next((x for x in al if J.agent.norm(x["n"]) == nq), None)
         or next((x for x in al if nq and (nq in J.agent.norm(x["n"]) or J.agent.norm(x["n"]) in nq)), None)
         or next((x for x in al if any(len(w) > 3 and w in J.agent.norm(x["n"] + " " + x["d"]) for w in nq.split())), None))
    if not a:
        return {"hata": "Böyle bir uygulama bulamadım. Uygulamalar: " + ", ".join(x["n"] for x in al)}
    if not a["url"]:
        return {"hata": f"{a['n']} adresi kayıtlı değil. Ayarlar → Uygulama adresleri bölümüne yaz."}
    webbrowser.open(a["url"])
    return {"ok": True, "acildi": a["n"]}


# ======================= eşleştirme =======================
def apply_pair(code):
    code = str(code or "").strip()
    if not code.startswith("TITUS1."):
        raise ValueError("Bu bir Titus bağlantı kodu değil. Telefonda Ayarlar → Bilgisayarı bağla → Bağlantı kodu oluştur.")
    o = json.loads(base64.b64decode(code.split(".", 1)[1] + "==").decode("utf-8"))
    m = {"u": "url", "t": "token", "g": "gemini_key", "q": "groq_key", "ca": "cf_account", "ct": "cf_token", "k": "kadro_sheet", "a": "audition_sheet", "au": "audition_url", "ku": "kadro_url", "n": "name", "nt": "ntfy"}
    new = {v: o[k] for k, v in m.items() if o.get(k)}
    J.save_cfg(new)
    got = [x for x, k in (("Gemini", "gemini_key"), ("Groq", "groq_key"), ("Google (Gmail, takvim, görevler)", "url"), ("Cloudflare", "cf_token"), ("KADRO", "kadro_sheet")) if new.get(k)]
    J.log("bilgi", "Telefonla eşleştirildi: " + ", ".join(got))
    return {"ok": True, "gelenler": got}


def need_link():
    if not J.AG.get("url"):
        raise RuntimeError("Telefon/Google bağlantısı kurulmamış. Telefonda Ayarlar → Bilgisayarı bağla'dan kodu alıp Ayarlar'a yapıştır.")


def gs(action, **kw):
    need_link()
    return J.agent.call(J.AG, action, **kw)


# ======================= Gmail / takvim / KADRO / telefon =======================
def t_mail(a):
    r = gs("gmail", query=a.get("sorgu") or "is:unread in:inbox", max=int(a.get("adet") or 8))
    return {"mailler": r.get("mailler", [])}


def t_draft(a):
    r = gs("gmailDraft", to=a.get("kime", ""), subject=a.get("konu", ""), body=a.get("metin", ""))
    return {"ok": True, "not": r.get("not", "Taslak Gmail'de hazır.")}


def t_cal(a):
    return {"etkinlikler": gs("calendarList", days=int(a.get("gun") or 2)).get("etkinlikler", [])}


def t_cal_add(a):
    r = gs("calendarAdd", title=a.get("baslik", "Etkinlik"), start=a.get("baslangic"), end=a.get("bitis") or None, location=a.get("yer", ""))
    return {"ok": True, **{k: v for k, v in r.items() if k != "ok"}}


def t_kadro(a):
    if not J.C.get("kadro_sheet"):
        return {"hata": "KADRO tablosu bağlı değil (telefondaki bağlantı kodunu Ayarlar'a yapıştır)."}
    r = gs("sheetQuery", sheetId=J.C["kadro_sheet"], query=a.get("arama", ""), limit=int(a.get("adet") or 15))
    return {k: v for k, v in r.items() if k != "ok"}


def t_phone_do(a):
    txt = str(a.get("komut", "")).strip()
    if not txt:
        return {"hata": "Telefonda ne yapayım?"}
    gs("phPush", kind="ask", text=txt)
    return {"ok": True, "not": "Telefondaki Titus'a iletildi; telefon açıkken (en geç 45 sn içinde) çalıştırır."}


# ======================= görsel üretimi =======================
POLL = {"at": 0.0}


def _http_get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "Titus/2.6"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _english(prompt):
    if not any(ch in prompt for ch in "çğıöşüÇĞİÖŞÜ") and " ve " not in prompt and " bir " not in prompt:
        return prompt
    try:
        c = J.gemini([{"role": "user", "parts": [{"text": "Translate this image description to a rich English image-generation prompt. Only output the prompt: " + prompt}]}], max_tokens=200, temperature=0.3)
        return J.gemini_text(c) or prompt
    except Exception:
        return prompt


def gen_image(prompt, w=1024, h=1024, translate=True):
    """JPEG baytları döndürür. Cloudflare bağlıysa onu, değilse anahtarsız ücretsiz servisi kullanır."""
    en = _english(prompt) if translate else prompt
    if J.C.get("cf_account") and J.C.get("cf_token"):
        url = f"https://api.cloudflare.com/client/v4/accounts/{J.C['cf_account']}/ai/run/@cf/black-forest-labs/flux-1-schnell"
        hd = {"Authorization": "Bearer " + J.C["cf_token"]}
        for body in ({"prompt": en, "steps": 6, "width": w, "height": h}, {"prompt": en, "steps": 4}):
            try:
                j = J.post_json(url, body, headers=hd, timeout=90)
                b64 = (j.get("result") or {}).get("image")
                if b64:
                    return base64.b64decode(b64)
            except Exception as e:
                J.log("uyarı", f"Cloudflare görsel: {getattr(e, 'msg', e)}")
                if getattr(e, "status", 0) != 400:
                    break
    wait = 16 - (time.time() - POLL["at"])
    if POLL["at"] and wait > 0:
        time.sleep(wait)  # anahtarsız kullanımda 15 sn'de 1 görsel
    POLL["at"] = time.time()
    url = f"https://image.pollinations.ai/prompt/{urllib.parse.quote(en[:380])}?width={min(w, 1280)}&height={min(h, 1280)}&nologo=true&seed={int(time.time() * 1000) % 1000000}"
    data = _http_get(url)
    if len(data) < 3000:
        raise RuntimeError("Görsel servisi şu an yanıt vermiyor, biraz sonra tekrar dene.")
    return data


def _safe(name):
    return "".join(ch for ch in str(name) if ch.isalnum() or ch in " -_").strip().replace(" ", "-")[:40] or "titus"


def _open(path):
    try:
        if os.name == "nt":
            os.startfile(str(path))
    except Exception:
        pass


def t_image(a):
    oran = a.get("oran") or "1:1"
    w, h = {"9:16": (768, 1344), "16:9": (1344, 768)}.get(oran, (1024, 1024))
    out = Path.home() / "Pictures" / "Titus"; out.mkdir(parents=True, exist_ok=True)
    n = max(1, min(4, int(a.get("adet") or 1))); files = []
    for i in range(n):
        data = gen_image(a.get("aciklama", ""), w, h)
        f = out / f"{_safe(a.get('aciklama', 'gorsel'))}-{datetime.now():%Y%m%d-%H%M%S}.jpg"
        f.write_bytes(data); files.append(str(f))
    _open(files[0])
    return {"ok": True, "dosyalar": files, "not": "Resimler/Titus klasörüne kaydedildi ve açıldı."}


# ======================= video üretimi =======================
def _ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def _font(size):
    from PIL import ImageFont
    for f in ("arialbd.ttf", "segoeuib.ttf", "DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _caption_png(text, W, H, path):
    from PIL import Image, ImageDraw
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im); fs = int(W * 0.05); font = _font(fs)
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) > W * 0.86 and cur:
            lines.append(cur); cur = w
        else:
            cur = t
    if cur:
        lines.append(cur)
    y = int(H * 0.86) - len(lines) * int(fs * 1.2)
    for ln in lines:
        x = (W - d.textlength(ln, font=font)) / 2
        d.text((x, y), ln, font=font, fill=(255, 255, 255, 255), stroke_width=max(2, fs // 9), stroke_fill=(0, 0, 0, 235)); y += int(fs * 1.2)
    im.save(path)


def _card_jpg(title, W, H, path):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (W, H), (44, 10, 13)); d = ImageDraw.Draw(im); font = _font(int(W * 0.07))
    x = (W - d.textlength(title[:30], font=font)) / 2
    d.text((x, H * 0.42), title[:30], font=font, fill=(255, 240, 238)); d.rectangle([W * 0.1, H * 0.52, W * 0.9, H * 0.52 + 4], fill=(255, 59, 59))
    im.save(path, quality=92)


def make_video(a, step=lambda s: None):
    ff = _ffmpeg()
    if not ff:
        return {"hata": "Video için gereken parça (imageio-ffmpeg) kurulu değil; 1-KUR.bat'ı bir kez çalıştır."}
    konu = str(a.get("konu", "")).strip()
    if not konu:
        return {"hata": "Video konusu ne olsun?"}
    n = max(3, min(8, int(a.get("sahne") or 5))); fmt = a.get("format") or "16:9"
    W, H = {"9:16": (720, 1280), "1:1": (1080, 1080)}.get(fmt, (1280, 720))
    iw, ih = {"9:16": (576, 1024), "1:1": (768, 768)}.get(fmt, (1024, 576))
    step("Senaryo yazılıyor")
    c = J.gemini([{"role": "user", "parts": [{"text": f'"{konu}" hakkında {n} sahnelik kısa, akıcı bir video hazırla. Anlatım Türkçe ve sesli okunacak (her sahne 1-2 cümle). SADECE JSON: {{"baslik":"","sahneler":[{{"anlatim":"","gorsel":"English image prompt: cinematic, detailed, no text"}}]}}'}]}], max_tokens=2000, json_mode=True, temperature=0.7)
    t = J.gemini_text(c)
    plan = json.loads(t[t.index("{"): t.rindex("}") + 1])
    scenes = [s for s in plan.get("sahneler", []) if s.get("anlatim")][:8]
    if not scenes:
        return {"hata": "Senaryo çıkarılamadı; konuyu biraz daha açık söyler misin?"}
    title = plan.get("baslik") or konu
    tmp = Path(tempfile.mkdtemp(prefix="titus_video_")); segs = []; with_img = 0; voiced = 0
    try:
        for i, s in enumerate(scenes):
            step(f"Sahne {i + 1}/{len(scenes)}: görsel")
            img = tmp / f"s{i}.jpg"
            try:
                img.write_bytes(gen_image(s.get("gorsel") or s["anlatim"], iw, ih, translate=not s.get("gorsel"))); with_img += 1
            except Exception as e:
                J.log("uyarı", f"sahne {i + 1} görseli üretilemedi: {e}"); _card_jpg(title, iw, ih, img)
            step(f"Sahne {i + 1}/{len(scenes)}: ses")
            wav = tmp / f"s{i}.wav"; pcm = None
            try:
                pcm = J._tts(s["anlatim"])
            except Exception:
                pcm = None
            if pcm is not None and len(pcm):
                dur = len(pcm) / 24000 + 0.45; voiced += 1; raw = pcm.tobytes()
            else:
                dur = max(2.6, len(s["anlatim"]) * 0.075); raw = b"\0\0" * int(24000 * dur)
            with wave.open(str(wav), "wb") as wf:
                wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(24000); wf.writeframes(raw)
            cap = tmp / f"c{i}.png"; _caption_png(s["anlatim"], W, H, cap)
            seg = tmp / f"seg{i}.mp4"; frames = int(dur * 30) + 1
            zoom = "min(1+0.0010*on,1.14)" if i % 2 == 0 else "max(1.14-0.0010*on,1)"
            fc = (f"[0:v]scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
                  f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps=30[bg];[bg][1:v]overlay=0:0,format=yuv420p[v]")
            cmd = [ff, "-y", "-loglevel", "error", "-i", str(img), "-i", str(cap), "-i", str(wav), "-filter_complex", fc, "-map", "[v]", "-map", "2:a",
                   "-af", "apad", "-t", f"{dur:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30", "-c:a", "aac", "-ar", "44100", "-ac", "2", str(seg)]
            r = subprocess.run(cmd, capture_output=True, text=True, creationflags=NO_WINDOW)
            if r.returncode != 0 or not seg.exists():
                raise RuntimeError("Video sahnesi işlenemedi: " + r.stderr[-300:])
            segs.append(seg)
        step("Sahneler birleştiriliyor")
        lst = tmp / "list.txt"; lst.write_text("".join(f"file '{s.as_posix()}'\n" for s in segs), "utf-8")
        outdir = Path.home() / "Videos" / "Titus"; outdir.mkdir(parents=True, exist_ok=True)
        out = outdir / f"{_safe(title)}-{datetime.now():%Y%m%d-%H%M}.mp4"
        r = subprocess.run([ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(out)], capture_output=True, text=True, creationflags=NO_WINDOW)
        if r.returncode != 0 or not out.exists():
            raise RuntimeError("Video birleştirilemedi: " + r.stderr[-300:])
        _open(out)
        return {"ok": True, "dosya": str(out), "baslik": title, "sahne": len(scenes), "gorselli_sahne": with_img, "seslendirilen_sahne": voiced, "not": "Videolar/Titus klasörüne kaydedildi ve açıldı."}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def t_video(a):
    return make_video(a, lambda s: J.emit("arac", "video: " + s))


# ======================= kurulum =======================
def setup(jd, p):
    global J, P
    J, P = jd, p
    jd.DEFAULTS.update(EXTRA_KEYS)
    for k, v in EXTRA_KEYS.items():
        jd.C.setdefault(k, v)
    reg = jd.register
    reg("mailleri_oku", "Gmail'den mailleri getirir (varsayılan: okunmamışlar). Gmail arama sözdizimi kullanılabilir (from:, subject:, newer_than:2d).", {"sorgu": P("STRING", "Gmail arama sorgusu"), "adet": P("NUMBER", "Kaç mail")}, [], t_mail)
    reg("mail_taslagi", "Gmail'de mail taslağı hazırlar (göndermez; Burak kontrol edip gönderir).", {"kime": P("STRING", "Alıcı e-posta"), "konu": P("STRING", "Konu"), "metin": P("STRING", "Mail metni")}, ["konu", "metin"], t_draft)
    reg("takvim", "Google Takvim'deki yaklaşan etkinlikleri getirir.", {"gun": P("NUMBER", "Kaç günlük (varsayılan 2)")}, [], t_cal)
    reg("takvime_ekle", "Google Takvim'e etkinlik ekler.", {"baslik": P("STRING", "Etkinlik adı"), "baslangic": P("STRING", "YYYY-MM-DDTHH:mm"), "bitis": P("STRING", "YYYY-MM-DDTHH:mm (isteğe bağlı)"), "yer": P("STRING", "Yer")}, ["baslik", "baslangic"], t_cal_add)
    reg("kadro_ara", "Recast KADRO tablosunda oyuncu arar (ad, yaş, özellik, şehir…).", {"arama": P("STRING", "Aranacak kelime(ler)"), "adet": P("NUMBER", "En fazla kaç sonuç")}, ["arama"], t_kadro)
    reg("telefonda_yap", "Telefondaki Titus'a iş yaptırır (ör. 'yarın 8'e alarm kur', 'Kübra'yı ara', 'şu notu al').", {"komut": P("STRING", "Telefonda çalışacak komut, doğal dille")}, ["komut"], t_phone_do)
    reg("gorsel_uret", "Yapay zekâyla görsel üretir (afiş, post, kapak, illüstrasyon) ve Resimler/Titus'a kaydeder.", {"aciklama": P("STRING", "Görsel tarifi"), "oran": P("STRING", "", ["1:1", "9:16", "16:9"]), "adet": P("NUMBER", "Kaç tane (1-4)")}, ["aciklama"], t_image)
    reg("video_olustur", "Verilen konuda kısa bir video üretir: senaryo, sahne görselleri, seslendirme, altyazı. Videolar/Titus'a kaydeder. 1-3 dakika sürer.", {"konu": P("STRING", "Video konusu"), "sahne": P("NUMBER", "Sahne sayısı (3-8)"), "format": P("STRING", "", ["16:9", "9:16", "1:1"])}, ["konu"], t_video)
    reg("uygulamam_ac", "Burak'la birlikte yapılan uygulamalardan birini açar: Recast Audition, KADRO, Self-Tape Okuyucu, Uyku Transı, Kesit Kurgu, Senaryo Masası, Replik, Okuma Atölyesi, Filiz, Kira Radarı, Saha Yıldızı, Galerici, Cephe 1921, Burak Sahnede, Istaka Okey vb.", {"ad": P("STRING", "Uygulama adı")}, ["ad"], lambda a: open_app(a.get("ad", "")))
    jd.MEMORY_HOOK.append(lambda: "\nGmail, takvim ve KADRO için mailleri_oku / mail_taslagi / takvim / takvime_ekle / kadro_ara kullan. Görsel için gorsel_uret, video için video_olustur, Burak'ın uygulamaları için uygulamam_ac, telefonda yapılacak işler (alarm, arama, telefon bildirimi) için telefonda_yap kullan."
                          + ("" if jd.AG.get("url") else " (Google bağlantısı henüz kurulmamış: mail/takvim/KADRO istenirse Ayarlar'a telefondaki bağlantı kodunun yapıştırılması gerektiğini söyle.)"))
