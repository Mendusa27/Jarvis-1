"""
Titus — kesintisiz canlı sesli sohbet (Gemini Live API).
Tek bir açık bağlantı üzerinden sen konuşurken dinler, araya girersen susar, cevabı akış halinde söyler.
Bağlantı koparsa ya da süre dolarsa kaldığı yerden sessizce yeniden bağlanır.
"""
import asyncio, base64, json, re, threading, time

import numpy as np
import sounddevice as sd

try:
    import websockets
except ImportError:  # paket yoksa çağıran taraf eski moda düşer
    websockets = None

LIVE_MODELS = ["gemini-3.8-live", "gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-preview-12-2025", "gemini-2.5-flash-native-audio-preview-09-2025"]
WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key="
BYE = re.compile(r"^(tamam(dır)?[, ]*)?(görüşürüz|hoşça kal|bu kadar|şimdilik bu kadar|teşekkürler titus|sağ ?ol titus|kapat|iyi geceler|bye)\b", re.I)
PERSONA = """
ŞU AN CANLI, KESİNTİSİZ BİR SESLİ SOHBETTESİN. Burak her cümlede "Titus" demek zorunda değil; sohbet akıp gidiyor.
Bir insan gibi konuş: doğal, sıcak, akıcı Türkçe; kısa cümleler; konuşma dilinde ("tabii", "hmm, bakalım", "anladım"). Madde işareti ve uzun liste yok.
Sıra al: genelde 1-3 cümle söyle, sonra sözü ona bırak. Gerekirse kısa bir soru sor, ama her cevabı soruyla bitirme.
Önceki konuşulanları hatırla ve bağla. Yerinde hafif espri yapabilirsin. Söz kesildiğinde hemen sus ve dinle.
Anlamadığın bir şey olursa tahmin yürütme, kısaca sor. Bilgisayarda bir işlem istenirse aracı hemen çağır, araç adlarını söyleme; işi yapınca kısaca söyle.
Burak vedalaşırsa ("görüşürüz", "bu kadar", "sağ ol") kısa ve sıcak bir vedayla bitir."""


class Player:
    """24 kHz akış oynatıcı; söz kesilince anında susturulabilir."""
    def __init__(self):
        self.buf = bytearray(); self.lock = threading.Lock(); self.last = 0.0
        self.stream = sd.OutputStream(samplerate=24000, channels=1, dtype="int16", blocksize=960, callback=self._cb)
        self.stream.start()

    def _cb(self, out, frames, t, status):
        need = frames * 2
        with self.lock:
            chunk = bytes(self.buf[:need]); del self.buf[:need]
        if chunk:
            self.last = time.time()
        out[:] = np.frombuffer(chunk.ljust(need, b"\0"), dtype=np.int16).reshape(-1, 1)

    def add(self, pcm):
        with self.lock:
            self.buf += pcm

    def clear(self):
        with self.lock:
            self.buf.clear()

    def playing(self):
        with self.lock:
            n = len(self.buf)
        return n > 0 or time.time() - self.last < 0.35

    def close(self):
        try: self.stream.stop(); self.stream.close()
        except Exception: pass


class LiveChat:
    def __init__(self, J):
        self.J, self.C = J, J.C
        self.handle = None; self.model = None; self.lite = False
        self.ws = None; self.stop_flag = False; self.end_after = False
        self.user_txt = ""; self.bot_txt = ""; self.last_act = time.time()
        self.player = None; self.loop = None; self.mic_q = None; self.reconnecting = False; self.state = ""

    def set_state(self, st):
        if st != self.state:
            self.state = st; self.J.emit("durum", st)

    # ---------- bağlantı ----------
    def setup_msg(self, model, lite):
        setup = {
            "model": "models/" + model,
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": self.C.get("voice", "Charon")}}}},
            "systemInstruction": {"parts": [{"text": self.J.system_prompt() + PERSONA}]},
            "tools": self.J.DECL,
            "inputAudioTranscription": {}, "outputAudioTranscription": {},
        }
        if not lite:
            setup["realtimeInputConfig"] = {"automaticActivityDetection": {"startOfSpeechSensitivity": "START_SENSITIVITY_HIGH", "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH", "prefixPaddingMs": 120, "silenceDurationMs": 600}}
            setup["contextWindowCompression"] = {"slidingWindow": {}}
            setup["sessionResumption"] = {"handle": self.handle} if self.handle else {}
        return {"setup": setup}

    async def open(self, model, lite):
        ws = await asyncio.wait_for(websockets.connect(WS_URL + self.C["gemini_key"], max_size=None, ping_interval=20, ping_timeout=20), 8)
        await ws.send(json.dumps(self.setup_msg(model, lite)))
        while True:
            m = json.loads(await asyncio.wait_for(ws.recv(), 8))
            if "setupComplete" in m:
                break
        old, self.ws, self.model, self.lite = self.ws, ws, model, lite
        if old:
            try: await old.close()
            except Exception: pass

    async def connect_first(self):
        models = [self.C.get("live_model")] + LIVE_MODELS
        err = None
        for m in [x for i, x in enumerate(models) if x and x not in models[:i]]:
            for lite in (False, True):
                try:
                    await self.open(m, lite)
                    if self.C.get("live_model") != m:
                        self.C["live_model"] = m
                    return
                except Exception as e:
                    err = e
        raise err or RuntimeError("Canlı bağlantı kurulamadı")

    async def seed(self):
        turns = []
        for h in self.J.HIST[-12:]:
            txt = " ".join(p.get("text", "") for p in h.get("parts", []) if p.get("text"))
            if txt.strip():
                turns.append({"role": "model" if h["role"] == "model" else "user", "parts": [{"text": txt[:600]}]})
        if turns:
            await self.ws.send(json.dumps({"clientContent": {"turns": turns, "turnComplete": False}}))

    async def reconnect(self):
        if self.reconnecting or self.stop_flag:
            return
        self.reconnecting = True
        try:
            for i in range(4):
                try:
                    await self.open(self.model, self.lite)
                    if self.lite or not self.handle:  # kaldığı yerden devam edemiyorsa bağlamı yeniden ver
                        await self.seed()
                    return
                except Exception:
                    await asyncio.sleep(0.6 * (i + 1))
            self.J.emit("hata", "Bağlantı koptu. Tekrar konuşmak için 'Titus' de.")
            self.stop_flag = True
        finally:
            self.reconnecting = False

    # ---------- ses girişi ----------
    def mic_cb(self, indata, frames, t, status):
        pcm = indata.copy()
        rms = float(np.sqrt(np.mean(pcm.astype(np.float32) ** 2)))
        if self.player.playing() and rms < (500 if self.C.get("kulaklik") else 2600):
            pcm[:] = 0  # hoparlörden dönen kendi sesini duymasın; yüksek sesle araya girersen keser
        elif rms > 450:
            self.last_act = time.time()
        if self.loop:
            self.loop.call_soon_threadsafe(self.mic_q.put_nowait, pcm.tobytes())

    async def sender(self):
        pend = b""
        while not self.stop_flag:
            try:
                d = await asyncio.wait_for(self.mic_q.get(), 0.5)
            except asyncio.TimeoutError:
                continue
            pend += d
            if self.reconnecting or not self.ws:
                pend = pend[-16000 * 2 * 8:]  # bağlanırken son 8 saniyeyi tut
                continue
            if len(pend) >= 3200:  # 100 ms
                try:
                    await self.ws.send(json.dumps({"realtimeInput": {"audio": {"data": base64.b64encode(pend).decode(), "mimeType": "audio/pcm;rate=16000"}}}))
                    pend = b""
                except Exception:
                    await self.reconnect()

    # ---------- sunucudan gelenler ----------
    async def receiver(self):
        while not self.stop_flag:
            ws = self.ws
            try:
                raw = await ws.recv()
            except Exception:
                if self.stop_flag:
                    return
                if ws is self.ws:
                    await self.reconnect()
                continue
            try:
                m = json.loads(raw)
            except Exception:
                continue
            await self.on_msg(m)

    async def on_msg(self, m):
        J = self.J
        u = m.get("sessionResumptionUpdate")
        if u and u.get("resumable") and u.get("newHandle"):
            self.handle = u["newHandle"]
        sc = m.get("serverContent")
        if sc:
            if sc.get("interrupted"):
                self.player.clear(); self.set_state("dinliyor")
            it = (sc.get("inputTranscription") or {}).get("text")
            if it:
                self.user_txt += it; self.last_act = time.time(); J.emit("sen_canli", self.user_txt.strip())
            for p in (sc.get("modelTurn") or {}).get("parts", []):
                d = (p.get("inlineData") or {}).get("data")
                if d:
                    self.player.add(base64.b64decode(d)); self.set_state("konuşuyor")
            ot = (sc.get("outputTranscription") or {}).get("text")
            if ot:
                self.bot_txt += ot; J.emit("titus_canli", self.bot_txt.strip())
            if sc.get("turnComplete") or sc.get("generationComplete"):
                if self.user_txt.strip():
                    J.HIST.append({"role": "user", "parts": [{"text": self.user_txt.strip()}]})
                    if BYE.match(self.user_txt.strip()):
                        self.end_after = True
                if self.bot_txt.strip():
                    J.HIST.append({"role": "model", "parts": [{"text": self.bot_txt.strip()}]})
                del J.HIST[:-30]
                try: J.save_hist()
                except Exception: pass
                J.emit("tur_son", "")
                self.user_txt = self.bot_txt = ""; self.last_act = time.time()
        tc = m.get("toolCall")
        if tc:
            res = []
            for fc in tc.get("functionCalls", []):
                name, args = fc.get("name"), fc.get("args") or {}
                J.emit("arac", name)
                try:
                    r = await asyncio.get_running_loop().run_in_executor(None, lambda: J.TOOLS[name][2](args) if name in J.TOOLS else {"hata": "Bilinmeyen araç"})
                except Exception as e:
                    r = {"hata": str(e)}
                res.append({"id": fc.get("id"), "name": name, "response": {"result": r if isinstance(r, dict) else {"sonuc": r}}})
            try:
                await self.ws.send(json.dumps({"toolResponse": {"functionResponses": res}}))
            except Exception:
                pass
            self.last_act = time.time()
        if "goAway" in m:
            asyncio.ensure_future(self.reconnect())

    def send_text(self, text):
        """Canlı sohbet sırasında yazılan mesajı da aynı sohbete ekler."""
        if not (self.loop and self.ws):
            return False
        self.J.emit("sen", text); self.last_act = time.time()
        msg = json.dumps({"clientContent": {"turns": [{"role": "user", "parts": [{"text": text}]}], "turnComplete": True}})
        asyncio.run_coroutine_threadsafe(self.ws.send(msg), self.loop)
        return True

    async def watchdog(self):
        idle = float(self.C.get("live_idle", 45))
        while not self.stop_flag:
            await asyncio.sleep(0.5)
            if self.player.playing() or self.reconnecting:
                continue
            if self.J.LIVE_STOP.is_set() or self.end_after or time.time() - self.last_act > idle:
                self.stop_flag = True
            else:
                self.set_state("dinliyor")

    async def run(self):
        self.loop = asyncio.get_running_loop(); self.mic_q = asyncio.Queue()
        self.player = Player()
        mic = sd.InputStream(samplerate=16000, channels=1, dtype="int16", blocksize=1600, callback=self.mic_cb)
        mic.start()  # bağlanırken söylediklerin kaybolmasın diye mikrofon hemen açılır
        self.set_state("bağlanıyor")
        try:
            await self.connect_first()
            self.set_state("dinliyor")
            await self.seed()
            self.last_act = time.time()
            tasks = [asyncio.ensure_future(x) for x in (self.sender(), self.receiver(), self.watchdog())]
            while not self.stop_flag:
                await asyncio.sleep(0.2)
            for t in tasks:
                t.cancel()
        finally:
            try: mic.stop(); mic.close()
            except Exception: pass
            t0 = time.time()
            while self.player.playing() and time.time() - t0 < 6 and not self.J.LIVE_STOP.is_set():
                await asyncio.sleep(0.1)
            self.player.close()
            if self.ws:
                try: await self.ws.close()
                except Exception: pass


def run_live(J):
    """Canlı sohbeti başlatır ve bitene kadar bekler. Kurulamazsa False döner (eski moda geçilir)."""
    if websockets is None or not J.C.get("gemini_key") or not J.C.get("canli", True):
        return False
    chat = LiveChat(J)
    J.LIVE_STOP.clear()
    J.LIVE_CHAT = chat
    try:
        asyncio.run(chat.run())
        return True
    except Exception as e:
        J.emit("hata", "Canlı sohbet açılamadı, normal moda geçiyorum: " + str(e)[:90])
        return False
    finally:
        J.LIVE_CHAT = None
        J.emit("durum", "hazır")
