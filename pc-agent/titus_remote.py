#!/usr/bin/env python3
"""
T.I.T.U.S. — Uzak Ekran (v3.2)

Telefondaki Titus bilgisayarın ekranını canlı görür, dokunarak tıklar, yazı yazar.
Ek program yok: görüntü WebRTC veri kanalıyla doğrudan (şifreli, DTLS) telefona akar.
Bağlantı kurulumu (sinyal) mevcut Apps Script kuyruğundan geçer (pcPush → pcPull → pcDone),
yani Apps Script'te değişiklik gerekmez.

Görüntü: JPEG kareler. Ekran değişmiyorsa hiç kare gitmez; hareket varken akıcı (küçük, hafif),
ekran durunca tam çözünürlükte "keskin kare" gider — FM gibi yazı ağırlıklı oyunlarda yazılar okunur.

Telefon → bilgisayar mesajları (JSON, "ctl" kanalı):
  m{x,y} mutlak hareket (0..1) · mr{dx,dy} göreli hareket · d/u{b} tuş bas/bırak · c{b,n} tıkla
  w{dy} tekerlek · k{key,mods} tuş · txt{s} yazı · q{mode} kalite · ask{s} Titus'a görev · stop · bye
Bilgisayar → telefon: info · f{n,w,h,sharp} + n parça JPEG ("scr" kanalı) · cur{x,y} · say{s} · agent{on}
"""
import asyncio, io, json, os, platform, subprocess, sys, threading, time, zlib
from concurrent.futures import ThreadPoolExecutor

J = None  # jarvis_desktop modülü
OS = platform.system()
VERSION = "1.0"
CHUNK = 16000
STUN = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}, {"urls": ["stun:stun.cloudflare.com:3478"]}]
MODES = {  # hareket halindeki kare: genişlik, kalite, kare/sn
    "akici": {"w": 1280, "q": 55, "fps": 20},
    "dengeli": {"w": 1600, "q": 62, "fps": 15},
    "net": {"w": 1920, "q": 75, "fps": 10},
    "veri": {"w": 1024, "q": 45, "fps": 8},  # mobil veri dostu
}
STATE = {"loop": None, "sess": None, "deps": None, "installing": False}


def log(level, msg):
    try:
        J.log(level, "[uzak ekran] " + msg)
    except Exception:
        print("[uzak ekran]", msg)


def toast(msg):
    try:
        import titus_plus
        titus_plus.toast("Titus · Uzak Ekran", msg)
    except Exception:
        log("bilgi", msg)


# ============================ paketler ============================
def deps_ok():
    try:
        import aiortc  # noqa: F401
        return True
    except Exception:
        return False


def ensure_deps(block=False):
    """aiortc ve mss yoksa arka planda kendisi kurar (1-KUR.bat'ı yeniden çalıştırmaya gerek kalmasın)."""
    if deps_ok():
        STATE["deps"] = True
        return True
    if STATE["installing"]:
        return False

    def inst():
        STATE["installing"] = True
        try:
            log("bilgi", "Uzak ekran paketleri kuruluyor (aiortc, mss)… bir dakika sürebilir.")
            exe = sys.executable
            if exe.lower().endswith("pythonw.exe"):
                alt = exe[:-11] + "python.exe"
                exe = alt if os.path.exists(alt) else exe
            flags = 0x08000000 if OS == "Windows" else 0  # pencere açmadan
            r = subprocess.run([exe, "-m", "pip", "install", "--upgrade", "aiortc", "mss"], capture_output=True, text=True, timeout=900, creationflags=flags)
            STATE["deps"] = r.returncode == 0 and deps_ok()
            log("bilgi" if STATE["deps"] else "hata", "Uzak ekran paketleri hazır." if STATE["deps"] else "Paket kurulamadı: " + (r.stderr or r.stdout)[-300:])
        except Exception as e:
            log("hata", f"paket kurulumu: {e}")
        finally:
            STATE["installing"] = False

    if block:
        inst()
        return bool(STATE["deps"])
    threading.Thread(target=inst, daemon=True).start()
    return False


# ============================ ekran ============================
_tl = threading.local()


def primary_rect():
    """Ana monitörün fiziksel piksel alanı (left, top, w, h)."""
    try:
        import mss
        if not hasattr(_tl, "sct"):
            _tl.sct = mss.mss()
        mons = _tl.sct.monitors[1:]
        m = next((m for m in mons if m["left"] == 0 and m["top"] == 0), mons[0])
        return m["left"], m["top"], m["width"], m["height"]
    except Exception:
        from PIL import ImageGrab
        im = ImageGrab.grab()
        return 0, 0, im.width, im.height


def grab():
    """(raw bytes, PIL.Image) — ana monitör."""
    from PIL import Image
    try:
        import mss
        if not hasattr(_tl, "sct"):
            _tl.sct = mss.mss()
        l, t, w, h = primary_rect()
        s = _tl.sct.grab({"left": l, "top": t, "width": w, "height": h})
        raw = s.bgra
        return raw, Image.frombytes("RGB", s.size, raw, "raw", "BGRX")
    except ImportError:
        from PIL import ImageGrab
        im = ImageGrab.grab()
        return im.tobytes(), im.convert("RGB")


def encode(im, w, q):
    from PIL import Image
    if im.width > w:
        h = round(im.height * w / im.width)
        im = im.resize((w, h), Image.BILINEAR if q < 70 else Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, "JPEG", quality=q, optimize=False, subsampling=2 if q < 70 else 0)
    return b.getvalue(), im.width, im.height


# ============================ fare / klavye ============================
VK = {"space": 0x20, "enter": 0x0D, "esc": 0x1B, "backspace": 0x08, "tab": 0x09, "up": 0x26, "down": 0x28, "left": 0x25,
      "right": 0x27, "delete": 0x2E, "home": 0x24, "end": 0x23, "pgup": 0x21, "pgdn": 0x22, "insert": 0x2D,
      "ctrl": 0x11, "alt": 0x12, "shift": 0x10, "win": 0x5B, "printscreen": 0x2C, "capslock": 0x14}
VK.update({f"f{i}": 0x6F + i for i in range(1, 13)})
EXTENDED = {0x26, 0x28, 0x25, 0x27, 0x2E, 0x24, 0x23, 0x21, 0x22, 0x2D, 0x5B, 0x2C}
PYA = {"pgup": "pageup", "pgdn": "pagedown", "esc": "esc", "win": "winleft"}


class Input:
    """Windows'ta SendInput (DPI'dan bağımsız, oyunlarda da çalışır); diğer sistemlerde pyautogui."""

    def __init__(self):
        self.win = OS == "Windows"
        self.held = set()
        if self.win:
            import ctypes
            from ctypes import wintypes
            self.ct = ctypes
            U = ctypes.c_size_t

            class MI(ctypes.Structure):
                _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", U)]

            class KI(ctypes.Structure):
                _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", U)]

            class HI(ctypes.Structure):
                _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]

            class UN(ctypes.Union):
                _fields_ = [("mi", MI), ("ki", KI), ("hi", HI)]

            class INPUT(ctypes.Structure):
                _fields_ = [("type", wintypes.DWORD), ("u", UN)]

            self.MI, self.KI, self.INPUT = MI, KI, INPUT
            self.u32 = ctypes.windll.user32
            try:  # fiziksel piksellerle çalış (ekran ölçekleme %125/%150 olsa da tıklama kaymasın)
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass
        else:
            import pyautogui
            pyautogui.FAILSAFE = False
            pyautogui.PAUSE = 0
            self.pa = pyautogui

    # ---- düşük seviye
    def _send(self, *inps):
        arr = (self.INPUT * len(inps))(*inps)
        self.u32.SendInput(len(inps), arr, self.ct.sizeof(self.INPUT))

    def _mouse(self, flags, dx=0, dy=0, data=0):
        i = self.INPUT(type=0)
        i.u.mi = self.MI(dx, dy, data & 0xFFFFFFFF, flags, 0, 0)
        return i

    def _key(self, vk=0, scan=0, flags=0):
        i = self.INPUT(type=1)
        i.u.ki = self.KI(vk, scan, flags, 0, 0)
        return i

    # ---- konum
    def cursor(self):
        """İmlecin ana monitördeki yeri (0..1)."""
        l, t, w, h = primary_rect()
        if self.win:
            from ctypes import wintypes
            p = wintypes.POINT()
            self.u32.GetCursorPos(self.ct.byref(p))
            x, y = p.x, p.y
        else:
            x, y = self.pa.position()
        return max(0.0, min(1.0, (x - l) / w)), max(0.0, min(1.0, (y - t) / h))

    def move(self, x, y):
        x, y = max(0.0, min(1.0, float(x))), max(0.0, min(1.0, float(y)))
        if self.win:  # MOVE | ABSOLUTE: 0..65535 ana monitöre eşlenir
            self._send(self._mouse(0x0001 | 0x8000, round(x * 65535), round(y * 65535)))
        else:
            l, t, w, h = primary_rect()
            self.pa.moveTo(l + x * (w - 1), t + y * (h - 1))

    def move_rel(self, dx, dy):
        x, y = self.cursor()
        self.move(x + float(dx), y + float(dy))

    def button(self, b="l", down=True):
        if self.win:
            f = {"l": (0x0002, 0x0004), "r": (0x0008, 0x0010), "m": (0x0020, 0x0040)}[b][0 if down else 1]
            self._send(self._mouse(f))
        else:
            btn = {"l": "left", "r": "right", "m": "middle"}[b]
            (self.pa.mouseDown if down else self.pa.mouseUp)(button=btn)
        (self.held.add if down else self.held.discard)(b)

    def click(self, b="l", n=1):
        for _ in range(max(1, min(3, int(n)))):
            self.button(b, True)
            self.button(b, False)

    def wheel(self, notches):
        n = int(max(-15, min(15, round(float(notches)))))
        if not n:
            return
        if self.win:
            self._send(self._mouse(0x0800, data=120 * n))
        else:
            self.pa.scroll(n)

    def _vk(self, key):
        k = str(key).lower()
        if k in VK:
            return VK[k]
        if len(k) == 1 and (k.isalnum()):
            return ord(k.upper())
        return None

    def key(self, key, mods=()):
        mods = [m for m in (mods or []) if m in ("ctrl", "alt", "shift", "win")]
        if self.win:
            vk = self._vk(key)
            if vk is None:
                return self.text(str(key))
            seq = [m for m in mods] + [key]
            downs, ups = [], []
            for k in seq:
                v = self._vk(k)
                sc = self.u32.MapVirtualKeyW(v, 0)
                ext = 0x0001 if v in EXTENDED else 0
                downs.append(self._key(v, sc, ext))
                ups.insert(0, self._key(v, sc, ext | 0x0002))
            self._send(*downs, *ups)
        else:
            k = PYA.get(str(key).lower(), str(key).lower())
            self.pa.hotkey(*[PYA.get(m, m) for m in mods], k)

    def text(self, s):
        s = str(s)[:2000]
        if not s:
            return
        if self.win:  # KEYEVENTF_UNICODE: Türkçe karakterler dahil her harf
            inps = []
            for ch in s:
                if ch == "\n":
                    inps += [self._key(0x0D, 0x1C, 0), self._key(0x0D, 0x1C, 0x0002)]
                    continue
                b = ch.encode("utf-16-le")
                for cu in (int.from_bytes(b[i:i + 2], "little") for i in range(0, len(b), 2)):
                    inps += [self._key(0, cu, 0x0004), self._key(0, cu, 0x0004 | 0x0002)]
            for i in range(0, len(inps), 200):
                self._send(*inps[i:i + 200])
        else:
            try:
                import pyperclip
                pyperclip.copy(s)
                self.pa.hotkey("ctrl", "v")
            except Exception:
                self.pa.write(s)

    def release_all(self):
        for b in list(self.held):
            try:
                self.button(b, False)
            except Exception:
                pass


# ============================ uyanık tutma ============================
def keep_awake(display=False):
    """Windows'un uyku moduna geçmesini engeller (Titus açık olduğu sürece)."""
    if OS != "Windows":
        return
    import ctypes
    ES_CONTINUOUS, ES_SYSTEM, ES_DISPLAY = 0x80000000, 0x00000001, 0x00000002
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM | (ES_DISPLAY if display else 0))


def awake_thread():
    def run():
        while True:
            try:
                s = STATE.get("sess")
                keep_awake(display=bool(s and s.alive))
            except Exception:
                pass
            time.sleep(30)
    threading.Thread(target=run, daemon=True, name="titus-uyanik").start()


# ============================ oturum ============================
class Session:
    def __init__(self, loop):
        self.loop = loop
        self.pc = None
        self.ctl = None
        self.scr = None
        self.alive = False
        self.mode = "dengeli"
        self.inp = Input()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="titus-ekran")
        self.tasks = []
        self.force = True
        self.agent_busy = False
        self.stats = {"bytes": 0, "frames": 0, "t": time.time()}
        self.started = time.time()

    # ---------- sinyal
    async def answer(self, sdp, ice=None):
        from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer
        servers = []
        for s in (ice or []) + STUN:
            try:
                urls = s.get("urls") if isinstance(s, dict) else s
                servers.append(RTCIceServer(urls=urls, username=s.get("username") if isinstance(s, dict) else None, credential=s.get("credential") if isinstance(s, dict) else None))
            except Exception:
                pass
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=servers))

        @self.pc.on("datachannel")
        def on_dc(ch):
            if ch.label == "ctl":
                self.ctl = ch

                @ch.on("message")
                def on_msg(m):
                    if isinstance(m, str):
                        try:
                            self.on_ctl(json.loads(m))
                        except Exception as e:
                            log("hata", f"komut: {e}")

                @ch.on("open")
                def _o():
                    self.on_open()
                if ch.readyState == "open":
                    self.on_open()
            elif ch.label == "scr":
                self.scr = ch

        @self.pc.on("connectionstatechange")
        async def on_state():
            st = self.pc.connectionState
            log("bilgi", f"bağlantı: {st}")
            if st in ("failed", "closed"):
                await self.close()

        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="offer"))
        ans = await self.pc.createAnswer()
        await self.pc.setLocalDescription(ans)  # aiortc adayları burada toplar (trickle yok)
        # 40 sn içinde bağlanmazsa kapat
        self.loop.call_later(40, lambda: (not self.alive) and asyncio.ensure_future(self.close()))
        return self.pc.localDescription.sdp

    def on_open(self):
        if self.alive:
            return
        self.alive = True
        keep_awake(display=True)
        l, t, w, h = primary_rect()
        self.send_ctl({"t": "info", "w": w, "h": h, "v": VERSION, "pc": getattr(J, "VERSION", "?"), "name": platform.node()})
        self.tasks = [asyncio.ensure_future(self.frames()), asyncio.ensure_future(self.cursor_loop())]
        toast("📱 Telefondan uzak ekran bağlandı. Kesmek için Ctrl+Alt+Q.")

    def send_ctl(self, obj):
        try:
            if self.ctl and self.ctl.readyState == "open":
                self.ctl.send(json.dumps(obj, ensure_ascii=False))
        except Exception:
            pass

    # ---------- görüntü
    async def frames(self):
        last_crc, last_change, sharp_sent = None, time.time(), True
        loop = asyncio.get_running_loop()
        while self.alive:
            m = MODES.get(self.mode, MODES["dengeli"])
            t0 = time.time()
            scr = self.scr
            if not scr or scr.readyState != "open":
                await asyncio.sleep(0.1)
                continue
            if scr.bufferedAmount > 1_500_000:  # ağ yetişemiyor: bu kareyi atla
                await asyncio.sleep(0.03)
                continue
            try:
                raw, im = await loop.run_in_executor(self.pool, grab)
            except Exception as e:
                log("hata", f"ekran alınamadı: {e}")
                await asyncio.sleep(1)
                continue
            crc = zlib.crc32(raw)
            now = time.time()
            job = None
            if crc != last_crc or self.force:
                job, last_crc, last_change, sharp_sent = (m["w"], m["q"], False), crc, now, False
                self.force = False
            elif not sharp_sent and now - last_change > 0.35:
                job, sharp_sent = (max(m["w"], 1920 if self.mode != "veri" else 1366), 85 if self.mode != "veri" else 70, True), True
            if job:
                data, w, h = await loop.run_in_executor(self.pool, encode, im, job[0], job[1])
                self.push_frame(data, w, h, job[2])
            idle = now - last_change > 2
            wait = (1 / 6 if idle else 1 / m["fps"]) - (time.time() - t0)
            await asyncio.sleep(max(0.005, wait))

    def push_frame(self, data, w, h, sharp):
        n = (len(data) + CHUNK - 1) // CHUNK
        try:
            self.scr.send(json.dumps({"t": "f", "n": n, "w": w, "h": h, "sharp": sharp, "b": len(data)}))
            for i in range(n):
                self.scr.send(data[i * CHUNK:(i + 1) * CHUNK])
        except Exception:
            return
        st = self.stats
        st["bytes"] += len(data)
        st["frames"] += 1
        if time.time() - st["t"] >= 2:
            d = time.time() - st["t"]
            self.send_ctl({"t": "stat", "fps": round(st["frames"] / d, 1), "kbs": round(st["bytes"] / d / 1024)})
            st.update(bytes=0, frames=0, t=time.time())

    async def cursor_loop(self):
        last = None
        while self.alive:
            try:
                c = self.inp.cursor()
                c = (round(c[0], 4), round(c[1], 4))
                if c != last:
                    self.send_ctl({"t": "cur", "x": c[0], "y": c[1]})
                    last = c
            except Exception:
                pass
            await asyncio.sleep(0.05)

    # ---------- kontrol
    def on_ctl(self, m):
        t = m.get("t")
        if t in ("m", "mr", "d", "u", "c", "w", "k", "txt") and self.agent_busy:
            self.take_over()
        i = self.inp
        if t == "m":
            i.move(m["x"], m["y"])
        elif t == "mr":
            i.move_rel(m.get("dx", 0), m.get("dy", 0))
        elif t == "d":
            if "x" in m:
                i.move(m["x"], m["y"])
            i.button(m.get("b", "l"), True)
        elif t == "u":
            if "x" in m:
                i.move(m["x"], m["y"])
            i.button(m.get("b", "l"), False)
        elif t == "c":
            if "x" in m:
                i.move(m["x"], m["y"])
            i.click(m.get("b", "l"), m.get("n", 1))
        elif t == "w":
            i.wheel(m.get("dy", 0))
        elif t == "k":
            i.key(m.get("key", ""), m.get("mods") or [])
        elif t == "txt":
            i.text(m.get("s", ""))
        elif t == "q":
            if m.get("mode") in MODES:
                self.mode = m["mode"]
            self.force = True
        elif t == "refresh":
            self.force = True
        elif t == "ask":
            self.ask(m.get("s", ""))
        elif t == "stop":
            self.take_over(silent=False)
        elif t == "ping":
            self.send_ctl({"t": "pong", "at": m.get("at")})
        elif t == "bye":
            asyncio.ensure_future(self.close())

    def take_over(self, silent=True):
        try:
            if getattr(J, "AGENT_STOP", None):
                J.AGENT_STOP.set()
        except Exception:
            pass
        if self.agent_busy:
            self.send_ctl({"t": "say", "s": "Kontrol sende, Titus durdu."})
        self.agent_busy = False
        self.send_ctl({"t": "agent", "on": False})

    def ask(self, text):
        """Titus sürüyor: görevi bilgisayardaki Titus'un beynine verir; Burak ekrandan canlı izler."""
        text = str(text).strip()
        if not text or self.agent_busy:
            return
        self.agent_busy = True
        self.send_ctl({"t": "agent", "on": True})

        def run():
            try:
                if getattr(J, "AGENT_STOP", None):
                    J.AGENT_STOP.clear()
                prompt = text + " (Burak telefondan uzak ekranla izliyor; ekranda yapılacak işse ekran_gorevi aracını kullan. Kısa Türkçe sonuç söyle.)"
                busy = getattr(J, "BUSY", None)
                if busy and not busy.acquire(timeout=5):
                    r = "Titus şu an bilgisayarda başka bir işle meşgul (sohbet ya da görev). Biraz sonra tekrar dene."
                else:
                    try:
                        r = J.think(prompt)
                    finally:
                        if busy:
                            busy.release()
            except Exception as e:
                r = "Bir sorun oldu: " + str(e)[:120]
            was = self.agent_busy
            self.agent_busy = False
            if was:
                self.loop.call_soon_threadsafe(self.send_ctl, {"t": "say", "s": str(r)[:1500]})
            self.loop.call_soon_threadsafe(self.send_ctl, {"t": "agent", "on": False})
        threading.Thread(target=run, daemon=True, name="titus-uzak-gorev").start()

    async def close(self):
        if getattr(self, "_closed", False):
            return
        self._closed = True
        was = self.alive
        self.alive = False
        try:
            self.inp.release_all()
        except Exception:
            pass
        for t in self.tasks:
            t.cancel()
        try:
            if self.pc:
                await self.pc.close()
        except Exception:
            pass
        self.pool.shutdown(wait=False)
        if STATE.get("sess") is self:
            STATE["sess"] = None
        keep_awake(display=False)
        if was:
            mins = int((time.time() - self.started) // 60)
            toast(f"Uzak ekran kapandı ({mins} dk).")


# ============================ asyncio döngüsü ============================
def get_loop():
    if STATE["loop"]:
        return STATE["loop"]
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True, name="titus-uzak").start()
    STATE["loop"] = loop
    return loop


async def _new_session(sdp, ice):
    old = STATE.get("sess")
    if old:
        await old.close()
    s = Session(asyncio.get_running_loop())
    STATE["sess"] = s
    return await s.answer(sdp, ice)


def handle_offer(cmd):
    """phone_queue_loop'tan çağrılır: telefonun teklifini alır, cevabı (answer) döndürür."""
    if not (J.C.get("uzak_ekran", True)):
        return {"ok": False, "hata": "Uzak ekran bilgisayarda kapalı (Titus → Ayarlar)."}
    if not deps_ok():
        if not ensure_deps(block=False) and STATE["installing"]:
            return {"ok": False, "kuruluyor": True, "hata": "Bilgisayarda uzak ekran paketi kuruluyor, 1-2 dakika sonra tekrar dene."}
        if not deps_ok():
            return {"ok": False, "hata": "Uzak ekran paketi (aiortc) kurulamadı. Bilgisayarda 1-KUR.bat'ı çalıştır."}
    sdp = cmd.get("sdp") or ""
    if "m=application" not in sdp:
        return {"ok": False, "hata": "Geçersiz bağlantı isteği"}
    fut = asyncio.run_coroutine_threadsafe(_new_session(sdp, cmd.get("ice") or []), get_loop())
    try:
        ans = fut.result(timeout=25)
    except Exception as e:
        return {"ok": False, "hata": f"Bağlantı hazırlanamadı: {e}"}
    log("bilgi", "telefondan bağlantı isteği cevaplandı")
    return {"ok": True, "sdp": ans, "type": "answer", "v": VERSION}


def stop_session():
    s = STATE.get("sess")
    if s:
        asyncio.run_coroutine_threadsafe(s.close(), get_loop())
        return {"ok": True, "not": "Uzak ekran kesildi."}
    return {"ok": True, "not": "Açık uzak ekran yok."}


def status():
    s = STATE.get("sess")
    return {"bagli": bool(s and s.alive), "paket": deps_ok(), "kuruluyor": STATE["installing"], "acik": J.C.get("uzak_ekran", True)}


# ============================ kurulum ============================
def setup(jd, P=None):
    global J
    J = jd
    acts = getattr(jd, "PHONE_ACTIONS", None)
    if acts is None:
        acts = jd.PHONE_ACTIONS = {}
    acts["remote_offer"] = handle_offer
    acts["remote_stop"] = lambda c: stop_session()
    acts["remote_status"] = lambda c: {"ok": True, **status()}
    if P is None:
        P = getattr(jd, "P", None)
    try:
        jd.register("uzak_ekran_durumu", "Telefondan uzak ekran bağlantısının durumunu söyler (bağlı mı, paket kurulu mu).", {}, [], lambda a: status())
        jd.register("uzak_ekrani_kes", "Telefondan açık olan uzak ekran bağlantısını hemen keser.", {}, [], lambda a: stop_session())
    except Exception:
        pass
    try:  # acil kesme kısayolu
        kb = getattr(jd, "keyboard", None)
        if kb is None:
            import keyboard as kb
        kb.add_hotkey("ctrl+alt+q", stop_session)
    except Exception:
        pass
    if jd.C.get("uzak_uyanik", True):
        awake_thread()
    if jd.C.get("uzak_ekran", True):
        ensure_deps(block=False)
    log("bilgi", f"hazır (paket: {'var' if deps_ok() else 'kuruluyor'})")
