"""
Titus v2.7 — bilgisayar medya beyni.
Dosya/fotoğraf analizi (ekler), kimliği koruyan fotoğraf montajı, model kütüphanesi (telefonla ortak),
isteğe sadık görsel üretimi (ayrıntılandır → üret → kontrol et → düzelt) ve dudak senkronlu konuşan karakter videosu.
Hepsi ücretsiz servislerle: Gemini (anahtar), Hugging Face (ücretsiz token), anahtarsız FLUX.
"""
import base64, io, json, os, random, shutil, subprocess, tempfile, threading, time, uuid, wave
from datetime import datetime
from pathlib import Path

J = None; P = None; TX = None
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
MEDIA_KEYS = {"hf_token": "", "edit_space": "", "talk_space": ""}
OFF = {}
CUR = {"imgs": []}   # son eklenen fotoğraflar (jpeg baytları)
MDIR = None

KONTEXT_SPACES = ["black-forest-labs/FLUX.1-Kontext-Dev", "zerogpu-aoti/FLUX.1-Kontext-Dev"]
TALK_SPACES = ["zarroug/MoDA-fast-talking-head", "acvlab/FantasyTalking", "Madras1/sadtalker-api"]
GEM_IMG = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-2.0-flash-preview-image-generation"]
KEEP = ("Keep the person's identity EXACTLY the same: same face, facial features, skin tone, hair, body shape, hands and arms. "
        "Do not beautify or alter the person. Photorealistic, natural lighting that matches the new scene, realistic shadows. ")


def off(k, sec):
    OFF[k] = time.time() + sec


def is_off(k):
    return OFF.get(k, 0) > time.time()


def jpeg(data, max_side=1600, q=90):
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    im.thumbnail((max_side, max_side))
    b = io.BytesIO(); im.save(b, "JPEG", quality=q); return b.getvalue()


def gem_json(prompt, images=(), max_tokens=1500):
    parts = [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(jpeg(i, 1024)).decode()}} for i in images]
    c = J.gemini([{"role": "user", "parts": parts + [{"text": prompt + "\nSADECE geçerli JSON döndür."}]}], max_tokens=max_tokens, json_mode=True, temperature=0.4)
    t = J.gemini_text(c)
    return json.loads(t[t.index("{"): t.rindex("}") + 1])


# ======================= ekler (dosya analizi) =======================
def file_to_parts(f):
    """GUI'den gelen dosyayı Gemini parçasına çevirir. f = {name, mime, data(base64)}"""
    name, mime = f.get("name", "dosya"), (f.get("mime") or "").lower()
    raw = base64.b64decode(f.get("data", ""))
    ext = Path(name).suffix.lower()
    if mime.startswith("image/") or ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".heic"):
        try:
            j = jpeg(raw)
        except Exception:
            raise RuntimeError(f"{name}: görsel açılamadı")
        CUR["imgs"] = (CUR["imgs"] + [j])[-6:]
        return [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(j).decode()}}]
    if ext == ".pdf" or mime == "application/pdf":
        if len(raw) > 18 * 1024 * 1024:
            raise RuntimeError(f"{name} çok büyük (en fazla 18 MB)")
        return [{"inlineData": {"mimeType": "application/pdf", "data": f["data"]}}]
    if mime.startswith(("audio/", "video/")) or ext in (".mp3", ".wav", ".m4a", ".ogg", ".mp4", ".mov", ".webm"):
        if len(raw) > 18 * 1024 * 1024:
            raise RuntimeError(f"{name} çok büyük (en fazla 18 MB); daha kısa bir parça ver")
        m = mime or ("video/mp4" if ext in (".mp4", ".mov", ".webm") else "audio/mpeg")
        return [{"inlineData": {"mimeType": m, "data": f["data"]}}]
    tmp = Path(tempfile.mkdtemp()) / name
    tmp.write_bytes(raw)
    try:
        import titus_plus
        text = titus_plus.read_doc(tmp, 200000)
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)
    return [{"text": f"[{name}]\n{text}"}]


# ======================= görsel motorları =======================
def gemini_image(prompt, refs=()):
    if not J.C.get("gemini_key") or is_off("gemini"):
        raise RuntimeError("Gemini görsel kapalı")
    for m in GEM_IMG:
        if is_off("g:" + m):
            continue
        parts = [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(jpeg(r, 1280)).decode()}} for r in refs[:3]] + [{"text": prompt}]
        try:
            j = J.post_json(J._gem_url(m), {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}}, timeout=120)
            for p in ((j.get("candidates") or [{}])[0].get("content") or {}).get("parts", []):
                if (p.get("inlineData") or {}).get("mimeType", "").startswith("image/"):
                    return base64.b64decode(p["inlineData"]["data"])
        except Exception as e:
            st = getattr(e, "status", 0)
            off("g:" + m, 12 * 3600 if st == 429 else 7 * 86400 if st == 404 else 1800)
    off("gemini", 6 * 3600)
    raise RuntimeError("Gemini görsel kotası yok (ücretsiz anahtarda kapalı olabilir)")


def _client(space):
    from gradio_client import Client
    tok = J.C.get("hf_token") or None
    for kw in ("hf_token", "token"):
        try:
            return Client(space, **{kw: tok}, verbose=False) if tok else Client(space, verbose=False)
        except TypeError:
            continue
    return Client(space)


def _file_of(res):
    """gradio çıktısından dosya yolunu bulur."""
    if isinstance(res, (list, tuple)):
        for x in res:
            p = _file_of(x)
            if p:
                return p
        return None
    if isinstance(res, dict):
        for k in ("video", "path", "name", "value", "url"):
            if res.get(k):
                p = _file_of(res[k])
                if p:
                    return p
        return None
    if isinstance(res, str) and (os.path.exists(res) or res.startswith("http")):
        return res
    return None


def _fetch(p):
    if p.startswith("http"):
        import urllib.request
        req = urllib.request.Request(p, headers={"Authorization": "Bearer " + J.C["hf_token"]} if J.C.get("hf_token") else {})
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()
    return Path(p).read_bytes()


def _quota_err(e):
    s = str(e).lower()
    return any(k in s for k in ("quota", "gpu", "exceeded", "zerogpu", "limit"))


def kontext_edit(ref, prompt):
    if is_off("hf"):
        raise RuntimeError("Hugging Face kotası dolu, birkaç saat sonra")
    from gradio_client import handle_file
    tmp = Path(tempfile.mkdtemp()) / "girdi.jpg"; tmp.write_bytes(jpeg(ref, 1280)); last = None
    try:
        for sp in [J.C.get("edit_space")] + KONTEXT_SPACES:
            if not sp:
                continue
            try:
                c = _client(sp)
                try:
                    res = c.predict(handle_file(str(tmp)), prompt, random.randint(0, 999999), False, 2.5, 28, api_name="/infer")
                except Exception as e1:
                    if _quota_err(e1):
                        raise
                    res = adaptive_call(c, {"image": str(tmp), "text": prompt})
                p = _file_of(res)
                if p:
                    return jpeg(_fetch(p), 2048, 93)
            except Exception as e:
                last = e; J.log("uyarı", f"HF {sp}: {str(e)[:160]}")
                if _quota_err(e):
                    off("hf", 3 * 3600); break
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)
    raise RuntimeError("Hugging Face düzenleme olmadı: " + (str(last)[:120] if last else "alan yok"))


def adaptive_call(c, inputs):
    """Bir gradio alanının API'sine bakıp görsel/ses/metin girdilerini yerleştirerek çağırır."""
    from gradio_client import handle_file
    api = c.view_api(return_format="dict", print_info=False)
    eps = (api or {}).get("named_endpoints", {})
    want_audio = "audio" in inputs
    for name, ep in eps.items():
        params = ep.get("parameters", [])
        comps = [str(p.get("component", "")).lower() for p in params]
        if "image" not in comps or (want_audio and "audio" not in comps):
            continue
        args, ok, used_text = [], True, False
        for p, comp in zip(params, comps):
            if comp == "image":
                args.append(handle_file(inputs["image"]))
            elif comp == "audio":
                args.append(handle_file(inputs["audio"]))
            elif comp in ("textbox", "text") and not used_text and "text" in inputs:
                args.append(inputs["text"]); used_text = True
            elif p.get("parameter_has_default"):
                args.append(p.get("parameter_default"))
            else:
                ok = False; break
        if not ok:
            continue
        return c.predict(*args, api_name=name)
    raise RuntimeError("Uygun API bulunamadı")


def text_image(prompt, w, h):
    return TX.gen_image(prompt, w, h, translate=False)


SIZES = {"1:1": (1024, 1024), "9:16": (768, 1344), "16:9": (1344, 768), "4:5": (896, 1120)}


def edit_keep(refs, prompt):
    errs = []
    try:
        return gemini_image(KEEP + prompt, refs), "Gemini"
    except Exception as e:
        errs.append(str(e))
    try:
        return kontext_edit(refs[0], KEEP + prompt), "FLUX Kontext (Hugging Face)"
    except Exception as e:
        errs.append(str(e))
    raise LookupError(" | ".join(errs))


def smart_image(istek, oran=None, refs=(), model=None, step=lambda s: None):
    refs = list(refs)
    if model:
        refs = (model["imgs"] + refs)[:3]
    step("istek ayrıntılandırılıyor")
    plan = gem_json(
        "Kullanıcı Türkçe bir görsel istiyor. İsteği görsel yapay zekâsının TAM uygulayacağı ayrıntılı İngilizce prompt'a çevir. "
        "Kullanıcının söylediği HER ayrıntıyı (kişi sayısı, kıyafet, renk, mekân, saat, ışık, kamera açısı, poz, ifade, nesneler, yazı) koru ve açıkça yaz; "
        "kendinden yeni ana unsur ekleme; yazı istenmişse tırnak içinde aynen yaz. "
        + ("Referans fotoğraf var: prompt bir DÜZENLEME talimatı olsun (ör. 'Place this person in ..., keep the face identical'). " if refs else "")
        + (f"Kişi tarifi (birebir koru): {model['desc']} " if model else "")
        + 'JSON: {"prompt":"","oran":"1:1|9:16|16:9|4:5","kontrol":["mutlaka olması gereken 3-8 madde, Türkçe"]}\nİSTEK: ' + istek)
    w, h = SIZES.get(oran or plan.get("oran"), SIZES["1:1"])
    prompt = plan.get("prompt") or istek; best = None; notes = []
    for attempt in range(3):
        step("üretiliyor" if not attempt else f"düzeltiliyor ({attempt + 1}. deneme)")
        if refs:
            try:
                img, motor = edit_keep(refs, prompt)
            except LookupError as e:
                J.log("uyarı", "kimlik koruyan motor yok: " + str(e)[:200])
                notes.append("Yüzü birebir koruyan ücretsiz motorlara şu an ulaşılamadı (Ayarlar'a ücretsiz Hugging Face token ekle); tarife göre çizildi, yüz farklı olabilir.")
                img, motor = text_image(((model or {}).get("desc", "") + ". " + prompt).strip(". "), w, h), "metinden"
                refs = []
        else:
            img, motor = text_image(prompt, w, h), ("Cloudflare FLUX" if J.C.get("cf_token") else "FLUX (ücretsiz)")
        step("isteğe uygunluğu kontrol ediliyor")
        try:
            c = gem_json(f'Bu görsel şu isteğe ne kadar uyuyor? İSTEK: "{istek}". KONTROL: {json.dumps(plan.get("kontrol", []), ensure_ascii=False)}. '
                         'JSON: {"puan":0-100,"eksikler":["Türkçe kısa"],"duzeltme":"eksikleri gideren İngilizce ek prompt"}', [img])
        except Exception:
            c = {"puan": 70}
        if not best or c.get("puan", 0) > best["puan"]:
            best = {"img": img, "puan": c.get("puan", 0), "eksik": c.get("eksikler", []), "motor": motor}
        if c.get("puan", 0) >= 80 or not c.get("duzeltme"):
            break
        prompt += " " + c["duzeltme"]
    best["notlar"] = notes
    return best


def save_img(data, title):
    out = Path.home() / "Pictures" / "Titus"; out.mkdir(parents=True, exist_ok=True)
    f = out / f"{TX._safe(title)}-{datetime.now():%Y%m%d-%H%M%S}.jpg"; f.write_bytes(data)
    TX._open(f); return f


# ======================= model kütüphanesi =======================
def mdir():
    d = J.DATA / "modeller"; d.mkdir(exist_ok=True); return d


def models():
    out = []
    for d in sorted(mdir().iterdir()):
        try:
            m = json.loads((d / "meta.json").read_text("utf-8"))
            m["imgs"] = [p.read_bytes() for p in sorted(d.glob("img*.jpg"))]
            m["dir"] = str(d); out.append(m)
        except Exception:
            continue
    return out


def model_get(q):
    n = J.agent.norm(str(q or "")).strip()
    ms = models()
    return (next((m for m in ms if m["id"] == q), None) or next((m for m in ms if J.agent.norm(m["name"]) == n), None)
            or next((m for m in ms if n and (n in J.agent.norm(m["name"]) or J.agent.norm(m["name"]) in n)), None))


def _write_model(m_id, name, desc, imgs, at=None):
    d = mdir() / m_id; d.mkdir(exist_ok=True)
    for old in d.glob("img*.jpg"):
        old.unlink()
    for i, b in enumerate(imgs[:3]):
        (d / f"img{i}.jpg").write_bytes(b)
    (d / "meta.json").write_text(json.dumps({"id": m_id, "name": name, "desc": desc, "at": at or datetime.now().strftime("%Y-%m-%dT%H:%M")}, ensure_ascii=False), "utf-8")


def model_save(name, imgs, note=""):
    if not imgs:
        raise RuntimeError("Önce modelin 1-3 net fotoğrafını ekle (📎).")
    small = [jpeg(i, 1024) for i in imgs[:3]]
    parts = [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(b).decode()}} for b in small]
    c = J.gemini([{"role": "user", "parts": parts + [{"text": "Bu fotoğraflardaki kişiyi bir görsel yapay zekâsının birebir yeniden çizebileceği şekilde İngilizce tarif et: yaş aralığı, cinsiyet, ten, yüz şekli, gözler, kaşlar, burun, dudaklar, çene, saç, sakal/bıyık, belirgin işaretler, yapı, tipik kıyafet. Tek paragraf, isim yok." + (" Not: " + note if note else "")}]}], max_tokens=600, temperature=0.2)
    desc = J.gemini_text(c)
    old = model_get(name); m_id = old["id"] if old else uuid.uuid4().hex[:10]
    _write_model(m_id, name, desc, small)
    if J.AG.get("url"):  # telefonla paylaş
        try:
            payload = {"id": m_id, "name": name, "desc": desc, "imgs": [base64.b64encode(b).decode() for b in small], "at": datetime.now().strftime("%Y-%m-%dT%H:%M")}
            J.agent.call(J.AG, "saveFile", name=f"model-{m_id}.json", mime="application/json", data=base64.b64encode(json.dumps(payload).encode()).decode(), folder="TITUS Modeller", replace=True)
        except Exception as e:
            J.log("uyarı", f"model Drive'a yüklenemedi: {e}")
    return model_get(m_id)


def model_del(m_id):
    shutil.rmtree(mdir() / m_id, ignore_errors=True)


def models_sync():
    if not J.AG.get("url"):
        return 0
    have = {m["id"] for m in models()}; n = 0
    for f in J.agent.call(J.AG, "listFolder", folder="TITUS Modeller").get("files", []):
        mid = f["name"][6:-5] if f["name"].startswith("model-") and f["name"].endswith(".json") else None
        if not mid or mid in have:
            continue
        try:
            g = J.agent.call(J.AG, "getFileB64", id=f["id"])
            m = json.loads(base64.b64decode(g["data"]).decode("utf-8"))
            _write_model(m["id"], m["name"], m.get("desc", ""), [base64.b64decode(x) for x in m.get("imgs", [])], m.get("at")); n += 1
        except Exception as e:
            J.log("uyarı", f"model indirilemedi {f['name']}: {e}")
    return n


# ======================= konuşan karakter videosu =======================
def talking_clip(img_bytes, wav_path):
    """Fotoğraf + ses → dudak senkronlu video (Hugging Face ücretsiz alanları). Olmazsa None."""
    if is_off("talk"):
        return None
    try:
        import gradio_client  # noqa
    except Exception:
        J.log("uyarı", "gradio_client kurulu değil; 1-KUR.bat'ı çalıştır"); return None
    tmp = Path(tempfile.mkdtemp()); img = tmp / "yuz.jpg"; img.write_bytes(jpeg(img_bytes, 1024))
    try:
        for sp in [J.C.get("talk_space")] + TALK_SPACES:
            if not sp:
                continue
            try:
                J.emit("arac", f"video: konuşan yüz hazırlanıyor ({sp.split('/')[-1]})")
                res = adaptive_call(_client(sp), {"image": str(img), "audio": str(wav_path)})
                p = _file_of(res)
                if p:
                    out = tmp / "talk.mp4"; out.write_bytes(_fetch(p))
                    keep = Path(tempfile.mkdtemp()) / "talk.mp4"; shutil.move(str(out), keep); return keep
            except Exception as e:
                J.log("uyarı", f"konuşan video {sp}: {str(e)[:200]}")
                if _quota_err(e):
                    off("talk", 3 * 3600); break
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return None


def _wav(pcm_bytes, path, rate=24000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm_bytes)


def _seg_from_talk(ff, talk, wav, cap, W, H, out):
    fc = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps=30[v0];[v0][1:v]overlay=0:0,format=yuv420p[v]")
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(talk), "-i", str(cap), "-i", str(wav), "-filter_complex", fc, "-map", "[v]", "-map", "2:a",
                        "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-ar", "44100", "-ac", "2", str(out)], capture_output=True, text=True, creationflags=NO_WINDOW)
    return r.returncode == 0 and out.exists()


def _seg_from_still(ff, img, wav, cap, W, H, dur, out, i):
    frames = int(dur * 30) + 1
    zoom = "min(1+0.0010*on,1.14)" if i % 2 == 0 else "max(1.14-0.0010*on,1)"
    fc = (f"[0:v]scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
          f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps=30[bg];[bg][1:v]overlay=0:0,format=yuv420p[v]")
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(img), "-i", str(cap), "-i", str(wav), "-filter_complex", fc, "-map", "[v]", "-map", "2:a",
                        "-af", "apad", "-t", f"{dur:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30", "-c:a", "aac", "-ar", "44100", "-ac", "2", str(out)], capture_output=True, text=True, creationflags=NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError("Sahne işlenemedi: " + r.stderr[-200:])


def story_video(a, step=lambda s: None):
    """Senaryo → (kayıtlı modelle tutarlı) sahne görselleri → seslendirme → konuşan karakter klipleri → video."""
    ff = TX._ffmpeg()
    if not ff:
        return {"hata": "Video parçası (imageio-ffmpeg) kurulu değil; 1-KUR.bat'ı bir kez çalıştır."}
    konu = str(a.get("konu") or a.get("metin") or "").strip()
    if not konu:
        return {"hata": "Video konusu ya da söylenecek metin ne?"}
    model = model_get(a["model"]) if a.get("model") else None
    if a.get("model") and not model:
        try:
            models_sync(); model = model_get(a["model"])
        except Exception:
            pass
        if not model:
            return {"hata": f"'{a['model']}' adında kayıtlı model yok. Fotoğraflarını ekleyip 'model olarak kaydet' de."}
    ref = model["imgs"][0] if model else (CUR["imgs"][-1] if a.get("ekli_foto") and CUR["imgs"] else None)
    talk = bool(a.get("konusan", True)) and (ref is not None or a.get("karakter"))
    fmt = a.get("format") or "9:16"
    W, H = {"16:9": (1280, 720), "1:1": (1080, 1080)}.get(fmt, (720, 1280))
    iw, ih = {"16:9": (1344, 768), "1:1": (1024, 1024)}.get(fmt, (768, 1344))
    step("senaryo yazılıyor")
    plan = gem_json(
        f'"{konu}" için {max(2, min(8, int(a.get("sahne") or 4)))} sahnelik gerçekçi bir kısa video planla. '
        + (f"Ana karakter şu kişi (tarif birebir korunacak): {model['desc']}. " if model else "")
        + (f"Ortam/kıyafet: {a['ortam']}. " if a.get("ortam") else "")
        + ("Karakter kameraya bakarak konuşuyor; her sahnede söylediği Türkçe cümleyi 'anlatim'a yaz. " if talk else "Anlatım Türkçe dış ses. ")
        + 'Görsel prompt İngilizce, fotogerçekçi, yazısız; karakter sahnedeyse "medium close-up, facing camera, mouth visible" ekle. '
        'JSON: {"baslik":"","sahneler":[{"anlatim":"","gorsel":"","karakter_var":true}]}')
    scenes = [s for s in plan.get("sahneler", []) if s.get("anlatim")][:8]
    if not scenes:
        return {"hata": "Senaryo çıkarılamadı."}
    title = plan.get("baslik") or konu
    tmp = Path(tempfile.mkdtemp(prefix="titus_story_")); segs = []; stats = {"konusan": 0, "gorsel_kimlikli": 0, "gorsel": 0}
    try:
        for i, s in enumerate(scenes):
            step(f"sahne {i + 1}/{len(scenes)}: görsel")
            img = tmp / f"s{i}.jpg"
            try:
                if ref is not None and s.get("karakter_var", True):
                    try:
                        data, _ = edit_keep([ref], s.get("gorsel") or konu); stats["gorsel_kimlikli"] += 1
                    except LookupError:
                        data = text_image(((model or {}).get("desc", "") + ". " + (s.get("gorsel") or konu)).strip(". "), iw, ih)
                else:
                    data = text_image(s.get("gorsel") or s["anlatim"], iw, ih)
                img.write_bytes(data); stats["gorsel"] += 1
            except Exception as e:
                J.log("uyarı", f"sahne görseli: {e}"); TX._card_jpg(title, iw, ih, img)
            step(f"sahne {i + 1}/{len(scenes)}: ses")
            wav = tmp / f"s{i}.wav"; pcm = None
            try:
                pcm = J._tts(s["anlatim"])
            except Exception:
                pass
            dur = (len(pcm) / 24000 + 0.4) if pcm is not None and len(pcm) else max(2.6, len(s["anlatim"]) * 0.075)
            _wav(pcm.tobytes() if pcm is not None and len(pcm) else b"\0\0" * int(24000 * dur), wav)
            cap = tmp / f"c{i}.png"; TX._caption_png(s["anlatim"], W, H, cap)
            seg = tmp / f"seg{i}.mp4"; done = False
            if talk and s.get("karakter_var", True):
                step(f"sahne {i + 1}/{len(scenes)}: dudak senkronu")
                clip = talking_clip(img.read_bytes(), wav)
                if clip:
                    done = _seg_from_talk(ff, clip, wav, cap, W, H, seg); stats["konusan"] += int(done)
                    shutil.rmtree(Path(clip).parent, ignore_errors=True)
            if not done:
                _seg_from_still(ff, img, wav, cap, W, H, dur, seg, i)
            segs.append(seg)
        step("birleştiriliyor")
        lst = tmp / "list.txt"; lst.write_text("".join(f"file '{x.as_posix()}'\n" for x in segs), "utf-8")
        outdir = Path.home() / "Videos" / "Titus"; outdir.mkdir(parents=True, exist_ok=True)
        out = outdir / f"{TX._safe(title)}-{datetime.now():%Y%m%d-%H%M}.mp4"
        r = subprocess.run([ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-movflags", "+faststart", str(out)], capture_output=True, text=True, creationflags=NO_WINDOW)
        if r.returncode != 0:
            raise RuntimeError("Video birleştirilemedi: " + r.stderr[-200:])
        TX._open(out)
        note = []
        if talk and stats["konusan"] < len(scenes):
            note.append(f"{len(scenes) - stats['konusan']} sahnede dudak senkronu yapılamadı (ücretsiz Hugging Face alanları dolu ya da kapalı olabilir; Ayarlar'a ücretsiz HF token ekle). O sahneler hareketli fotoğraf + ses olarak eklendi.")
        if ref is not None and stats["gorsel_kimlikli"] < len(scenes):
            note.append("Bazı sahnelerde yüz birebir korunamadı (kimlik koruyan motor yanıt vermedi).")
        return {"ok": True, "dosya": str(out), "baslik": title, "sahne": len(scenes), "konusan_sahne": stats["konusan"], "yuzu_korunan_sahne": stats["gorsel_kimlikli"], "not": " ".join(note) or "Videolar/Titus klasörüne kaydedildi."}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ======================= araçlar =======================
def t_image(a):
    m = model_get(a["model"]) if a.get("model") else None
    if a.get("model") and not m:
        models_sync(); m = model_get(a["model"])
    n = max(1, min(4, int(a.get("adet") or 1))); files = []; last = None
    for _ in range(n):
        last = smart_image(a.get("istek") or a.get("aciklama", ""), a.get("oran"), (), m, lambda s: J.emit("arac", "görsel: " + s))
        files.append(str(save_img(last["img"], a.get("istek") or "gorsel")))
    return {"ok": True, "dosyalar": files, "uyum": last["puan"], "eksikler": last["eksik"], "motor": last["motor"], "not": " ".join(last["notlar"]) or "Resimler/Titus klasörüne kaydedildi ve açıldı."}


def t_montage(a):
    m = model_get(a["model"]) if a.get("model") else None
    if a.get("model") and not m:
        models_sync(); m = model_get(a["model"])
    if not CUR["imgs"] and not m:
        return {"hata": "Önce 📎 ile fotoğrafını ekle ya da kayıtlı bir model adı söyle."}
    r = smart_image(a.get("istek", ""), a.get("oran"), [] if m else CUR["imgs"][-3:], m, lambda s: J.emit("arac", "montaj: " + s))
    f = save_img(r["img"], "montaj")
    return {"ok": True, "dosya": str(f), "uyum": r["puan"], "motor": r["motor"], "not": " ".join(r["notlar"])}


def t_model_save(a):
    m = model_save(a.get("ad", "Model"), CUR["imgs"][-3:], a.get("not", ""))
    return {"ok": True, "model": m["name"], "foto": len(m["imgs"]), "tarif": m["desc"][:200]}


def t_talk(a):
    if not a.get("model") and not CUR["imgs"]:
        return {"hata": "Kim konuşsun? Kayıtlı bir model adı söyle ya da fotoğraf ekle."}
    metin = str(a.get("metin", "")).strip()
    if not metin:
        return {"hata": "Ne söylesin?"}
    return story_video({"konu": f"Karakter kameraya şunu söylüyor (cümleleri aynen kullan, sahnelere böl): {metin}", "model": a.get("model"), "ortam": a.get("ortam"),
                        "sahne": max(1, min(6, len([x for x in metin.replace("!", ".").replace("?", ".").split(".") if x.strip()]))), "format": a.get("format"), "konusan": True, "ekli_foto": True},
                       lambda s: J.emit("arac", "video: " + s))


def t_video(a):
    if a.get("model") or a.get("konusan"):
        return story_video(a, lambda s: J.emit("arac", "video: " + s))
    return TX.t_video(a)


def setup(jd, p, tx):
    global J, P, TX
    J, P, TX = jd, p, tx
    jd.DEFAULTS.update(MEDIA_KEYS)
    for k, v in MEDIA_KEYS.items():
        jd.C.setdefault(k, v)
    jd.MEDIA = __import__(__name__)
    reg = jd.register
    reg("gorsel_uret", "İsteğe birebir uyan görsel üretir: isteği ayrıntılandırır, üretir, sonucu kontrol edip eksikse düzeltir. Kayıtlı model (kişi) kullanılabilir. Resimler/Titus'a kaydeder.",
        {"istek": P("STRING", "Kullanıcının isteği, TÜM ayrıntılarıyla"), "oran": P("STRING", "", ["1:1", "9:16", "4:5", "16:9"]), "model": P("STRING", "Kayıtlı model adı"), "adet": P("NUMBER", "Kaç tane (1-4)")}, ["istek"], t_image)
    reg("fotograf_montaj", "Eklenen fotoğraftaki kişiyi (ya da kayıtlı modeli) yüzü, eli, kolu DEĞİŞMEDEN başka ortam/kıyafet/pozla gerçekçi montajlar.",
        {"istek": P("STRING", "Yeni ortam/kıyafet/poz, kullanıcının sözleriyle"), "model": P("STRING", "Kayıtlı model adı"), "oran": P("STRING", "", ["4:5", "9:16", "1:1", "16:9"])}, ["istek"], t_montage)
    reg("model_kaydet", "Eklenen fotoğraflardaki kişiyi isimle model olarak kaydeder (telefonla ortak; görsel ve videolarda kullanılır).", {"ad": P("STRING", "Model adı"), "not": P("STRING", "Ek not")}, ["ad"], t_model_save)
    reg("modeller", "Kayıtlı modelleri listeler (telefondakiler dahil).", {}, [], lambda a: (models_sync(), {"modeller": [m["name"] for m in models()]})[1])
    reg("konusan_video", "Gerçekçi, dudak senkronlu konuşan karakter videosu üretir (kayıtlı model ya da eklenen fotoğraf). Videolar/Titus'a kaydeder. Birkaç dakika sürer.",
        {"metin": P("STRING", "Karakterin söyleyeceği metin"), "model": P("STRING", "Kayıtlı model adı"), "ortam": P("STRING", "Ortam/kıyafet"), "format": P("STRING", "", ["9:16", "16:9", "1:1"])}, ["metin"], t_talk)
    reg("video_olustur", "Konudan kısa video üretir: senaryo, sahne görselleri, seslendirme, altyazı. Model verilirse karakter tüm sahnelerde aynı yüzle görünür ve konuşur (dudak senkronu).",
        {"konu": P("STRING", "Video konusu"), "sahne": P("NUMBER", "Sahne sayısı (2-8)"), "format": P("STRING", "", ["16:9", "9:16", "1:1"]), "model": P("STRING", "Kayıtlı model adı"), "konusan": P("BOOLEAN", "Karakter konuşsun mu")}, ["konu"], t_video)
    jd.MEMORY_HOOK.append(lambda: "\nGÖRSEL/DOSYA: Mesajda dosya ya da fotoğraf varsa önce dikkatle incele ve somut cevap ver ('göremiyorum' deme). Eklenen fotoğrafla başka ortam/kıyafet istenirse fotograf_montaj, 'model olarak kaydet/hafızana al' denirse model_kaydet, çizim için gorsel_uret, konuşan karakter için konusan_video kullan; isteği araca kısaltmadan ver."
                          + (f" Kayıtlı modeller: {', '.join(m['name'] for m in models())}." if models() else "") + (f" Şu an {len(CUR['imgs'])} fotoğraf ekli." if CUR["imgs"] else ""))
