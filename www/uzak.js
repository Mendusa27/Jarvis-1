/* ================= UZAK EKRAN (v4.9) =================
   Telefondan bilgisayar ekranını canlı görme ve kontrol etme. Ek program yok:
   - Bağlantı kurulumu eşleştirme koduyla (Google gerekmez; şifreli el sıkışma ntfy.sh üzerinden) ya da Apps Script kuyruğundan geçer.
   - Görüntü ve komutlar WebRTC veri kanalıyla doğrudan, şifreli akar (aynı Wi-Fi'da yerel ağdan).
   - İki mod: 👆 Dokun (dokunduğun yere tıklar) · 🖱 Touchpad (imleci parmağınla gezdirirsin; FM'de üzerine gelme için ideal).
   - Ekran durunca bilgisayar tam çözünürlükte "keskin kare" yollar: küçük yazılar yakınlaştırınca okunur.
   app.js'ten sonra yüklenir. app.js kendi kapalı bloğunda çalıştığı için ihtiyaç duyulanlar
   window.__TITUS köprüsünden alınır (SET, saveSet, toast, script, Jarvis, TOOLS, T, TOOL_GROUPS, ACT_TR). */
(() => {
"use strict";
const A = window.__TITUS;
if (!A) { console.warn("uzak ekran: Titus köprüsü yok"); return; }
const { saveSet, toast, script, sleep, esc, T, TOOLS, TOOL_GROUPS, ACT_TR, Jarvis } = A;
const UZ = {
  open: false, pc: null, ctl: null, scr: null, info: null, img: null, imgW: 0, imgH: 0, sharp: false,
  hdr: null, parts: [], cur: { x: 0.5, y: 0.5 }, curT: 0, z: 1, px: 0, py: 0, rot: false, agent: false,
  dirty: true, raf: 0, stat: "", lastMsg: 0, panel: "", tries: 0, connecting: false, closing: false
};
const uzSet = () => (A.SET.uzak = Object.assign({ code: "", ntfy: "", mode: "pad", q: "dengeli", turnUrl: "", turnUser: "", turnPass: "", speed: 1.6, help: true }, A.SET.uzak || {}));
const uzEl = id => document.getElementById(id);

function uzCss() {
  if (uzEl("uzCss")) return;
  const st = document.createElement("style"); st.id = "uzCss";
  st.textContent = `
#uzOv{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:9500;background:#050203;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;display:none;color:#f3e6e6;font-family:Nunito,system-ui,sans-serif}
#uzOv.on{display:block}
#uzOv.rot{width:100vh;height:100vw;transform-origin:0 0;transform:rotate(90deg) translateY(-100%)}
#uzCv{position:absolute;inset:0;width:100%;height:100%;display:block}
.uzbar{position:absolute;right:0;top:0;bottom:0;width:52px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 3px;background:rgba(20,4,6,.82);border-left:1px solid #3a0d12;overflow-y:auto;z-index:3}
.uzbar.min{width:30px;background:transparent;border:0}
.uzbar.min button:not(#uzMin){display:none}
.uzbar button{width:44px;min-height:38px;border-radius:10px;border:1px solid #4a1218;background:#1c0709;color:#ffdede;font-size:17px;font-weight:800;padding:0;flex:0 0 auto}
.uzbar button small{display:block;font-size:9px;font-weight:700;opacity:.8;line-height:1}
.uzbar button.on{background:#b3121f;border-color:#ff4a55;color:#fff}
.uzbar button.warn{background:#5a0a10;border-color:#ff4a55}
#uzMin{min-height:28px!important;width:26px!important;font-size:14px!important}
.uzstat{position:absolute;left:8px;top:6px;font-size:11px;padding:3px 8px;border-radius:9px;background:rgba(0,0,0,.55);z-index:2;pointer-events:none;transition:opacity .6s}
.uzsay{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:70%;font-size:14px;padding:8px 12px;border-radius:12px;background:rgba(40,6,10,.92);border:1px solid #ff4a55;z-index:4;display:none}
.uzcenter{position:absolute;inset:0 52px 0 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:20px;z-index:2}
.uzcenter p{margin:0;max-width:420px;line-height:1.4}
.uzcenter .btn{min-width:160px}
.uzpanel{position:absolute;right:58px;top:8px;bottom:8px;width:min(360px,calc(100% - 70px));background:rgba(22,5,7,.97);border:1px solid #4a1218;border-radius:14px;padding:12px;overflow-y:auto;z-index:5;display:none;font-size:14px}
.uzpanel.on{display:block}
.uzpanel h4{margin:4px 0 8px;color:#ff6b72;letter-spacing:1px;font-size:13px}
.uzkeys{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.uzkeys button,.uzrow button{border-radius:9px;border:1px solid #4a1218;background:#2a0a0e;color:#ffe;font-weight:800;padding:9px 2px;font-size:13px}
.uzrow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.uzrow button.on{background:#b3121f}
.uzpanel input{width:100%;box-sizing:border-box;background:#120304;border:1px solid #4a1218;color:#fff;border-radius:9px;padding:9px;margin-bottom:6px;font-size:14px}
.uzpanel .hint{font-size:12px;opacity:.8;line-height:1.4}
#uzKb{position:absolute;left:-1000px;top:0;width:200px;height:30px;opacity:0}
`;
  document.head.appendChild(st);
}

function uzBuild() {
  let ov = uzEl("uzOv"); if (ov) return ov;
  uzCss();
  ov = document.createElement("div"); ov.id = "uzOv";
  ov.innerHTML = `<canvas id="uzCv"></canvas><div class="uzstat" id="uzStat"></div><div class="uzsay" id="uzSay"></div>
<div class="uzcenter" id="uzCenter"><div class="reactor" style="pointer-events:none;transform:scale(.6)"><span class="r r1"></span><span class="r r2"></span><span class="r r3"></span><span class="c"></span></div><p id="uzMsg">Bilgisayara bağlanıyor…</p><div id="uzPairF" style="display:none;width:min(320px,90%)"><input id="uzCode" placeholder="ABCD-1234" autocomplete="off" autocapitalize="characters" spellcheck="false" style="width:100%;box-sizing:border-box;font-size:26px;letter-spacing:4px;text-align:center;font-weight:800;padding:10px;border-radius:12px;border:1px solid #ff4a55;background:#120304;color:#fff;margin-bottom:10px"><button class="btn" id="uzPairGo" style="width:100%">Bağlan</button></div><button class="btn" id="uzRetry" style="display:none">Tekrar dene</button><button class="btn ghost" id="uzBack2">← Titus'a dön</button></div>
<div class="uzbar" id="uzBar">
 <button id="uzMin">⋮</button>
 <button id="uzClose" title="Kapat">✕</button>
 <button id="uzModeB"><span id="uzModeI">🖱</span><small id="uzModeT">pad</small></button>
 <button id="uzKbB">⌨</button>
 <button id="uzSpace">▶<small>devam</small></button>
 <button id="uzEsc">Esc</button>
 <button id="uzUp">▲</button>
 <button id="uzDown">▼</button>
 <button id="uzRC">🖱<small>sağ</small></button>
 <button id="uzZoom">🔍<small>1x</small></button>
 <button id="uzKeysB">⌘<small>tuş</small></button>
 <button id="uzAskB">💬<small>Titus</small></button>
 <button id="uzSetB">⚙</button>
</div>
<div class="uzpanel" id="uzPanel"></div>
<input id="uzKb" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="enter">`;
  document.body.appendChild(ov);
  uzBind(ov);
  return ov;
}

/* ---------------- açma / kapama ---------------- */
async function uzOpen() {
  uzSet(); const ov = uzBuild(); UZ.open = true; ov.classList.add("on");
  try { if (typeof Jarvis !== "undefined" && Jarvis && Jarvis.screenMode) await Jarvis.screenMode({ landscape: true, awake: true }); } catch {}
  try { if (navigator.wakeLock) UZ.wl = await navigator.wakeLock.request("screen"); } catch {}
  setTimeout(uzLayout, 350); uzLayout(); uzModeUI();
  if (!UZ.ctl || UZ.ctl.readyState !== "open") { if (uzSet().code || A.SET.scriptUrl) uzConnect(); else uzPair(); }
  uzLoop();
  return { ok: true, metin: "Uzak ekran açıldı." };
}
async function uzClose() {
  UZ.open = false; UZ.closing = true;
  try { if (UZ.ctl && UZ.ctl.readyState === "open") UZ.ctl.send(JSON.stringify({ t: "bye" })); } catch {}
  setTimeout(() => { try { UZ.pc && UZ.pc.close(); } catch {} UZ.pc = UZ.ctl = UZ.scr = null; UZ.closing = false; }, 150);
  const ov = uzEl("uzOv"); if (ov) ov.classList.remove("on", "rot");
  uzPanel(""); cancelAnimationFrame(UZ.raf);
  try { if (typeof Jarvis !== "undefined" && Jarvis && Jarvis.screenMode) await Jarvis.screenMode({ landscape: false, awake: false }); } catch {}
  try { UZ.wl && UZ.wl.release(); UZ.wl = null; } catch {}
}
function uzBackKey() { if (UZ.panel) { uzPanel(""); return true; } if (UZ.open) { uzClose(); return true; } return false; }

/* ---------------- bağlantı (WebRTC + Apps Script sinyali) ---------------- */
function uzMsg(t, retry = false) {
  const c = uzEl("uzCenter"); if (!c) return;
  c.style.display = t ? "flex" : "none"; uzEl("uzMsg").textContent = t || ""; uzEl("uzRetry").style.display = retry ? "" : "none";
  uzEl("uzPairF").style.display = "none";
}
function uzPair(note) {
  uzMsg((note ? note + "\n\n" : "") + "Bilgisayardaki Titus'ta Ayarlar → Uzak Ekran bölümündeki eşleştirme kodunu yaz. Bir kez yazman yeter.");
  uzEl("uzMsg").style.whiteSpace = "pre-line";
  uzEl("uzPairF").style.display = ""; const i = uzEl("uzCode"); i.value = uzSet().code || ""; setTimeout(() => i.focus(), 80);
}
async function uzPairGo() {
  const raw = uzNorm(uzEl("uzCode").value);
  if (raw.length !== 8) return toast("Kod 8 karakter olmalı (ör. ABCD-1234)");
  uzSet().code = raw.slice(0, 4) + "-" + raw.slice(4); saveSet(); uzEl("uzCode").blur(); uzConnect();
}

/* ---- eşleştirme kodu + ntfy sinyali (Google gerekmez). Konu adları ve AES-GCM anahtarı koddan türetilir. ---- */
const uzNorm = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const uzHex = u8 => [...u8].map(b => b.toString(16).padStart(2, "0")).join("");
const uzB64e = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const uzB64d = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
async function uzSha(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function uzTopic(kind, code, sid) { return "titus" + uzHex(await uzSha(kind === "pc" ? "uzak-pc:" + uzNorm(code) : "uzak-ph:" + uzNorm(code) + ":" + sid)).slice(0, 28); }
async function uzKeyOf(code) { return crypto.subtle.importKey("raw", await uzSha("titus-uzak-anahtar:" + uzNorm(code)), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function uzZ(u8, compress) { const st = new Blob([u8]).stream().pipeThrough(compress ? new CompressionStream("deflate") : new DecompressionStream("deflate")); return new Uint8Array(await new Response(st).arrayBuffer()); }
async function uzSeal(code, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await uzZ(new TextEncoder().encode(JSON.stringify(obj)), true);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await uzKeyOf(code), data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return uzB64e(out);
}
async function uzUnseal(code, b64) {
  const raw = uzB64d(b64); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await uzKeyOf(code), raw.slice(12));
  return JSON.parse(new TextDecoder().decode(await uzZ(new Uint8Array(pt), false)));
}
async function uzSignalNtfy(cmd, pc) {
  const code = uzSet().code, base = (uzSet().ntfy || "https://ntfy.sh").replace(/\/$/, "");
  const sid = uzHex(crypto.getRandomValues(new Uint8Array(6)));
  const blob = await uzSeal(code, { ...cmd, ts: Date.now() }); const parts = blob.match(/[\s\S]{1,3000}/g) || [""];
  const tpc = await uzTopic("pc", code);
  for (let i = 0; i < parts.length; i++) { const r = await fetch(`${base}/${tpc}`, { method: "POST", body: JSON.stringify({ s: sid, i, n: parts.length, d: parts[i] }) }); if (!r.ok) throw new Error("ntfy " + r.status); }
  uzMsg("Bilgisayardaki Titus'a ulaşılıyor… (Titus bilgisayarda açık olmalı)");
  const tph = await uzTopic("ph", code, sid), got = {};
  for (let k = 0; k < 24 && UZ.open && UZ.pc === pc; k++) {
    await sleep(k < 2 ? 1300 : 1500);
    let txt = ""; try { txt = await (await fetch(`${base}/${tph}/json?poll=1&since=3m`)).text(); } catch { continue; }
    for (const line of txt.split("\n")) { let ev, m; try { ev = JSON.parse(line); m = JSON.parse(ev.message || "{}"); } catch { continue; } if (ev.event === "message" && m.s === sid) { got[m.i] = m.d; got.n = m.n; } }
    if (got.n && Object.keys(got).length - 1 >= got.n) return uzUnseal(code, Array.from({ length: got.n }, (_, i) => got[i]).join(""));
    if (k === 6) uzMsg("Bilgisayar henüz cevap vermedi… Titus bilgisayarda açık mı, kod doğru mu? (Bilgisayar uykudaysa bağlanılamaz.)");
  }
  return null;
}
async function uzSignalScript(cmd, pc) {
  uzMsg("Bilgisayardaki Titus'a ulaşılıyor… (Titus bilgisayarda açık olmalı)");
  const q = await script("pcPush", { cmd });
  for (let i = 0; i < 30 && UZ.open && UZ.pc === pc; i++) {
    await sleep(i < 3 ? 1500 : 1200);
    const r = await script("pcResult", { id: q.id });
    if (r.result) return r.result;
    if (i === 6) uzMsg("Bilgisayar cevap vermedi henüz… Bilgisayar uykuda ya da Titus kapalı olabilir.");
  }
  return null;
}
function uzIce() {
  const s = uzSet(); const l = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: ["stun:stun.cloudflare.com:3478"] }];
  if (s.turnUrl) l.push({ urls: s.turnUrl.split(/[\s,]+/).filter(Boolean), username: s.turnUser || undefined, credential: s.turnPass || undefined });
  return l;
}
async function uzConnect() {
  if (UZ.connecting) return; UZ.connecting = true; UZ.tries++;
  try { UZ.pc && UZ.pc.close(); } catch {}
  UZ.img = null; UZ.info = null; UZ.dirty = true;
  uzMsg("Bilgisayara bağlanıyor…");
  try {
    const ice = uzIce();
    const pc = new RTCPeerConnection({ iceServers: ice }); UZ.pc = pc;
    const ctl = pc.createDataChannel("ctl", { ordered: true }), scr = pc.createDataChannel("scr", { ordered: true });
    scr.binaryType = "arraybuffer"; UZ.ctl = ctl; UZ.scr = scr;
    ctl.onmessage = e => uzOnCtl(e.data); scr.onmessage = e => uzOnScr(e.data);
    ctl.onopen = () => { uzMsg(""); UZ.tries = 0; uzSend({ t: "q", mode: uzSet().q }); uzStat("● Bağlandı"); if (uzSet().help) setTimeout(() => uzPanel("help"), 900); };
    ctl.onclose = () => { if (UZ.open && !UZ.closing && UZ.pc === pc) uzMsg("Bağlantı koptu.", true); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" && UZ.pc === pc && UZ.open) uzMsg("Doğrudan bağlantı kurulamadı. İnternetin (özellikle mobil veri) engelliyor olabilir. Wi-Fi'ı dene ya da ⚙ → TURN sunucusu ekle.", true); };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(res => { if (pc.iceGatheringState === "complete") return res(); const t = setTimeout(res, 3500); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } }; });
    const cmd = { action: "remote_offer", sdp: pc.localDescription.sdp, ice: uzSet().turnUrl ? ice.slice(-1) : [] };
    const viaCode = !!uzSet().code;
    const ans = viaCode ? await uzSignalNtfy(cmd, pc) : await uzSignalScript(cmd, pc);
    if (!UZ.open || UZ.pc !== pc) return;
    if (!ans) { if (viaCode) return uzPair("Bilgisayardan cevap gelmedi. Bilgisayar açık mı, Titus çalışıyor mu, kod doğru mu?"); return uzMsg("Bilgisayardan cevap gelmedi. Bilgisayar açık mı, Titus çalışıyor mu? (Windows uyku modundaysa bağlanılamaz.)", true); }
    if (!ans.ok || !ans.sdp) return uzMsg(ans.hata || "Bilgisayar bağlantıyı kabul etmedi.", true);
    uzMsg("Görüntü bekleniyor…");
    await pc.setRemoteDescription({ type: "answer", sdp: ans.sdp });
    setTimeout(() => { if (UZ.pc === pc && UZ.open && ctl.readyState !== "open") uzMsg("Doğrudan bağlantı kurulamadı. Telefonla bilgisayar aynı Wi-Fi'dayken dene; mobil veride olmuyorsa ⚙ → TURN sunucusu ekle.", true); }, 15000);
  } catch (e) {
    uzMsg("Bağlanamadım: " + (e.message || e), true);
  } finally { UZ.connecting = false; }
}
const uzSend = o => { try { if (UZ.ctl && UZ.ctl.readyState === "open") { UZ.ctl.send(JSON.stringify(o)); return true; } } catch {} return false; };

function uzOnCtl(d) {
  let m; try { m = JSON.parse(d); } catch { return; }
  if (m.t === "cur") { if (Date.now() - UZ.curT > 400) { UZ.cur = { x: m.x, y: m.y }; UZ.dirty = true; uzFollow(); } }
  else if (m.t === "info") { UZ.info = m; uzFit(); uzStat(`● ${m.name || "Bilgisayar"} · ${m.w}×${m.h}`); }
  else if (m.t === "stat") { uzStat(`● ${m.fps} kare/sn · ${m.kbs} KB/sn`, true); }
  else if (m.t === "say") uzSay(m.s);
  else if (m.t === "agent") { UZ.agent = !!m.on; const b = uzEl("uzAskB"); if (b) { b.classList.toggle("warn", UZ.agent); b.innerHTML = UZ.agent ? "⏹<small>durdur</small>" : "💬<small>Titus</small>"; } if (UZ.agent) uzSay("🤖 Titus sürüyor… Ekrana dokunursan kontrol sana geçer.", 4000); }
}
function uzOnScr(d) {
  if (typeof d === "string") { try { UZ.hdr = JSON.parse(d); UZ.parts = []; } catch {} return; }
  if (!UZ.hdr) return;
  UZ.parts.push(d);
  if (UZ.parts.length < UZ.hdr.n) return;
  const h = UZ.hdr; const blob = new Blob(UZ.parts, { type: "image/jpeg" }); UZ.hdr = null; UZ.parts = [];
  createImageBitmap(blob).then(bm => { if (UZ.img && UZ.img.close) UZ.img.close(); UZ.img = bm; UZ.imgW = h.w; UZ.imgH = h.h; UZ.sharp = h.sharp; UZ.dirty = true; if (!UZ.info) { UZ.info = { w: h.w, h: h.h }; uzFit(); } uzMsg(""); }).catch(() => {});
}
let uzStatT = 0;
function uzStat(t, quiet) { const e = uzEl("uzStat"); if (!e) return; e.textContent = t; e.style.opacity = 1; clearTimeout(uzStatT); uzStatT = setTimeout(() => { e.style.opacity = quiet ? 0 : 0.35; }, quiet ? 1800 : 3500); }
let uzSayT = 0;
function uzSay(t, ms = 6000) { const e = uzEl("uzSay"); if (!e) return; e.textContent = t; e.style.display = "block"; clearTimeout(uzSayT); uzSayT = setTimeout(() => { e.style.display = "none"; }, ms); }

/* ---------------- görünüm: sığdırma, yakınlaştırma, kaydırma ---------------- */
function uzVW() { const ov = uzEl("uzOv"); const bar = uzEl("uzBar"); return { w: ov.clientWidth - (bar && !bar.classList.contains("min") ? 52 : 0), h: ov.clientHeight }; }
function uzLayout() {
  const ov = uzEl("uzOv"); if (!ov || !UZ.open) return;
  // yerel yatay mod yoksa ve telefon dik tutuluyorsa, ekranı CSS ile çevir
  const native = typeof Jarvis !== "undefined" && Jarvis && Jarvis.screenMode;
  UZ.rot = !native && innerHeight > innerWidth * 1.15;
  ov.classList.toggle("rot", UZ.rot);
  const cv = uzEl("uzCv"), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(ov.clientWidth * dpr); cv.height = Math.round(ov.clientHeight * dpr);
  uzFit(true);
}
function uzBase() { const v = uzVW(); const W = (UZ.info && UZ.info.w) || 16, H = (UZ.info && UZ.info.h) || 9; return { v, s: Math.min(v.w / W, v.h / H), W, H }; }
function uzFit(keep) {
  const { v, s, W, H } = uzBase();
  if (!keep) UZ.z = 1;
  const dw = W * s * UZ.z, dh = H * s * UZ.z;
  if (!keep || UZ.z === 1) { UZ.px = (v.w - dw) / 2; UZ.py = (v.h - dh) / 2; }
  uzClamp(); UZ.dirty = true; uzZoomUI();
}
function uzRect() { const { s, W, H } = uzBase(); return { x: UZ.px, y: UZ.py, w: W * s * UZ.z, h: H * s * UZ.z }; }
function uzClamp() {
  const v = uzVW(), r = uzRect();
  UZ.px = r.w <= v.w ? (v.w - r.w) / 2 : Math.min(0, Math.max(v.w - r.w, UZ.px));
  UZ.py = r.h <= v.h ? (v.h - r.h) / 2 : Math.min(0, Math.max(v.h - r.h, UZ.py));
}
function uzZoomAt(z, lx, ly) {
  const r = uzRect(); const u = (lx - r.x) / r.w, v = (ly - r.y) / r.h;
  UZ.z = Math.max(1, Math.min(6, z));
  const n = uzRect(); UZ.px = lx - u * n.w; UZ.py = ly - v * n.h; uzClamp(); UZ.dirty = true; uzZoomUI();
}
function uzZoomUI() { const b = uzEl("uzZoom"); if (b) b.innerHTML = `🔍<small>${UZ.z < 1.05 ? "1x" : UZ.z.toFixed(1) + "x"}</small>`; }
function uzFollow() { // touchpad modunda imleç görünümün dışına çıkmasın
  if (UZ.z <= 1.01) return;
  const v = uzVW(), r = uzRect(); const cx = r.x + UZ.cur.x * r.w, cy = r.y + UZ.cur.y * r.h; const mx = v.w * 0.14, my = v.h * 0.14;
  if (cx < mx) UZ.px += mx - cx; else if (cx > v.w - mx) UZ.px -= cx - (v.w - mx);
  if (cy < my) UZ.py += my - cy; else if (cy > v.h - my) UZ.py -= cy - (v.h - my);
  uzClamp(); UZ.dirty = true;
}
function uzToNorm(lx, ly) { const r = uzRect(); return { x: Math.max(0, Math.min(1, (lx - r.x) / r.w)), y: Math.max(0, Math.min(1, (ly - r.y) / r.h)) }; }

function uzLoop() {
  cancelAnimationFrame(UZ.raf);
  const step = () => { if (!UZ.open) return; if (UZ.dirty) { UZ.dirty = false; uzDraw(); } UZ.raf = requestAnimationFrame(step); };
  step();
}
function uzDraw() {
  const cv = uzEl("uzCv"); if (!cv) return; const g = cv.getContext("2d"); const dpr = cv.width / Math.max(1, uzEl("uzOv").clientWidth);
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#050203"; g.fillRect(0, 0, cv.width, cv.height);
  if (!UZ.img) return;
  const r = uzRect(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = UZ.z > 1.5 ? "high" : "medium";
  g.drawImage(UZ.img, r.x, r.y, r.w, r.h);
  // imleç (bilgisayarın imleci yakalanmaz; burada çizilir)
  const cx = r.x + UZ.cur.x * r.w, cy = r.y + UZ.cur.y * r.h, k = UZ.mode() === "pad" ? 1.25 : 0.9;
  g.save(); g.translate(cx, cy); g.scale(k, k);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 17); g.lineTo(4.5, 13); g.lineTo(8, 20.5); g.lineTo(10.5, 19.3); g.lineTo(7.2, 12.2); g.lineTo(12.5, 12.2); g.closePath();
  g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 1.4; g.fill(); g.stroke(); g.restore();
  if (UZ.dragHold) { g.beginPath(); g.arc(cx, cy, 16, 0, 7); g.strokeStyle = "rgba(255,74,85,.9)"; g.lineWidth = 2.5; g.stroke(); }
}
UZ.mode = () => uzSet().mode;

/* ---------------- dokunma hareketleri ---------------- */
const UZ_UI = ".uzbar,.uzpanel,.uzcenter button,.uzcenter input"; // dokunuşu bilgisayara değil arayüze bırak
function uzLocal(t) { // ekrandaki dokunuş → kaplamanın kendi koordinatları (çevrilmiş olabilir)
  return UZ.rot ? { x: t.clientY, y: innerWidth - t.clientX } : { x: t.clientX, y: t.clientY };
}
const G = { n: 0, t0: 0, sx: 0, sy: 0, lx: 0, ly: 0, moved: false, long: null, longFired: false, drag: false, lastTapT: 0, lastTapX: 0, lastTapY: 0, d0: 0, z0: 1, mx0: 0, my0: 0, px0: 0, py0: 0, pinch: false, acc: 0, two: false, twoMoved: false, twoT: 0, mvT: 0 };
function uzTouchStart(e) {
  if (e.target.closest(UZ_UI)) return;
  e.preventDefault(); if (uzEl("uzPanel").classList.contains("on")) uzPanel("");
  const ts = [...e.touches].map(uzLocal);
  if (ts.length === 1) {
    const p = ts[0]; Object.assign(G, { n: 1, t0: Date.now(), sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, longFired: false, drag: false, two: false });
    if (UZ.mode() === "touch") {
      clearTimeout(G.long);
      G.long = setTimeout(() => { if (!G.moved && G.n === 1) { G.longFired = true; const n = uzToNorm(G.sx, G.sy); uzSend({ t: "c", b: "r", x: n.x, y: n.y }); UZ.cur = n; UZ.curT = Date.now(); UZ.dirty = true; navigator.vibrate && navigator.vibrate(25); } }, 550);
    } else if (Date.now() - G.lastTapT < 300 && Math.hypot(p.x - G.lastTapX, p.y - G.lastTapY) < 40) {
      UZ.dragHold = true; uzSend({ t: "d", b: "l" }); UZ.dirty = true; // dokun-dokun-sürükle = basılı tutarak sürükle
    }
  } else if (ts.length === 2) {
    clearTimeout(G.long);
    if (G.drag) { uzSend({ t: "u", b: "l" }); G.drag = false; }
    if (UZ.dragHold) { uzSend({ t: "u", b: "l" }); UZ.dragHold = false; }
    const [a, b] = ts; Object.assign(G, { n: 2, two: true, twoMoved: false, twoT: Date.now(), d0: Math.hypot(a.x - b.x, a.y - b.y), z0: UZ.z, mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2, px0: UZ.px, py0: UZ.py, pinch: false, acc: 0, lmy: (a.y + b.y) / 2 });
  }
}
function uzTouchMove(e) {
  if (e.target.closest(UZ_UI)) return;
  e.preventDefault(); const ts = [...e.touches].map(uzLocal);
  if (ts.length === 1 && G.n === 1) {
    const p = ts[0]; const dx = p.x - G.lx, dy = p.y - G.ly;
    if (!G.moved && Math.hypot(p.x - G.sx, p.y - G.sy) > 9) { G.moved = true; clearTimeout(G.long); }
    if (!G.moved) return;
    if (UZ.mode() === "touch") {
      if (G.longFired) return;
      const n = uzToNorm(p.x, p.y);
      if (!G.drag) { const s = uzToNorm(G.sx, G.sy); uzSend({ t: "d", b: "l", x: s.x, y: s.y }); G.drag = true; }
      if (Date.now() - G.mvT > 24) { uzSend({ t: "m", x: n.x, y: n.y }); G.mvT = Date.now(); }
      UZ.cur = n; UZ.curT = Date.now(); UZ.dirty = true;
    } else {
      const r = uzRect(), sp = uzSet().speed || 1.6; const v = Math.hypot(dx, dy); const acc = sp * (v > 14 ? 1.6 : v > 6 ? 1.15 : 0.8);
      const ndx = dx / r.w * acc, ndy = dy / r.h * acc;
      UZ.cur = { x: Math.max(0, Math.min(1, UZ.cur.x + ndx)), y: Math.max(0, Math.min(1, UZ.cur.y + ndy)) }; UZ.curT = Date.now();
      G.pdx = (G.pdx || 0) + ndx; G.pdy = (G.pdy || 0) + ndy;
      if (Date.now() - G.mvT > 20) { uzSend({ t: "m", x: UZ.cur.x, y: UZ.cur.y }); G.mvT = Date.now(); G.pdx = G.pdy = 0; }
      UZ.dirty = true; uzFollow();
    }
    G.lx = p.x; G.ly = p.y;
  } else if (ts.length === 2 && G.n === 2) {
    const [a, b] = ts; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (!G.twoMoved && (Math.abs(d - G.d0) > 14 || Math.hypot(mx - G.mx0, my - G.my0) > 10)) G.twoMoved = true;
    if (!G.pinch && Math.abs(d / G.d0 - 1) > 0.12) G.pinch = true;
    if (G.pinch) { UZ.z = G.z0; UZ.px = G.px0; UZ.py = G.py0; uzZoomAt(G.z0 * d / G.d0, G.mx0, G.my0); UZ.px += mx - G.mx0; UZ.py += my - G.my0; uzClamp(); UZ.dirty = true; }
    else if (G.twoMoved) {
      const scroll = UZ.mode() === "pad" || UZ.z <= 1.01;
      if (scroll) { G.acc += my - G.lmy; while (Math.abs(G.acc) >= 32) { const s = Math.sign(G.acc); uzSend({ t: "w", dy: s }); G.acc -= s * 32; } }
      else { UZ.px = G.px0 + (mx - G.mx0); UZ.py = G.py0 + (my - G.my0); uzClamp(); UZ.dirty = true; }
    }
    G.lmy = my;
  }
}
function uzTouchEnd(e) {
  if (e.target.closest(UZ_UI)) return;
  e.preventDefault();
  const left = e.touches.length;
  if (G.n === 2) { // parmaklar nadiren aynı anda kalkar: ilk kalkışta karar ver
    if (!G.twoMoved && !G.pinch && Date.now() - G.twoT < 350) { uzSend({ t: "c", b: "r" }); navigator.vibrate && navigator.vibrate(20); }
    G.n = left ? 3 : 0; // kalan parmağı hareket bitene kadar yok say
    return;
  }
  if (G.n === 3) { if (!left) G.n = 0; return; }
  if (G.n !== 1) return;
  clearTimeout(G.long); G.n = 0;
  if (UZ.mode() === "touch") {
    if (G.longFired) return;
    if (G.drag) { const n = uzToNorm(G.lx, G.ly); uzSend({ t: "u", b: "l", x: n.x, y: n.y }); G.drag = false; return; }
    if (!G.moved) { const n = uzToNorm(G.sx, G.sy); uzSend({ t: "c", b: "l", x: n.x, y: n.y }); UZ.cur = n; UZ.curT = Date.now(); UZ.dirty = true; }
  } else {
    if (UZ.dragHold) { uzSend({ t: "m", x: UZ.cur.x, y: UZ.cur.y }); uzSend({ t: "u", b: "l" }); UZ.dragHold = false; UZ.dirty = true; G.lastTapT = 0; return; }
    if (G.moved) { uzSend({ t: "m", x: UZ.cur.x, y: UZ.cur.y }); return; }
    if (Date.now() - G.t0 < 260) { uzSend({ t: "c", b: "l" }); G.lastTapT = Date.now(); G.lastTapX = G.sx; G.lastTapY = G.sy; }
  }
}

/* ---------------- düğmeler, klavye, paneller ---------------- */
function uzModeUI() { const m = UZ.mode(); const i = uzEl("uzModeI"), t = uzEl("uzModeT"); if (i) { i.textContent = m === "pad" ? "🖱" : "👆"; t.textContent = m === "pad" ? "pad" : "dokun"; } UZ.dirty = true; }
function uzKey(key, mods = []) { uzSend({ t: "k", key, mods }); navigator.vibrate && navigator.vibrate(10); }
const UZ_KB = { v: "" };
function uzKbOpen() { const k = uzEl("uzKb"); k.value = "  "; UZ_KB.v = "  "; k.focus(); try { k.setSelectionRange(2, 2); } catch {} }
function uzKbInput() {
  const k = uzEl("uzKb"); const v = k.value, o = UZ_KB.v;
  if (v.length < o.length && o.startsWith(v)) { for (let i = 0; i < o.length - v.length; i++) uzKey("backspace"); }
  else if (v.startsWith(o)) { const add = v.slice(o.length); if (add) uzSend({ t: "txt", s: add }); }
  else { let i = 0; while (i < v.length && i < o.length && v[i] === o[i]) i++; for (let j = 0; j < o.length - i; j++) uzKey("backspace"); if (v.slice(i)) uzSend({ t: "txt", s: v.slice(i) }); }
  if (v.length < 1 || v.length > 40) { k.value = "  "; try { k.setSelectionRange(2, 2); } catch {} }
  UZ_KB.v = k.value;
}
function uzPanel(name) {
  const p = uzEl("uzPanel"); if (!p) return; UZ.panel = name;
  if (!name) { p.classList.remove("on"); return; }
  const s = uzSet(); let h = "";
  if (name === "keys") {
    const k = (lbl, key, mods = "") => `<button data-uzk="${key}" data-uzm="${mods}">${lbl}</button>`;
    h = `<h4>TUŞLAR</h4><div class="uzkeys">${k("Enter", "enter")}${k("Tab", "tab")}${k("⌫", "backspace")}${k("Del", "delete")}${k("↑", "up")}${k("↓", "down")}${k("←", "left")}${k("→", "right")}${k("Space", "space")}${k("Esc", "esc")}${k("PgUp", "pgup")}${k("PgDn", "pgdn")}</div>
<h4>KISAYOLLAR</h4><div class="uzkeys">${k("Kaydet", "s", "ctrl")}${k("Kopyala", "c", "ctrl")}${k("Yapıştır", "v", "ctrl")}${k("Geri al", "z", "ctrl")}${k("Alt+Tab", "tab", "alt")}${k("Win", "win")}${k("Masaüstü", "d", "win")}${k("Ctrl+F", "f", "ctrl")}</div>
<h4>F TUŞLARI</h4><div class="uzkeys">${Array.from({ length: 12 }, (_, i) => k("F" + (i + 1), "f" + (i + 1))).join("")}</div>
<div class="uzrow"><button data-uzk="f4" data-uzm="alt" data-uzconfirm="1">Alt+F4 (pencereyi kapat)</button></div>`;
  } else if (name === "ask") {
    h = `<h4>TİTUS SÜRSÜN</h4><div class="hint" style="margin-bottom:8px">Bilgisayardaki Titus'a görev ver, ekrandan canlı izle. Ekrana dokunduğun an kontrol sana geçer.</div>
<input id="uzAskT" placeholder="ör. FM'yi aç ve son kaydı yükle" enterkeyhint="send">
<div class="uzrow"><button id="uzAskGo" class="on">Gönder</button><button data-uzq="Football Manager'ı aç ve son kayıtlı oyunu yükle.">FM'yi aç</button><button data-uzq="Ekranda ne var? Kısaca söyle.">Ekranda ne var?</button><button data-uzq="Masaüstündeki pencereleri küçült.">Masaüstü</button></div>`;
  } else if (name === "set") {
    const q = (v, l) => `<button data-uzq2="${v}" class="${s.q === v ? "on" : ""}">${l}</button>`;
    h = `<h4>GÖRÜNTÜ</h4><div class="uzrow">${q("akici", "Akıcı")}${q("dengeli", "Dengeli")}${q("net", "Net")}${q("veri", "Veri tasarrufu")}</div>
<div class="hint" style="margin-bottom:10px">Ekran durunca her modda tam çözünürlükte keskin kare gelir. Mobil veride "Veri tasarrufu" önerilir.</div>
<h4>TOUCHPAD HIZI</h4><div class="uzrow">${[1.0, 1.6, 2.4].map((v, i) => `<button data-uzsp="${v}" class="${(s.speed || 1.6) === v ? "on" : ""}">${["Yavaş", "Normal", "Hızlı"][i]}</button>`).join("")}</div>
<h4>BAĞLANTI</h4><div class="hint" style="margin-bottom:6px">Eşleştirme kodu: <b>${esc(s.code || "yok")}</b></div><div class="uzrow"><button id="uzCodeB">Kodu değiştir</button><button id="uzReconn">Yeniden bağlan</button><button id="uzRefresh">Görüntüyü yenile</button><button id="uzHelpB">Nasıl kullanılır</button></div>
<div class="hint">Mobil veride bağlanmıyorsa (bazı operatörler doğrudan bağlantıyı engeller) bir TURN sunucusu ekle. Ücretsiz katmanı olan bir TURN servisinden adresi, kullanıcıyı ve şifreyi yaz:</div>
<input id="uzTurnU" placeholder="turn:adres:3478 (virgülle birden çok)" value="${esc(s.turnUrl || "")}"><input id="uzTurnN" placeholder="Kullanıcı adı" value="${esc(s.turnUser || "")}"><input id="uzTurnP" placeholder="Şifre" type="password" value="${esc(s.turnPass || "")}">
<div class="uzrow"><button id="uzTurnSave" class="on">Kaydet</button></div>`;
  } else if (name === "help") {
    h = `<h4>NASIL KULLANILIR</h4><div class="hint" style="font-size:13px">
<b>🖱 Touchpad modu</b> (FM için önerilen): parmağını kaydır, imleç gelsin · dokun = tık · iki kez dokun = çift tık · dokun, sonra tekrar dokunup kaydır = sürükle · iki parmakla dokun = sağ tık · iki parmakla kaydır = liste kaydır.<br><br>
<b>👆 Dokun modu</b>: dokunduğun yere tıklar · uzun bas = sağ tık · tek parmakla sürükle = sürükle · yakınken iki parmakla kaydır = görüntüyü gezdir.<br><br>
<b>Her iki modda</b>: iki parmakla aç/kapat = yakınlaştır · 🔍 = sığdır · ▶ = Space (FM'de "Devam") · ▲▼ = kaydırma · ⌨ = klavye · 💬 = Titus'a görev ver.<br><br>
Bilgisayarda <b>Ctrl+Alt+Q</b> bağlantıyı anında keser.</div>
<div class="uzrow" style="margin-top:10px"><button id="uzHelpOk" class="on">Anladım</button></div>`;
  }
  p.innerHTML = h; p.classList.add("on");
  if (name === "ask") setTimeout(() => uzEl("uzAskT") && uzEl("uzAskT").focus(), 50);
}
function uzAsk(t) {
  t = (t || "").trim(); if (!t) return;
  if (!uzSend({ t: "ask", s: t })) return toast("Bağlı değil");
  uzPanel(""); uzSay("🤖 Titus'a iletildi: " + t, 3000);
}

function uzBind(ov) {
  ov.addEventListener("touchstart", uzTouchStart, { passive: false });
  ov.addEventListener("touchmove", uzTouchMove, { passive: false });
  ov.addEventListener("touchend", uzTouchEnd, { passive: false });
  ov.addEventListener("touchcancel", uzTouchEnd, { passive: false });
  // fareyle (tablet/bilgisayar tarayıcısı) de çalışsın
  ov.addEventListener("mousedown", e => { if (e.target.id !== "uzCv") return; const n = uzToNorm(e.offsetX, e.offsetY); uzSend({ t: "d", b: e.button === 2 ? "r" : "l", x: n.x, y: n.y }); });
  ov.addEventListener("mouseup", e => { if (e.target.id !== "uzCv") return; const n = uzToNorm(e.offsetX, e.offsetY); uzSend({ t: "u", b: e.button === 2 ? "r" : "l", x: n.x, y: n.y }); });
  ov.addEventListener("mousemove", e => { if (e.target.id !== "uzCv" || Date.now() - G.mvT < 30) return; G.mvT = Date.now(); const n = uzToNorm(e.offsetX, e.offsetY); uzSend({ t: "m", x: n.x, y: n.y }); UZ.cur = n; UZ.curT = Date.now(); UZ.dirty = true; });
  ov.addEventListener("wheel", e => { if (e.target.id === "uzCv") { e.preventDefault(); uzSend({ t: "w", dy: e.deltaY > 0 ? -1 : 1 }); } }, { passive: false });
  ov.addEventListener("contextmenu", e => e.preventDefault());
  addEventListener("resize", () => UZ.open && setTimeout(uzLayout, 120));
  const kb = uzEl("uzKb");
  kb.addEventListener("input", uzKbInput);
  kb.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); uzKey("enter"); } else if (e.key === "Backspace" && kb.value.length <= 1) { e.preventDefault(); uzKey("backspace"); } });
  ov.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const id = t.id;
    if (id === "uzClose" || id === "uzBack2") uzClose();
    else if (id === "uzRetry" || id === "uzReconn") { uzPanel(""); uzConnect(); }
    else if (id === "uzPairGo") uzPairGo();
    else if (id === "uzCodeB") { uzPanel(""); uzPair(); }
    else if (id === "uzMin") { uzEl("uzBar").classList.toggle("min"); uzFit(true); }
    else if (id === "uzModeB") { const s = uzSet(); s.mode = s.mode === "pad" ? "touch" : "pad"; saveSet(); uzModeUI(); uzSay(s.mode === "pad" ? "🖱 Touchpad modu: parmağınla imleci gezdir, dokun = tık" : "👆 Dokun modu: dokunduğun yere tıklar, uzun bas = sağ tık", 2500); }
    else if (id === "uzKbB") uzKbOpen();
    else if (id === "uzSpace") uzKey("space");
    else if (id === "uzEsc") uzKey("esc");
    else if (id === "uzUp") uzSend({ t: "w", dy: 3 });
    else if (id === "uzDown") uzSend({ t: "w", dy: -3 });
    else if (id === "uzRC") uzSend({ t: "c", b: "r" });
    else if (id === "uzZoom") { if (UZ.z > 1.05) uzFit(); else { const v = uzVW(), r = uzRect(); uzZoomAt(2, r.x + UZ.cur.x * r.w || v.w / 2, r.y + UZ.cur.y * r.h || v.h / 2); } }
    else if (id === "uzKeysB") uzPanel(UZ.panel === "keys" ? "" : "keys");
    else if (id === "uzAskB") { if (UZ.agent) uzSend({ t: "stop" }); else uzPanel(UZ.panel === "ask" ? "" : "ask"); }
    else if (id === "uzSetB") uzPanel(UZ.panel === "set" ? "" : "set");
    else if (id === "uzAskGo") uzAsk(uzEl("uzAskT").value);
    else if (id === "uzRefresh") { uzSend({ t: "refresh" }); uzPanel(""); }
    else if (id === "uzHelpB") uzPanel("help");
    else if (id === "uzHelpOk") { uzSet().help = false; saveSet(); uzPanel(""); }
    else if (id === "uzTurnSave") { const s = uzSet(); s.turnUrl = uzEl("uzTurnU").value.trim(); s.turnUser = uzEl("uzTurnN").value.trim(); s.turnPass = uzEl("uzTurnP").value; saveSet(); toast("✓ Kaydedildi, yeniden bağlanıyorum"); uzPanel(""); uzConnect(); }
    else if (t.dataset.uzk) { if (t.dataset.uzconfirm && !confirm("Bilgisayardaki aktif pencere kapanacak. Emin misin?")) return; uzKey(t.dataset.uzk, t.dataset.uzm ? t.dataset.uzm.split("+") : []); }
    else if (t.dataset.uzq) uzAsk(t.dataset.uzq);
    else if (t.dataset.uzq2) { uzSet().q = t.dataset.uzq2; saveSet(); uzSend({ t: "q", mode: t.dataset.uzq2 }); uzPanel("set"); }
    else if (t.dataset.uzsp) { uzSet().speed = Number(t.dataset.uzsp); saveSet(); uzPanel("set"); }
  });
  ov.addEventListener("keydown", e => { if (e.target.id === "uzAskT" && e.key === "Enter") { e.preventDefault(); uzAsk(e.target.value); } if (e.target.id === "uzCode" && e.key === "Enter") { e.preventDefault(); uzPairGo(); } });
}

/* ---------------- Titus'a bağla: düğme, sesli komut, uygulamalar ---------------- */
document.addEventListener("click", e => { if (e.target.closest("#uzChip,[data-uzopen]")) { e.preventDefault(); uzOpen(); } });
try {
  TOOLS.push(T("uzak_ekran_ac", "Bilgisayarın ekranını telefonda canlı açar (uzak ekran): Burak ekranı görür, dokunarak tıklar, yazar, oyun oynar (ör. FM). 'bilgisayar ekranını aç', 'bilgisayara bağlan', 'FM oynayacağım' gibi isteklerde kullan.", {}, [], async () => uzOpen()));
  TOOLS.push(T("uzak_ekran_kapat", "Telefondaki uzak ekran bağlantısını kapatır.", {}, [], async () => { await uzClose(); return { ok: true }; }));
  TOOL_GROUPS.push([/uzak|ekranı(nı)? (aç|göster)|bilgisayar(ın|ımın)? ekran|bilgisayara bağlan|pc'?ye bağlan|fm|football manager|bilgisayarda oyna|oyun oyna/, ["uzak_ekran_ac", "uzak_ekran_kapat"]]);
  Object.assign(ACT_TR, { uzak_ekran_ac: "🖥 uzak ekran", uzak_ekran_kapat: "🖥 kapat" });
} catch (e) { console.warn("uzak ekran aracı eklenemedi", e); }
try {
  A.wrapApps(() => `<div class="card"><h3>BİLGİSAYAR</h3><div class="appgrid"><button class="app" data-uzopen="1"><i>🖥</i><b>Uzak Ekran</b><small>ekranı gör, dokun, oyna</small></button></div></div>`);
} catch {}

/* ---------------- Ayarlar → Uzak Ekran kartı ---------------- */
function uzSettingsHTML() {
  const s = uzSet(); const o = (v, l, cur) => `<option value="${v}"${cur === v ? " selected" : ""}>${l}</option>`;
  return `<div class="card"><h3>UZAK EKRAN (BİLGİSAYARI TELEFONDAN KONTROL)</h3>
<div class="hint" style="margin-top:0">Bilgisayarın ekranını telefonda canlı gör, dokunarak tıkla, yaz, oyun oyna. Google gerekmez: bilgisayardaki Titus → Ayarlar → <b>Uzak Ekran</b> bölümündeki kodu buraya bir kez yaz.</div>
<button class="btn" id="uzsConnect" style="width:100%;margin:10px 0">🖥 Bilgisayara bağlan</button>
<div class="form">
<div class="lbl">Eşleştirme kodu</div><input id="uzsCode" value="${esc(s.code || "")}" placeholder="ABCD-1234" autocapitalize="characters" autocomplete="off" style="font-size:20px;letter-spacing:3px;font-weight:800;text-align:center">
<div class="lbl">Görüntü</div><select id="uzsQ">${o("akici", "Akıcı (hareketli oyunlar)", s.q)}${o("dengeli", "Dengeli (önerilen)", s.q)}${o("net", "Net (yazı ağırlıklı)", s.q)}${o("veri", "Veri tasarrufu (mobil veri)", s.q)}</select>
<div class="lbl">Kontrol modu</div><select id="uzsMode">${o("pad", "🖱 Touchpad (imleç; FM için önerilen)", s.mode)}${o("touch", "👆 Dokun (dokunduğun yere tıklar)", s.mode)}</select>
<div class="lbl">Touchpad hızı</div><select id="uzsSpeed">${o("1", "Yavaş", String(s.speed))}${o("1.6", "Normal", String(s.speed))}${o("2.4", "Hızlı", String(s.speed))}</select>
<details style="margin-top:8px"><summary class="meta" style="cursor:pointer">Gelişmiş (mobil veride bağlanmıyorsa)</summary>
<div class="lbl">TURN sunucusu (virgülle birden çok)</div><input id="uzsTurnU" value="${esc(s.turnUrl || "")}" placeholder="turn:adres:3478">
<div class="lbl">TURN kullanıcı adı</div><input id="uzsTurnN" value="${esc(s.turnUser || "")}">
<div class="lbl">TURN şifresi</div><input id="uzsTurnP" type="password" value="${esc(s.turnPass || "")}">
<div class="lbl">Eşleştirme sunucusu (boş = ntfy.sh)</div><input id="uzsNtfy" value="${esc(s.ntfy || "")}" placeholder="https://ntfy.sh">
</details>
<div class="row" style="margin-top:10px"><button class="btn ghost sm" id="uzsSave">Kaydet</button><button class="btn ghost sm" id="uzsHelp">Nasıl kullanılır</button></div>
</div></div>`;
}
function uzSettingsSave(silent) {
  const s = uzSet(), v = id => (uzEl(id) || {}).value;
  const raw = uzNorm(v("uzsCode"));
  if (raw && raw.length !== 8) { toast("Kod 8 karakter olmalı (ör. ABCD-1234)"); return false; }
  s.code = raw ? raw.slice(0, 4) + "-" + raw.slice(4) : "";
  s.q = v("uzsQ") || s.q; s.mode = v("uzsMode") || s.mode; s.speed = Number(v("uzsSpeed")) || 1.6;
  s.turnUrl = (v("uzsTurnU") || "").trim(); s.turnUser = (v("uzsTurnN") || "").trim(); s.turnPass = v("uzsTurnP") || ""; s.ntfy = (v("uzsNtfy") || "").trim();
  saveSet(); if (uzEl("uzsCode")) uzEl("uzsCode").value = s.code; if (!silent) toast("✓ Uzak ekran ayarları kaydedildi");
  return true;
}
document.addEventListener("click", e => {
  const t = e.target.closest("#uzsConnect,#uzsSave,#uzsHelp"); if (!t) return;
  if (t.id === "uzsSave") uzSettingsSave();
  else if (t.id === "uzsConnect") { if (uzSettingsSave(true)) uzOpen(); }
  else if (t.id === "uzsHelp") { uzSettingsSave(true); uzOpen().then(() => setTimeout(() => uzPanel("help"), 400)); }
});

window.uzOpen = uzOpen; window.uzClose = uzClose; window.uzBackKey = uzBackKey; window.uzSettingsHTML = uzSettingsHTML;
})();
