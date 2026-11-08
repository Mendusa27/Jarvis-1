/* JARVIS — Burak'ın kişisel asistanı
   Android (Capacitor) + tarayıcıda çalışır. Tüm veri cihazda; isteğe bağlı Google Apps Script senkronu. */
(() => {
"use strict";

/* ================= yardımcılar ================= */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = n => String(n).padStart(2, "0");
const DAYS = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const localISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = d => localISO(d).slice(0, 10);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const trLower = s => String(s || "").toLocaleLowerCase("tr-TR");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 2000000000 + 1; };
const money = n => (Math.round(n * 100) / 100).toLocaleString("tr-TR") + " ₺";
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s.length === 10 ? s + "T09:00" : s);
  return isNaN(d) ? null : d;
}
function fmtWhen(iso, withTime = true) {
  const d = parseDate(iso); if (!d) return iso || "";
  const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t0) / 864e5);
  const day = diff === 0 ? "Bugün" : diff === 1 ? "Yarın" : diff === -1 ? "Dün" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${DAYS[d.getDay()].slice(0, 3)}`;
  return withTime && String(iso).length > 10 ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}
function toast(t, ms = 2400) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("on"), ms); }

/* ================= Capacitor köprüsü ================= */
const Cap = window.Capacitor;
const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plug = n => (NATIVE && Cap.registerPlugin) ? Cap.registerPlugin(n) : null;
const Jarvis = plug("Jarvis");
const LN = plug("LocalNotifications");
const TTS = plug("TextToSpeech");
const Prefs = plug("Preferences");
const AppP = plug("App");
const Haptics = plug("Haptics");
async function nat(fn, fallback = null) { try { return await fn(); } catch (e) { console.warn(e); return fallback; } }

/* ================= depolama ================= */
const EMPTY = () => ({ reminders: [], tasks: [], notes: [], geo: [], memory: [], expenses: [], habits: [], auditions: [], shifts: [], projects: [], routines: [], dates: [], bills: [], applications: [], goals: [], updatedAt: 0 });
const DEF_SET = {
  provider: "gemini", geminiKey: "", geminiModel: "gemini-3.8-flash", claudeKey: "", claudeModel: "claude-haiku-5-5", claudeSmart: "claude-sonnet-5-5",
  personality: "esprili", voiceIdx: -1, rate: 1.0, pitch: 0.9, speakReplies: true, followUp: true,
  wake: false, scriptUrl: "", scriptToken: "", briefTime: "08:30", briefOn: true, eveningTime: "", city: "İstanbul", lat: 41.01, lng: 28.98,
  name: "Burak", budget: 0, lock: false, headset: false, homeLat: null, homeLng: null, partnerName: "Kübra", autoSendWa: false,
  kadroSheetId: "", ntfyTopic: "", radars: [], webhooks: [], proactive: true,
  stt: "gemini", wakeStrict: true, wakeConf: 0.92
};
let S = EMPTY(), SET = { ...DEF_SET }, CHAT = [];
async function kvGet(k) {
  if (Prefs) { const r = await nat(() => Prefs.get({ key: k })); return r && r.value; }
  try { return localStorage.getItem(k); } catch { return null; }
}
async function kvSet(k, v) {
  if (Prefs) return nat(() => Prefs.set({ key: k, value: v }));
  try { localStorage.setItem(k, v); } catch {}
}
async function loadAll() {
  try { const s = JSON.parse(await kvGet("jarvis_state") || "null"); if (s) S = Object.assign(EMPTY(), s); } catch {}
  try { const s = JSON.parse(await kvGet("jarvis_settings") || "null"); if (s) SET = Object.assign({ ...DEF_SET }, s); } catch {}
  try { const c = JSON.parse(await kvGet("jarvis_chat") || "null"); if (Array.isArray(c)) CHAT = c.slice(-40); } catch {}
}
let saveT = null;
function save(fromSync = false) {
  if (!fromSync) S.updatedAt = Date.now();
  kvSet("jarvis_state", JSON.stringify(S));
  renderAll();
  clearTimeout(saveT);
  saveT = setTimeout(() => { reschedule(); updateWidget(); if (!fromSync) pushSync(); }, 600);
}
const saveSet = () => kvSet("jarvis_settings", JSON.stringify(SET));
const saveChat = () => kvSet("jarvis_chat", JSON.stringify(CHAT.slice(-40)));

/* ================= Apps Script (senkron, Gmail, Takvim) ================= */
async function script(action, data = {}) {
  if (!SET.scriptUrl) throw new Error("Google bağlantısı kurulmamış (Ayarlar → Google).");
  const r = await fetch(SET.scriptUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: SET.scriptToken, action, ...data }) });
  let txt = await r.text();
  // Bazı Android sürümlerinde Google'ın yönlendirmesi otomatik izlenmez: elle takip et
  const mv = !txt.trim().startsWith("{") && txt.match(/HREF="([^"]+)"/i);
  if (mv) txt = await (await fetch(mv[1].replace(/&amp;/g, "&"))).text();
  let j; try { j = JSON.parse(txt); } catch { throw new Error("Google yanıtı okunamadı. Apps Script dağıtımını (Herkes erişebilir) kontrol et."); }
  if (!j.ok) throw new Error(j.error || "Google hatası");
  return j;
}
let syncBusy = false;
async function pullSync() {
  if (!SET.scriptUrl) return;
  try {
    const j = await script("load");
    if (j.data && (j.data.updatedAt || 0) > (S.updatedAt || 0)) { S = Object.assign(EMPTY(), j.data); save(true); toast("☁️ Veriler senkronlandı"); }
    else if ((S.updatedAt || 0) > ((j.data && j.data.updatedAt) || 0)) pushSync();
  } catch (e) { console.warn("sync", e); }
}
async function pushSync() {
  if (!SET.scriptUrl || syncBusy) return;
  syncBusy = true;
  try { await script("save", { data: S }); } catch (e) { console.warn("push", e); } finally { syncBusy = false; }
}

/* ================= ses: konuşma ================= */
let voices = [], speaking = false;
async function loadVoices() {
  if (TTS) { const r = await nat(() => TTS.getSupportedVoices(), { voices: [] }); voices = (r.voices || []).map((v, i) => ({ i, name: v.name, lang: v.lang })); }
  else if ("speechSynthesis" in window) voices = speechSynthesis.getVoices().map((v, i) => ({ i, name: v.name, lang: v.lang }));
}
async function speak(text, force = false) {
  if (!text || (!SET.speakReplies && !force)) return;
  const clean = String(text).replace(/[*_#`>|]/g, "").replace(/https?:\/\/\S+/g, "link");
  speaking = true; setMode("speak", "Konuşuyor");
  try {
    if (TTS) {
      const o = { text: clean, lang: "tr-TR", rate: SET.rate, pitch: SET.pitch, volume: 1, category: "playback", queueStrategy: 0 };
      if (SET.voiceIdx >= 0) o.voice = SET.voiceIdx;
      await TTS.speak(o);
    } else if ("speechSynthesis" in window) {
      await new Promise(res => {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(clean); u.lang = "tr-TR"; u.rate = SET.rate; u.pitch = SET.pitch;
        const vs = speechSynthesis.getVoices(); if (SET.voiceIdx >= 0 && vs[SET.voiceIdx]) u.voice = vs[SET.voiceIdx];
        u.onend = u.onerror = res; speechSynthesis.speak(u);
      });
    }
  } catch (e) { console.warn(e); }
  speaking = false; setMode("", "Hazır");
}
async function stopSpeaking() {
  speaking = false;
  if (TTS) await nat(() => TTS.stop()); else try { speechSynthesis.cancel(); } catch {}
}

/* ================= ses: dinleme ================= */
let listening = false, webRec = null;
async function listen() {
  if (listening) return null;
  await stopSpeaking();
  listening = true; $("#mic").classList.add("on"); setMode("listen", "Dinliyorum…");
  if (Haptics) nat(() => Haptics.impact({ style: "LIGHT" }));
  let text = null, done = false;
  if (SET.stt === "gemini" && SET.geminiKey && navigator.onLine && navigator.mediaDevices) {
    try {
      if (Jarvis) await nat(() => Jarvis.pauseWake());
      $("#q").placeholder = "● Dinliyorum… (bitince sus, kendim anlarım)";
      text = await listenGemini(); done = true;
    } catch (e) { console.warn("gemini stt", e); GEM_REC = null; }
    $("#q").placeholder = "JARVIS'e söyle…";
  }
  try {
    if (done) { /* Gemini ile anlaşıldı */ }
    else if (Jarvis) {
      await nat(() => Jarvis.pauseWake());
      const r = await Jarvis.listen({ lang: "tr-TR" });
      text = r && r.text;
    } else {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toast("Bu tarayıcıda ses tanıma yok — yazarak kullan."); }
      else text = await new Promise(res => {
        webRec = new SR(); webRec.lang = "tr-TR"; webRec.interimResults = true;
        let fin = "";
        webRec.onresult = e => { let t = ""; fin = ""; for (const r of e.results) r.isFinal ? fin += r[0].transcript : t += r[0].transcript; $("#q").value = fin || t; };
        webRec.onerror = () => {}; webRec.onend = () => res(fin || $("#q").value || null);
        webRec.start();
      });
    }
  } catch (e) {
    const m = String(e && (e.message || e));
    if (/izin|permission/i.test(m)) toast("Mikrofon izni gerekli (Ayarlar → İzinler).");
    else if (!/no.?match|duyamad|timeout|7|6/i.test(m)) toast("Ses tanıma: " + m);
  }
  listening = false; $("#mic").classList.remove("on"); setMode("", "Hazır"); $("#q").value = "";
  return text && text.trim() ? text.trim() : null;
}
async function stopListen() { if (GEM_REC) { GEM_REC.stopNow = true; return; } if (Jarvis) await nat(() => Jarvis.stopListen()); else try { webRec && webRec.stop(); } catch {} }
async function voiceTurn(greet = false) {
  if (greet) await speak("Efendim?", true);
  const t = await listen();
  if (t) await send(t, true); else resumeWake();
}
function resumeWake() { if (Jarvis && SET.wake) nat(() => Jarvis.resumeWake()); }

/* ================= onay penceresi ================= */
function confirmBox(text, yes = "Evet", no = "Vazgeç") {
  return new Promise(res => {
    $("#modalBox").innerHTML = `<h2>ONAY</h2><p>${esc(text)}</p><div class="row"><button class="btn ghost" id="mNo">${no}</button><button class="btn" id="mYes">${yes}</button></div>`;
    $("#modal").classList.add("on");
    const done = v => { $("#modal").classList.remove("on"); res(v); };
    $("#mYes").onclick = () => done(true); $("#mNo").onclick = () => done(false);
  });
}
function infoBox(title, html) {
  $("#modalBox").innerHTML = `<h2>${esc(title)}</h2><div style="text-align:left;font-size:15px;line-height:1.45;max-height:60vh;overflow:auto">${html}</div><div class="row" style="margin-top:14px"><button class="btn" id="mOk">Tamam</button></div>`;
  $("#modal").classList.add("on"); $("#mOk").onclick = () => $("#modal").classList.remove("on");
}

/* ================= iş mantığı (UI + JARVIS araçları ortak) ================= */
const REP = { none: "", daily: "her gün", weekdays: "hafta içi", weekly: "her hafta", monthly: "her ay" };
const A = {
  addReminder({ text, due, repeat = "none" }) {
    const d = parseDate(due); if (!text || !d) throw new Error("Metin veya tarih geçersiz");
    const r = { id: uid(), text, due: localISO(d), repeat: REP[repeat] !== undefined ? repeat : "none", done: false };
    S.reminders.push(r); save(); return r;
  },
  del(key, id) { const n = S[key].length; S[key] = S[key].filter(x => x.id !== id); save(); return n !== S[key].length; },
  addTask({ text, date = "", project = "" }) { const t = { id: uid(), text, date, project, done: false, created: localISO(new Date()) }; S.tasks.push(t); save(); return t; },
  toggleTask(id, v) { const t = S.tasks.find(t => t.id === id); if (!t) return false; t.done = v ?? !t.done; save(); return true; },
  addNote({ text, project = "" }) { const n = { id: uid(), text, project, created: localISO(new Date()) }; S.notes.unshift(n); save(); return n; },
  addMemory({ text }) { const m = { id: uid(), text, created: ymd(new Date()) }; S.memory.push(m); save(); return m; },
  addExpense({ amount, category = "Diğer", note = "", date }) {
    const a = Number(String(amount).replace(",", ".")); if (!(a > 0)) throw new Error("Tutar geçersiz");
    const e = { id: uid(), amount: a, category: category || "Diğer", note, date: date || ymd(new Date()) }; S.expenses.unshift(e); save(); return e;
  },
  expenseSummary(days = 30) {
    const from = ymd(new Date(Date.now() - (days - 1) * 864e5));
    const list = S.expenses.filter(e => e.date >= from); const by = {};
    list.forEach(e => by[e.category] = (by[e.category] || 0) + e.amount);
    return { days, total: list.reduce((s, e) => s + e.amount, 0), byCategory: by, count: list.length };
  },
  addHabit({ name }) { const h = { id: uid(), name, log: [] }; S.habits.push(h); save(); return h; },
  markHabit({ name, id, date }) {
    const h = S.habits.find(h => h.id === id) || S.habits.find(h => trLower(h.name).includes(trLower(name)));
    if (!h) throw new Error("Alışkanlık bulunamadı"); const d = date || ymd(new Date());
    if (h.log.includes(d)) h.log = h.log.filter(x => x !== d); else h.log.push(d);
    save(); return { name: h.name, done: h.log.includes(d), streak: streak(h) };
  },
  addAudition({ title, date, place = "", type = "seçme", notes = "" }) { const a = { id: uid(), title, date: date ? localISO(parseDate(date)) : "", place, type, notes, done: false }; S.auditions.push(a); save(); return a; },
  addShift({ date, start = "18:00", end = "02:00", place = "Kadıköy bar" }) { const s = { id: uid(), date, start, end, place }; S.shifts.push(s); save(); return s; },
  upsertProject({ name, status = "", next = "" }) {
    let p = S.projects.find(p => trLower(p.name) === trLower(name));
    if (!p) { p = { id: uid(), name, status: "", next: "" }; S.projects.push(p); }
    if (status) p.status = status; if (next) p.next = next; p.updated = ymd(new Date()); save(); return p;
  }
};
function streak(h) {
  let n = 0; const d = new Date();
  if (!h.log.includes(ymd(d))) d.setDate(d.getDate() - 1);
  while (h.log.includes(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ================= bildirim/alarm zamanlayıcı ================= */
let schedBusy = false, schedAgain = false;
function plannedNotifications() {
  const out = [], now = new Date();
  const N = (key, title, body, sch, extra = {}) => out.push({ id: hash(key), title, body, schedule: { allowWhileIdle: true, ...sch }, extra, channelId: "jarvis_alarm", smallIcon: "ic_stat_jarvis" });
  for (const r of S.reminders) {
    if (r.done) continue; const d = parseDate(r.due); if (!d) continue;
    const on = { hour: d.getHours(), minute: d.getMinutes() };
    if (r.repeat === "daily") N("r" + r.id, "JARVIS", r.text, { on }, { rid: r.id });
    else if (r.repeat === "weekly") N("r" + r.id, "JARVIS", r.text, { on: { ...on, weekday: d.getDay() + 1 } }, { rid: r.id });
    else if (r.repeat === "monthly") N("r" + r.id, "JARVIS", r.text, { on: { ...on, day: d.getDate() } }, { rid: r.id });
    else if (r.repeat === "weekdays") for (let w = 2; w <= 6; w++) N("r" + r.id + w, "JARVIS", r.text, { on: { ...on, weekday: w } }, { rid: r.id });
    else if (d > now) N("r" + r.id, "JARVIS", r.text, { at: d }, { rid: r.id });
  }
  for (const s of S.shifts) {
    const st = parseDate(s.date + "T" + s.start); if (!st) continue;
    const pre = new Date(st - 36e5); if (pre > now) N("s1" + s.id, "Vardiya 1 saat sonra", `${s.place} · ${s.start}–${s.end}`, { at: pre });
    let en = parseDate(s.date + "T" + s.end); if (en && en <= st) en = new Date(en.getTime() + 864e5);
    if (en && en > now) N("s2" + s.id, "Vardiya bitti", "Eve dönüş vakti. Toplu taşıma saatlerini kontrol et, dikkatli dön.", { at: en });
  }
  for (const a of S.auditions) {
    if (a.done || !a.date) continue; const d = parseDate(a.date); if (!d) continue;
    const eve = new Date(d); eve.setDate(eve.getDate() - 1); eve.setHours(20, 0, 0, 0);
    if (eve > now) N("a1" + a.id, `Yarın ${a.type}: ${a.title}`, "Replik, kıyafet ve ulaşımı bu akşam hazırla.", { at: eve });
    const h2 = new Date(d - 2 * 36e5); if (h2 > now) N("a2" + a.id, `${a.type} 2 saat sonra`, `${a.title}${a.place ? " · " + a.place : ""}`, { at: h2 });
  }
  if (SET.briefOn && /^\d\d:\d\d$/.test(SET.briefTime)) { const [h, m] = SET.briefTime.split(":").map(Number); N("brief", "Günaydın Burak ☀️", "Günlük brifingin hazır. Dinlemek için dokun.", { on: { hour: h, minute: m } }, { action: "brief" }); }
  if (/^\d\d:\d\d$/.test(SET.eveningTime || "")) { const [h, m] = SET.eveningTime.split(":").map(Number); N("evening", "Gün sonu 🌙", "Bugünün özeti ve yarının planı için dokun.", { on: { hour: h, minute: m } }, { action: "evening" }); }
  try { extraNotifications(N, now); } catch (e) { console.warn(e); }
  if (FOCUS.until > Date.now()) N("focus", "Odak süresi bitti ✅", FOCUS.label || "Mola zamanı.", { at: new Date(FOCUS.until) }, { action: "focusEnd" });
  return out;
}
async function reschedule() {
  if (!LN) return;
  if (schedBusy) { schedAgain = true; return; }
  schedBusy = true;
  try {
    const pend = await nat(() => LN.getPending(), { notifications: [] });
    if (pend.notifications && pend.notifications.length) await nat(() => LN.cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) }));
    const list = plannedNotifications();
    if (list.length) await nat(() => LN.schedule({ notifications: list }));
  } finally { schedBusy = false; if (schedAgain) { schedAgain = false; reschedule(); } }
}
// tarayıcı modu için sayfa açıkken basit alarm
function webTick() {
  if (LN) return; const now = new Date(); let ch = false;
  for (const r of S.reminders) {
    if (r.done) continue; const d = parseDate(r.due); if (!d || d > now) continue;
    if ((now - d) < 3 * 36e5) alarm(r.text);
    if (r.repeat === "none") r.done = true; else { const nd = new Date(d); do { if (r.repeat === "monthly") nd.setMonth(nd.getMonth() + 1); else if (r.repeat === "weekly") nd.setDate(nd.getDate() + 7); else { nd.setDate(nd.getDate() + 1); if (r.repeat === "weekdays") while (nd.getDay() === 0 || nd.getDay() === 6) nd.setDate(nd.getDate() + 1); } } while (nd <= now); r.due = localISO(nd); }
    ch = true;
  }
  if (ch) save();
}
function alarm(text) {
  $("#modalBox").innerHTML = `<h2>⚠ HATIRLATMA</h2><p>${esc(text)}</p><div class="row"><button class="btn ghost" id="mSn">10 dk ertele</button><button class="btn" id="mOk">Tamam</button></div>`;
  $("#modal").classList.add("on");
  $("#mOk").onclick = () => $("#modal").classList.remove("on");
  $("#mSn").onclick = () => { $("#modal").classList.remove("on"); A.addReminder({ text, due: localISO(new Date(Date.now() + 6e5)) }); };
  speak("Burak, hatırlatma: " + text, true);
}
// tek seferlik geçmiş hatırlatıcıları "tamamlandı" işaretle (native)
function sweepPast() {
  const now = new Date(); let ch = false;
  for (const r of S.reminders) if (!r.done && r.repeat === "none") { const d = parseDate(r.due); if (d && d < now) { r.done = true; ch = true; } }
  if (ch) save();
}

/* ================= odak modu ================= */
let FOCUS = { until: 0, label: "" }, focusTimer = null;
async function startFocus(minutes = 25, label = "Odak") {
  FOCUS = { until: Date.now() + minutes * 6e4, label }; kvSet("jarvis_focus", JSON.stringify(FOCUS));
  let dnd = null; if (Jarvis) dnd = await nat(() => Jarvis.dnd({ on: true }));
  reschedule(); tickFocus(); renderSec("life");
  return { minutes, dnd: dnd ? dnd.ok : false };
}
async function endFocus(silent) {
  if (!FOCUS.until) return; FOCUS = { until: 0, label: "" }; kvSet("jarvis_focus", JSON.stringify(FOCUS));
  if (Jarvis) await nat(() => Jarvis.dnd({ on: false }));
  reschedule(); renderSec("life"); if (!silent) speak("Odak süresi bitti Burak. Kısa bir mola hak ettin.", true);
}
function tickFocus() {
  clearInterval(focusTimer);
  if (!FOCUS.until) return;
  focusTimer = setInterval(() => {
    if (Date.now() >= FOCUS.until) { clearInterval(focusTimer); endFocus(); return; }
    const el = $("#focusLeft"); if (el) { const s = Math.max(0, Math.round((FOCUS.until - Date.now()) / 1000)); el.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
  }, 1000);
}

/* ================= dış servisler ================= */
const WMO = { 0: "açık", 1: "çoğunlukla açık", 2: "parçalı bulutlu", 3: "kapalı", 45: "sisli", 48: "sisli", 51: "çiseleyen", 53: "çiseleyen", 55: "çiseleyen", 61: "hafif yağmurlu", 63: "yağmurlu", 65: "sağanak", 71: "kar", 73: "kar", 75: "yoğun kar", 80: "sağanak", 81: "sağanak", 82: "şiddetli sağanak", 95: "gök gürültülü", 96: "dolu", 99: "dolu" };
async function geocode(name) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=tr`);
  const j = await r.json(); const g = j.results && j.results[0];
  if (!g) throw new Error("Yer bulunamadı: " + name);
  return { lat: g.latitude, lng: g.longitude, name: g.name + (g.admin1 ? ", " + g.admin1 : "") };
}
async function weather(place) {
  let lat = SET.lat, lng = SET.lng, name = SET.city;
  if (place && trLower(place) !== trLower(SET.city)) { const g = await geocode(place); lat = g.lat; lng = g.lng; name = g.name; }
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FIstanbul&forecast_days=3`);
  const j = await r.json(); const c = j.current, d = j.daily;
  return {
    yer: name, simdi: `${Math.round(c.temperature_2m)}°C (hissedilen ${Math.round(c.apparent_temperature)}°C), ${WMO[c.weather_code] || ""}, rüzgar ${Math.round(c.wind_speed_10m)} km/s`,
    gunler: d.time.map((t, i) => `${fmtWhen(t, false)}: ${Math.round(d.temperature_2m_min[i])}–${Math.round(d.temperature_2m_max[i])}°C, ${WMO[d.weather_code[i]] || ""}, yağış %${d.precipitation_probability_max[i]}`)
  };
}
function normPhone(n) {
  let d = String(n || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "90" + d.slice(1);
  if (d.length === 10 && d.startsWith("5")) d = "90" + d;
  return d;
}
async function resolveContact(who) {
  if (/^[+\d\s()-]{7,}$/.test(String(who))) return { name: who, number: who };
  if (!Jarvis) throw new Error("Rehbere erişim sadece telefonda çalışır.");
  const r = await Jarvis.findContact({ name: who });
  const list = (r && r.contacts) || [];
  if (!list.length) throw new Error(`Rehberde "${who}" bulunamadı.`);
  const exact = list.find(c => trLower(c.name) === trLower(who));
  return exact || list[0];
}

/* ================= JARVIS araçları ================= */
const T = (name, description, props = {}, required = [], run) => ({ name, description, props, required, run });
const str = (d, e) => ({ type: "string", description: d, ...(e ? { enum: e } : {}) });
const num = d => ({ type: "number", description: d });
const bool = d => ({ type: "boolean", description: d });
const TOOLS = [
  T("hatirlatici_ekle", "Zamanlı alarm/hatırlatma kurar (uygulama kapalıyken de çalar).", { text: str("Ne hatırlatılacak"), due: str("Yerel saat YYYY-MM-DDTHH:mm"), repeat: str("Tekrar", ["none", "daily", "weekdays", "weekly", "monthly"]) }, ["text", "due"],
    a => { const r = A.addReminder(a); return { ok: true, id: r.id, due: r.due, repeat: r.repeat }; }),
  T("hatirlatici_sil", "id ile hatırlatıcıyı siler.", { id: str("id") }, ["id"], a => ({ ok: A.del("reminders", a.id) })),
  T("konum_hatirlatici_ekle", "Bir yere varınca hatırlatma kurar. place: yer adı (ör. 'Kadıköy') ya da 'burası'.", { text: str("Mesaj"), place: str("Yer adı veya 'burası'"), radius: num("Metre, varsayılan 300") }, ["text", "place"],
    async a => addGeo(a)),
  T("gorev_ekle", "Yapılacaklar listesine görev ekler.", { text: str("Görev"), date: str("Opsiyonel YYYY-MM-DD"), project: str("Opsiyonel proje adı") }, ["text"], a => ({ ok: true, id: A.addTask(a).id })),
  T("gorev_tamamla", "Görevi tamamlandı (done=true) veya geri al yapar.", { id: str("id"), done: bool("Tamamlandı mı") }, ["id"], a => ({ ok: A.toggleTask(a.id, a.done ?? true) })),
  T("gorev_sil", "Görevi siler.", { id: str("id") }, ["id"], a => ({ ok: A.del("tasks", a.id) })),
  T("not_al", "Not kaydeder.", { text: str("Not"), project: str("Opsiyonel proje") }, ["text"], a => ({ ok: true, id: A.addNote(a).id })),
  T("not_sil", "Notu siler.", { id: str("id") }, ["id"], a => ({ ok: A.del("notes", a.id) })),
  T("hafiza_kaydet", "Burak hakkında kalıcı bir bilgiyi kaydeder (kişiler, tercihler, alışkanlıklar). Sadece Burak açıkça söylediğinde veya kalıcı ve faydalıysa.", { text: str("Bilgi, tek cümle") }, ["text"], a => ({ ok: true, id: A.addMemory(a).id })),
  T("hafiza_sil", "Kayıtlı bilgiyi siler.", { id: str("id") }, ["id"], a => ({ ok: A.del("memory", a.id) })),
  T("harcama_ekle", "Harcama kaydeder (TL).", { amount: num("Tutar TL"), category: str("Kategori: Yemek, Ulaşım, Kira, Fatura, Eğlence, Market, Sağlık, Kişisel, Diğer"), note: str("Not"), date: str("YYYY-MM-DD, varsayılan bugün") }, ["amount"], a => ({ ok: true, ...A.addExpense(a) })),
  T("harcama_ozeti", "Son N günün harcama özeti.", { days: num("Gün sayısı (7, 30...)") }, [], a => A.expenseSummary(a.days || 30)),
  T("aliskanlik_ekle", "Takip edilecek yeni alışkanlık ekler.", { name: str("Ad, ör. 'Su 2 litre'") }, ["name"], a => ({ ok: true, id: A.addHabit(a).id })),
  T("aliskanlik_isaretle", "Bugün (veya verilen tarihte) alışkanlığı yapıldı olarak işaretler/geri alır.", { name: str("Alışkanlık adı"), date: str("YYYY-MM-DD") }, ["name"], a => A.markHabit(a)),
  T("secme_ekle", "Seçme (audition), çekim, prova veya self-tape ekler; otomatik hatırlatma kurulur.", { title: str("Proje/rol"), date: str("YYYY-MM-DDTHH:mm"), place: str("Yer"), type: str("Tür", ["seçme", "çekim", "prova", "self-tape", "toplantı"]), notes: str("Notlar") }, ["title"], a => ({ ok: true, id: A.addAudition(a).id })),
  T("secme_sil", "Seçme/çekim kaydını siler.", { id: str("id") }, ["id"], a => ({ ok: A.del("auditions", a.id) })),
  T("vardiya_ekle", "Bar vardiyası ekler; 1 saat önce ve bitişte hatırlatır.", { date: str("YYYY-MM-DD"), start: str("HH:mm"), end: str("HH:mm"), place: str("Yer") }, ["date"], a => ({ ok: true, id: A.addShift(a).id })),
  T("vardiya_sil", "Vardiyayı siler.", { id: str("id") }, ["id"], a => ({ ok: A.del("shifts", a.id) })),
  T("proje_guncelle", "Yazılım/oyun projesinin durumunu ve sıradaki adımını kaydeder.", { name: str("Proje adı"), status: str("Nerede kaldı"), next: str("Sıradaki adım") }, ["name"], a => ({ ok: true, ...A.upsertProject(a) })),
  T("odak_baslat", "Odak/pomodoro başlatır, rahatsız etme modunu açar.", { minutes: num("Dakika, varsayılan 25"), label: str("Ne üzerinde çalışılacak") }, [], a => startFocus(a.minutes || 25, a.label || "Odak")),
  T("odak_bitir", "Odak modunu bitirir.", {}, [], async () => { await endFocus(true); return { ok: true }; }),
  T("hava_durumu", "Hava durumu (varsayılan şehir veya verilen yer).", { place: str("Opsiyonel yer") }, [], a => weather(a.place)),
  T("takvim_listele", "Google Takvim etkinliklerini getirir.", { days: num("Bugünden itibaren kaç gün, varsayılan 2") }, [], async a => script("calendarList", { days: a.days || 2 })),
  T("takvim_ekle", "Google Takvim'e etkinlik ekler (telefonun takvim bildirimiyle de hatırlatır).", { title: str("Başlık"), start: str("YYYY-MM-DDTHH:mm"), end: str("YYYY-MM-DDTHH:mm, opsiyonel"), location: str("Yer") }, ["title", "start"],
    async a => { if (!(await confirmBox(`Takvime eklensin mi?\n${a.title} · ${fmtWhen(a.start)}`))) return { ok: false, iptal: true }; return script("calendarAdd", a); }),
  T("mail_ozeti", "Gmail'deki son/okunmamış mailleri getirir. query Gmail arama ifadesi olabilir (ör. 'is:unread', 'from:recasttalent').", { query: str("Gmail arama"), max: num("En fazla, varsayılan 8") }, [], async a => script("gmail", { query: a.query || "is:unread in:inbox", max: a.max || 8 })),
  T("bildirimleri_oku", "Telefona gelen son bildirimleri (WhatsApp, Instagram, mail...) getirir.", { limit: num("Kaç tane, varsayılan 15") }, [],
    async a => { if (!Jarvis) return { hata: "Sadece telefonda" }; const r = await Jarvis.getNotifications({ limit: a.limit || 15 }); return r.granted ? { bildirimler: r.items } : { hata: "Bildirim erişimi izni yok. Ayarlar → İzinler'den açılmalı." }; }),
  T("ara", "Rehberdeki birini veya numarayı arar. Önce ekranda onay ister.", { kim: str("Kişi adı (rehberdeki gibi) veya numara") }, ["kim"],
    async a => { const c = await resolveContact(a.kim); if (!(await confirmBox(`${c.name} (${c.number}) aransın mı?`, "Ara"))) return { ok: false, iptal: true }; await Jarvis.call({ number: c.number }); return { ok: true, arandi: c.name }; }),
  T("whatsapp_mesaj", "WhatsApp mesajını hazırlayıp açar; Burak gönder tuşuna basar.", { kim: str("Kişi adı veya numara"), mesaj: str("Mesaj metni") }, ["kim", "mesaj"],
    async a => { const c = await resolveContact(a.kim); if (!(await confirmBox(`${c.name} kişisine WhatsApp:\n"${a.mesaj}"`, "Aç"))) return { ok: false, iptal: true }; await openUrl(`https://wa.me/${normPhone(c.number)}?text=${encodeURIComponent(a.mesaj)}`); return { ok: true, not: "WhatsApp açıldı, gönder tuşuna basması gerekiyor." }; }),
  T("sms_hazirla", "SMS'i hazırlayıp mesajlar uygulamasında açar.", { kim: str("Kişi adı veya numara"), mesaj: str("Mesaj") }, ["kim", "mesaj"],
    async a => { const c = await resolveContact(a.kim); await openUrl(`sms:${c.number}?body=${encodeURIComponent(a.mesaj)}`); return { ok: true, not: "SMS ekranı açıldı." }; }),
  T("uygulama_ac", "Telefondaki bir uygulamayı adıyla açar (Spotify, Instagram, YouTube...).", { ad: str("Uygulama adı") }, ["ad"],
    async a => Jarvis ? Jarvis.openApp({ name: a.ad }) : { hata: "Sadece telefonda" }),
  T("link_ac", "Bir web sayfasını veya haritada yol tarifini açar.", { url: str("https://... veya 'yol:Kadıköy'") }, ["url"],
    async a => { const u = a.url.startsWith("yol:") ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.url.slice(4))}` : a.url; await openUrl(u); return { ok: true }; }),
  T("fener", "Feneri açar/kapatır.", { on: bool("Açık mı") }, ["on"], async a => Jarvis ? Jarvis.torch({ on: !!a.on }) : { hata: "Sadece telefonda" }),
  T("rahatsiz_etme", "Rahatsız etme modunu açar/kapatır.", { on: bool("Açık mı") }, ["on"], async a => Jarvis ? Jarvis.dnd({ on: !!a.on }) : { hata: "Sadece telefonda" }),
  T("replik_modu", "Replik çalışma ekranını açar (Kariyer → Replik). Burak sahne metnini oraya yapıştırır.", {}, [], () => { go("work"); openSec("work", "lines"); return { ok: true }; })
];
async function openUrl(url) { if (Jarvis) await Jarvis.openUrl({ url }); else window.open(url, "_blank"); }
async function addGeo({ text, place, radius = 300 }) {
  if (!Jarvis) return { hata: "Konum hatırlatma sadece telefonda çalışır." };
  let lat, lng, name = place;
  if (/^(burası|burasi|buraya|şu an|bulunduğum yer)$/i.test(String(place).trim())) { const l = await Jarvis.getLocation(); lat = l.lat; lng = l.lng; name = "Şu anki konum"; }
  else { const g = await geocode(place); lat = g.lat; lng = g.lng; name = g.name; }
  const g = { id: uid(), text, place: name, lat, lng, radius: Math.max(100, Math.min(radius || 300, 2000)), active: true };
  const r = await Jarvis.addGeofence({ id: g.id, lat, lng, radius: g.radius, text });
  if (!r || !r.ok) return { hata: (r && r.error) || "Konum izni (her zaman) gerekli. Ayarlar → İzinler." };
  S.geo.push(g); save(); return { ok: true, yer: name };
}

/* ================= beyin ================= */
function systemPrompt() {
  const d = new Date();
  const upc = S.reminders.filter(r => !r.done).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 30).map(r => `- [${r.id}] ${r.text} @ ${r.due}${r.repeat !== "none" ? " (" + r.repeat + ")" : ""}`).join("\n") || "(yok)";
  const tasks = S.tasks.filter(t => !t.done).slice(0, 40).map(t => `- [${t.id}] ${t.text}${t.date ? " @ " + t.date : ""}${t.project ? " #" + t.project : ""}`).join("\n") || "(yok)";
  const doneToday = S.tasks.filter(t => t.done).slice(-10).map(t => `- [${t.id}] ✔ ${t.text}`).join("\n");
  const notes = S.notes.slice(0, 20).map(n => `- [${n.id}] ${n.text.slice(0, 160)}${n.project ? " #" + n.project : ""}`).join("\n") || "(yok)";
  const mem = S.memory.map(m => `- [${m.id}] ${m.text}`).join("\n") || "(yok)";
  const aud = S.auditions.filter(a => !a.done).map(a => `- [${a.id}] ${a.type}: ${a.title} @ ${a.date || "?"} ${a.place || ""}`).join("\n") || "(yok)";
  const sh = S.shifts.filter(s => s.date >= ymd(new Date(Date.now() - 864e5))).map(s => `- [${s.id}] ${s.date} ${s.start}-${s.end} ${s.place}`).join("\n") || "(yok)";
  const pr = S.projects.map(p => `- ${p.name}: ${p.status || "-"} → ${p.next || "-"} (${p.updated || ""})`).join("\n") || "(yok)";
  const hb = S.habits.map(h => `- ${h.name}: bugün ${h.log.includes(ymd(d)) ? "yapıldı" : "yapılmadı"}, seri ${streak(h)} gün`).join("\n") || "(yok)";
  const geo = S.geo.filter(g => g.active).map(g => `- [${g.id}] ${g.text} @ ${g.place}`).join("\n") || "(yok)";
  const tone = SET.personality === "resmi" ? "Resmi, kibar ve kısa konuş; espri yapma." : "Iron Man'deki JARVIS gibi zeki, sakin, hafif esprili ve sadık ol; ara sıra 'efendim' de.";
  return `Sen JARVIS'sin, ${SET.name}'ın kişisel sesli asistanısın. ${tone}
Burak İstanbul'da yaşayan bir oyuncu; Recast Talent House casting ajansında çalışıyor, Kadıköy'de bir barda gece vardiyaları var, kendi uygulama ve oyunlarını geliştiriyor.
HER ZAMAN Türkçe konuş. Cevapların sesli okunur: kısa ol (genelde 1-3 cümle), markdown, madde işareti, emoji ve link yazma. Brifing/özet istenirse en fazla 6-8 kısa cümle.
Şu an: ${DAYS[d.getDay()]} ${localISO(d)} (Türkiye, UTC+3). "Yarın", "akşam", "2 saat sonra" gibi ifadeleri buna göre kesin zamana çevir; "sabah"=09:00, "öğlen"=12:30, "akşam"=19:00, "gece"=23:00.
EN ÖNEMLİ KURAL: Bir işlem istendiğinde (alarm, hatırlatma, not, görev, arama, mesaj, uygulama açma...) MUTLAKA ilgili aracı çağır. Araç çağırmadan asla "kurdum/ekledim/yaptım" deme; araç sonucu gelmeden işlem yapılmış sayılmaz. "Alarm kur / beni uyandır" → alarm_kur (gerçek Saat uygulaması alarmı). "X dakika sonra/şu saatte hatırlat" → hatirlatici_ekle. Geri sayım → zamanlayici_kur. Kullanıcı metni ses tanımadan geldiği için küçük yazım hataları olabilir; anlamı tahmin et.
Araçlarını gerçekten kullan: bir işi yaptığını söylemeden önce ilgili aracı çağır. Yaptığın işlemi gün ve saatle tek cümlede onayla. Arama/mesaj araçları ekranda onay ister; Burak vazgeçerse saygı göster. Bir araç hata dönerse dürüstçe söyle.
Yapamadığın şeyler (ödeme yapmak, mesajı kendiliğinden göndermek, telefonun ayarlarını değiştirmek gibi) için dürüst ol ve en yakın alternatifi öner.
Burak kalıcı bir bilgi paylaşırsa (ör. "annemin adı ...", "salıları provam var") hafiza_kaydet ile sakla.

KALICI HAFIZA:\n${mem}
HATIRLATICILAR:\n${upc}
KONUM HATIRLATMALARI:\n${geo}
AÇIK GÖREVLER:\n${tasks}${doneToday ? "\nSON TAMAMLANANLAR:\n" + doneToday : ""}
NOTLAR:\n${notes}
SEÇME/ÇEKİMLER:\n${aud}
VARDİYALAR:\n${sh}
PROJELER:\n${pr}
ALIŞKANLIKLAR:\n${hb}
${FOCUS.until > Date.now() ? "ODAK MODU AÇIK: " + Math.round((FOCUS.until - Date.now()) / 6e4) + " dk kaldı" : ""}
RUTİNLER: ${S.routines.map(r => r.name).join(", ") || "(yok)"}
ÖZEL GÜNLER:\n${S.dates.map(x => `- [${x.id}] ${x.name} ${x.kind} ${x.md}`).join("\n") || "(yok)"}
FATURA/ABONELİK:\n${S.bills.map(b => `- [${b.id}] ${b.name} ayın ${b.day}'i ${b.amount ? money(b.amount) : ""}`).join("\n") || "(yok)"}
BAŞVURULAR:\n${S.applications.filter(a => !["olumsuz"].includes(a.status)).slice(-25).map(a => `- [${a.id}] ${a.project}${a.role ? " / " + a.role : ""} · ${a.status} · ${a.date}${a.followUp ? " · takip " + a.followUp : ""}${a.contact ? " · " + a.contact : ""}`).join("\n") || "(yok)"}
HAFTALIK HEDEFLER (${weekKey()}):\n${S.goals.map(g => `- [${g.id}] ${g.text}: ${g.week === weekKey() ? g.count : 0}/${g.target}`).join("\n") || "(yok)"}
BÜTÇE: ${SET.budget > 0 ? `aylık ${money(SET.budget)}, bu ay harcanan ${money(monthSpent())}` : "belirlenmemiş"}
EV KONUMU: ${SET.homeLat ? "kayıtlı" : "kayıtlı değil"} · PARTNER: ${SET.partnerName || "-"}
YETENEKLER: Ekran erişimi ${PERM.a11y ? "açık (ekrani_gor, ekranda_dokun, ekrana_yaz, ekran_hareket kullanılabilir)" : "kapalı"}; bilgisayar ajanı Google bağlantısı üzerinden; internette_ara ile güncel bilgi.
ÇOK ADIMLI İŞLER: "Seçmeye hazırla", "haftamı planla" gibi isteklerde önce gerekeni araçlarla topla (takvim, hava, yol süresi), sonra birden fazla aracı sırayla kullan (hatırlatıcı, görev, not) ve en sonda yaptıklarını kısa bir listeyle söyle.`;
}
function schemaFor(t, upper) {
  const conv = o => {
    if (Array.isArray(o)) return o.map(conv);
    if (!o || typeof o !== "object") return o;
    const r = {}; for (const [k, v] of Object.entries(o)) r[k] = k === "type" && typeof v === "string" ? (upper ? v.toUpperCase() : v.toLowerCase()) : conv(v);
    return r;
  };
  return conv({ type: "object", properties: t.props, required: t.required });
}
async function runTool(name, args) {
  const t = TOOLS.find(t => t.name === name);
  if (!t) return { hata: "Bilinmeyen araç" };
  try { const r = await t.run(args || {}); return r === undefined ? { ok: true } : JSON.parse(JSON.stringify(r)); }
  catch (e) { return { hata: String(e && e.message || e) }; }
}
async function httpJson(url, body, headers = {}) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) { const e = new Error((j && j.error && (j.error.message || j.error.type)) || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return j;
}
const GEMINI_FALLBACK = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
async function askGemini(history, onAct, attach) {
  if (!SET.geminiKey) throw new Error("NOKEY");
  const contents = history.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (attach && attach.length) contents[contents.length - 1].parts.unshift(...attach.map(a => ({ inlineData: { mimeType: a.mime, data: a.data } })));
  const body = () => ({ systemInstruction: { parts: [{ text: systemPrompt() }] }, contents, tools: [{ functionDeclarations: TOOLS.map(t => { const d = { name: t.name, description: t.description }; if (Object.keys(t.props).length) { d.parameters = schemaFor(t, true); if (!t.required.length) delete d.parameters.required; } return d; }) }], generationConfig: { temperature: 0.4, maxOutputTokens: 2048 } });
  const models = [SET.geminiModel, ...GEMINI_FALLBACK.filter(m => m !== SET.geminiModel)];
  let mi = 0;
  for (let step = 0; step < 12; step++) {
    let j;
    for (;;) {
      try { j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${models[mi]}:generateContent?key=${encodeURIComponent(SET.geminiKey)}`, body()); break; }
      catch (e) {
        if ((e.status === 404 || e.status === 429 || e.status === 400 && /model/i.test(e.message)) && mi < models.length - 1) { mi++; continue; }
        if (e.status === 429) throw new Error("Ücretsiz Gemini kotası doldu, biraz sonra tekrar dene.");
        throw e;
      }
    }
    if (mi > 0 && SET.geminiModel !== models[mi]) { SET.geminiModel = models[mi]; saveSet(); }
    const cand = j.candidates && j.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const calls = parts.filter(p => p.functionCall);
    if (!calls.length) return parts.filter(p => p.text && !p.thought).map(p => p.text).join("").trim();
    contents.push(cand.content);
    const responses = [];
    for (const p of calls) { onAct(p.functionCall.name); const res = await runTool(p.functionCall.name, p.functionCall.args); responses.push({ functionResponse: { name: p.functionCall.name, response: { result: res } } }); }
    contents.push({ role: "user", parts: responses });
  }
  return "İşlemleri yaptım.";
}
async function askClaude(history, onAct, smart, attach) {
  if (!SET.claudeKey) throw new Error("NOKEY");
  const messages = history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  if (attach && attach.length) {
    const imgs = attach.filter(a => a.mime.startsWith("image/"));
    if (imgs.length < attach.length) throw new Error("Ses kaydı analizi için Gemini gerekli (Ayarlar → Beyin).");
    const last = messages[messages.length - 1]; last.content = [...imgs.map(a => ({ type: "image", source: { type: "base64", media_type: a.mime, data: a.data } })), { type: "text", text: last.content }];
  }
  const tools = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: schemaFor(t, false) }));
  for (let step = 0; step < 12; step++) {
    const j = await httpJson("https://api.anthropic.com/v1/messages", { model: smart ? SET.claudeSmart : SET.claudeModel, max_tokens: 1200, system: systemPrompt(), messages, tools },
      { "x-api-key": SET.claudeKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
    const uses = (j.content || []).filter(b => b.type === "tool_use");
    if (!uses.length || j.stop_reason !== "tool_use") return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    messages.push({ role: "assistant", content: j.content });
    const results = [];
    for (const u of uses) { onAct(u.name); results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input)) }); }
    messages.push({ role: "user", content: results });
  }
  return "İşlemleri yaptım.";
}
const ACT_TR = { hatirlatici_ekle: "⏰ hatırlatıcı", gorev_ekle: "✅ görev", not_al: "📝 not", hafiza_kaydet: "🧠 hafıza", harcama_ekle: "💸 harcama", takvim_listele: "📅 takvim", takvim_ekle: "📅 takvime ekle", mail_ozeti: "✉️ mail", bildirimleri_oku: "🔔 bildirimler", hava_durumu: "🌤 hava", ara: "📞 arama", whatsapp_mesaj: "💬 WhatsApp", uygulama_ac: "📱 uygulama", konum_hatirlatici_ekle: "📍 konum", odak_baslat: "🎯 odak", secme_ekle: "🎭 seçme", vardiya_ekle: "🍸 vardiya" };

let busy = false;
async function send(text, byVoice = false, attach = null, label = null) {
  text = String(text || "").trim(); if (!text) return;
  if (busy) return toast("Bir saniye, önceki isteği bitiriyorum.");
  go("home");
  if (!attach && pendingAttach.length) { attach = pendingAttach; pendingAttach = []; $("#attachInfo").textContent = ""; label = label || ("📷 " + text); }
  if (text === "__weekly") { text = "Haftalık raporumu ver: bu hafta harcamalarım (kategori bazında), alışkanlık serilerim, tamamlanan görevler, seçme/başvuru durumları ve haftalık hedeflerim. Gelecek hafta için 2 öneri."; label = "📊 Haftalık rapor"; }
  // kesin komutlar (alarm, zamanlayıcı, net hatırlatıcılar): yapay zekâya gitmeden, garantili
  if (!attach && !text.startsWith("__")) {
    let q = null; try { q = await quickCommand(text); } catch (e) { console.warn(e); }
    if (q) {
      bubble("user", text); const sp = bubble("assistant", q.reply);
      const a = document.createElement("div"); a.className = "acts"; a.textContent = q.act + " · doğrudan"; sp.parentElement.appendChild(a);
      CHAT.push({ role: "user", content: text }, { role: "assistant", content: q.reply }); saveChat();
      if (byVoice || SET.speakReplies) await speak(q.reply, byVoice);
      resumeWake(); return;
    }
  }
  // rutin tetikleyicisi: beyne gitmeden doğrudan çalıştır
  if (!attach && !text.startsWith("__")) {
    const r = matchRoutine(text);
    if (r) {
      bubble("user", text); const sp = bubble("assistant", "⚡ " + r.name + "…");
      const res = await runRoutine(r, byVoice);
      sp.textContent = "⚡ " + r.name + (res.adimlar && res.adimlar.length ? ": " + res.adimlar.join(", ") : " tamam.");
      resumeWake(); return;
    }
  }
  const shown = label ? null : (text.startsWith("__") ? null : text);
  let prompt = text;
  if (text === "__brief") prompt = "Günaydın! Günlük brifingimi ver: hava durumu, bugünkü takvim ve hatırlatıcılar, seçme/çekim ve vardiyalar, açık görevler, varsa önemli okunmamış mailler. Sonunda kısa bir motivasyon cümlesi.";
  if (text === "__evening") prompt = "Gün sonu özeti: bugün ne yaptım (tamamlanan görevler, alışkanlıklar, harcamalar), neler kaldı, yarın beni ne bekliyor? Yarın için 1-2 öneri ver.";
  CHAT.push({ role: "user", content: prompt }); saveChat();
  if (shown) bubble("user", shown); else bubble("sys", label || (text === "__brief" ? "☀️ Günlük brifing" : "🌙 Gün sonu özeti"));
  busy = true; setMode("think", "Düşünüyor…");
  const span = bubble("assistant", "…"); const acts = [];
  const onAct = n => { acts.push(ACT_TR[n] || n); span.textContent = "… " + acts.join(" · "); };
  let out = "";
  try {
    const hist = CHAT.slice(-14);
    const smart = /plan|strateji|analiz|detaylı|uzun/i.test(prompt) || text === "__evening";
    const useClaude = SET.provider === "claude" && SET.claudeKey && !(attach && attach.some(a => !a.mime.startsWith("image/")));
    out = useClaude ? await askClaude(hist, onAct, smart, attach) : await askGemini(hist, onAct, attach);
    out = out || "Tamamdır.";
    // Model bir işi "yaptım" deyip aracı hiç çağırmadıysa: bir kez daha, bu sefer aracı kullanmaya zorla
    if (!acts.length && !attach && CMD_RX.test(prompt) && CLAIM_RX.test(out)) {
      const fix = [...hist, { role: "assistant", content: out }, { role: "user", content: "SİSTEM NOTU: Az önceki cevabında hiçbir aracı çağırmadın; yani işlem gerçekte YAPILMADI. Şimdi uygun aracı çağırarak isteği gerçekten yerine getir ve araç sonucuna göre kısa onay ver. Yapamıyorsan bunu açıkça söyle." }];
      const out2 = useClaude ? await askClaude(fix, onAct, smart) : await askGemini(fix, onAct);
      out = acts.length ? (out2 || "Tamamdır.") : "Bunu yapamadım Burak, işlem gerçekleşmedi. Biraz farklı söyler misin? (ör. 'yarın 7:30'a alarm kur')";
    }
  } catch (e) {
    const offline = !navigator.onLine || /failed to fetch|network|timeout|unable to resolve|internet/i.test(String(e.message));
    const local = (offline || e.message === "NOKEY") && !attach ? offlineCommand(prompt) : null;
    if (local) out = (offline ? "(internetsiz mod) " : "") + local;
    else if (e.message === "NOKEY") out = "Beynimi çalıştırmak için ücretsiz bir Gemini API anahtarı gerekli. Ayarlar → Beyin bölümünden ekleyebilirsin.";
    else if (offline) out = "İnternet yok. Hatırlatıcı, not, görev, fener, uygulama açma, arama ve rutinler gibi temel komutları yine yapabilirim.";
    else out = "Bir aksaklık oldu: " + e.message;
  }
  span.textContent = out;
  if (acts.length) { const a = document.createElement("div"); a.className = "acts"; a.textContent = acts.join(" · "); span.parentElement.appendChild(a); }
  CHAT.push({ role: "assistant", content: out }); saveChat();
  busy = false; setMode("", "Hazır");
  if (byVoice || SET.speakReplies) await speak(out, byVoice);
  if (byVoice && SET.followUp && /\?\s*$/.test(out)) { const t = await listen(); if (t) return send(t, true); }
  resumeWake();
}

/* ================= arayüz: sohbet ================= */
function setMode(m, s) { $("#reactor").className = "reactor" + (m ? " " + m : ""); $("#status").textContent = s; }
function bubble(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + (role === "user" ? "u" : role === "sys" ? "sys" : "j");
  if (role === "assistant") el.innerHTML = "<b>JARVIS</b>";
  const s = document.createElement("span"); s.textContent = text; el.appendChild(s);
  $("#log").appendChild(el); $("#log").scrollTop = 1e9; return s;
}
function drawChat() {
  $("#log").innerHTML = "";
  const vis = CHAT.slice(-20);
  if (!vis.length) bubble("assistant", `Merhaba ${SET.name}. Sistemler çevrimiçi. Hatırlatıcı kurabilir, arama yapabilir, bildirimlerini okuyabilir, gününü planlayabilirim. Ne yapalım?`);
  vis.forEach(m => { if (m.content.startsWith("Günaydın! Günlük brifingimi")) bubble("sys", "☀️ Günlük brifing"); else if (m.content.startsWith("Gün sonu özeti:")) bubble("sys", "🌙 Gün sonu özeti"); else bubble(m.role, m.content); });
}

/* ================= arayüz: bölümler ================= */
let CUR = { plan: "reminders", life: "expenses", work: "auditions" };
const FORMS = {
  reminders: () => `<input name="text" placeholder="Ne hatırlatayım?" required><div class="row"><input name="due" type="datetime-local" value="${localISO(new Date(Date.now() + 36e5))}" required><select name="repeat"><option value="none">Tek sefer</option><option value="daily">Her gün</option><option value="weekdays">Hafta içi</option><option value="weekly">Her hafta</option><option value="monthly">Her ay</option></select></div><button class="btn">+ Hatırlatıcı</button>`,
  tasks: () => `<input name="text" placeholder="Yeni görev" required><div class="row"><input name="date" type="date"><input name="project" placeholder="Proje (ops.)"><button class="btn">+</button></div>`,
  notes: () => `<textarea name="text" placeholder="Not yaz…" required style="min-height:70px"></textarea><div class="row"><input name="project" placeholder="Proje (ops.)"><button class="btn">+ Not</button></div>`,
  geo: () => `<input name="text" placeholder="Oraya varınca ne söyleyeyim?" required><div class="row"><input name="place" placeholder="Yer (ör. Kadıköy) veya burası" required><button class="btn">+</button></div><div class="hint">Telefonda "her zaman" konum izni gerekir.</div>`,
  expenses: () => `<div class="row"><input name="amount" type="number" step="0.01" inputmode="decimal" placeholder="Tutar ₺" required><select name="category">${["Yemek", "Market", "Ulaşım", "Kira", "Fatura", "Eğlence", "Kişisel", "Sağlık", "Diğer"].map(c => `<option>${c}</option>`).join("")}</select></div><div class="row"><input name="note" placeholder="Not"><button class="btn">+</button></div>`,
  habits: () => `<div class="row"><input name="name" placeholder="Yeni alışkanlık (ör. Su 2L, Spor, 20 sayfa)" required><button class="btn">+</button></div>`,
  auditions: () => `<input name="title" placeholder="Proje / rol" required><div class="row"><input name="date" type="datetime-local"><select name="type"><option>seçme</option><option>self-tape</option><option>çekim</option><option>prova</option><option>toplantı</option></select></div><div class="row"><input name="place" placeholder="Yer"><button class="btn">+</button></div>`,
  shifts: () => `<div class="row"><input name="date" type="date" value="${ymd(new Date())}" required><input name="start" type="time" value="18:00"><input name="end" type="time" value="02:00"></div><div class="row"><input name="place" value="Kadıköy bar"><button class="btn">+ Vardiya</button></div>`,
  projects: () => `<input name="name" placeholder="Proje adı (ör. Galerici)" required><input name="status" placeholder="Nerede kaldım?"><div class="row"><input name="next" placeholder="Sıradaki adım"><button class="btn">Kaydet</button></div>`
};
const ADD = {
  reminders: f => A.addReminder(f), tasks: f => A.addTask(f), notes: f => A.addNote(f), expenses: f => A.addExpense(f), habits: f => A.addHabit(f),
  auditions: f => A.addAudition(f), shifts: f => A.addShift(f), projects: f => A.upsertProject(f),
  geo: async f => { const r = await addGeo(f); if (r.hata) throw new Error(r.hata); }
};
function itemHTML({ ic = "", h, meta = "", cls = "", ck = null, id, key }) {
  return `<div class="item ${cls}">${ck !== null ? `<button class="ck ${ck ? "on" : ""}" data-ck="${key}:${id}">${ck ? "✓" : ""}</button>` : `<div class="ic">${ic}</div>`}<div class="t"><div class="h">${h}</div>${meta ? `<div class="meta">${meta}</div>` : ""}</div><button class="x" data-del="${key}:${id}">✕</button></div>`;
}
function listHTML(sec) {
  const now = new Date();
  const E = t => `<div class="empty">${t}</div>`;
  switch (sec) {
    case "reminders": {
      const l = S.reminders.filter(r => !r.done).sort((a, b) => a.due.localeCompare(b.due));
      return l.length ? l.map(r => itemHTML({ ic: "⏰", h: esc(r.text), meta: fmtWhen(r.due) + (r.repeat !== "none" ? " · ↻ " + REP[r.repeat] : ""), cls: r.repeat === "none" && parseDate(r.due) < now ? "late" : "", id: r.id, key: "reminders" })).join("") : E("Hatırlatıcı yok. \"Her sabah 9'da su içmeyi hatırlat\" de.");
    }
    case "tasks": {
      const l = [...S.tasks].sort((a, b) => a.done - b.done || (a.date || "9").localeCompare(b.date || "9"));
      return l.length ? l.map(t => itemHTML({ h: esc(t.text), meta: [t.date && fmtWhen(t.date, false), t.project && "#" + esc(t.project)].filter(Boolean).join(" · "), cls: t.done ? "done" : "", ck: t.done, id: t.id, key: "tasks" })).join("") + (S.tasks.some(t => t.done) ? `<button class="btn ghost sm" id="clrDone">Tamamlananları temizle</button>` : "") : E("Görev yok.");
    }
    case "notes": return S.notes.length ? S.notes.map(n => itemHTML({ ic: "📝", h: esc(n.text), meta: fmtWhen(n.created) + (n.project ? " · #" + esc(n.project) : ""), id: n.id, key: "notes" })).join("") : E("Not yok.");
    case "geo": return S.geo.length ? S.geo.map(g => itemHTML({ ic: "📍", h: esc(g.text), meta: esc(g.place) + ` · ${g.radius} m`, id: g.id, key: "geo" })).join("") : E("Konum hatırlatması yok. \"Kadıköy'e varınca bana ekmek almamı hatırlat\" de.");
    case "expenses": {
      const m = A.expenseSummary(30), w = A.expenseSummary(7);
      const cats = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1]);
      const max = cats.length ? cats[0][1] : 1;
      return `<div class="card"><h3>SON 30 GÜN</h3><div class="big">${money(m.total)}</div><div class="meta" style="color:var(--dim)">Son 7 gün: ${money(w.total)}</div>${cats.map(([c, v]) => `<div style="margin-top:8px;font-size:14px">${esc(c)} <span style="float:right">${money(v)}</span><div class="bar"><i style="width:${Math.round(v / max * 100)}%"></i></div></div>`).join("")}</div>` +
        (S.expenses.length ? S.expenses.slice(0, 60).map(e => itemHTML({ ic: "💸", h: `${money(e.amount)} · ${esc(e.category)}`, meta: fmtWhen(e.date, false) + (e.note ? " · " + esc(e.note) : ""), id: e.id, key: "expenses" })).join("") : E("Harcama yok. \"Bugün 250 lira yemeğe verdim\" de."));
    }
    case "habits": {
      if (!S.habits.length) return E("Alışkanlık yok.");
      return S.habits.map(h => {
        const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return `<span class="${h.log.includes(ymd(d)) ? "on" : ""}">${DAYS[d.getDay()][0]}</span>`; }).join("");
        const today = h.log.includes(ymd(new Date()));
        return `<div class="item"><button class="ck ${today ? "on" : ""}" data-habit="${h.id}">${today ? "✓" : ""}</button><div class="t"><div class="h">${esc(h.name)}</div><div class="meta">🔥 ${streak(h)} gün seri</div><div class="dots">${days}</div></div><button class="x" data-del="habits:${h.id}">✕</button></div>`;
      }).join("");
    }
    case "focus": {
      if (FOCUS.until > Date.now()) return `<div class="card"><div class="focusring"><span id="focusLeft">--:--</span><small>${esc(FOCUS.label)}</small></div><button class="btn warn" id="focusStop" style="width:100%">Bitir</button><div class="hint">Rahatsız etme modu açık (izin verdiysen). Süre bitince alarm çalar.</div></div>`;
      return `<div class="card"><h3>ODAK MODU</h3><div class="form"><input id="focusLabel" placeholder="Ne üzerinde çalışacaksın?"><div class="row">${[25, 45, 60, 90].map(m => `<button class="btn ghost" data-focus="${m}">${m} dk</button>`).join("")}</div></div><div class="hint">Bildirimleri susturur, bitince haber verir. "JARVIS, 45 dakika odak başlat" da diyebilirsin.</div></div>`;
    }
    case "auditions": {
      const l = [...S.auditions].sort((a, b) => a.done - b.done || (a.date || "9").localeCompare(b.date || "9"));
      return l.length ? l.map(a => itemHTML({ h: `${esc(a.title)}`, meta: [a.type, a.date && fmtWhen(a.date), a.place && esc(a.place)].filter(Boolean).join(" · "), cls: a.done ? "done" : "", ck: a.done, id: a.id, key: "auditions" })).join("") : E("Seçme/çekim yok. Bir gün önce akşam ve 2 saat önce hatırlatırım.");
    }
    case "shifts": {
      const l = S.shifts.filter(s => s.date >= ymd(new Date(Date.now() - 2 * 864e5))).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      return l.length ? l.map(s => itemHTML({ ic: "🍸", h: `${fmtWhen(s.date, false)} · ${s.start}–${s.end}`, meta: esc(s.place), id: s.id, key: "shifts" })).join("") : E("Vardiya yok. 1 saat önce ve bitişte eve dönüş için hatırlatırım.");
    }
    case "projects": return S.projects.length ? S.projects.map(p => itemHTML({ ic: "🛠", h: esc(p.name), meta: `${esc(p.status || "-")}${p.next ? " → " + esc(p.next) : ""}${p.updated ? " · " + fmtWhen(p.updated, false) : ""}`, id: p.id, key: "projects" })).join("") : E("Proje yok. \"Galerici'de araç satın alma ekranında kaldım\" de, kaydederim.");
    case "lines": return linesHTML();
  }
  return "";
}
const GROUP_EL = { plan: "#b-plan", life: "#b-life", work: "#b-work" };
function renderSec(group) {
  const sec = CUR[group], el = $(GROUP_EL[group]); if (!el) return;
  const form = FORMS[sec] ? `<div class="card"><form class="form" data-add="${sec}">${FORMS[sec]()}</form></div>` : "";
  el.innerHTML = (sec === "expenses" || sec === "focus" || sec === "lines" ? "" : form) + listHTML(sec) + (sec === "expenses" ? form : "");
  if (sec === "focus") tickFocus();
  if (sec === "lines") bindLines();
}
function openSec(group, sec) {
  CUR[group] = sec;
  document.querySelectorAll(`.seg[data-group="${group}"] button`).forEach(b => b.classList.toggle("on", b.dataset.sec === sec));
  renderSec(group);
}
function renderAll() { renderSec("plan"); renderSec("life"); renderSec("work"); }
function go(v) {
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
  document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  if (v === "set") renderSettings();
}

/* ================= replik çalışma ================= */
let LINES = { script: "", me: "", list: [], idx: -1, running: false };
function parseScript(txt) {
  const out = []; let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    const m = l.match(/^([A-ZÇĞİÖŞÜa-zçğıöşü0-9 .'-]{1,30})\s*[:：]\s*(.+)$/);
    if (m) { cur = { who: m[1].trim(), text: m[2].trim() }; out.push(cur); }
    else if (/^[A-ZÇĞİÖŞÜ0-9 .'-]{2,30}$/.test(l)) { cur = { who: l, text: "" }; out.push(cur); }
    else if (cur) cur.text += (cur.text ? " " : "") + l;
  }
  return out.filter(x => x.text);
}
function linesHTML() {
  const chars = [...new Set(LINES.list.map(l => l.who))];
  return `<div class="card"><h3>REPLİK ÇALIŞMA</h3><div class="form">
    <textarea id="lnScript" placeholder="Sahneyi yapıştır. Her satır 'KARAKTER: replik' şeklinde olsun.">${esc(LINES.script)}</textarea>
    <div class="row"><button class="btn ghost" id="lnParse">Ayrıştır</button><select id="lnMe">${chars.length ? chars.map(c => `<option ${c === LINES.me ? "selected" : ""}>${esc(c)}</option>`).join("") : "<option>— önce ayrıştır —</option>"}</select></div>
    <div class="row"><button class="btn" id="lnStart" ${LINES.list.length ? "" : "disabled"}>${LINES.running ? "Durdur" : "▶ Başla"}</button></div>
    <div class="hint">Diğer karakterleri ben okurum; senin replik sırana gelince dinlerim, söyledikten sonra devam ederim.</div></div></div>
    <div id="lnList">${LINES.list.map((l, i) => `<div class="line ${l.who === LINES.me ? "me" : ""} ${i === LINES.idx ? "cur" : ""}"><b>${esc(l.who)}</b>${esc(l.text)}</div>`).join("")}</div>`;
}
function bindLines() {
  const p = $("#lnParse"); if (!p) return;
  p.onclick = () => { LINES.script = $("#lnScript").value; LINES.list = parseScript(LINES.script); { const nm = trLower(SET.name); const mine = LINES.list.find(l => trLower(l.who) === nm); LINES.me = mine ? mine.who : (LINES.list[0] ? LINES.list[0].who : ""); } LINES.idx = -1; renderSec("work"); if (!LINES.list.length) toast("Replik bulunamadı. 'AD: replik' biçimini kullan."); };
  $("#lnMe").onchange = e => { LINES.me = e.target.value; renderSec("work"); };
  $("#lnStart").onclick = () => LINES.running ? (LINES.running = false, stopSpeaking(), stopListen()) : runLines();
}
async function runLines() {
  LINES.running = true; renderSec("work");
  for (let i = 0; i < LINES.list.length && LINES.running; i++) {
    LINES.idx = i; renderSec("work");
    const cur = document.querySelector(".line.cur"); if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
    const l = LINES.list[i];
    if (l.who === LINES.me) { await sleep(250); const heard = await listen(); if (!heard && LINES.running) { toast("Duyamadım, replik: " + l.text.slice(0, 60)); await speak("Replik: " + l.text, true); } }
    else await speak(l.text, true);
  }
  LINES.running = false; LINES.idx = -1; renderSec("work"); toast("Sahne bitti 👏");
}

/* ================= ayarlar ================= */
let PERM = {};
async function renderSettings() {
  if (Jarvis) PERM = await nat(() => Jarvis.permissionsStatus(), {}) || {};
  if (!voices.length) await loadVoices();
  const trV = voices.filter(v => /^tr/i.test(v.lang));
  const vOpts = `<option value="-1">Varsayılan Türkçe</option>` + (trV.length ? trV : voices).map(v => `<option value="${v.i}" ${v.i === SET.voiceIdx ? "selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("");
  const P = (k, label, sub) => `<div class="perm"><span>${label}<br><small style="color:var(--dim)">${sub}</small></span>${PERM[k] ? `<span class="ok">✓ Açık</span>` : `<button class="btn sm" data-perm="${k}">İzin ver</button>`}</div>`;
  const tg = (k, label, sub) => `<label class="toggle"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" class="sw" data-set="${k}" ${SET[k] ? "checked" : ""}></label>`;
  $("#b-set").innerHTML = `
  <div class="card"><h3>BEYİN</h3><div class="form">
    <select data-set="provider"><option value="gemini" ${SET.provider === "gemini" ? "selected" : ""}>Google Gemini (ücretsiz)</option><option value="claude" ${SET.provider === "claude" ? "selected" : ""}>Claude (ücretli, daha akıllı)</option></select>
    <div class="lbl">Gemini API anahtarı</div><input data-set="geminiKey" type="password" value="${esc(SET.geminiKey)}" placeholder="AIza…">
    <div class="lbl">Gemini modeli</div><input data-set="geminiModel" value="${esc(SET.geminiModel)}">
    <div class="hint">Ücretsiz anahtar: aistudio.google.com → "Get API key". Kart gerekmez.</div>
    <div class="lbl">Claude API anahtarı (ileride)</div><input data-set="claudeKey" type="password" value="${esc(SET.claudeKey)}" placeholder="sk-ant-…">
    <button class="btn ghost sm" id="testBrain">Bağlantıyı test et</button></div></div>

  <div class="card"><h3>SES</h3>
    ${tg("speakReplies", "Cevapları sesli oku")}
    ${tg("followUp", "Soru sorunca otomatik dinle", "Kesintisiz sohbet")}
    <div class="form" style="margin-top:6px"><div class="lbl">Ses</div><select data-set="voiceIdx">${vOpts}</select>
    <div class="row"><div><div class="lbl">Hız ${SET.rate}</div><input type="range" min="0.6" max="1.6" step="0.05" data-set="rate" value="${SET.rate}"></div><div><div class="lbl">Ton ${SET.pitch}</div><input type="range" min="0.5" max="1.5" step="0.05" data-set="pitch" value="${SET.pitch}"></div></div>
    <select data-set="personality"><option value="esprili" ${SET.personality === "esprili" ? "selected" : ""}>Kişilik: Esprili Jarvis</option><option value="resmi" ${SET.personality === "resmi" ? "selected" : ""}>Kişilik: Resmi</option></select>
    <button class="btn ghost sm" id="testVoice">Sesi dene</button>
    <div class="hint">Daha doğal ses için telefonda Ayarlar → Metin okuma → Google motoru → Türkçe ses verilerini indir.</div></div></div>

  <div class="card"><h3>HEY JARVIS</h3>
    ${tg("wake", "Uyandırma kelimesi", "Ekran kapalıyken bile \"Hey Jarvis\" dinler. İlk açılışta ~40 MB ses modeli iner. Pil kullanır.")}
    <div class="hint" id="wakeStatus">${NATIVE ? "" : "Sadece Android uygulamasında çalışır."}</div></div>

  <div class="card"><h3>BRİFİNG</h3>
    ${tg("briefOn", "Sabah brifingi bildirimi")}
    <div class="row"><div><div class="lbl">Sabah</div><input type="time" data-set="briefTime" value="${esc(SET.briefTime)}"></div><div><div class="lbl">Gün sonu (boş=kapalı)</div><input type="time" data-set="eveningTime" value="${esc(SET.eveningTime)}"></div></div>
    <div class="lbl">Şehir (hava durumu)</div><div class="row"><input id="cityIn" value="${esc(SET.city)}"><button class="btn ghost sm" id="citySave">Kaydet</button></div></div>

  <div class="card"><h3>İZİNLER</h3>
    ${NATIVE ? [P("notifications", "Bildirim", "Hatırlatıcılar için"), P("exactAlarm", "Tam zamanlı alarm", "Alarmlar dakikasında çalsın"), P("microphone", "Mikrofon", "Sesli komut"), P("contacts", "Rehber", "\"Annemi ara\""), P("phone", "Telefon", "Doğrudan arama"), P("notificationAccess", "Bildirim erişimi", "Gelen bildirimleri okuma"), P("dndAccess", "Rahatsız etme erişimi", "Odak modu"), P("location", "Konum", "Konum hatırlatmaları"), P("backgroundLocation", "Konum: her zaman", "Uygulama kapalıyken konum hatırlatması"), P("overlay", "Diğer uygulamaların üzerinde", "Hey Jarvis ile ekranı açabilmek"), P("battery", "Pil kısıtlamasız", "Arka planda kapanmasın")].join("") : `<div class="hint">İzinler Android uygulamasında görünür.</div>`}
  </div>

  <div class="card"><h3>GOOGLE (SENKRON · GMAIL · TAKVİM)</h3><div class="form">
    <div class="lbl">Apps Script web uygulaması URL</div><input data-set="scriptUrl" value="${esc(SET.scriptUrl)}" placeholder="https://script.google.com/macros/s/…/exec">
    <div class="lbl">Gizli anahtar (Code.gs içindeki TOKEN)</div><input data-set="scriptToken" type="password" value="${esc(SET.scriptToken)}">
    <div class="row"><button class="btn ghost sm" id="testScript">Test et</button><button class="btn ghost sm" id="syncNow">Şimdi senkronla</button></div>
    <div class="hint">Telefon, tablet ve bilgisayar aynı veriyi görür. Kurulum: README → Google bölümü.</div></div></div>

  <div class="card"><h3>HAFIZA (${S.memory.length})</h3>
    ${S.memory.length ? S.memory.map(m => itemHTML({ ic: "🧠", h: esc(m.text), meta: m.created, id: m.id, key: "memory" })).join("") : `<div class="empty">Henüz bir şey kaydetmedim. "Annemin adı Ayşe, unutma" diyebilirsin.</div>`}
    <form class="form" data-add-mem><div class="row"><input name="text" placeholder="Elle ekle"><button class="btn">+</button></div></form></div>

  <div class="card"><h3>VERİ</h3><div class="row"><button class="btn ghost sm" id="exportBtn">Yedeği kopyala</button><button class="btn ghost sm" id="importBtn">Yedeği yükle</button><button class="btn ghost sm" id="clearChat">Sohbeti sil</button></div>
    <div class="hint">JARVIS v1.3 · ${NATIVE ? "Android" : "Web"} · Tüm veriler cihazında.</div></div>`;
  if (Jarvis) nat(() => Jarvis.wakeStatus()).then(r => r && showWake(r));
}
function showWake(r) {
  const el = $("#wakeStatus"); if (!el || !r) return;
  const M = { off: "Kapalı", downloading: `Ses modeli indiriliyor… ${r.progress || 0}%`, loading: "Model yükleniyor…", listening: "🟢 Dinliyor: \"Hey Jarvis\" de.", paused: "Duraklatıldı (konuşma sırasında)", error: "Hata: " + (r.error || "") };
  el.textContent = M[r.status] || r.status;
}
async function onSetChange(el) {
  const k = el.dataset.set; let v = el.type === "checkbox" ? el.checked : el.value;
  if (["rate", "pitch"].includes(k)) v = Number(v);
  if (k === "voiceIdx") v = Number(v);
  if (k === "geminiKey" || k === "claudeKey" || k === "scriptUrl" || k === "scriptToken" || k === "geminiModel") v = String(v).trim();
  SET[k] = v; await saveSet();
  if (k === "wake") {
    if (v) {
      const r = await nat(() => Jarvis.startWake(), null);
      if (!r || !r.ok) { SET.wake = false; saveSet(); el.checked = false; toast((r && r.error) || "Uyandırma başlatılamadı. Mikrofon ve bildirim iznini kontrol et."); }
    } else nat(() => Jarvis && Jarvis.stopWake());
  }
  if (["briefOn", "briefTime", "eveningTime"].includes(k)) reschedule();
  if (k === "rate" || k === "pitch") renderSettings();
}

/* ================= izinler ================= */
async function askPerm(name) {
  if (name === "notifications") { await nat(() => LN.requestPermissions()); await nat(() => Jarvis.ensureChannel()); }
  else if (name === "exactAlarm") await nat(() => LN.changeExactNotificationSetting());
  else await nat(() => Jarvis.requestPerm({ name }));
  setTimeout(renderSettings, 800);
}

/* ================= widget ================= */
function updateWidget() {
  if (!Jarvis) return;
  const next = S.reminders.filter(r => !r.done && parseDate(r.due) > new Date()).sort((a, b) => a.due.localeCompare(b.due))[0];
  const open = S.tasks.filter(t => !t.done).length;
  nat(() => Jarvis.updateWidget({ line1: next ? `⏰ ${fmtWhen(next.due)} · ${next.text}` : "Yaklaşan hatırlatıcı yok", line2: `${open} açık görev · Konuşmak için dokun` }));
}

/* ================= olaylar ================= */
function bind() {
  $("#inbar").onsubmit = e => { e.preventDefault(); const t = $("#q").value.trim(); $("#q").value = ""; if (t) send(t); };
  $("#mic").onclick = () => listening ? stopListen() : voiceTurn(false);
  $("#reactor").onclick = () => speaking ? stopSpeaking().then(() => voiceTurn(false)) : listening ? stopListen() : voiceTurn(false);
  document.querySelectorAll(".chip").forEach(c => c.onclick = () => send(c.dataset.q));
  document.querySelectorAll(".tabbar button").forEach(b => b.onclick = () => go(b.dataset.view));
  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => openSec(b.parentElement.dataset.group, b.dataset.sec));
  document.addEventListener("submit", async e => {
    const f = e.target;
    if (f.dataset.add) {
      e.preventDefault(); const data = Object.fromEntries(new FormData(f));
      try { await ADD[f.dataset.add](data); toast("Eklendi ✓"); } catch (err) { toast(err.message); }
    } else if (f.hasAttribute("data-add-mem")) { e.preventDefault(); const t = new FormData(f).get("text"); if (t) { A.addMemory({ text: t }); renderSettings(); } }
  });
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-del],[data-ck],[data-habit],[data-focus],[data-perm],#focusStop,#clrDone,#testVoice,#testBrain,#testScript,#syncNow,#exportBtn,#importBtn,#clearChat,#citySave");
    if (!t) return;
    if (t.dataset.del) {
      const [key, id] = t.dataset.del.split(":");
      if (key === "geo" && Jarvis) nat(() => Jarvis.removeGeofence({ id }));
      A.del(key, id); if (key === "memory") renderSettings();
    } else if (t.dataset.ck) {
      const [key, id] = t.dataset.ck.split(":"); const x = S[key].find(x => x.id === id); if (x) { x.done = !x.done; save(); }
    } else if (t.dataset.habit) A.markHabit({ id: t.dataset.habit });
    else if (t.dataset.focus) startFocus(Number(t.dataset.focus), ($("#focusLabel") && $("#focusLabel").value) || "Odak");
    else if (t.dataset.perm) askPerm(t.dataset.perm);
    else if (t.id === "focusStop") endFocus(true);
    else if (t.id === "clrDone") { S.tasks = S.tasks.filter(x => !x.done); save(); }
    else if (t.id === "testVoice") speak(`Merhaba ${SET.name}, ben JARVIS. Ses ayarlarım böyle.`, true);
    else if (t.id === "testBrain") { toast("Test ediliyor…"); try { const r = SET.provider === "claude" ? await askClaude([{ role: "user", content: "Sadece 'Bağlantı tamam' de." }], () => {}) : await askGemini([{ role: "user", content: "Sadece 'Bağlantı tamam' de." }], () => {}); toast("✓ " + r); } catch (er) { toast("✗ " + (er.message === "NOKEY" ? "Anahtar yok" : er.message), 5000); } }
    else if (t.id === "testScript") { try { const r = await script("ping"); toast("✓ Google bağlı: " + (r.email || "")); } catch (er) { toast("✗ " + er.message, 5000); } }
    else if (t.id === "syncNow") { await pushSync(); await pullSync(); toast("Senkron tamam"); }
    else if (t.id === "exportBtn") { try { await navigator.clipboard.writeText(JSON.stringify(S)); toast("Yedek panoya kopyalandı"); } catch { infoBox("YEDEK", `<textarea style="width:100%;min-height:200px">${esc(JSON.stringify(S))}</textarea>`); } }
    else if (t.id === "importBtn") {
      $("#modalBox").innerHTML = `<h2>YEDEĞİ YÜKLE</h2><textarea id="impTxt" style="width:100%;min-height:160px" placeholder="Yedek metnini yapıştır"></textarea><div class="row" style="margin-top:10px"><button class="btn ghost" id="mNo">Vazgeç</button><button class="btn" id="mYes">Yükle</button></div>`;
      $("#modal").classList.add("on"); $("#mNo").onclick = () => $("#modal").classList.remove("on");
      $("#mYes").onclick = () => { try { S = Object.assign(EMPTY(), JSON.parse($("#impTxt").value)); save(); $("#modal").classList.remove("on"); toast("Yüklendi"); } catch { toast("Geçersiz yedek"); } };
    }
    else if (t.id === "clearChat") { CHAT = []; saveChat(); drawChat(); toast("Sohbet silindi"); }
    else if (t.id === "citySave") { try { const g = await geocode($("#cityIn").value); SET.city = g.name.split(",")[0]; SET.lat = g.lat; SET.lng = g.lng; saveSet(); toast("Şehir: " + g.name); } catch (er) { toast(er.message); } }
  });
  document.addEventListener("change", e => { if (e.target.dataset && e.target.dataset.set) onSetChange(e.target); });
}
async function handleLaunch(action) {
  if (!action) return;
  if (action === "wake") { go("home"); voiceTurn(true); }
  else if (action === "listen") { go("home"); voiceTurn(false); }
  else if (action === "brief") send("__brief", true);
  else if (action === "evening") send("__evening", true);
  else if (action === "focusEnd") endFocus();
}

/* ================= saat ================= */
function clock() {
  const d = new Date();
  $("#clk").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $("#dt").textContent = `${d.getDate()} ${MONTHS[d.getMonth()]} ${DAYS[d.getDay()]}`;
}

/* =====================================================================
   FAZ 1 + FAZ 2 MODÜLLERİ
   ===================================================================== */

/* ================= meta (cihaza özel, senkronlanmaz) ================= */
let META = { lastProactive: 0, lastNudgeDay: "", rain: null, lastLines: 0, unlockedAt: 0, seeded: false };
const saveMeta = () => kvSet("jarvis_meta", JSON.stringify(META));
const weekKey = (d = new Date()) => { const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); const w1 = new Date(t.getFullYear(), 0, 4); return t.getFullYear() + "-W" + pad(1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7)); };
const monthKey = (d = new Date()) => ymd(d).slice(0, 7);
const normTxt = s => trLower(s).replace(/[.,!?;:'"’]/g, " ").replace(/\s+/g, " ").trim();

/* ================= yeni iş mantığı ================= */
Object.assign(A, {
  addDate({ name, date, kind = "doğum günü", note = "" }) {
    const t = String(date || "").trim(); let mm, dd, m;
    if ((m = t.match(/^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/))) { mm = m[1]; dd = m[2]; }
    else if ((m = t.match(/^(\d{1,2})[./](\d{1,2})/))) { dd = m[1]; mm = m[2]; }
    else throw new Error("Tarih anlaşılmadı (AA-GG ya da GG.AA)");
    const x = { id: uid(), name, md: `${pad(+mm)}-${pad(+dd)}`, kind, note }; S.dates.push(x); save(); return x;
  },
  addBill({ name, amount = 0, day, kind = "fatura" }) {
    const d = Math.max(1, Math.min(31, Number(day) || 1)); const b = { id: uid(), name, amount: Number(amount) || 0, day: d, kind }; S.bills.push(b); save(); return b;
  },
  addApplication({ project, role = "", contact = "", status = "başvuruldu", date, followUp }) {
    const d = date || ymd(new Date());
    const f = followUp || ymd(new Date(parseDate(d).getTime() + 7 * 864e5));
    const a = { id: uid(), project, role, contact, status, date: d, followUp: f, log: [{ date: d, status }] }; S.applications.push(a); save(); return a;
  },
  updateApplication({ id, project, status, followUp, note }) {
    const a = S.applications.find(a => a.id === id) || S.applications.find(a => project && trLower(a.project).includes(trLower(project)));
    if (!a) throw new Error("Başvuru bulunamadı");
    if (status) { a.status = status; a.log.push({ date: ymd(new Date()), status, note: note || "" }); }
    if (followUp) a.followUp = followUp;
    if (["olumsuz", "kabul"].includes(status)) a.followUp = "";
    save(); return a;
  },
  addGoal({ text, target = 1 }) { const g = { id: uid(), text, target: Math.max(1, Number(target) || 1), week: weekKey(), count: 0, history: [] }; S.goals.push(g); save(); return g; },
  bumpGoal({ id, text, by = 1 }) {
    rollGoals(); const g = S.goals.find(g => g.id === id) || S.goals.find(g => trLower(g.text).includes(trLower(text || "")));
    if (!g) throw new Error("Hedef bulunamadı"); g.count = Math.max(0, g.count + (Number(by) || 1)); save(); return { text: g.text, count: g.count, target: g.target };
  },
  addRoutine({ name, triggers = [], steps = [] }) {
    const r = { id: uid(), name, triggers: (triggers.length ? triggers : [name]).map(normTxt), steps }; S.routines.push(r); save(); return r;
  }
});
function rollGoals() {
  const wk = weekKey(); let ch = false;
  for (const g of S.goals) if (g.week !== wk) { g.history = (g.history || []).concat([{ week: g.week, count: g.count, target: g.target }]).slice(-12); g.week = wk; g.count = 0; ch = true; }
  if (ch) save();
}
function monthSpent() { const mk = monthKey(); return S.expenses.filter(e => e.date.startsWith(mk)).reduce((s, e) => s + e.amount, 0); }
function budgetNote() {
  if (!(SET.budget > 0)) return null; const sp = monthSpent(), p = sp / SET.budget;
  if (p >= 1) return `Bu ayki bütçeyi aştın: ${money(sp)} / ${money(SET.budget)}.`;
  if (p >= 0.8) return `Bütçenin %${Math.round(p * 100)}'ini kullandın (${money(sp)} / ${money(SET.budget)}).`;
  return null;
}
const _addExpense = A.addExpense;
A.addExpense = f => { const e = _addExpense(f); const n = budgetNote(); if (n) { toast("⚠️ " + n, 4000); e.uyari = n; } return e; };
function nextDateOf(md) { const [m, d] = md.split("-").map(Number); const now = new Date(); let x = new Date(now.getFullYear(), m - 1, d, 9, 0); if (x < new Date(now.getFullYear(), now.getMonth(), now.getDate())) x = new Date(now.getFullYear() + 1, m - 1, d, 9, 0); return x; }
function nextBillDate(day, from = new Date()) {
  const mk = (y, mo) => { const last = new Date(y, mo + 1, 0).getDate(); return new Date(y, mo, Math.min(day, last), 10, 0); };
  let x = mk(from.getFullYear(), from.getMonth());
  if (x < new Date(from.getFullYear(), from.getMonth(), from.getDate())) x = mk(from.getFullYear(), from.getMonth() + 1);
  return x;
}

/* ================= ek bildirimler ================= */
function extraNotifications(N, now) {
  for (const b of S.bills) {
    let due = nextBillDate(b.day);
    for (let k = 0; k < 2; k++) {
      const pre = new Date(due.getTime() - 2 * 864e5); pre.setHours(10, 0, 0, 0);
      if (pre > now) N("b" + b.id + k, `${b.kind === "abonelik" ? "Abonelik" : "Fatura"}: ${b.name}`, `2 gün sonra${b.amount ? " · " + money(b.amount) : ""}`, { at: pre });
      due = nextBillDate(b.day, new Date(due.getFullYear(), due.getMonth() + 1, 1));
    }
  }
  for (const x of S.dates) {
    const d = nextDateOf(x.md); const pre = new Date(d.getTime() - 3 * 864e5); pre.setHours(10, 0, 0, 0);
    if (pre > now) N("d1" + x.id, `3 gün sonra: ${x.name} (${x.kind})`, "Hediye ya da plan fikri ister misin? Dokun, JARVIS'e sor.", { at: pre }, { action: "ask:" + `${x.name} için ${x.kind} hediye ve kutlama fikri ver.` });
    if (d > now) N("d2" + x.id, `Bugün ${x.name} için ${x.kind} 🎉`, x.note || "Aramayı ya da mesaj atmayı unutma.", { at: d });
  }
  for (const a of S.applications) {
    if (!a.followUp || ["olumsuz", "kabul"].includes(a.status)) continue;
    const f = parseDate(a.followUp + "T11:00"); if (f && f > now) N("ap" + a.id, `Takip: ${a.project}`, `${a.contact || "Casting"}'e dönüş için yazma zamanı. Durum: ${a.status}`, { at: f });
  }
  for (const a of S.auditions) {
    if (a.done || !a.leaveAt) continue; const l = parseDate(a.leaveAt);
    if (l && l > now) N("lv" + a.id, `Çıkma vakti: ${a.title}`, `${a.place} · yol yaklaşık ${a.travelMin} dk`, { at: l });
  }
  if (SET.proactive) {
    N("weekly", "Haftalık rapor hazır 📊", "Harcamalar, alışkanlıklar ve bu hafta yaptıkların.", { on: { weekday: 1, hour: 20, minute: 0 } }, { action: "weekly" });
    if (META.rain && META.rain.at && new Date(META.rain.at) > now) N("rain", `Yarın yağmur %${META.rain.prob} ☔`, "Şemsiyeni kapının yanına koy.", { at: new Date(META.rain.at) });
  }
}

/* ================= proaktif JARVIS ================= */
async function proactive(force = false) {
  if (!SET.proactive) return;
  const now = Date.now();
  if (!force && now - META.lastProactive < 3 * 36e5) return;
  META.lastProactive = now; saveMeta();
  // 1) yağmur uyarısı
  try {
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${SET.lat}&longitude=${SET.lng}&daily=precipitation_probability_max&timezone=Europe%2FIstanbul&forecast_days=2`).then(r => r.json());
    const p = w.daily.precipitation_probability_max[1];
    if (p >= 60) {
      const eve = new Date(); eve.setHours(21, 30, 0, 0);
      let at = eve; if (eve < new Date()) { const [h, m] = (SET.briefTime || "08:30").split(":").map(Number); at = new Date(); at.setDate(at.getDate() + 1); at.setHours(h, Math.max(0, m - 15), 0, 0); }
      META.rain = { prob: p, at: at.toISOString() };
    } else META.rain = null;
    saveMeta(); reschedule();
  } catch {}
  // 2) uygulama içi dürtmeler (günde bir)
  const today = ymd(new Date());
  if (META.lastNudgeDay === today) return;
  const nudges = [];
  const stale = S.tasks.filter(t => !t.done && !t.date && t.created && (now - parseDate(t.created)) > 3 * 864e5);
  if (stale.length) nudges.push(`${stale.length} görev 3 günden uzun süredir bekliyor: ${stale.slice(0, 3).map(t => t.text).join(", ")}. Bugün birini bitirelim mi?`);
  const tmr = ymd(new Date(now + 864e5));
  const aud = S.auditions.find(a => !a.done && a.date && a.date.slice(0, 10) === tmr);
  if (aud && now - META.lastLines > 864e5) nudges.push(`Yarın ${aud.type}: ${aud.title}. Bu akşam repliği birlikte çalışalım mı? Kariyer → Replik'e yapıştırman yeterli.`);
  const bn = budgetNote(); if (bn) nudges.push(bn);
  const soonDate = S.dates.find(x => { const d = nextDateOf(x.md); return d - now < 4 * 864e5 && d - now > 0; });
  if (soonDate) nudges.push(`${fmtWhen(ymd(nextDateOf(soonDate.md)), false)} ${soonDate.name} için ${soonDate.kind}. Bir plan yapalım mı?`);
  rollGoals();
  const g = S.goals.filter(g => g.count < g.target); const dow = new Date().getDay();
  if (g.length && (dow === 4 || dow === 5)) nudges.push(`Haftalık hedeflerde eksik var: ${g.map(x => `${x.text} ${x.count}/${x.target}`).join(", ")}.`);
  const ff = S.applications.filter(a => a.followUp && a.followUp <= today && !["olumsuz", "kabul"].includes(a.status));
  if (ff.length) nudges.push(`Takip zamanı gelen başvurular: ${ff.map(a => a.project).join(", ")}. Mail taslağı hazırlayayım mı?`);
  if (nudges.length) { META.lastNudgeDay = today; saveMeta(); bubble("assistant", "💡 " + nudges.join("\n💡 ")); }
}

/* ================= rutinler ================= */
const STEP_TR = { dnd: "Rahatsız etme", torch: "Fener", speak: "Söyle", reminder: "Hatırlatıcı", shiftEnd: "Vardiya bitişine alarm", whatsapp: "WhatsApp", app: "Uygulama aç", focus: "Odak", brief: "Brifing", plan: "Yarının planı", sleep: "Uyku modu", webhook: "Akıllı ev", url: "Link aç", wake: "Hey Jarvis" };
function seedRoutines() {
  if (META.seeded || S.routines.length) { META.seeded = true; saveMeta(); return; }
  const P = SET.partnerName || "Kübra";
  S.routines.push(
    { id: uid(), name: "Vardiyaya çıkıyorum", triggers: ["vardiyaya çıkıyorum", "vardiyaya gidiyorum", "işe çıkıyorum"], steps: [{ type: "dnd", on: true }, { type: "shiftEnd" }, { type: "whatsapp", kim: P, mesaj: "Vardiyaya çıktım, bitince yazarım ❤️" }, { type: "speak", text: "İyi vardiyalar Burak. Bitişte eve dönüş için haber vereceğim." }] },
    { id: uid(), name: "Eve geldim", triggers: ["eve geldim", "evdeyim", "eve vardım"], steps: [{ type: "dnd", on: false }, { type: "whatsapp", kim: P, mesaj: "Eve vardım 🏠" }, { type: "plan" }] },
    { id: uid(), name: "İyi geceler", triggers: ["iyi geceler", "yatıyorum", "uyku modu"], steps: [{ type: "sleep" }] },
    { id: uid(), name: "Günaydın", triggers: ["günaydın jarvis", "günaydın"], steps: [{ type: "dnd", on: false }, { type: "brief" }] }
  );
  META.seeded = true; saveMeta(); save();
}
function matchRoutine(text) {
  const t = normTxt(text);
  return S.routines.find(r => (r.triggers || []).some(tr => tr && (t === tr || (t.length < tr.length + 12 && t.includes(tr)))));
}
async function runRoutine(r, byVoice = false) {
  const done = [];
  for (const s of r.steps) {
    try {
      if (s.type === "dnd") { if (Jarvis) { const d = await Jarvis.dnd({ on: !!s.on }); if (d && d.ok) done.push(s.on ? "sessize aldım" : "sesi açtım"); } }
      else if (s.type === "torch") { if (Jarvis) await Jarvis.torch({ on: !!s.on }); }
      else if (s.type === "speak") await speak(s.text, true);
      else if (s.type === "reminder") { A.addReminder({ text: s.text || r.name, due: localISO(new Date(Date.now() + (Number(s.minutes) || 60) * 6e4)) }); done.push("hatırlatıcı kurdum"); }
      else if (s.type === "shiftEnd") {
        const today = ymd(new Date()); const sh = S.shifts.find(x => x.date === today) || S.shifts.find(x => x.date === ymd(new Date(Date.now() - 864e5)));
        let end = sh ? parseDate(sh.date + "T" + sh.end) : null; if (end && sh && sh.end <= sh.start) end = new Date(end.getTime() + 864e5);
        if (!end || end < new Date()) end = new Date(Date.now() + 8 * 36e5);
        A.addReminder({ text: "Vardiya bitti — eve dönüş. Dikkatli dön Burak.", due: localISO(end) }); done.push("vardiya bitişine alarm kurdum (" + pad(end.getHours()) + ":" + pad(end.getMinutes()) + ")");
      }
      else if (s.type === "whatsapp") { const r2 = await runTool("whatsapp_mesaj", { kim: s.kim, mesaj: s.mesaj }); if (r2.ok) done.push(s.kim + " için mesaj"); }
      else if (s.type === "app") await runTool("uygulama_ac", { ad: s.ad });
      else if (s.type === "url") await openUrl(s.url);
      else if (s.type === "focus") { await startFocus(Number(s.minutes) || 25, s.label || r.name); done.push("odak başladı"); }
      else if (s.type === "webhook") { await runTool("akilli_ev", { ad: s.ad }); done.push(s.ad); }
      else if (s.type === "wake") { if (Jarvis) s.on ? await Jarvis.startWake() : await Jarvis.stopWake(); }
      else if (s.type === "brief") { if (busy) return { ok: true, adimlar: done, devam: "Şimdi Burak'a günlük brifing ver." }; await send("__brief", byVoice); return { ok: true, adimlar: done }; }
      else if (s.type === "plan") { if (busy) return { ok: true, adimlar: done, devam: "Şimdi yarının planını kısaca söyle." }; await send("Yarın beni neler bekliyor? Kısaca planı söyle.", byVoice); return { ok: true, adimlar: done }; }
      else if (s.type === "sleep") { await sleepMode(); return { ok: true, adimlar: done }; }
    } catch (e) { done.push("✗ " + (STEP_TR[s.type] || s.type)); }
  }
  return { ok: true, adimlar: done };
}

/* ================= uyku modu ================= */
let sleepTimer = null;
async function sleepMode() {
  if (Jarvis) nat(() => Jarvis.dnd({ on: true }));
  if (Jarvis && SET.wake) nat(() => Jarvis.stopWake());
  const tmr = S.reminders.filter(r => !r.done && r.due.slice(0, 10) === ymd(new Date(Date.now() + 864e5))).length;
  let script = "";
  try {
    script = await plainGemini(`Burak için Türkçe, 120-160 kelimelik, çok sakin bir uyku öncesi gevşeme metni yaz. Nefese odaklan, bedeni yukarıdan aşağı gevşet, yarını düşünmeyi bırakmasını söyle. Madde işareti ve başlık kullanma. ${tmr ? `Yarın ${tmr} hatırlatıcısı olduğunu ve hepsinin kayıtlı olduğunu, kafasını rahat tutabileceğini bir cümleyle söyle.` : ""}`);
  } catch {}
  if (!script) script = "Gözlerini kapat Burak. Derin bir nefes al… ve yavaşça ver. Omuzlarını bırak, çeneni gevşet. Yarının işleri kayıtlı, hepsini ben hatırlayacağım. Şimdi sadece nefesine odaklan. Her nefesle biraz daha ağırlaşıyorsun, biraz daha sakinleşiyorsun. İyi geceler.";
  bubble("assistant", "🌙 " + script);
  const r0 = SET.rate, p0 = SET.pitch; SET.rate = 0.78; SET.pitch = 0.85;
  await speak(script, true); SET.rate = r0; SET.pitch = p0;
  clearTimeout(sleepTimer);
  return { ok: true };
}

/* ================= Gemini yardımcıları (düz metin, görsel, arama) ================= */
async function plainGemini(prompt, parts = [], tools = null) {
  if (!SET.geminiKey) throw new Error("NOKEY");
  const models = [SET.geminiModel, ...GEMINI_FALLBACK.filter(m => m !== SET.geminiModel)];
  for (let i = 0; i < models.length; i++) {
    try {
      const body = { contents: [{ role: "user", parts: [...parts, { text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 1400 } };
      if (tools) body.tools = tools;
      const j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent?key=${encodeURIComponent(SET.geminiKey)}`, body);
      const c = j.candidates && j.candidates[0];
      const txt = ((c && c.content && c.content.parts) || []).filter(p => p.text && !p.thought).map(p => p.text).join("").trim();
      const src = ((c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || []).map(g => g.web && g.web.title).filter(Boolean).slice(0, 4);
      return src.length ? txt + "\n(Kaynaklar: " + src.join(", ") + ")" : txt;
    } catch (e) { if ((e.status === 404 || e.status === 429) && i < models.length - 1) continue; throw e; }
  }
}
async function webSearch(q) { return { sonuc: await plainGemini(`Güncel bilgiye ihtiyaç var. Google'da ara ve Türkçe, kısa ve net yanıtla (en fazla 6 cümle): ${q}`, [], [{ google_search: {} }]) }; }

/* ================= medya: fotoğraf, ses kaydı ================= */
function fileToB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); }); }
async function shrinkImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url); return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}
let pendingAttach = [];
async function pickPhoto() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try { const b = await shrinkImage(f); pendingAttach = [{ mime: "image/jpeg", data: b }]; $("#attachInfo").textContent = "📷 Fotoğraf eklendi — ne yapayım? (ör. 'harcamaya ekle', 'bu ilanı seçmelere kaydet')"; $("#q").focus(); }
    catch { toast("Fotoğraf okunamadı"); }
  };
  inp.click();
}
// 16 kHz mono WAV kaydedici (Gemini ses formatı)
class WavRecorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1); this.chunks = []; this.len = 0;
    this.proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0); this.chunks.push(new Float32Array(d)); this.len += d.length;
      if (this.onLevel) { let q = 0; for (let i = 0; i < d.length; i += 4) q += d[i] * d[i]; this.onLevel(Math.sqrt(q / (d.length / 4))); }
    };
    this.src.connect(this.proc); this.proc.connect(this.ctx.destination); this.t0 = Date.now();
  }
  seconds() { return this.t0 ? (Date.now() - this.t0) / 1000 : 0; }
  async stop() {
    try { this.proc.disconnect(); this.src.disconnect(); } catch {}
    this.stream.getTracks().forEach(t => t.stop());
    const rate = this.ctx.sampleRate; await this.ctx.close();
    const all = new Float32Array(this.len); let o = 0; for (const c of this.chunks) { all.set(c, o); o += c.length; }
    const ratio = rate / 16000, n = Math.floor(all.length / ratio), pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    let bin = ""; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}
async function recordDialog(title, hint, maxSec = 540) {
  if (Jarvis) await nat(() => Jarvis.pauseWake());
  const rec = new WavRecorder();
  try { await rec.start(); } catch (e) { toast("Mikrofon açılamadı: " + e.message); resumeWake(); return null; }
  return new Promise(res => {
    $("#modalBox").innerHTML = `<h2>${esc(title)}</h2><div class="focusring" style="width:150px;height:150px;font-size:30px"><span id="recT">00:00</span><small>● kayıt</small></div><p style="font-size:14px;color:var(--dim)">${esc(hint)}</p><div class="row"><button class="btn ghost" id="mNo">İptal</button><button class="btn" id="mYes">■ Bitir</button></div>`;
    $("#modal").classList.add("on");
    const iv = setInterval(() => { const s = Math.round(rec.seconds()); $("#recT").textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; if (s >= maxSec) $("#mYes").click(); }, 500);
    $("#mNo").onclick = async () => { clearInterval(iv); await rec.stop().catch(() => {}); $("#modal").classList.remove("on"); resumeWake(); res(null); };
    $("#mYes").onclick = async () => { clearInterval(iv); const b = await rec.stop(); $("#modal").classList.remove("on"); resumeWake(); res(b); };
  });
}
async function voiceMemo() {
  const b = await recordDialog("SESLİ NOT / TOPLANTI", "Konuş ya da toplantıyı kaydet (en fazla 9 dk). Bitince özetleyip notlara ve görevlere eklerim.");
  if (!b) return;
  await send("Bu ses kaydını dinle. Türkçe kısa bir özet çıkar, özeti not_al ile kaydet; içinde yapılacak işler varsa her birini gorev_ekle ile ekle, tarih/saat geçiyorsa hatırlatıcı kur. Sonunda ne kaydettiğini söyle.", false, [{ mime: "audio/wav", data: b }], "🎙 Sesli not");
}

/* ================= self-tape kaydı ================= */
let TAPE = null;
async function selfTape() {
  if (!LINES.list.length) return toast("Önce sahneyi yapıştırıp Ayrıştır'a bas.");
  if (Jarvis) await nat(() => Jarvis.pauseWake());
  let facing = "user";
  const open = async () => navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
  let stream;
  try { stream = await open(); } catch (e) { toast("Kamera açılamadı: " + e.message); return; }
  $("#modalBox").innerHTML = `<h2>SELF-TAPE</h2><div style="position:relative"><video id="tpV" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000;max-height:55vh;transform:scaleX(${facing === "user" ? -1 : 1})"></video><div id="tpC" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:90px;font-weight:800;color:#fff;text-shadow:0 0 20px #000"></div><div id="tpL" style="position:absolute;left:8px;right:8px;bottom:8px;background:rgba(0,0,0,.6);border-radius:8px;padding:6px;font-size:14px;display:none"></div></div>
    <div class="row" style="margin-top:10px"><button class="btn ghost sm" id="tpFlip">↺ Kamera</button><button class="btn ghost sm" id="tpX">Kapat</button><button class="btn" id="tpGo">● Kayda başla</button></div><div class="hint">Kayıtta diğer karakterleri JARVIS okur. Senin repliğinde ekrana dokununca devam eder (ya da süre dolunca).</div>`;
  $("#modal").classList.add("on");
  const v = $("#tpV"); v.srcObject = stream;
  const close = () => { try { stream.getTracks().forEach(t => t.stop()); } catch {} $("#modal").classList.remove("on"); resumeWake(); TAPE = null; };
  $("#tpX").onclick = () => { if (TAPE && TAPE.rec && TAPE.rec.state === "recording") TAPE.stop = true; close(); };
  $("#tpFlip").onclick = async () => { facing = facing === "user" ? "environment" : "user"; stream.getTracks().forEach(t => t.stop()); stream = await open(); v.srcObject = stream; v.style.transform = `scaleX(${facing === "user" ? -1 : 1})`; };
  $("#tpGo").onclick = async () => {
    $("#tpGo").disabled = true; $("#tpFlip").disabled = true;
    for (const n of [3, 2, 1]) { $("#tpC").textContent = n; await sleep(900); } $("#tpC").textContent = "";
    const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9,opus", "video/webm"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined); const parts = [];
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    TAPE = { rec, stop: false }; rec.start(1000);
    const L = $("#tpL"); L.style.display = "block";
    for (const l of LINES.list) {
      if (TAPE.stop) break;
      L.innerHTML = `<b style="color:var(--cyan)">${esc(l.who)}</b> ${esc(l.text)}`;
      if (l.who === LINES.me) {
        const wait = Math.min(25000, 1500 + l.text.split(/\s+/).length * 480);
        await new Promise(r => { const t = setTimeout(r, wait); $("#modalBox").onclick = e => { if (!e.target.closest("button")) { clearTimeout(t); r(); } }; });
        $("#modalBox").onclick = null;
      } else await speak(l.text, true);
      await sleep(300);
    }
    L.innerHTML = "Kayıt bitti, kaydediliyor…"; await sleep(1200);
    await new Promise(r => { rec.onstop = r; rec.stop(); });
    const blob = new Blob(parts, { type: rec.mimeType || "video/webm" });
    const ext = (rec.mimeType || "").includes("mp4") ? "mp4" : "webm";
    const name = `selftape-${ymd(new Date())}-${Date.now().toString().slice(-5)}.${ext}`;
    META.lastLines = Date.now(); saveMeta();
    try { await saveVideo(blob, name); toast("🎬 Galeriye kaydedildi: Movies/JARVIS/" + name, 4500); } catch (e) { toast("Kaydedilemedi: " + e.message, 5000); }
    close();
  };
}
async function saveVideo(blob, name) {
  if (!Jarvis) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); return; }
  const CH = 768 * 1024; const buf = new Uint8Array(await blob.arrayBuffer());
  await Jarvis.fileBegin({ name });
  for (let i = 0; i < buf.length; i += CH) {
    let bin = ""; const sub = buf.subarray(i, i + CH); for (let k = 0; k < sub.length; k += 0x8000) bin += String.fromCharCode.apply(null, sub.subarray(k, k + 0x8000));
    await Jarvis.fileAppend({ name, data: btoa(bin) });
  }
  await Jarvis.fileSaveToGallery({ name, mime: blob.type || "video/webm" });
}
async function performanceFeedback() {
  if (!LINES.list.length) return toast("Önce sahneyi yapıştırıp Ayrıştır'a bas.");
  const mine = LINES.list.filter(l => l.who === LINES.me).map(l => l.text).join("\n");
  const b = await recordDialog("PERFORMANS", `${LINES.me} repliklerini oku. Bitince tempo, duraklama, vurgu ve duygu için geri bildirim vereceğim.`, 300);
  if (!b) return;
  META.lastLines = Date.now(); saveMeta();
  bubble("sys", "🎭 Performans değerlendiriliyor…"); go("home"); setMode("think", "Dinliyor…");
  try {
    const txt = await plainGemini(`Sen deneyimli bir oyunculuk koçusun. Ekteki kayıtta oyuncu "${LINES.me}" karakterinin repliklerini okuyor.\nSahne:\n${LINES.script.slice(0, 3000)}\n\nOyuncunun replikleri:\n${mine}\n\nTürkçe, samimi ve yapıcı geri bildirim ver: 1) metne sadakat (atlanan/değişen kelimeler), 2) tempo ve duraklamalar, 3) vurgu ve anlam, 4) duygu ve inandırıcılık, 5) bir sonraki tekrar için 2 somut öneri. Kısa paragraflar, en fazla 180 kelime.`, [{ inlineData: { mimeType: "audio/wav", data: b } }]);
    bubble("assistant", "🎭 " + txt); setMode("", "Hazır"); speak(txt);
  } catch (e) { setMode("", "Hazır"); bubble("assistant", "Değerlendiremedim: " + (e.message === "NOKEY" ? "Gemini anahtarı yok." : e.message)); }
}

/* ================= yol süresi / çıkış saati ================= */
async function travelMinutes(place) {
  const g = await geocode(place);
  const fromLat = SET.homeLat ?? SET.lat, fromLng = SET.homeLng ?? SET.lng;
  const j = await fetch(`https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${g.lng},${g.lat}?overview=false`).then(r => r.json());
  const sec = j.routes && j.routes[0] && j.routes[0].duration; if (!sec) throw new Error("Rota bulunamadı");
  return { min: Math.round(sec / 60 * 1.6 + 10), yer: g.name };   // İstanbul trafiği payı + park/yürüme
}
async function planLeave(a) {
  if (!a.place || !a.date) return a;
  try {
    const t = await travelMinutes(a.place); const d = parseDate(a.date);
    a.travelMin = t.min; a.leaveAt = localISO(new Date(d.getTime() - (t.min + 20) * 6e4)); save();
  } catch {}
  return a;
}
const _addAud = A.addAudition;
A.addAudition = f => { const a = _addAud(f); planLeave(a); return a; };

/* ================= internetsiz komutlar ================= */
function offlineCommand(text) {
  text = String(text).trim();
  const t = trLower(text);
  const O = g => { const i = t.indexOf(g); return i >= 0 ? text.substr(i, g.length) : g; };
  let m;
  if (/saat kaç/.test(t)) { const d = new Date(); return `Saat ${pad(d.getHours())}:${pad(d.getMinutes())}.`; }
  const hm = (h, mi) => { const d = new Date(); d.setHours(Number(h), Number(mi || 0), 0, 0); return d; };
  if ((m = t.match(/(\d+)\s*(dakika|dk|saat)\s*sonra\s+(.+?)\s*(hatırlat|söyle|uyar).*$/))) {
    const d = new Date(Date.now() + Number(m[1]) * (m[2] === "saat" ? 36e5 : 6e4)); A.addReminder({ text: O(m[3]), due: localISO(d) }); return `Tamam, ${pad(d.getHours())}:${pad(d.getMinutes())} için hatırlatıcı kurdum.`;
  }
  if ((m = t.match(/(yarın|bugün)?\s*(?:saat\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:'?(?:d[ae]|t[ae]|da|de|ta|te))?\s+(.+?)\s*(hatırlat|söyle|uyar|alarm).*$/))) {
    const d = hm(m[2], m[3]); if (m[1] === "yarın" || (!m[1] && d < new Date())) d.setDate(d.getDate() + 1);
    A.addReminder({ text: O(m[4]), due: localISO(d) }); return `Tamam, ${fmtWhen(localISO(d))} için hatırlatıcı kurdum.`;
  }
  if ((m = t.match(/^not\s*(?:al|et)\s*[:,]?\s*(.+)$/))) { A.addNote({ text: text.replace(/^not\s*(al|et)\s*[:,]?\s*/i, "") }); return "Not aldım."; }
  if ((m = t.match(/^(?:görev(?:lerime)?\s*ekle|yapılacaklara\s*ekle)\s*[:,]?\s*(.+)$/))) { A.addTask({ text: O(m[1]) }); return "Görevlere ekledim."; }
  if (/fener/.test(t)) { const on = !/kapat|söndür/.test(t); Jarvis && Jarvis.torch({ on }); return on ? "Fener açık." : "Fener kapalı."; }
  if ((m = t.match(/(\d+)\s*(?:dakika|dk)\s*odak/))) { startFocus(Number(m[1])); return `${m[1]} dakikalık odak başladı.`; }
  if ((m = t.match(/^(.+?)(?:'?[ıiuü]|'?y[ıiuü])?\s+ara$/))) { runTool("ara", { kim: O(m[1]) }); return `${O(m[1])} aranıyor, onay ver.`; }
  if ((m = t.match(/^(.+?)\s+(?:uygulamasını\s+)?aç$/)) && !/fener/.test(t)) { if (!Jarvis) return "Uygulama açma sadece telefonda."; Jarvis.openApp({ name: O(m[1]) }); return `${O(m[1])} açılıyor.`; }
  const r = matchRoutine(text); if (r) { runRoutine(r); return `${r.name} rutini çalışıyor.`; }
  return null;
}

/* ================= ekran ajanı (Faz 2) ================= */
async function a11yOk() { if (!Jarvis) return false; const r = await nat(() => Jarvis.a11yStatus(), {}); return !!(r && r.enabled); }
async function screenLook(question) {
  if (!(await a11yOk())) return { hata: "Ekran erişimi kapalı. Ayarlar → İzinler → Ekran erişimi (Erişilebilirlik) aç." };
  const shot = await nat(() => Jarvis.screenshot(), null);
  if (shot && shot.data) {
    const txt = await plainGemini(`Bu, Burak'ın telefon ekranının görüntüsü. ${question || "Ekranda ne var? Kısaca özetle."} Türkçe ve kısa yanıtla.`, [{ inlineData: { mimeType: "image/jpeg", data: shot.data } }]);
    return { ekran: txt };
  }
  const t = await Jarvis.screenText(); return { ekran_metni: (t.text || "").slice(0, 4000), uygulama: t.app };
}

/* ================= akıllı ev / webhook ================= */
async function fireWebhook(name) {
  const w = (SET.webhooks || []).find(w => trLower(w.name) === trLower(name)) || (SET.webhooks || []).find(w => trLower(w.name).includes(trLower(name)));
  if (!w) return { hata: `"${name}" adlı cihaz/webhook yok. Ayarlar → Akıllı ev'den ekle.` };
  const r = await fetch(w.url, { method: w.method || "POST", headers: { "Content-Type": "application/json" }, body: (w.method || "POST") === "GET" ? undefined : (w.body || "{}") });
  return { ok: r.ok, durum: r.status, cihaz: w.name };
}

/* ================= bilgisayar ajanı ================= */
async function pcCommand(action, arg = "", arg2 = "") {
  const q = await script("pcPush", { cmd: { action, arg, arg2 } });
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const r = await script("pcResult", { id: q.id });
    if (r.result) return r.result;
  }
  return { bekliyor: true, not: "Bilgisayar 30 sn içinde cevap vermedi. JARVIS PC ajanı açık mı?" };
}

/* ================= radar ================= */
let RADAR_CACHE = [];
async function radarCheck() {
  const r = await script("radarGet", {}); RADAR_CACHE = r.items || []; renderSec("work"); return { yeni: RADAR_CACHE.filter(x => !x.seen).slice(0, 15), toplam: RADAR_CACHE.length };
}

/* ================= kilit ================= */
async function lockCheck() {
  if (!SET.lock || !Jarvis) return;
  if (Date.now() - (META.unlockedAt || 0) < 5 * 6e4) return;
  $("#lock").classList.add("on");
  const r = await nat(() => Jarvis.authenticate({ reason: "JARVIS'i aç" }), null);
  if (r && r.ok) { META.unlockedAt = Date.now(); saveMeta(); $("#lock").classList.remove("on"); }
}

/* ================= yeni araçlar ================= */
TOOLS.push(
  T("internette_ara", "Güncel bilgi gerektiğinde Google'da arar (haberler, etkinlikler, fiyatlar, açık mı, ne zaman...).", { soru: str("Aranacak soru") }, ["soru"], a => webSearch(a.soru)),
  T("rutin_calistir", "Kayıtlı bir rutini çalıştırır (ör. 'Vardiyaya çıkıyorum', 'Eve geldim', 'İyi geceler').", { ad: str("Rutin adı") }, ["ad"],
    async a => { const r = S.routines.find(r => trLower(r.name) === trLower(a.ad)) || matchRoutine(a.ad); if (!r) return { hata: "Rutin yok", mevcut: S.routines.map(r => r.name) }; return runRoutine(r); }),
  T("rutin_olustur", "Yeni rutin oluşturur. steps: [{type:'dnd'|'torch'|'speak'|'reminder'|'shiftEnd'|'whatsapp'|'app'|'url'|'focus'|'brief'|'plan'|'sleep'|'webhook', on?, text?, minutes?, kim?, mesaj?, ad?, url?}]", { name: str("Rutin adı"), triggers: { type: "array", items: { type: "string" }, description: "Tetikleyici cümleler" }, steps: { type: "array", items: { type: "object", properties: { type: { type: "string" }, on: { type: "boolean" }, text: { type: "string" }, minutes: { type: "number" }, kim: { type: "string" }, mesaj: { type: "string" }, ad: { type: "string" }, url: { type: "string" } } }, description: "Adımlar" } }, ["name", "steps"],
    a => ({ ok: true, id: A.addRoutine(a).id })),
  T("uyku_modu", "Uyku modunu açar: rahatsız etmeyi açar, sakin bir gevşeme metni okur.", {}, [], () => sleepMode()),
  T("ozel_gun_ekle", "Doğum günü, yıldönümü gibi özel gün ekler; 3 gün önce ve günü hatırlatır.", { name: str("Kim/ne"), date: str("AA-GG veya GG.AA"), kind: str("doğum günü, yıldönümü, anma..."), note: str("Not") }, ["name", "date"], a => ({ ok: true, ...A.addDate(a) })),
  T("fatura_ekle", "Aylık fatura/abonelik ekler; 2 gün önce hatırlatır.", { name: str("Ad (Netflix, elektrik...)"), amount: num("Tutar TL"), day: num("Ayın günü"), kind: str("Tür", ["fatura", "abonelik", "kira"]) }, ["name", "day"], a => ({ ok: true, ...A.addBill(a) })),
  T("butce_ayarla", "Aylık harcama bütçesini ayarlar (TL).", { amount: num("Aylık bütçe") }, ["amount"], a => { SET.budget = Number(a.amount) || 0; saveSet(); return { ok: true, butce: SET.budget, harcanan: monthSpent() }; }),
  T("basvuru_ekle", "Casting/iş başvurusu ekler; 7 gün sonra takip hatırlatır.", { project: str("Proje"), role: str("Rol"), contact: str("Casting/ajans/kişi"), status: str("Durum", ["başvuruldu", "self-tape gönderildi", "callback", "olumsuz", "kabul"]), date: str("YYYY-MM-DD") }, ["project"], a => ({ ok: true, id: A.addApplication(a).id })),
  T("basvuru_guncelle", "Başvurunun durumunu günceller.", { id: str("id"), project: str("Proje adı (id yoksa)"), status: str("Yeni durum", ["başvuruldu", "self-tape gönderildi", "callback", "olumsuz", "kabul"]), followUp: str("Yeni takip tarihi YYYY-MM-DD"), note: str("Not") }, [], a => ({ ok: true, ...A.updateApplication(a) })),
  T("hedef_ekle", "Bu hafta için hedef ekler (ör. '3 başvuru').", { text: str("Hedef"), target: num("Hedef sayı") }, ["text"], a => ({ ok: true, id: A.addGoal(a).id })),
  T("hedef_ilerlet", "Haftalık hedefte ilerleme kaydeder.", { id: str("id"), text: str("Hedef adı"), by: num("Artış, varsayılan 1") }, [], a => A.bumpGoal(a)),
  T("mail_taslagi", "Gmail'de taslak mail oluşturur (göndermez; Burak kontrol edip gönderir).", { to: str("Alıcı e-posta"), subject: str("Konu"), body: str("Metin") }, ["subject", "body"],
    async a => { if (!(await confirmBox(`Gmail taslağı oluşturulsun mu?\n${a.to || "(alıcı yok)"} · ${a.subject}`, "Oluştur"))) return { ok: false, iptal: true }; return script("gmailDraft", a); }),
  T("kadro_sorgula", "KADRO oyuncu/başvuru tablosunda arar ve sayar. query: isim, şehir, yaş vb.; since: bu tarihten sonraki kayıtlar.", { query: str("Arama"), since: str("YYYY-MM-DD"), limit: num("En fazla") }, [],
    async a => { if (!SET.kadroSheetId) return { hata: "KADRO tablosu bağlı değil (Ayarlar → İş bağlantıları)." }; return script("sheetQuery", { sheetId: SET.kadroSheetId, query: a.query || "", since: a.since || "", limit: a.limit || 20 }); }),
  T("radar_kontrol", "Casting ilanı / kiralık ev radarındaki yeni bulguları getirir.", {}, [], () => radarCheck()),
  T("ekrani_gor", "Telefon ekranında ne olduğunu görür/okur ve soruyu yanıtlar.", { soru: str("Ekranla ilgili soru") }, [], a => screenLook(a.soru)),
  T("ekranda_dokun", "Açık uygulamada yazısı/etiketi verilen düğmeye veya öğeye dokunur.", { hedef: str("Düğme/öğe yazısı") }, ["hedef"],
    async a => { if (!(await a11yOk())) return { hata: "Ekran erişimi kapalı" }; if (!(await confirmBox(`Ekranda "${a.hedef}" öğesine dokunulsun mu?`, "Dokun"))) return { iptal: true }; return Jarvis.a11yClick({ text: a.hedef }); }),
  T("ekrana_yaz", "Açık uygulamadaki odaklanmış yazı alanına metin yazar.", { metin: str("Metin") }, ["metin"], async a => (await a11yOk()) ? Jarvis.a11yType({ text: a.metin }) : { hata: "Ekran erişimi kapalı" }),
  T("ekran_hareket", "Geri, ana ekran, son uygulamalar, bildirimler veya kaydırma yapar.", { hareket: str("Hareket", ["geri", "ana_ekran", "son_uygulamalar", "bildirimler", "asagi_kaydir", "yukari_kaydir"]) }, ["hareket"], async a => (await a11yOk()) ? Jarvis.a11yGlobal({ action: a.hareket }) : { hata: "Ekran erişimi kapalı" }),
  T("akilli_ev", "Akıllı ev cihazını/webhook'u tetikler (ışık, priz...).", { ad: str("Cihaz/eylem adı, Ayarlar'daki gibi") }, ["ad"], a => fireWebhook(a.ad)),
  T("bilgisayar", "Bilgisayardaki JARVIS ajanına komut verir. open_app: uygulama aç; open_url: link aç; find_file: dosya ara; mail_file: dosyayı Gmail taslağına ekle (arg=dosya adı, arg2=alıcı); lock: kilitle; notify: bilgisayarda mesaj göster.", { action: str("Komut", ["open_app", "open_url", "find_file", "mail_file", "lock", "notify"]), arg: str("Uygulama/link/dosya adı/mesaj"), arg2: str("Ek bilgi (ör. alıcı e-posta)") }, ["action"],
    async a => { if (["lock", "mail_file"].includes(a.action) && !(await confirmBox(`Bilgisayarda: ${a.action} ${a.arg || ""} ${a.arg2 || ""}`, "Gönder"))) return { iptal: true }; return pcCommand(a.action, a.arg, a.arg2); }),
  T("yol_suresi", "Bir yere arabayla tahmini süre (İstanbul trafiği payı dahil) ve ne zaman çıkılması gerektiği.", { yer: str("Hedef"), varis: str("Varış saati YYYY-MM-DDTHH:mm (ops.)") }, ["yer"],
    async a => { const t = await travelMinutes(a.yer); const out = { tahmini_dk: t.min, yer: t.yer }; if (a.varis) { const d = parseDate(a.varis); if (d) out.cikis = localISO(new Date(d - (t.min + 15) * 6e4)); } return out; }),
  T("yol_tarifi", "Google Haritalar'da toplu taşıma/araç/yürüyüş tarifini açar (canlı sefer saatleri dahil).", { yer: str("Hedef (ev için 'ev')"), mod: str("Mod", ["transit", "driving", "walking"]) }, ["yer"],
    async a => { const dest = trLower(a.yer) === "ev" && SET.homeLat ? `${SET.homeLat},${SET.homeLng}` : a.yer; await openUrl(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=${a.mod || "transit"}`); return { ok: true }; })
);
const _ACT = { fatura_ekle: "🧾 fatura", ozel_gun_ekle: "🎂 özel gün", hedef_ekle: "🎯 hedef", rutin_olustur: "⚡ rutin", internette_ara: "🌐 arama", rutin_calistir: "⚡ rutin", ekrani_gor: "👁 ekran", ekranda_dokun: "👆 dokun", bilgisayar: "💻 bilgisayar", mail_taslagi: "✉️ taslak", kadro_sorgula: "📇 KADRO", radar_kontrol: "📡 radar", basvuru_ekle: "📨 başvuru", hedef_ilerlet: "🎯 hedef", akilli_ev: "🏠 ev", yol_suresi: "🚗 yol", uyku_modu: "🌙 uyku" };
Object.assign(ACT_TR, _ACT);

/* ================= yeni bölümler: formlar ve listeler ================= */
let DRAFT_STEPS = [];
const STATUS = ["başvuruldu", "self-tape gönderildi", "callback", "olumsuz", "kabul"];
const STATUS_CLS = { "başvuruldu": "", "self-tape gönderildi": "wait", "callback": "wait", "olumsuz": "no", "kabul": "ok" };
const stepLabel = s => {
  const T2 = STEP_TR[s.type] || s.type;
  if (s.type === "dnd" || s.type === "torch" || s.type === "wake") return `${T2}: ${s.on ? "aç" : "kapat"}`;
  if (s.type === "speak") return `${T2}: "${s.text}"`;
  if (s.type === "reminder") return `${T2}: ${s.minutes || 60} dk sonra "${s.text || ""}"`;
  if (s.type === "whatsapp") return `${T2}: ${s.kim} → "${s.mesaj}"`;
  if (s.type === "app" || s.type === "webhook") return `${T2}: ${s.ad}`;
  if (s.type === "url") return `${T2}: ${s.url}`;
  if (s.type === "focus") return `${T2}: ${s.minutes || 25} dk`;
  return T2;
};
Object.assign(FORMS, {
  routines: () => `<input name="name" placeholder="Rutin adı (ör. Seçmeye gidiyorum)" required>
    <input name="triggers" placeholder="Tetikleyici cümleler, virgülle (ör. seçmeye gidiyorum, seçmeye çıktım)">
    <div class="steps">${DRAFT_STEPS.map((s, i) => `<div class="step"><span>${i + 1}. ${esc(stepLabel(s))}</span><button type="button" class="x" data-dstep="${i}">✕</button></div>`).join("") || `<div class="hint">Henüz adım yok.</div>`}</div>
    <div class="row"><select id="stType">${Object.entries(STEP_TR).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select><label class="hint" style="flex:0 0 auto;margin:0"><input type="checkbox" id="stOn" checked style="width:auto"> aç</label></div>
    <div class="row"><input id="stP1" placeholder="Metin / kişi / uygulama / dakika / link"><input id="stP2" placeholder="Mesaj (WhatsApp)"></div>
    <div class="row"><button type="button" class="btn ghost" id="stepAdd">+ Adım</button><button class="btn">Rutini kaydet</button></div>`,
  dates: () => `<div class="row"><input name="name" placeholder="Kim / ne (ör. Annem)" required><input name="date" placeholder="GG.AA (ör. 03.03)" required></div>
    <div class="row"><select name="kind"><option>doğum günü</option><option>yıldönümü</option><option>anma</option><option>önemli gün</option></select><input name="note" placeholder="Not"><button class="btn">+</button></div>
    ${NATIVE ? `<button type="button" class="btn ghost sm" id="bdayImport">📇 Rehberdeki doğum günlerini al</button>` : ""}`,
  bills: () => `<div class="row"><input name="name" placeholder="Ad (Netflix, elektrik, kira…)" required><input name="amount" type="number" inputmode="decimal" placeholder="Tutar ₺"></div>
    <div class="row"><input name="day" type="number" min="1" max="31" placeholder="Ayın günü" required><select name="kind"><option>fatura</option><option>abonelik</option><option>kira</option></select><button class="btn">+</button></div>`,
  applications: () => `<div class="row"><input name="project" placeholder="Proje" required><input name="role" placeholder="Rol"></div>
    <div class="row"><input name="contact" placeholder="Casting / ajans / kişi"><select name="status">${STATUS.map(x => `<option>${x}</option>`).join("")}</select><button class="btn">+</button></div>`,
  goals: () => `<div class="row"><input name="text" placeholder="Bu haftaki hedef (ör. Başvuru)" required><input name="target" type="number" min="1" value="3" style="max-width:80px"><button class="btn">+</button></div>`
});
Object.assign(ADD, {
  routines: f => {
    if (!DRAFT_STEPS.length) throw new Error("En az bir adım ekle");
    A.addRoutine({ name: f.name, triggers: String(f.triggers || f.name).split(",").map(x => x.trim()).filter(Boolean), steps: DRAFT_STEPS });
    DRAFT_STEPS = [];
  },
  dates: f => A.addDate(f), bills: f => A.addBill(f), applications: f => A.addApplication(f), goals: f => A.addGoal(f)
});
const _baseList = listHTML;
listHTML = function (sec) {
  const E = t => `<div class="empty">${t}</div>`;
  switch (sec) {
    case "routines": return S.routines.length ? S.routines.map(r => `<div class="item"><div class="ic">⚡</div><div class="t"><div class="h">${esc(r.name)}</div><div class="meta">"${esc((r.triggers || []).join('", "'))}"</div><div class="meta">${r.steps.map(stepLabel).map(esc).join(" → ")}</div></div><div style="display:flex;flex-direction:column;gap:4px"><button class="btn sm" data-runr="${r.id}">▶</button><button class="x" data-del="routines:${r.id}">✕</button></div></div>`).join("") : E("Rutin yok.");
    case "dates": {
      const l = [...S.dates].sort((a, b) => nextDateOf(a.md) - nextDateOf(b.md));
      return l.length ? l.map(x => itemHTML({ ic: "🎂", h: `${esc(x.name)} · ${esc(x.kind)}`, meta: `${fmtWhen(ymd(nextDateOf(x.md)), false)} (${x.md.split("-").reverse().join(".")})${x.note ? " · " + esc(x.note) : ""}`, id: x.id, key: "dates" })).join("") : E("Özel gün yok. \"Annemin doğum günü 3 Mart\" de.");
    }
    case "bills": {
      const tot = S.bills.reduce((s, b) => s + (b.amount || 0), 0);
      const sp = monthSpent();
      const head = `<div class="card"><h3>BU AY</h3><div class="big">${money(sp)}</div><div class="meta" style="color:var(--dim)">Sabit giderler: ${money(tot)}/ay${SET.budget > 0 ? ` · Bütçe: ${money(SET.budget)}` : " · Bütçe yok (Ayarlar → Kişisel)"}</div>${SET.budget > 0 ? `<div class="bar"><i style="width:${Math.min(100, Math.round(sp / SET.budget * 100))}%;background:${sp > SET.budget ? "var(--red)" : sp > SET.budget * 0.8 ? "var(--gold)" : "var(--cyan)"}"></i></div>` : ""}</div>`;
      const l = [...S.bills].sort((a, b) => nextBillDate(a.day) - nextBillDate(b.day));
      return head + (l.length ? l.map(b => itemHTML({ ic: b.kind === "abonelik" ? "🔁" : b.kind === "kira" ? "🏠" : "🧾", h: `${esc(b.name)}${b.amount ? " · " + money(b.amount) : ""}`, meta: `Her ayın ${b.day}'i · sıradaki ${fmtWhen(ymd(nextBillDate(b.day)), false)}`, id: b.id, key: "bills" })).join("") : E("Fatura/abonelik yok. 2 gün önceden hatırlatırım."));
    }
    case "applications": {
      const l = [...S.applications].sort((a, b) => b.date.localeCompare(a.date));
      const cnt = st => S.applications.filter(a => a.status === st).length;
      const head = l.length ? `<div class="card"><h3>ÖZET</h3><div class="meta" style="color:var(--txt);font-size:14px">${STATUS.map(st => `${st}: <b>${cnt(st)}</b>`).join(" · ")}</div></div>` : "";
      return head + (l.length ? l.map(a => `<div class="item"><div class="ic">📨</div><div class="t"><div class="h">${esc(a.project)}${a.role ? " · " + esc(a.role) : ""}<span class="pill ${STATUS_CLS[a.status] || ""}">${esc(a.status)}</span></div><div class="meta">${fmtWhen(a.date, false)}${a.contact ? " · " + esc(a.contact) : ""}${a.followUp ? " · takip " + fmtWhen(a.followUp, false) : ""}</div><select data-appst="${a.id}" style="margin-top:6px;padding:6px;font-size:14px">${STATUS.map(x => `<option ${x === a.status ? "selected" : ""}>${x}</option>`).join("")}</select></div><button class="x" data-del="applications:${a.id}">✕</button></div>`).join("") : E("Başvuru yok. 7 gün sonra takip için hatırlatırım."));
    }
    case "goals": {
      rollGoals();
      return S.goals.length ? S.goals.map(g => `<div class="item"><div class="ic">🎯</div><div class="t"><div class="h">${esc(g.text)} <b>${g.count}/${g.target}</b></div><div class="bar"><i style="width:${Math.min(100, Math.round(g.count / g.target * 100))}%;background:${g.count >= g.target ? "var(--green)" : "var(--cyan)"}"></i></div>${(g.history || []).length ? `<div class="meta">Geçmiş: ${g.history.slice(-4).map(h => `${h.count}/${h.target}`).join(" · ")}</div>` : ""}</div><button class="btn sm" data-goal="${g.id}">+1</button><button class="x" data-del="goals:${g.id}">✕</button></div>`).join("") : E("Haftalık hedef yok. Her pazartesi sıfırlanır.");
    }
    case "radar": {
      const head = `<div class="card"><div class="row"><div class="hint" style="margin:0">Casting ilanları ve kiralık ev için Google'da her saat tarama yapılır. Kaynakları Ayarlar → İş bağlantıları'ndan ekle.</div><button class="btn sm" id="radarRefresh">Yenile</button></div></div>`;
      return head + (RADAR_CACHE.length ? RADAR_CACHE.slice(0, 60).map(x => `<div class="item"><div class="ic">${x.radar && /ev|kira/i.test(x.radar) ? "🏠" : "🎬"}</div><div class="t"><div class="h">${esc(x.title)}</div><div class="meta">${esc(x.radar || "")} · ${esc(x.found || "")}</div>${x.link ? `<button class="btn ghost sm" style="margin-top:6px" data-open="${esc(x.link)}">Aç</button>` : ""}</div></div>`).join("") : E(SET.scriptUrl ? "Henüz bulgu yok. Yenile'ye bas." : "Google bağlantısı gerekli (Ayarlar → Google)."));
    }
  }
  return _baseList(sec);
};
const _baseLines = linesHTML;
linesHTML = function () {
  return _baseLines() + (LINES.list.length ? `<div class="card"><h3>KAYIT</h3><div class="row"><button class="btn" id="tapeBtn">🎬 Self-tape çek</button><button class="btn ghost" id="perfBtn">🎭 Performansımı değerlendir</button></div><div class="hint">Self-tape: 3-2-1 sonra kayıt başlar, diğer karakterleri ben okurum, video galeriye (Movies/JARVIS) kaydedilir.</div></div>` : "");
};

/* ================= yeni ayar kartları ================= */
const _baseSettings = renderSettings;
renderSettings = async function () {
  await _baseSettings();
  const tg = (k, label, sub) => `<label class="toggle"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" class="sw" data-set="${k}" ${SET[k] ? "checked" : ""}></label>`;
  const wk = Jarvis ? await nat(() => Jarvis.getWakeWords(), { words: [] }) : { words: [] };
  const html = `
  <div class="card"><h3>KİŞİSEL</h3><div class="form">
    <div class="row"><div><div class="lbl">Adın</div><input data-set="name" value="${esc(SET.name)}"></div><div><div class="lbl">Partner (rutinlerde)</div><input data-set="partnerName" value="${esc(SET.partnerName)}"></div></div>
    <div class="lbl">Aylık bütçe (₺, 0 = kapalı)</div><input data-set="budget" type="number" inputmode="decimal" value="${SET.budget || 0}">
    <div class="row"><span class="hint" style="margin:0">Ev konumu: ${SET.homeLat ? "✓ kayıtlı" : "kayıtlı değil"}</span><button class="btn ghost sm" id="homeHere">📍 Burası evim</button></div>
    ${tg("proactive", "Proaktif JARVIS", "Yağmur uyarısı, bekleyen görevler, seçme hazırlığı, haftalık rapor")}</div></div>

  <div class="card"><h3>GÜVENLİK VE KISAYOLLAR</h3>
    ${tg("lock", "Parmak izi kilidi", "Açılışta ve 5 dk sonra parmak izi/yüz ister")}
    ${tg("headset", "Kulaklık tuşu", "Kulaklığın tuşuna basınca JARVIS dinler (müzik çalmıyorken)")}
    ${tg("autoSendWa", "WhatsApp'ı otomatik gönder", "Onayından sonra gönder tuşuna kendisi basar (Ekran erişimi gerekli)")}
    ${NATIVE ? `<div class="perm"><span>Ekran erişimi (Erişilebilirlik)<br><small style="color:var(--dim)">Ekranı görme, dokunma, yazma</small></span>${PERM.a11y ? `<span class="ok">✓ Açık</span>` : `<button class="btn sm" data-perm="a11y">Aç</button>`}</div>
    <div class="perm"><span>Kamera<br><small style="color:var(--dim)">Self-tape, fotoğraf</small></span>${PERM.camera ? `<span class="ok">✓ Açık</span>` : `<button class="btn sm" data-perm="camera">İzin ver</button>`}</div>
    <div class="hint">Android 13+: Ekran erişimi gri görünürse Ayarlar → Uygulamalar → JARVIS → ⋮ → "Kısıtlanmış ayarlara izin ver".</div>` : ""}</div>

  <div class="card"><h3>HEY JARVIS · SESİME UYARLA</h3>
    <div class="hint" style="margin-top:0">5 kez "Hey Jarvis" dersin; senin telaffuzunda nasıl duyulduğunu öğrenip algılamayı iyileştiririm.</div>
    <div class="row" style="margin-top:8px"><button class="btn ghost sm" id="calibWake">🎙 Kalibre et</button><button class="btn ghost sm" id="calibReset">Sıfırla</button></div>
    <div class="hint">Ek kelimeler: ${(wk.words || []).length ? esc(wk.words.join(", ")) : "yok"}</div></div>

  <div class="card"><h3>DOĞAL TÜRKÇE SES (İNTERNETSİZ)</h3>
    <div class="hint" style="margin-top:0">1) "sherpa-onnx TTS Engine" uygulamasının APK'sını kur (k2-fsa GitHub sayfası). 2) İçinden Türkçe Piper sesini seç (ör. tr_TR-dfki / fahrettin). 3) Aşağıdaki düğmeyle tercih edilen motoru o yap. 4) JARVIS → Ses'ten yeni sesi seç.</div>
    ${NATIVE ? `<button class="btn ghost sm" id="ttsSettings" style="margin-top:8px">Metin okuma ayarlarını aç</button>` : ""}</div>

  <div class="card"><h3>İŞ BAĞLANTILARI</h3><div class="form">
    <div class="lbl">KADRO Google E-Tablo kimliği (linkteki /d/ ile /edit arası)</div><input data-set="kadroSheetId" value="${esc(SET.kadroSheetId)}" placeholder="1AbC…">
    <div class="lbl">Anlık bildirim (ntfy konusu, ops.)</div><input data-set="ntfyTopic" value="${esc(SET.ntfyTopic)}" placeholder="burak-jarvis-gizli-123">
    <div class="hint">Telefona ücretsiz "ntfy" uygulamasını kurup bu konuya abone olursan radar yeni ilan bulunca anında bildirim gelir.</div>
    <div class="lbl">Radar kaynakları</div>
    ${(SET.radars || []).map((r, i) => `<div class="step"><span>${r.type === "gmail" ? "✉️" : "🌐"} <b>${esc(r.name)}</b> · ${esc(r.query || r.url)}${r.keywords ? " · [" + esc(r.keywords) + "]" : ""}</span><button class="x" data-delradar="${i}">✕</button></div>`).join("") || `<div class="hint">Kaynak yok.</div>`}
    <div class="row"><input id="rdName" placeholder="Ad (ör. Casting ilanları)"><select id="rdType" style="max-width:110px"><option value="gmail">Gmail</option><option value="web">Web sayfası</option></select></div>
    <input id="rdQuery" placeholder="Gmail araması (ör. casting OR seçme OR oyuncu aranıyor) ya da sayfa linki">
    <div class="row"><input id="rdKw" placeholder="Anahtar kelimeler, virgülle (web için)"><button class="btn sm" id="radarAdd">+</button></div>
    <button class="btn ghost sm" id="radarSave">Radarı Google'a kaydet</button>
    <div class="hint">Örnek web kaynağı: bir casting ilan sayfası veya kiralık ev arama sonuç linki (filtrelerin linkte olsun). Bazı siteler otomatik okumayı engelleyebilir.</div></div></div>

  <div class="card"><h3>AKILLI EV (WEBHOOK)</h3>
    ${(SET.webhooks || []).map((w, i) => `<div class="step"><span><b>${esc(w.name)}</b> · ${esc(w.method || "POST")} ${esc(w.url.slice(0, 40))}…</span><button class="btn ghost sm" data-testwh="${i}">▶</button><button class="x" data-delwh="${i}">✕</button></div>`).join("") || `<div class="hint" style="margin-top:0">Webhook yok.</div>`}
    <div class="form" style="margin-top:6px"><div class="row"><input id="whName" placeholder="Ad (ör. Salon ışığı aç)"><select id="whMethod" style="max-width:90px"><option>POST</option><option>GET</option></select></div><input id="whUrl" placeholder="https://… (Home Assistant, IFTTT, Smart Life webhook)"><div class="row"><input id="whBody" placeholder='Gövde (ops.) {"state":"on"}'><button class="btn sm" id="whAdd">+</button></div>
    <div class="hint">"JARVIS, salon ışığını aç" dediğinde adıyla eşleşen webhook'u tetikler. Rutin adımı olarak da kullanılabilir.</div></div></div>

  <div class="card"><h3>BİLGİSAYAR AJANI</h3>
    <div class="hint" style="margin-top:0">Bilgisayarında <code>pc-agent/jarvis_pc.py</code> dosyasını çalıştır (README → Bilgisayar ajanı). Aynı Google bağlantısını kullanır.</div>
    <button class="btn ghost sm" id="pcTest" style="margin-top:8px">Bilgisayara test mesajı gönder</button></div>`;
  const setEl = $("#b-set"); const cards = setEl.querySelectorAll(".card");
  const memCard = [...cards].find(c => c.querySelector("h3") && /HAFIZA/.test(c.querySelector("h3").textContent));
  if (memCard) memCard.insertAdjacentHTML("beforebegin", html); else setEl.insertAdjacentHTML("beforeend", html);
};
const _baseOnSet = onSetChange;
onSetChange = async function (el) {
  const k = el.dataset.set;
  if (k === "budget") { SET.budget = Number(el.value) || 0; await saveSet(); renderSec("life"); return; }
  if (k === "lock" && el.checked) {
    const r = Jarvis ? await nat(() => Jarvis.authenticate({ reason: "Kilidi etkinleştir" }), null) : null;
    if (!r || !r.ok) { el.checked = false; return toast((r && r.error) || "Parmak izi/yüz kilidi doğrulanamadı."); }
    META.unlockedAt = Date.now(); saveMeta();
  }
  if (k === "headset") { const r = Jarvis ? await nat(() => Jarvis.setHeadset({ on: el.checked }), null) : null; if (el.checked && (!r || !r.ok)) { el.checked = false; return toast((r && r.error) || "Kulaklık tuşu başlatılamadı."); } }
  if (k === "autoSendWa" && el.checked && !(await a11yOk())) { el.checked = false; return toast("Önce Ekran erişimini aç."); }
  return _baseOnSet(el);
};

/* ================= WhatsApp: ekran erişimiyle otomatik gönder ================= */
{
  const wa = TOOLS.find(t => t.name === "whatsapp_mesaj"); const base = wa.run;
  wa.run = async a => {
    const r = await base(a);
    if (r && r.ok && SET.autoSendWa && (await a11yOk())) {
      await sleep(2600);
      const c = await nat(() => Jarvis.a11yClick({ text: "Gönder|Send", pkg: "com.whatsapp" }), null);
      if (c && c.ok) return { ok: true, gonderildi: true };
      return { ok: true, not: "WhatsApp açıldı ama gönder tuşunu bulamadım; gönder'e sen bas." };
    }
    return r;
  };
}

/* ================= kalibrasyon ================= */
async function calibrateWake() {
  if (!Jarvis) return;
  const st = await nat(() => Jarvis.wakeStatus(), {});
  if (!st || !["listening", "paused"].includes(st.status)) return toast("Önce Hey Jarvis'i aç ve modelin inmesini bekle.");
  const heard = [];
  for (let i = 1; i <= 5; i++) {
    toast(`${i}/5 — "Hey Jarvis" de`, 3500);
    await speak(i === 1 ? "Bip sesinden sonra hey jarvis de." : "Bir daha.", true);
    const r = await nat(() => Jarvis.wakeSample({ ms: 3500 }), null);
    if (r && r.text) heard.push(r.text);
  }
  const STOP = new Set(["hey", "okay", "ok", "the", "a", "uh", "um", "huh", "oh", "and", "i", "it", "is", "to", "of"]);
  const cnt = {}; heard.join(" ").split(/\s+/).filter(w => w && !STOP.has(w)).forEach(w => cnt[w] = (cnt[w] || 0) + 1);
  const words = Object.entries(cnt).filter(([w, n]) => n >= 2 && w !== "jarvis").map(([w]) => w).slice(0, 4);
  await nat(() => Jarvis.setWakeWords({ words }));
  resumeWake();
  infoBox("KALİBRASYON", `<p style="font-size:15px">Duyduklarım:</p><p style="font-size:14px;color:var(--dim)">${heard.map(esc).join("<br>") || "(hiçbir şey)"}</p><p style="font-size:15px">${words.length ? "Eklenen kelimeler: <b>" + esc(words.join(", ")) + "</b>" : (heard.some(h => h.includes("jarvis")) ? "\"jarvis\" kelimesini zaten doğru duyuyorum ✓" : "Belirgin bir kelime çıkmadı; daha net ve yakından tekrar dene.")}</p>`);
  renderSettings();
}

/* ================= yeni olaylar ================= */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act],#attachBtn,[data-runr],[data-goal],[data-dstep],#stepAdd,#bdayImport,#radarRefresh,[data-open],#tapeBtn,#perfBtn,#homeHere,#calibWake,#calibReset,#ttsSettings,#radarAdd,#radarSave,[data-delradar],#whAdd,[data-delwh],[data-testwh],#pcTest,#unlockBtn");
  if (!t) return;
  try {
    if (t.dataset.act === "memo") voiceMemo();
    else if (t.dataset.act === "photo" || t.id === "attachBtn") pickPhoto();
    else if (t.dataset.runr) { const r = S.routines.find(r => r.id === t.dataset.runr); if (r) { go("home"); bubble("sys", "⚡ " + r.name); const res = await runRoutine(r); toast("⚡ " + (res.adimlar || []).join(", ")); } }
    else if (t.dataset.goal) A.bumpGoal({ id: t.dataset.goal });
    else if (t.dataset.dstep) { DRAFT_STEPS.splice(Number(t.dataset.dstep), 1); renderSec("plan"); }
    else if (t.id === "stepAdd") {
      const type = $("#stType").value, p1 = $("#stP1").value.trim(), p2 = $("#stP2").value.trim(), on = $("#stOn").checked;
      const st = { type };
      if (["dnd", "torch", "wake"].includes(type)) st.on = on;
      if (type === "speak") st.text = p1 || "Tamam.";
      if (type === "reminder") { st.text = p2 || p1 || "Hatırlatma"; st.minutes = Number(p1) || 60; }
      if (type === "whatsapp") { if (!p1 || !p2) return toast("Kişi ve mesaj gir"); st.kim = p1; st.mesaj = p2; }
      if (type === "app" || type === "webhook") { if (!p1) return toast("Ad gir"); st.ad = p1; }
      if (type === "url") { if (!p1) return toast("Link gir"); st.url = p1; }
      if (type === "focus") st.minutes = Number(p1) || 25;
      const keep = { name: ($("form[data-add=routines] input[name=name]") || {}).value, trg: ($("form[data-add=routines] input[name=triggers]") || {}).value };
      DRAFT_STEPS.push(st); renderSec("plan");
      if (keep.name) $("form[data-add=routines] input[name=name]").value = keep.name;
      if (keep.trg) $("form[data-add=routines] input[name=triggers]").value = keep.trg;
    }
    else if (t.id === "bdayImport") {
      const r = await Jarvis.getBirthdays(); let n = 0;
      for (const b of (r.items || [])) if (!S.dates.some(x => trLower(x.name) === trLower(b.name))) { S.dates.push({ id: uid(), name: b.name, md: b.md, kind: "doğum günü", note: "" }); n++; }
      save(); toast(`${n} doğum günü eklendi`);
    }
    else if (t.id === "radarRefresh") { toast("Radar kontrol ediliyor…"); await radarCheck(); }
    else if (t.dataset.open) openUrl(t.dataset.open);
    else if (t.id === "tapeBtn") selfTape();
    else if (t.id === "perfBtn") performanceFeedback();
    else if (t.id === "homeHere") {
      if (!Jarvis) return toast("Sadece telefonda");
      const l = await Jarvis.getLocation(); SET.homeLat = l.lat; SET.homeLng = l.lng; saveSet();
      const home = S.routines.find(r => /eve geldim/i.test(r.name));
      const g = await nat(() => Jarvis.addGeofence({ id: "home", lat: l.lat, lng: l.lng, radius: 150, text: "Eve vardın Burak 🏠 — 'Eve geldim' rutini için dokun.", action: home ? "routine:" + home.id : "listen" }), null);
      toast(g && g.ok ? "🏠 Ev kaydedildi; eve varınca haber vereceğim." : "Ev kaydedildi. Otomatik algılama için konum: her zaman izni gerekli.", 4000); renderSettings();
    }
    else if (t.id === "calibWake") calibrateWake();
    else if (t.id === "calibReset") { await nat(() => Jarvis.setWakeWords({ words: [] })); renderSettings(); }
    else if (t.id === "ttsSettings") nat(() => Jarvis.openTtsSettings());
    else if (t.id === "radarAdd") {
      const r = { name: $("#rdName").value.trim(), type: $("#rdType").value, keywords: $("#rdKw").value.trim() };
      const q = $("#rdQuery").value.trim(); if (!r.name || !q) return toast("Ad ve arama/link gir");
      if (r.type === "gmail") r.query = q; else r.url = q;
      SET.radars = [...(SET.radars || []), r]; await saveSet(); renderSettings();
    }
    else if (t.dataset.delradar) { SET.radars.splice(Number(t.dataset.delradar), 1); await saveSet(); renderSettings(); }
    else if (t.id === "radarSave") { await script("radarSet", { radars: SET.radars || [], ntfy: SET.ntfyTopic || "" }); toast("✓ Radar Google'a kaydedildi; her saat taranacak."); }
    else if (t.id === "whAdd") {
      const w = { name: $("#whName").value.trim(), url: $("#whUrl").value.trim(), method: $("#whMethod").value, body: $("#whBody").value.trim() };
      if (!w.name || !/^https?:\/\//.test(w.url)) return toast("Ad ve geçerli link gir");
      SET.webhooks = [...(SET.webhooks || []), w]; await saveSet(); renderSettings();
    }
    else if (t.dataset.delwh) { SET.webhooks.splice(Number(t.dataset.delwh), 1); await saveSet(); renderSettings(); }
    else if (t.dataset.testwh) { const r = await fireWebhook(SET.webhooks[Number(t.dataset.testwh)].name); toast(r.ok ? "✓ Tetiklendi" : "✗ " + (r.hata || r.durum)); }
    else if (t.id === "pcTest") { toast("Bilgisayara gönderiliyor…"); const r = await pcCommand("notify", "Merhaba Burak, JARVIS bağlantısı çalışıyor ✓"); toast(r.bekliyor ? "Bilgisayar cevap vermedi (ajan açık mı?)" : "✓ Bilgisayar cevap verdi", 4000); }
    else if (t.id === "unlockBtn") { META.unlockedAt = 0; lockCheck(); }
  } catch (err) { toast(String(err.message || err), 4000); }
});
document.addEventListener("change", e => {
  const id = e.target.dataset && e.target.dataset.appst;
  if (id) { A.updateApplication({ id, status: e.target.value }); toast("Durum güncellendi"); }
});
const _baseLaunch = handleLaunch;
handleLaunch = async function (action) {
  if (!action) return;
  if (action === "weekly") return send("__weekly", true);
  if (action.startsWith("ask:")) return send(action.slice(4));
  if (action.startsWith("routine:")) { const r = S.routines.find(r => r.id === action.slice(8)); if (r) { go("home"); bubble("sys", "⚡ " + r.name); return runRoutine(r); } return; }
  return _baseLaunch(action);
};

/* =====================================================================
   v1.3 — DÜZELTMELER: doğru ses tanıma, kesin komutlar, gerçek alarm
   ===================================================================== */

/* ================= Türkçe sayı ve saat çözümleme ================= */
const NUMW = { "sıfır": 0, "bir": 1, "iki": 2, "üç": 3, "dört": 4, "beş": 5, "altı": 6, "yedi": 7, "sekiz": 8, "dokuz": 9, "on": 10, "yirmi": 20, "otuz": 30, "kırk": 40, "elli": 50, "altmış": 60, "yarım": 0.5 };
function wordsToDigits(t) {
  const out = []; let acc = null;
  const flush = () => { if (acc !== null) { out.push(String(acc)); acc = null; } };
  for (const x of t.split(" ")) {
    const base = x.split(/['’]/)[0]; const suf = x.slice(base.length); const v = NUMW[base];
    if (v !== undefined && base !== "yarım") {
      if (acc !== null && acc >= 10 && acc % 10 === 0 && v < 10) acc += v; else { flush(); acc = v; }
      if (suf) { out.push(acc + suf); acc = null; }
    } else { flush(); out.push(x); }
  }
  flush();
  return out.join(" ").replace(/(\d+) buçuk/g, "$1:30").replace(/yarım saat/g, "30 dakika");
}
const DAYIDX = { "pazar": 0, "pazartesi": 1, "salı": 2, "çarşamba": 3, "perşembe": 4, "cuma": 5, "cumartesi": 6 };
/** Metinden saat ve gün çıkarır. Dönüş: {h, m, dayOffset|null, weekday|null, repeat} ya da null */
function parseClock(t) {
  let m = t.match(/(?:saat\s*)?(\d{1,2})[:.](\d{2})/) || t.match(/saat\s*(\d{1,2})(?!\s*(?:dakika|dk|saniye|saat))/) || t.match(/(?:sabah|akşam|aksam|gece|öğlen|öğleden sonra|ikindi)\s*(\d{1,2})/) || t.match(/(\d{1,2})\s*(?:'?(?:de|da|te|ta|e|a|ye|ya))\b/);
  if (!m) return null;
  let h = Number(m[1]), mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return null;
  if (/(akşam|aksam|öğleden sonra|ikindi)/.test(t) && h < 12) h += 12;
  else if (/gece/.test(t) && h >= 7 && h < 12) h += 12;
  else if (/öğlen/.test(t) && h < 7) h += 12;
  const r = { h, m: mi, dayOffset: null, weekday: null, repeat: "none" };
  if (/yarın/.test(t)) r.dayOffset = 1; else if (/bugün/.test(t)) r.dayOffset = 0;
  for (const [k, v] of Object.entries(DAYIDX).sort((a, b) => b[0].length - a[0].length)) if (new RegExp("(?:^|\\s)" + k + "(?:ye|ya|e|a|günü|gunu)?(?=\\s|$)").test(t) && !/her\s/.test(t)) { r.weekday = v; break; }
  if (/her gün|hergün|her sabah|her akşam|her gece/.test(t)) r.repeat = "daily";
  else if (/hafta ?içi/.test(t)) r.repeat = "weekdays";
  else if (/hafta ?sonu/.test(t)) r.repeat = "weekend";
  else if (/her hafta|her (pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)/.test(t)) { r.repeat = "weekly"; const w = t.match(/her (pazartesi|salı|çarşamba|perşembe|cumartesi|cuma|pazar)/); if (w) r.weekday = DAYIDX[w[1]]; }
  return r;
}
function clockToDate(c) {
  const d = new Date(); d.setSeconds(0, 0); d.setHours(c.h, c.m);
  if (c.dayOffset !== null) d.setDate(d.getDate() + c.dayOffset);
  else if (c.weekday !== null) { let add = (c.weekday - d.getDay() + 7) % 7; if (add === 0 && d < new Date()) add = 7; d.setDate(d.getDate() + add); }
  else if (d < new Date()) d.setDate(d.getDate() + 1);
  return d;
}
function relDelta(t) {
  const m = t.match(/(\d+(?::30)?)\s*(saniye|sn|dakika|dk|saat)\s*(?:sonra|içinde|icinde|sonrasına|lık|lik|luk|lük)?/);
  if (!m) return null; let n = m[1].includes(":") ? Number(m[1].split(":")[0]) + 0.5 : Number(m[1]);
  const unit = m[2]; return Math.round(n * (unit.startsWith("sa") && unit !== "saniye" ? 3600 : unit === "saniye" || unit === "sn" ? 1 : 60));
}

/* ================= gerçek alarm ve zamanlayıcı (Saat uygulaması) ================= */
async function setClockAlarm({ h, m, label = "JARVIS", days = null }) {
  if (!Jarvis) { const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); A.addReminder({ text: "⏰ " + label, due: localISO(d) }); return { ok: true, yedek: "hatırlatıcı" }; }
  const r = await Jarvis.setAlarm({ hour: h, minute: m, message: label, days: days || [] });
  if (!r || !r.ok) { const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); A.addReminder({ text: "⏰ " + label, due: localISO(d) }); return { ok: true, yedek: "hatırlatıcı", not: (r && r.error) || "Saat uygulamasına alarm kurulamadı, JARVIS alarmı kuruldu." }; }
  return { ok: true, saat: `${pad(h)}:${pad(m)}`, gunler: days || [] };
}
async function setClockTimer(seconds, label = "JARVIS") {
  if (!Jarvis) { A.addReminder({ text: "⏱ " + label, due: localISO(new Date(Date.now() + seconds * 1000)) }); return { ok: true, yedek: "hatırlatıcı" }; }
  const r = await Jarvis.setTimer({ seconds, message: label });
  if (!r || !r.ok) { A.addReminder({ text: "⏱ " + label, due: localISO(new Date(Date.now() + seconds * 1000)) }); return { ok: true, yedek: "hatırlatıcı" }; }
  return { ok: true, saniye: seconds };
}
const DAYS_FOR = { daily: [1, 2, 3, 4, 5, 6, 0], weekdays: [1, 2, 3, 4, 5], weekend: [6, 0] };
const durTR = s => s >= 3600 ? `${Math.floor(s / 3600)} saat${s % 3600 ? " " + Math.round((s % 3600) / 60) + " dakika" : ""}` : s >= 60 ? `${Math.round(s / 60)} dakika` : `${s} saniye`;

/* ================= kesin komutlar: yapay zekâya gitmeden ================= */
async function quickCommand(raw) {
  const t0 = trLower(raw).replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  const t = wordsToDigits(t0);
  // ZAMANLAYICI
  if (/(zamanlayıcı|zamanlayici|geri ?sayım|kronometre|sayaç|timer)/.test(t)) {
    const s = relDelta(t); if (!s) return null;
    const r = await setClockTimer(s, "JARVIS");
    return { reply: `Zamanlayıcı başladı: ${durTR(s)}.`, act: "⏱ zamanlayıcı", r };
  }
  // ALARM / UYANDIR
  if (/(alarm|uyandır|uyandir|kaldır beni|uyanmam lazım)/.test(t) && !/(alarm(ı|i|ları|lari)? (sil|kapat|iptal))/.test(t)) {
    const rel = /sonra/.test(t) ? relDelta(t) : null;
    if (rel) {
      const d = new Date(Date.now() + rel * 1000);
      if (rel < 60 * 60 * 24) { const r = await setClockAlarm({ h: d.getHours(), m: d.getMinutes(), label: "JARVIS" }); return { reply: `Alarm ${pad(d.getHours())}:${pad(d.getMinutes())} için kuruldu.`, act: "⏰ alarm", r }; }
    }
    const c = parseClock(t); if (!c) return null;
    const label = (raw.match(/(?:için|icin)\s+(.{2,40})$/i) || [])[1] || "JARVIS";
    const days = DAYS_FOR[c.repeat] || (c.repeat === "weekly" && c.weekday !== null ? [c.weekday] : null);
    const when = clockToDate(c);
    const within24 = when - Date.now() < 864e5 + 6e4;
    if (days || within24) {
      const r = await setClockAlarm({ h: c.h, m: c.m, label, days });
      const dtxt = days ? (c.repeat === "daily" ? "her gün " : c.repeat === "weekdays" ? "hafta içi her gün " : c.repeat === "weekend" ? "hafta sonları " : `her ${DAYS[c.weekday]} `) : `${fmtWhen(localISO(when)).split(" ")[0]} `;
      return { reply: `Alarm kuruldu: ${dtxt}${pad(c.h)}:${pad(c.m)}.${r.yedek ? " (Saat uygulaması yerine JARVIS alarmı.)" : ""}`, act: "⏰ alarm", r };
    }
    // 24 saatten uzak tarih: Saat uygulaması tarih desteklemez → JARVIS alarmı (bildirim) kur
    A.addReminder({ text: "⏰ Alarm" + (label !== "JARVIS" ? ": " + label : ""), due: localISO(when) });
    return { reply: `${fmtWhen(localISO(when))} için alarm kurdum.`, act: "⏰ alarm" };
  }
  // HATIRLATICI (net kalıplar)
  if (/hatırlat|hatirlat|unutturma/.test(t)) {
    const what = s => s.replace(/(bana|beni|lütfen|jarvis|hey)/g, " ").replace(/\b(mi|mı|da|de)\b/g, " ").replace(/\s+/g, " ").trim();
    const m1 = t.match(/(\d+(?::30)?)\s*(dakika|dk|saat)\s*sonra\s+(.+?)\s*(?:diye\s*)?(?:hatırlat|hatirlat|unutturma)/);
    const m2 = m1 ? null : t.match(/(.+?)\s+(\d+(?::30)?)\s*(dakika|dk|saat)\s*sonra\s*(?:hatırlat|hatirlat)/);
    if (m1 || m2) {
      const rel = relDelta(t); const body = m1 ? m1[3] : m2[1];
      const txt = what(body.replace(/(mayı|meyi|mamı|memi|masını|mesini)$/, ""));
      if (rel && txt.length > 1) { const d = new Date(Date.now() + rel * 1000); A.addReminder({ text: txt.charAt(0).toLocaleUpperCase("tr-TR") + txt.slice(1), due: localISO(d) }); return { reply: `Tamam, saat ${pad(d.getHours())}:${pad(d.getMinutes())} olunca "${txt}" diye hatırlatacağım.`, act: "⏰ hatırlatıcı" }; }
    }
  }
  return null;
}

/* ================= Gemini ile ses anlama (Türkçe + İngilizce) ================= */
let GEM_REC = null;
async function listenGemini() {
  const rec = new WavRecorder(); GEM_REC = rec;
  let base = 0, nBase = 0, speechAt = 0, lastLoud = 0; const t0 = Date.now();
  rec.onLevel = rms => {
    const now = Date.now();
    if (now - t0 < 350) { base += rms; nBase++; return; }
    const floor = nBase ? base / nBase : 0.005; const thr = Math.max(0.018, floor * 3.2);
    if (rms > thr) { if (!speechAt) speechAt = now; lastLoud = now; }
    const bar = Math.min(1, rms / (thr * 3)); $("#reactor").style.setProperty("--lvl", bar.toFixed(2));
  };
  await rec.start();
  await new Promise(res => {
    const iv = setInterval(() => {
      const now = Date.now();
      if (rec.stopNow || (speechAt && now - lastLoud > 1400) || (!speechAt && now - t0 > 7000) || now - t0 > 20000) { clearInterval(iv); res(); }
    }, 120);
  });
  const hadSpeech = !!speechAt; const b64 = await rec.stop(); GEM_REC = null;
  if (!hadSpeech) return null;
  setMode("think", "Anlıyorum…");
  const txt = await plainGemini("Bu ses kaydında Burak'ın söylediğini kelimesi kelimesine yazıya dök. Konuşma Türkçe ağırlıklıdır, araya İngilizce kelime/isim girebilir (ör. JARVIS, Netflix, self-tape): her kelimeyi söylendiği dilde ve doğru yazımla yaz. Saatleri rakamla yaz (ör. 07:30). Sadece dökümü yaz; açıklama, tırnak, yorum ekleme. Anlaşılır bir konuşma yoksa sadece ### yaz.", [{ inlineData: { mimeType: "audio/wav", data: b64 } }]);
  const clean = String(txt || "").replace(/^["'“]|["'”]$/g, "").trim();
  return !clean || clean.includes("###") ? null : clean;
}

/* ================= araç çağırmadan "yaptım" demeyi engelle ================= */
const CMD_RX = /(alarm|hatırlat|hatirlat|kur(?=\s|$)|ekle|not al|kaydet|sil(?=\s|$)|ara(?=\s|$)|arar mısın|aç(?=\s|$)|gönder|yaz(?=\s|$)|başlat|ayarla|uyandır|zamanlayıcı)/i;
const CLAIM_RX = /(kurdum|kuruldu|ekledim|eklendi|ayarladım|ayarlandı|kaydettim|kaydedildi|hatırlatacağım|açıyorum|açtım|arıyorum|gönderdim|başlattım|sildim|not aldım)/i;

/* ================= yeni araçlar ================= */
TOOLS.unshift(
  T("alarm_kur", "Telefonun Saat uygulamasına GERÇEK alarm kurar (çalar saat). 'Alarm kur', 'beni uyandır' isteklerinde bunu kullan. Tarih desteklemez; 24 saatten uzak tek seferlik alarmlar için hatirlatici_ekle kullan.", { saat: str("HH:mm (24 saat)"), etiket: str("Alarm adı"), tekrar: str("Tekrar", ["none", "daily", "weekdays", "weekend"]) }, ["saat"],
    async a => { const [h, m] = String(a.saat).split(":").map(Number); if (isNaN(h)) return { hata: "Saat anlaşılmadı" }; return setClockAlarm({ h, m: m || 0, label: a.etiket || "JARVIS", days: DAYS_FOR[a.tekrar] || null }); }),
  T("zamanlayici_kur", "Saat uygulamasında geri sayım zamanlayıcısı başlatır.", { saniye: num("Toplam saniye"), etiket: str("Ad") }, ["saniye"], a => setClockTimer(Math.max(1, Math.round(a.saniye)), a.etiket || "JARVIS"))
);
Object.assign(ACT_TR, { alarm_kur: "⏰ alarm", zamanlayici_kur: "⏱ zamanlayıcı" });

/* ================= sistem testi ================= */
async function diagnostics() {
  const rows = []; const ok = (b, t, extra = "") => rows.push(`<div class="perm"><span>${t}${extra ? `<br><small style="color:var(--dim)">${esc(extra)}</small>` : ""}</span><span class="${b ? "ok" : "no"}">${b ? "✓" : "✗"}</span></div>`);
  infoBox("SİSTEM TESTİ", "Kontrol ediliyor…");
  try { const r = await plainGemini("Sadece 'tamam' yaz."); ok(!!r, "Beyin (Gemini)", `model: ${SET.geminiModel}`); } catch (e) { ok(false, "Beyin (Gemini)", e.message === "NOKEY" ? "Anahtar girilmemiş" : e.message); }
  if (NATIVE) {
    const p = await nat(() => Jarvis.permissionsStatus(), {}) || {}; PERM = p;
    ok(p.notifications, "Bildirim izni", p.notifications ? "" : "Ayarlar → İzinler → Bildirim");
    ok(p.exactAlarm, "Tam zamanlı alarm", p.exactAlarm ? "" : "Olmadan hatırlatıcılar gecikebilir");
    ok(p.microphone, "Mikrofon");
    const al = await nat(() => Jarvis.canSetAlarm(), {}); ok(al && al.ok, "Saat uygulamasına alarm", al && al.app ? al.app : "Saat uygulaması bulunamadı → JARVIS alarmı kullanılır");
    const pend = await nat(() => LN.getPending(), { notifications: [] }); ok(true, "Bekleyen JARVIS alarmı", String((pend.notifications || []).length));
    const w = await nat(() => Jarvis.wakeStatus(), {}); ok(!SET.wake || (w && w.status === "listening"), "Hey Jarvis", w ? w.status : "-");
    ok(p.battery, "Pil kısıtlaması kapalı", p.battery ? "" : "Arka planda kapanabilir");
  }
  const trv = voices.filter(v => /^tr/i.test(v.lang)).length; ok(trv > 0, "Türkçe ses", `${trv} ses`);
  ok(SET.stt === "gemini" ? !!SET.geminiKey : true, "Ses tanıma", SET.stt === "gemini" ? "Gemini (Türkçe + İngilizce)" : "Google (cihaz)");
  infoBox("SİSTEM TESTİ", rows.join("") + `<div class="row" style="margin-top:10px"><button class="btn ghost sm" id="testNotif">1 dk sonra test bildirimi</button><button class="btn ghost sm" id="testAlarm">2 dk sonra test alarmı</button></div>`);
  $("#testNotif").onclick = () => { A.addReminder({ text: "Test bildirimi ✓ Hatırlatıcılar çalışıyor.", due: localISO(new Date(Date.now() + 65e3)) }); toast("1 dakika sonra bildirim gelecek"); };
  $("#testAlarm").onclick = async () => { const d = new Date(Date.now() + 2 * 6e4 + 3e4); const r = await setClockAlarm({ h: d.getHours(), m: d.getMinutes(), label: "JARVIS test" }); toast(r.yedek ? "Saat uygulaması yok → JARVIS alarmı kuruldu" : `Saat uygulamasına ${pad(d.getHours())}:${pad(d.getMinutes())} alarmı kuruldu`, 4000); };
}

/* ================= ayarlara: ses tanıma ve uyandırma hassasiyeti ================= */
{
  const base = renderSettings;
  renderSettings = async function () {
    await base();
    const ses = [...document.querySelectorAll("#b-set .card")].find(c => /^SES$/.test(c.querySelector("h3").textContent.trim()));
    if (ses) ses.querySelector(".form").insertAdjacentHTML("afterbegin", `<div class="lbl">Ses tanıma motoru</div><select data-set="stt"><option value="gemini" ${SET.stt === "gemini" ? "selected" : ""}>Gemini — Türkçe + İngilizce, en doğru</option><option value="google" ${SET.stt === "google" ? "selected" : ""}>Google (cihaz) — hızlı, internetsiz de çalışır</option></select>`);
    const hj = [...document.querySelectorAll("#b-set .card")].find(c => /^HEY JARVIS$/.test(c.querySelector("h3").textContent.trim()));
    if (hj) hj.insertAdjacentHTML("beforeend", `<label class="toggle"><span>Sadece "Hey Jarvis" ile uyan<small>Tek başına "Jarvis" yetmez; yanlış uyanmayı büyük ölçüde engeller</small></span><input type="checkbox" class="sw" data-set="wakeStrict" ${SET.wakeStrict ? "checked" : ""}></label>
      <div class="lbl">Hassasiyet</div><select data-set="wakeConf"><option value="0.96" ${SET.wakeConf >= 0.95 ? "selected" : ""}>Düşük — çok nadir yanlış uyanır</option><option value="0.92" ${SET.wakeConf >= 0.9 && SET.wakeConf < 0.95 ? "selected" : ""}>Orta (önerilen)</option><option value="0.85" ${SET.wakeConf < 0.9 ? "selected" : ""}>Yüksek — uzaktan da duyar, ara sıra yanılır</option></select>`);
    $("#b-set").insertAdjacentHTML("afterbegin", `<div class="card"><div class="row"><div class="hint" style="margin:0">Bir şey çalışmıyorsa önce sistem testini çalıştır.</div><button class="btn sm" id="diagBtn">🩺 Sistem testi</button></div></div>`);
  };
  const baseSet = onSetChange;
  onSetChange = async function (el) {
    const k = el.dataset.set;
    if (k === "wakeStrict" || k === "wakeConf") {
      SET[k] = k === "wakeConf" ? Number(el.value) : el.checked; await saveSet();
      if (Jarvis) nat(() => Jarvis.setWakeOptions({ strict: !!SET.wakeStrict, conf: Number(SET.wakeConf) }));
      return toast("Uyandırma ayarı güncellendi");
    }
    return baseSet(el);
  };
}
document.addEventListener("click", e => { if (e.target.closest("#diagBtn")) diagnostics(); });

/* ================= açılış ================= */
async function boot() {
  await loadAll();
  try { const f = JSON.parse(await kvGet("jarvis_focus") || "null"); if (f) FOCUS = f; } catch {}
  try { const m = JSON.parse(await kvGet("jarvis_meta") || "null"); if (m) META = Object.assign(META, m); } catch {}
  seedRoutines(); rollGoals();
  if (Jarvis) PERM = await nat(() => Jarvis.permissionsStatus(), {}) || {};
  bind(); clock(); setInterval(clock, 10000); drawChat(); renderAll();
  if (FOCUS.until && FOCUS.until < Date.now()) endFocus(true); else tickFocus();
  if (NATIVE) {
    sweepPast(); reschedule(); updateWidget();
    nat(() => Jarvis.ensureChannel());
    const perm = await nat(() => LN.checkPermissions(), {});
    if (perm && perm.display !== "granted") await nat(() => LN.requestPermissions());
    LN && LN.addListener("localNotificationActionPerformed", ev => { const x = ev.notification && ev.notification.extra; if (x && x.action) handleLaunch(x.action); else if (x && x.rid) { go("plan"); openSec("plan", "reminders"); } });
    LN && LN.addListener("localNotificationReceived", n => { if (n.extra && n.extra.rid) speak("Burak, hatırlatma: " + n.body, true); if (n.extra && n.extra.action === "focusEnd") endFocus(); });
    Jarvis.addListener("launch", ev => handleLaunch(ev.action));
    Jarvis.addListener("partial", ev => { $("#q").value = ev.text || ""; });
    Jarvis.addListener("wakeStatus", showWake);
    AppP && AppP.addListener("resume", () => { lockCheck(); sweepPast(); pullSync(); proactive(); if (FOCUS.until && FOCUS.until < Date.now()) endFocus(true); nat(() => Jarvis.permissionsStatus()).then(p => { if (p) PERM = p; }); });
    AppP && AppP.addListener("pause", () => { if (SET.lock) META.unlockedAt = Math.min(META.unlockedAt || 0, Date.now()); saveMeta(); });
    Jarvis.addListener("headset", () => voiceTurn(true));
    lockCheck();
    AppP && AppP.addListener("backButton", () => { if ($("#modal").classList.contains("on")) $("#modal").classList.remove("on"); else if (!$("#v-home").classList.contains("on")) go("home"); else AppP.minimizeApp(); });
    await nat(() => Jarvis.setWakeOptions({ strict: !!SET.wakeStrict, conf: Number(SET.wakeConf) || 0.92 }));
    if (SET.wake) nat(() => Jarvis.startWake());
    const la = await nat(() => Jarvis.getLaunchAction(), {}); if (la && la.action) handleLaunch(la.action);
  } else {
    setInterval(webTick, 5000); webTick();
    if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = loadVoices;
  }
  loadVoices(); await pullSync();
  setTimeout(() => proactive(), 2500);
  if (SET.scriptUrl && (SET.radars || []).length) nat(() => radarCheck());
  // klavye kısayolları (bilgisayar/tablet)
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); go("home"); $("#q").focus(); }
    else if (e.key === "Escape") { if ($("#modal").classList.contains("on")) $("#modal").classList.remove("on"); else if (speaking) stopSpeaking(); }
    else if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); go("home"); $("#q").focus(); }
  });
  if (!NATIVE && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!SET.geminiKey && !SET.claudeKey) bubble("sys", "İlk adım: Ayarlar → Beyin'e ücretsiz Gemini anahtarını gir.");
}
boot();
})();
