/* Titus — Burak'ın kişisel asistanı
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
const Jarvis = plug("Jarvis"); // yerel eklentinin adı; değiştirme (Android tarafında "Jarvis" olarak kayıtlı)
const LN = plug("LocalNotifications");
const TTS = plug("TextToSpeech");
const Prefs = plug("Preferences");
const AppP = plug("App");
const Haptics = plug("Haptics");
async function nat(fn, fallback = null) { try { return await fn(); } catch (e) { console.warn(e); return fallback; } }

/* ================= depolama ================= */
const EMPTY = () => ({ reminders: [], tasks: [], notes: [], geo: [], memory: [], expenses: [], habits: [], auditions: [], shifts: [], projects: [], routines: [], dates: [], bills: [], applications: [], goals: [], journal: [], updatedAt: 0 });
const DEF_SET = {
  provider: "gemini", geminiKey: "", geminiModel: "gemini-3.8-flash", claudeKey: "", claudeModel: "claude-haiku-5-5", claudeSmart: "claude-sonnet-5-5",
  personality: "esprili", voiceIdx: -1, rate: 1.0, pitch: 0.9, speakReplies: true, followUp: true,
  wake: false, scriptUrl: "", scriptToken: "", briefTime: "08:30", briefOn: true, eveningTime: "", city: "İstanbul", lat: 41.01, lng: 28.98,
  name: "Burak", budget: 0, lock: false, headset: false, homeLat: null, homeLng: null, partnerName: "Kübra", autoSendWa: false,
  kadroSheetId: "", ntfyTopic: "", radars: [], webhooks: [], proactive: true,
  stt: "gemini", wakeStrict: false, wakeConf: 0.92, speed: "hizli", greetVoice: false, sttModel: "gemini-3.5-flash-lite",
  live: true, liveVoice: "Charon", liveIdle: 45, liveDuplex: false, voiceEngine: "gemini", ttsVoice: "Charon", groqKey: "", groqModel: "llama-3.3-70b-versatile", convo: true
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
  if (((SET.stt === "groq" && SET.groqKey) || (SET.stt === "gemini" && SET.geminiKey)) && navigator.onLine && navigator.mediaDevices) {
    try {
      if (Jarvis) await nat(() => Jarvis.pauseWake());
      $("#q").placeholder = "● Dinliyorum… (bitince sus, kendim anlarım)";
      text = await sttCapture(); done = true;
    } catch (e) { console.warn("gemini stt", e); GEM_REC = null; }
    $("#q").placeholder = "Titus'a söyle…";
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
  if (SET.live && !LIVE) { if (greet && !SET.greetVoice) beepUp(); if (await startLive()) return; }
  if (greet) { if (SET.greetVoice) await speak("Efendim?", true); else { beepUp(); if (Haptics) nat(() => Haptics.impact({ style: "MEDIUM" })); } }
  const t = await listen();
  if (t) await send(t, true); else resumeWake();
}
// Bağlantıyı önceden ısıt: ilk komutta TLS el sıkışmasını beklemeyelim
function warmUp() { if (SET.geminiKey && navigator.onLine) fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(SET.geminiKey)}`).catch(() => {}); }
let _ac = null;
function beepUp() {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = _ac.createOscillator(), g = _ac.createGain(); o.type = "sine"; o.connect(g); g.connect(_ac.destination);
    const t = _ac.currentTime; o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(1180, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.start(t); o.stop(t + 0.2);
  } catch {}
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

/* ================= iş mantığı (UI + Titus araçları ortak) ================= */
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
    if (r.repeat === "daily") N("r" + r.id, "Titus", r.text, { on }, { rid: r.id });
    else if (r.repeat === "weekly") N("r" + r.id, "Titus", r.text, { on: { ...on, weekday: d.getDay() + 1 } }, { rid: r.id });
    else if (r.repeat === "monthly") N("r" + r.id, "Titus", r.text, { on: { ...on, day: d.getDate() } }, { rid: r.id });
    else if (r.repeat === "weekdays") for (let w = 2; w <= 6; w++) N("r" + r.id + w, "Titus", r.text, { on: { ...on, weekday: w } }, { rid: r.id });
    else if (d > now) N("r" + r.id, "Titus", r.text, { at: d }, { rid: r.id });
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

/* ================= Titus araçları ================= */
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
  const tasks = S.tasks.filter(t => !t.done).slice(0, 25).map(t => `- [${t.id}] ${t.text}${t.date ? " @ " + t.date : ""}${t.project ? " #" + t.project : ""}`).join("\n") || "(yok)";
  const doneToday = S.tasks.filter(t => t.done).slice(-10).map(t => `- [${t.id}] ✔ ${t.text}`).join("\n");
  const notes = S.notes.slice(0, 10).map(n => `- [${n.id}] ${n.text.slice(0, 120)}${n.project ? " #" + n.project : ""}`).join("\n") || "(yok)";
  const mem = S.memory.map(m => `- [${m.id}] ${m.text}`).join("\n") || "(yok)";
  const aud = S.auditions.filter(a => !a.done).map(a => `- [${a.id}] ${a.type}: ${a.title} @ ${a.date || "?"} ${a.place || ""}`).join("\n") || "(yok)";
  const sh = S.shifts.filter(s => s.date >= ymd(new Date(Date.now() - 864e5))).map(s => `- [${s.id}] ${s.date} ${s.start}-${s.end} ${s.place}`).join("\n") || "(yok)";
  const pr = S.projects.map(p => `- ${p.name}: ${p.status || "-"} → ${p.next || "-"} (${p.updated || ""})`).join("\n") || "(yok)";
  const hb = S.habits.map(h => `- ${h.name}: bugün ${h.log.includes(ymd(d)) ? "yapıldı" : "yapılmadı"}, seri ${streak(h)} gün`).join("\n") || "(yok)";
  const geo = S.geo.filter(g => g.active).map(g => `- [${g.id}] ${g.text} @ ${g.place}`).join("\n") || "(yok)";
  const tone = SET.personality === "resmi" ? "Resmi, kibar ve kısa konuş; espri yapma." : "Iron Man'deki JARVIS tarzında ama adın Titus; zeki, sakin, hafif esprili ve sadık ol; ara sıra 'efendim' de.";
  return `Sen Titus'sun, ${SET.name}'ın kişisel sesli asistanısın. ${tone}
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
GEÇMİŞ HAFTALARIN ÖZETİ:\n${(S.journal || []).slice(-4).map(j => `(${j.week}) ${j.text}`).join("\n") || "(yok)"}
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
/* ---------- hız: düşünme seviyesi, araç seçimi, yerel onay ---------- */
const NO_THINK = new Set();
function thinkCfg(model, level) {
  if (NO_THINK.has(model)) return null;
  if (/gemini-2\.5/.test(model)) return /pro/.test(model) ? null : { thinkingBudget: 0 };
  if (/lite/.test(model)) return { thinkingLevel: "minimal" };
  return { thinkingLevel: level || "low" };
}
const TOOL_CORE = ["hatirlatici_ekle", "hatirlatici_sil", "alarm_kur", "zamanlayici_kur", "gorev_ekle", "gorev_tamamla", "gorev_sil", "not_al", "hafiza_kaydet", "internette_ara", "hava_durumu", "rutin_calistir", "uygulama_ac", "ara", "whatsapp_mesaj"];
const TOOL_GROUPS = [
  [/harcama|lira|\btl\b|₺|para|bütçe|fatura|abonelik|ödeme|kira|harcad/, ["harcama_ekle", "harcama_ozeti", "fatura_ekle", "butce_ayarla"]],
  [/alışkanlık|aliskanlik|seri|su iç|spor yaptım|okudum/, ["aliskanlik_ekle", "aliskanlik_isaretle"]],
  [/seçme|secme|casting|çekim|cekim|prova|self|başvur|basvur|callback|rol|ajans|recast|hedef|kadro|oyuncu/, ["secme_ekle", "secme_sil", "basvuru_ekle", "basvuru_guncelle", "hedef_ekle", "hedef_ilerlet", "kadro_sorgula", "replik_modu", "mail_taslagi"]],
  [/vardiya|bar|mesai|işe gid|ise gid/, ["vardiya_ekle", "vardiya_sil"]],
  [/proje|oyun|galerici|kod|uygulamam|geliştir/, ["proje_guncelle"]],
  [/odak|pomodoro|çalışacağım|ders|konsantre/, ["odak_baslat", "odak_bitir"]],
  [/takvim|toplantı|randevu|etkinlik|bugün|yarın|hafta|program/, ["takvim_listele", "takvim_ekle"]],
  [/mail|e-?posta|gmail|ileti|taslak/, ["mail_ozeti", "mail_taslagi"]],
  [/bildirim|kim yazdı|mesaj(lar)?ım|ne gelmiş/, ["bildirimleri_oku"]],
  [/sms/, ["sms_hazirla"]],
  [/link|site|harita|yol|nasıl gider|kaç dakika|trafik|toplu taşıma|metro|vapur|otobüs|çıkmalıyım/, ["link_ac", "yol_suresi", "yol_tarifi"]],
  [/fener|flaş/, ["fener"]],
  [/sessiz|rahatsız|dnd/, ["rahatsiz_etme"]],
  [/varınca|gidince|vardığımda|konum|oraya gelince/, ["konum_hatirlatici_ekle"]],
  [/unut|hafıza|hafiza|aklında/, ["hafiza_sil"]],
  [/not/, ["not_sil"]],
  [/rutin/, ["rutin_olustur"]],
  [/uyku|yatıyorum|iyi geceler|uyuyacağım/, ["uyku_modu"]],
  [/doğum|yıldönüm|özel gün|anma/, ["ozel_gun_ekle"]],
  [/ekran|dokun|bas\b|tıkla|kaydır|geri git|ana ekran|yaz\b|gönder'e/, ["ekrani_gor", "ekranda_dokun", "ekrana_yaz", "ekran_hareket"]],
  [/ışı|priz|klima|akıllı|lamba|televizyon/, ["akilli_ev"]],
  [/bilgisayar|\bpc\b|laptop|masaüstü/, ["bilgisayar"]],
  [/radar|ilan|kiralık/, ["radar_kontrol"]]
];
function pickTools(history) {
  const recent = history.filter(m => m.role === "user").slice(-2).map(m => trLower(m.content)).join(" ");
  if (/brifing|gün sonu|haftalık rapor|planla|hazırla|ne var/.test(recent)) return TOOLS;
  const names = new Set(TOOL_CORE);
  for (const [rx, list] of TOOL_GROUPS) if (rx.test(recent)) list.forEach(n => names.add(n));
  return TOOLS.filter(t => names.has(t.name));
}
const QUICK_OK = {
  hatirlatici_ekle: r => r.due ? `Tamam, ${fmtWhen(r.due)} hatırlatacağım${r.repeat && r.repeat !== "none" ? " (" + REP[r.repeat] + ")" : ""}.` : null,
  alarm_kur: r => r.yedek ? "Alarm kuruldu." : `Alarm ${r.saat} için kuruldu.`,
  zamanlayici_kur: () => "Zamanlayıcı başladı.",
  gorev_ekle: () => "Görevlere ekledim.", gorev_tamamla: () => "Tamamlandı olarak işaretledim.", gorev_sil: () => "Görevi sildim.",
  not_al: () => "Not aldım.", not_sil: () => "Notu sildim.", hafiza_kaydet: () => "Aklımda tutacağım.", hatirlatici_sil: () => "Hatırlatıcıyı sildim.",
  harcama_ekle: r => `${money(r.amount)} ${r.category} olarak kaydettim.${r.uyari ? " " + r.uyari : ""}`,
  fener: r => r.on ? "Fener açık." : "Fener kapalı.", rahatsiz_etme: r => r.ok ? (r.on ? "Sessize aldım." : "Sesi açtım.") : null,
  uygulama_ac: r => r.opened ? `${r.label} açılıyor.` : null,
  vardiya_ekle: () => "Vardiyayı ekledim; 1 saat önce ve bitişte haber vereceğim.",
  secme_ekle: () => "Kaydettim; bir gün önce akşam ve 2 saat önce hatırlatacağım.",
  aliskanlik_isaretle: r => `${r.name}: ${r.done ? "işaretlendi" : "geri alındı"}, seri ${r.streak} gün.`,
  fatura_ekle: () => "Ekledim; 2 gün önceden hatırlatacağım.", ozel_gun_ekle: () => "Ekledim; 3 gün önce ve gününde hatırlatacağım.",
  basvuru_ekle: () => "Başvuruyu kaydettim; 7 gün sonra takip için hatırlatacağım.", basvuru_guncelle: r => `Durum güncellendi: ${r.status}.`,
  hedef_ekle: () => "Hedefi ekledim.", hedef_ilerlet: r => `${r.text}: ${r.count}/${r.target}.`,
  odak_baslat: r => `${r.minutes} dakikalık odak başladı.`, proje_guncelle: () => "Proje durumunu kaydettim."
};
function quickConfirm(results) {
  const out = [];
  for (const { name, res } of results) {
    const f = QUICK_OK[name]; if (!f || !res || res.hata || res.iptal || res.ok === false) return null;
    const t = f(res); if (!t) return null; out.push(t);
  }
  return out.length ? out.join(" ") : null;
}
let LAST_MS = 0;
async function askGemini(history, onAct, attach) {
  if (!SET.geminiKey) throw new Error("NOKEY");
  const t0 = Date.now();
  const contents = history.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (attach && attach.length) contents[contents.length - 1].parts.unshift(...attach.map(a => ({ inlineData: { mimeType: a.mime, data: a.data } })));
  const tools = pickTools(history);
  const decl = tools.map(t => { const d = { name: t.name, description: t.description }; if (Object.keys(t.props).length) { d.parameters = schemaFor(t, true); if (!t.required.length) delete d.parameters.required; } return d; });
  const sys = systemPrompt();
  const models = [SET.geminiModel, ...GEMINI_FALLBACK.filter(m => m !== SET.geminiModel)];
  let mi = 0;
  const body = () => {
    const gc = { temperature: 0.4, maxOutputTokens: 2048 }; const th = thinkCfg(models[mi], (SET.speed === "akilli" || CUR_DEEP) ? "medium" : "low"); if (th) gc.thinkingConfig = th;
    return { systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: decl }], generationConfig: gc };
  };
  for (let step = 0; step < 12; step++) {
    let j;
    for (;;) {
      try { j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${models[mi]}:generateContent?key=${encodeURIComponent(SET.geminiKey)}`, body()); break; }
      catch (e) {
        if (e.status === 400 && /thinking/i.test(e.message) && !NO_THINK.has(models[mi])) { NO_THINK.add(models[mi]); continue; }
        if ((e.status === 404 || e.status === 429 || e.status === 400 && /model/i.test(e.message)) && mi < models.length - 1) { mi++; continue; }
        if (e.status === 429) { const q = new Error("Ücretsiz Gemini kotası doldu, biraz sonra tekrar dene."); q.status = 429; throw q; }
        throw e;
      }
    }
    if (mi > 0 && SET.geminiModel !== models[mi]) { SET.geminiModel = models[mi]; saveSet(); }
    const cand = j.candidates && j.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const calls = parts.filter(p => p.functionCall);
    if (!calls.length) { LAST_MS = Date.now() - t0; return parts.filter(p => p.text && !p.thought).map(p => p.text).join("").trim(); }
    contents.push(cand.content);
    const responses = [], results = [];
    for (const p of calls) { onAct(p.functionCall.name); const res = await runTool(p.functionCall.name, p.functionCall.args); results.push({ name: p.functionCall.name, res }); responses.push({ functionResponse: { name: p.functionCall.name, response: { result: res } } }); }
    // Basit işlerde ikinci kez yapay zekâya sormadan onayla (≈1-2 sn kazanç)
    if (step === 0) { const q = quickConfirm(results); if (q) { LAST_MS = Date.now() - t0; return q; } }
    contents.push({ role: "user", parts: responses });
  }
  LAST_MS = Date.now() - t0;
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

let busy = false, STREAMQ = null, STREAMED = false;
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
  if (text === "__brief") {
    let pre = null; try { pre = await prefetchBrief(); } catch {}
    prompt = "Günaydın! Günlük brifingimi ver: hava durumu, bugünkü takvim ve hatırlatıcılar, seçme/çekim ve vardiyalar, açık görevler, varsa önemli okunmamış mailler. Sonunda kısa bir motivasyon cümlesi." +
      (pre ? "\nHAZIR VERİLER (bunları kullan, takvim/mail/hava araçlarını tekrar çağırma):\n" + JSON.stringify({ hava: pre.hava, takvim: pre.takvim, mailler: (pre.mailler || []).slice(0, 6), gece_raporu: pre.gece || undefined }).slice(0, 7000) : "");
  }
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
    CUR_DEEP = smart || /karşılaştır|neden|nasıl yap|öner|hazırla|haftamı|değerlendir|fikir/i.test(prompt) || prompt.length > 220;
    if ((byVoice || SET.speakReplies) && !attach) { STREAMQ = new SpeechQueue(); CUR_Q = STREAMQ; ON_DELTA = d => { STREAMED = true; STREAMQ.push(d); }; }
    const useClaude = SET.provider === "claude" && SET.claudeKey && !(attach && attach.some(a => !a.mime.startsWith("image/")));
    try { out = useClaude ? await askClaude(hist, onAct, smart, attach) : await askGemini(hist, onAct, attach); }
    catch (e1) {
      // Gemini kotası/arızası: Groq yedek beyne geç
      if (!useClaude && SET.groqKey && !attach && (e1.status === 429 || e1.status >= 500 || /kota|quota|overload|unavailable/i.test(e1.message))) { onAct("groq"); out = await askGroq(hist, onAct); }
      else throw e1;
    }
    ON_DELTA = null;
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
    else out = friendlyErr(e);
  }
  ON_DELTA = null;
  span.textContent = out;
  { const a = document.createElement("div"); a.className = "acts"; a.textContent = [...acts, LAST_MS ? (LAST_MS / 1000).toFixed(1) + " sn" : ""].filter(Boolean).join(" · "); if (a.textContent) span.parentElement.appendChild(a); LAST_MS = 0; }
  CHAT.push({ role: "assistant", content: out }); saveChat();
  busy = false; setMode("", "Hazır");
  const sq = STREAMQ; STREAMQ = null;
  if (sq && STREAMED) { STREAMED = false; await sq.finish(); if (CUR_Q === sq) CUR_Q = null; }
  else { STREAMED = false; if (byVoice || SET.speakReplies) await speak(out, byVoice); }
  // Sohbet modu: cevaptan sonra "Hey Titus" demeden devam et
  if (byVoice && (SET.convo || (SET.followUp && /\?\s*$/.test(out)))) { const t = await listen(); if (t) return send(t, true); }
  resumeWake();
}

/* ================= arayüz: sohbet ================= */
function setMode(m, s) { $("#reactor").className = "reactor" + (m ? " " + m : ""); $("#status").textContent = s; }
function bubble(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + (role === "user" ? "u" : role === "sys" ? "sys" : "j");
  if (role === "assistant") el.innerHTML = "<b>Titus</b>";
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
      return `<div class="card"><h3>ODAK MODU</h3><div class="form"><input id="focusLabel" placeholder="Ne üzerinde çalışacaksın?"><div class="row">${[25, 45, 60, 90].map(m => `<button class="btn ghost" data-focus="${m}">${m} dk</button>`).join("")}</div></div><div class="hint">Bildirimleri susturur, bitince haber verir. "Titus, 45 dakika odak başlat" da diyebilirsin.</div></div>`;
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
    <select data-set="personality"><option value="esprili" ${SET.personality === "esprili" ? "selected" : ""}>Kişilik: Esprili Titus</option><option value="resmi" ${SET.personality === "resmi" ? "selected" : ""}>Kişilik: Resmi</option></select>
    <button class="btn ghost sm" id="testVoice">Sesi dene</button>
    <div class="hint">Daha doğal ses için telefonda Ayarlar → Metin okuma → Google motoru → Türkçe ses verilerini indir.</div></div></div>

  <div class="card"><h3>HEY Titus</h3>
    ${tg("wake", "Uyandırma kelimesi", "Ekran kapalıyken bile \"Titus\" dinler. İlk açılışta ~40 MB ses modeli iner. Pil kullanır.")}
    <div class="hint" id="wakeStatus">${NATIVE ? "" : "Sadece Android uygulamasında çalışır."}</div></div>

  <div class="card"><h3>BRİFİNG</h3>
    ${tg("briefOn", "Sabah brifingi bildirimi")}
    <div class="row"><div><div class="lbl">Sabah</div><input type="time" data-set="briefTime" value="${esc(SET.briefTime)}"></div><div><div class="lbl">Gün sonu (boş=kapalı)</div><input type="time" data-set="eveningTime" value="${esc(SET.eveningTime)}"></div></div>
    <div class="lbl">Şehir (hava durumu)</div><div class="row"><input id="cityIn" value="${esc(SET.city)}"><button class="btn ghost sm" id="citySave">Kaydet</button></div></div>

  <div class="card"><h3>İZİNLER</h3>
    ${NATIVE ? [P("notifications", "Bildirim", "Hatırlatıcılar için"), P("exactAlarm", "Tam zamanlı alarm", "Alarmlar dakikasında çalsın"), P("microphone", "Mikrofon", "Sesli komut"), P("contacts", "Rehber", "\"Annemi ara\""), P("phone", "Telefon", "Doğrudan arama"), P("notificationAccess", "Bildirim erişimi", "Gelen bildirimleri okuma"), P("dndAccess", "Rahatsız etme erişimi", "Odak modu"), P("location", "Konum", "Konum hatırlatmaları"), P("backgroundLocation", "Konum: her zaman", "Uygulama kapalıyken konum hatırlatması"), P("overlay", "Diğer uygulamaların üzerinde", "Hey Titus ile ekranı açabilmek"), P("battery", "Pil kısıtlamasız", "Arka planda kapanmasın")].join("") : `<div class="hint">İzinler Android uygulamasında görünür.</div>`}
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
    <div class="hint">Titus v3.0 · ${NATIVE ? "Android" : "Web"} · Tüm veriler cihazında.</div></div>`;
  if (Jarvis) nat(() => Jarvis.wakeStatus()).then(r => r && showWake(r));
}
function showWake(r) {
  const el = $("#wakeStatus"); if (!el || !r) return;
  const M = { off: "Kapalı", downloading: `Ses modeli indiriliyor… ${r.progress || 0}%`, loading: "Model yükleniyor…", listening: "🟢 Dinliyor: \"Hey Titus\" de.", paused: "Duraklatıldı (konuşma sırasında)", error: "Hata: " + (r.error || "") };
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
  $("#mic").onclick = () => LIVE ? LIVE.stop() : listening ? stopListen() : voiceTurn(false);
  $("#reactor").onclick = () => LIVE ? LIVE.stop() : speaking ? stopSpeaking().then(() => voiceTurn(false)) : listening ? stopListen() : voiceTurn(false);
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
    else if (t.id === "testVoice") speak(`Merhaba ${SET.name}, ben Titus. Ses ayarlarım böyle.`, true);
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
    if (pre > now) N("d1" + x.id, `3 gün sonra: ${x.name} (${x.kind})`, "Hediye ya da plan fikri ister misin? Dokun, Titus'a sor.", { at: pre }, { action: "ask:" + `${x.name} için ${x.kind} hediye ve kutlama fikri ver.` });
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

/* ================= proaktif Titus ================= */
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
const STEP_TR = { dnd: "Rahatsız etme", torch: "Fener", speak: "Söyle", reminder: "Hatırlatıcı", shiftEnd: "Vardiya bitişine alarm", whatsapp: "WhatsApp", app: "Uygulama aç", focus: "Odak", brief: "Brifing", plan: "Yarının planı", sleep: "Uyku modu", webhook: "Akıllı ev", url: "Link aç", wake: "Hey Titus" };
function seedRoutines() {
  if (META.seeded || S.routines.length) { META.seeded = true; saveMeta(); return; }
  const P = SET.partnerName || "Kübra";
  S.routines.push(
    { id: uid(), name: "Vardiyaya çıkıyorum", triggers: ["vardiyaya çıkıyorum", "vardiyaya gidiyorum", "işe çıkıyorum"], steps: [{ type: "dnd", on: true }, { type: "shiftEnd" }, { type: "whatsapp", kim: P, mesaj: "Vardiyaya çıktım, bitince yazarım ❤️" }, { type: "speak", text: "İyi vardiyalar Burak. Bitişte eve dönüş için haber vereceğim." }] },
    { id: uid(), name: "Eve geldim", triggers: ["eve geldim", "evdeyim", "eve vardım"], steps: [{ type: "dnd", on: false }, { type: "whatsapp", kim: P, mesaj: "Eve vardım 🏠" }, { type: "plan" }] },
    { id: uid(), name: "İyi geceler", triggers: ["iyi geceler", "yatıyorum", "uyku modu"], steps: [{ type: "sleep" }] },
    { id: uid(), name: "Günaydın", triggers: ["günaydın titus", "günaydın"], steps: [{ type: "dnd", on: false }, { type: "brief" }] }
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
async function plainGemini(prompt, parts = [], tools = null, opt = {}) {
  if (!SET.geminiKey) throw new Error("NOKEY");
  const first = opt.model || SET.geminiModel;
  const models = [first, ...(opt.fallback || []), ...GEMINI_FALLBACK].filter((m, i, a) => m && a.indexOf(m) === i);
  for (let i = 0; i < models.length; i++) {
    try {
      const gc = { temperature: opt.temperature ?? 0.7, maxOutputTokens: opt.max || 1400 }; if (opt.json) gc.responseMimeType = "application/json"; const th = thinkCfg(models[i], "low"); if (th) gc.thinkingConfig = th;
      const body = { contents: [{ role: "user", parts: [...parts, { text: prompt }] }], generationConfig: gc };
      if (tools) body.tools = tools;
      let j;
      try { j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent?key=${encodeURIComponent(SET.geminiKey)}`, body); }
      catch (e) { if (e.status === 400 && /thinking/i.test(e.message) && !NO_THINK.has(models[i])) { NO_THINK.add(models[i]); i--; continue; } throw e; }
      const c = j.candidates && j.candidates[0];
      const txt = ((c && c.content && c.content.parts) || []).filter(p => p.text && !p.thought).map(p => p.text).join("").trim();
      const src = ((c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || []).map(g => g.web && g.web.title).filter(Boolean).slice(0, 4);
      return src.length ? txt + "\n(Kaynaklar: " + src.join(", ") + ")" : txt;
    } catch (e) { if ((e.status === 404 || e.status === 429 || (e.status === 400 && /model/i.test(e.message))) && i < models.length - 1) continue; throw e; }
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
    <div class="row" style="margin-top:10px"><button class="btn ghost sm" id="tpFlip">↺ Kamera</button><button class="btn ghost sm" id="tpX">Kapat</button><button class="btn" id="tpGo">● Kayda başla</button></div><div class="hint">Kayıtta diğer karakterleri Titus okur. Senin repliğinde ekrana dokununca devam eder (ya da süre dolunca).</div>`;
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
    try { await saveVideo(blob, name); toast("🎬 Galeriye kaydedildi: Movies/TITUS/" + name, 4500); } catch (e) { toast("Kaydedilemedi: " + e.message, 5000); }
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
  return { bekliyor: true, not: "Bilgisayar 30 sn içinde cevap vermedi. Titus PC ajanı açık mı?" };
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
  const r = await nat(() => Jarvis.authenticate({ reason: "Titus'u aç" }), null);
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
  T("bilgisayar", "Bilgisayardaki Titus ajanına komut verir. open_app: uygulama aç; open_url: link aç; find_file: dosya ara; mail_file: dosyayı Gmail taslağına ekle (arg=dosya adı, arg2=alıcı); lock: kilitle; notify: bilgisayarda mesaj göster; ask: bilgisayardaki Titus'a serbest görev ver (arg=görev, ör. Word'ü aç ve toplantı notu başlığı yaz) — bilgisayarda Titus masaüstü sürümü çalışıyorsa.", { action: str("Komut", ["open_app", "open_url", "find_file", "mail_file", "lock", "notify", "ask"]), arg: str("Uygulama/link/dosya adı/mesaj"), arg2: str("Ek bilgi (ör. alıcı e-posta)") }, ["action"],
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
  return _baseLines() + (LINES.list.length ? `<div class="card"><h3>KAYIT</h3><div class="row"><button class="btn" id="tapeBtn">🎬 Self-tape çek</button><button class="btn ghost" id="perfBtn">🎭 Performansımı değerlendir</button></div><div class="hint">Self-tape: 3-2-1 sonra kayıt başlar, diğer karakterleri ben okurum, video galeriye (Movies/TITUS) kaydedilir.</div></div>` : "");
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
    ${tg("proactive", "Proaktif Titus", "Yağmur uyarısı, bekleyen görevler, seçme hazırlığı, haftalık rapor")}</div></div>

  <div class="card"><h3>GÜVENLİK VE KISAYOLLAR</h3>
    ${tg("lock", "Parmak izi kilidi", "Açılışta ve 5 dk sonra parmak izi/yüz ister")}
    ${tg("headset", "Kulaklık tuşu", "Kulaklığın tuşuna basınca Titus dinler (müzik çalmıyorken)")}
    ${tg("autoSendWa", "WhatsApp'ı otomatik gönder", "Onayından sonra gönder tuşuna kendisi basar (Ekran erişimi gerekli)")}
    ${NATIVE ? `<div class="perm"><span>Ekran erişimi (Erişilebilirlik)<br><small style="color:var(--dim)">Ekranı görme, dokunma, yazma</small></span>${PERM.a11y ? `<span class="ok">✓ Açık</span>` : `<button class="btn sm" data-perm="a11y">Aç</button>`}</div>
    <div class="perm"><span>Kamera<br><small style="color:var(--dim)">Self-tape, fotoğraf</small></span>${PERM.camera ? `<span class="ok">✓ Açık</span>` : `<button class="btn sm" data-perm="camera">İzin ver</button>`}</div>
    <div class="hint">Android 13+: Ekran erişimi gri görünürse Ayarlar → Uygulamalar → Titus → ⋮ → "Kısıtlanmış ayarlara izin ver".</div>` : ""}</div>

  <div class="card"><h3>HEY Titus · SESİME UYARLA</h3>
    <div class="hint" style="margin-top:0">5 kez "Hey Titus" dersin; senin telaffuzunda nasıl duyulduğunu öğrenip algılamayı iyileştiririm.</div>
    <div class="row" style="margin-top:8px"><button class="btn ghost sm" id="calibWake">🎙 Kalibre et</button><button class="btn ghost sm" id="calibReset">Sıfırla</button></div>
    <div class="hint">Ek kelimeler: ${(wk.words || []).length ? esc(wk.words.join(", ")) : "yok"}</div></div>

  <div class="card"><h3>DOĞAL TÜRKÇE SES (İNTERNETSİZ)</h3>
    <div class="hint" style="margin-top:0">1) "sherpa-onnx TTS Engine" uygulamasının APK'sını kur (k2-fsa GitHub sayfası). 2) İçinden Türkçe Piper sesini seç (ör. tr_TR-dfki / fahrettin). 3) Aşağıdaki düğmeyle tercih edilen motoru o yap. 4) Titus → Ses'ten yeni sesi seç.</div>
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
    <div class="hint">"Titus, salon ışığını aç" dediğinde adıyla eşleşen webhook'u tetikler. Rutin adımı olarak da kullanılabilir.</div></div></div>

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
  if (!st || !["listening", "paused"].includes(st.status)) return toast("Önce Hey Titus'u aç ve modelin inmesini bekle.");
  const heard = [];
  for (let i = 1; i <= 5; i++) {
    toast(`${i}/5 — "Hey Titus" de`, 3500);
    await speak(i === 1 ? "Bip sesinden sonra hey titus de." : "Bir daha.", true);
    const r = await nat(() => Jarvis.wakeSample({ ms: 3500 }), null);
    if (r && r.text) heard.push(r.text);
  }
  const STOP = new Set(["hey", "okay", "ok", "the", "a", "uh", "um", "huh", "oh", "and", "i", "it", "is", "to", "of"]);
  const cnt = {}; heard.join(" ").split(/\s+/).filter(w => w && !STOP.has(w)).forEach(w => cnt[w] = (cnt[w] || 0) + 1);
  const words = Object.entries(cnt).filter(([w, n]) => n >= 2 && w !== "titus" && w !== "jarvis").map(([w]) => w).slice(0, 4);
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
    else if (t.id === "pcTest") { toast("Bilgisayara gönderiliyor…"); const r = await pcCommand("notify", "Merhaba Burak, Titus bağlantısı çalışıyor ✓"); toast(r.bekliyor ? "Bilgisayar cevap vermedi (ajan açık mı?)" : "✓ Bilgisayar cevap verdi", 4000); }
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
async function setClockAlarm({ h, m, label = "Titus", days = null }) {
  if (!Jarvis) { const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); A.addReminder({ text: "⏰ " + label, due: localISO(d) }); return { ok: true, yedek: "hatırlatıcı" }; }
  const r = await Jarvis.setAlarm({ hour: h, minute: m, message: label, days: days || [] });
  if (!r || !r.ok) { const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); A.addReminder({ text: "⏰ " + label, due: localISO(d) }); return { ok: true, yedek: "hatırlatıcı", not: (r && r.error) || "Saat uygulamasına alarm kurulamadı, Titus alarmı kuruldu." }; }
  return { ok: true, saat: `${pad(h)}:${pad(m)}`, gunler: days || [] };
}
async function setClockTimer(seconds, label = "Titus") {
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
    const r = await setClockTimer(s, "Titus");
    return { reply: `Zamanlayıcı başladı: ${durTR(s)}.`, act: "⏱ zamanlayıcı", r };
  }
  // ALARM / UYANDIR
  if (/(alarm|uyandır|uyandir|kaldır beni|uyanmam lazım)/.test(t) && !/(alarm(ı|i|ları|lari)? (sil|kapat|iptal))/.test(t)) {
    const rel = /sonra/.test(t) ? relDelta(t) : null;
    if (rel) {
      const d = new Date(Date.now() + rel * 1000);
      if (rel < 60 * 60 * 24) { const r = await setClockAlarm({ h: d.getHours(), m: d.getMinutes(), label: "Titus" }); return { reply: `Alarm ${pad(d.getHours())}:${pad(d.getMinutes())} için kuruldu.`, act: "⏰ alarm", r }; }
    }
    const c = parseClock(t); if (!c) return null;
    const label = (raw.match(/(?:için|icin)\s+(.{2,40})$/i) || [])[1] || "Titus";
    const days = DAYS_FOR[c.repeat] || (c.repeat === "weekly" && c.weekday !== null ? [c.weekday] : null);
    const when = clockToDate(c);
    const within24 = when - Date.now() < 864e5 + 6e4;
    if (days || within24) {
      const r = await setClockAlarm({ h: c.h, m: c.m, label, days });
      const dtxt = days ? (c.repeat === "daily" ? "her gün " : c.repeat === "weekdays" ? "hafta içi her gün " : c.repeat === "weekend" ? "hafta sonları " : `her ${DAYS[c.weekday]} `) : `${fmtWhen(localISO(when)).split(" ")[0]} `;
      return { reply: `Alarm kuruldu: ${dtxt}${pad(c.h)}:${pad(c.m)}.${r.yedek ? " (Saat uygulaması yerine Titus alarmı.)" : ""}`, act: "⏰ alarm", r };
    }
    // 24 saatten uzak tarih: Saat uygulaması tarih desteklemez → Titus alarmı (bildirim) kur
    A.addReminder({ text: "⏰ Alarm" + (label !== "Titus" ? ": " + label : ""), due: localISO(when) });
    return { reply: `${fmtWhen(localISO(when))} için alarm kurdum.`, act: "⏰ alarm" };
  }
  // HATIRLATICI (net kalıplar)
  if (/hatırlat|hatirlat|unutturma/.test(t)) {
    const what = s => s.replace(/(bana|beni|lütfen|titus|jarvis|hey)/g, " ").replace(/\b(mi|mı|da|de)\b/g, " ").replace(/\s+/g, " ").trim();
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
      if (rec.stopNow || (speechAt && now - lastLoud > 950) || (!speechAt && now - t0 > 7000) || now - t0 > 20000) { clearInterval(iv); res(); }
    }, 120);
  });
  const hadSpeech = !!speechAt; const b64 = await rec.stop(); GEM_REC = null;
  if (!hadSpeech) return null;
  setMode("think", "Anlıyorum…");
  const txt = await plainGemini("Bu ses kaydında Burak'ın söylediğini kelimesi kelimesine yazıya dök. Konuşma Türkçe ağırlıklıdır, araya İngilizce kelime/isim girebilir (ör. Titus, Netflix, self-tape): her kelimeyi söylendiği dilde ve doğru yazımla yaz. Saatleri rakamla yaz (ör. 07:30). Sadece dökümü yaz; açıklama, tırnak, yorum ekleme. Anlaşılır bir konuşma yoksa sadece ### yaz.", [{ inlineData: { mimeType: "audio/wav", data: b64 } }], null, { model: SET.sttModel || "gemini-3.5-flash-lite", fallback: ["gemini-3.1-flash-lite"], temperature: 0, max: 300 });
  const clean = String(txt || "").replace(/^["'“]|["'”]$/g, "").trim();
  return !clean || clean.includes("###") ? null : clean;
}

/* ================= araç çağırmadan "yaptım" demeyi engelle ================= */
const CMD_RX = /(alarm|hatırlat|hatirlat|kur(?=\s|$)|ekle|not al|kaydet|sil(?=\s|$)|ara(?=\s|$)|arar mısın|aç(?=\s|$)|gönder|yaz(?=\s|$)|başlat|ayarla|uyandır|zamanlayıcı)/i;
const CLAIM_RX = /(kurdum|kuruldu|ekledim|eklendi|ayarladım|ayarlandı|kaydettim|kaydedildi|hatırlatacağım|açıyorum|açtım|arıyorum|gönderdim|başlattım|sildim|not aldım)/i;

/* ================= yeni araçlar ================= */
TOOLS.unshift(
  T("alarm_kur", "Telefonun Saat uygulamasına GERÇEK alarm kurar (çalar saat). 'Alarm kur', 'beni uyandır' isteklerinde bunu kullan. Tarih desteklemez; 24 saatten uzak tek seferlik alarmlar için hatirlatici_ekle kullan.", { saat: str("HH:mm (24 saat)"), etiket: str("Alarm adı"), tekrar: str("Tekrar", ["none", "daily", "weekdays", "weekend"]) }, ["saat"],
    async a => { const [h, m] = String(a.saat).split(":").map(Number); if (isNaN(h)) return { hata: "Saat anlaşılmadı" }; return setClockAlarm({ h, m: m || 0, label: a.etiket || "Titus", days: DAYS_FOR[a.tekrar] || null }); }),
  T("zamanlayici_kur", "Saat uygulamasında geri sayım zamanlayıcısı başlatır.", { saniye: num("Toplam saniye"), etiket: str("Ad") }, ["saniye"], a => setClockTimer(Math.max(1, Math.round(a.saniye)), a.etiket || "Titus"))
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
    const al = await nat(() => Jarvis.canSetAlarm(), {}); ok(al && al.ok, "Saat uygulamasına alarm", al && al.app ? al.app : "Saat uygulaması bulunamadı → Titus alarmı kullanılır");
    const pend = await nat(() => LN.getPending(), { notifications: [] }); ok(true, "Bekleyen Titus alarmı", String((pend.notifications || []).length));
    const w = await nat(() => Jarvis.wakeStatus(), {}); ok(!SET.wake || (w && w.status === "listening"), "Hey Titus", w ? w.status : "-");
    ok(p.battery, "Pil kısıtlaması kapalı", p.battery ? "" : "Arka planda kapanabilir");
  }
  const trv = voices.filter(v => /^tr/i.test(v.lang)).length; ok(trv > 0 || SET.voiceEngine === "gemini", "Ses", SET.voiceEngine === "gemini" ? "Gemini doğal ses" : `${trv} Türkçe telefon sesi`);
  if (SET.groqKey) { try { await httpJson("https://api.groq.com/openai/v1/chat/completions", { model: SET.groqModel, messages: [{ role: "user", content: "ok" }], max_tokens: 2 }, { Authorization: "Bearer " + SET.groqKey }); ok(true, "Groq (hız + yedek)"); } catch (e) { ok(false, "Groq", e.message); } }
  ok(!!SET.live && Date.now() > LIVE_OFF_UNTIL, "Canlı konuşma", SET.live ? (Date.now() > LIVE_OFF_UNTIL ? (SET.liveModel || "hazır") : "geçici olarak kapalı (kota/hata)") : "kapalı");
  if (NATIVE) rows.push(`<div class="hint">Vivo: Ayarlar → Pil → Arka planda yüksek güç tüketimi → Titus'u aç; Ayarlar → Uygulamalar → Otomatik başlatma → Titus'u aç. Yoksa Hey Titus ve alarmlar kapanabilir.</div>`);
  ok(SET.stt === "gemini" ? !!SET.geminiKey : true, "Ses tanıma", SET.stt === "gemini" ? "Gemini (Türkçe + İngilizce)" : "Google (cihaz)");
  infoBox("SİSTEM TESTİ", rows.join("") + `<div class="row" style="margin-top:10px"><button class="btn ghost sm" id="testNotif">1 dk sonra test bildirimi</button><button class="btn ghost sm" id="testAlarm">2 dk sonra test alarmı</button></div>`);
  $("#testNotif").onclick = () => { A.addReminder({ text: "Test bildirimi ✓ Hatırlatıcılar çalışıyor.", due: localISO(new Date(Date.now() + 65e3)) }); toast("1 dakika sonra bildirim gelecek"); };
  $("#testAlarm").onclick = async () => { const d = new Date(Date.now() + 2 * 6e4 + 3e4); const r = await setClockAlarm({ h: d.getHours(), m: d.getMinutes(), label: "Titus test" }); toast(r.yedek ? "Saat uygulaması yok → Titus alarmı kuruldu" : `Saat uygulamasına ${pad(d.getHours())}:${pad(d.getMinutes())} alarmı kuruldu`, 4000); };
}

/* ================= ayarlara: ses tanıma ve uyandırma hassasiyeti ================= */
{
  const base = renderSettings;
  renderSettings = async function () {
    await base();
    const ses = [...document.querySelectorAll("#b-set .card")].find(c => /^SES$/.test(c.querySelector("h3").textContent.trim()));
    if (ses) ses.querySelector(".form").insertAdjacentHTML("afterbegin", `<div class="lbl">Ses tanıma motoru</div><select data-set="stt"><option value="gemini" ${SET.stt === "gemini" ? "selected" : ""}>Gemini — Türkçe + İngilizce, en doğru</option><option value="google" ${SET.stt === "google" ? "selected" : ""}>Google (cihaz) — en hızlı, internetsiz de çalışır</option></select>
      <div class="lbl">Cevap hızı</div><select data-set="speed"><option value="hizli" ${SET.speed !== "akilli" ? "selected" : ""}>Hızlı — günlük komutlar için (önerilen)</option><option value="akilli" ${SET.speed === "akilli" ? "selected" : ""}>Akıllı — daha derin düşünür, daha yavaş</option></select>
      <label class="toggle"><span>Uyanınca "Efendim?" de<small>Kapalıyken sadece kısa bip sesi: daha hızlı</small></span><input type="checkbox" class="sw" data-set="greetVoice" ${SET.greetVoice ? "checked" : ""}></label>`);
    const hj = [...document.querySelectorAll("#b-set .card")].find(c => /^HEY Titus$/.test(c.querySelector("h3").textContent.trim()));
    if (hj) hj.insertAdjacentHTML("beforeend", `<label class="toggle"><span>Sadece "Hey Titus" ile uyan<small>Kapalıyken (önerilen) sadece "Titus" demen yeter; çok yanlış uyanırsa aç</small></span><input type="checkbox" class="sw" data-set="wakeStrict" ${SET.wakeStrict ? "checked" : ""}></label>
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

/* =====================================================================
   v1.5 — CANLI KONUŞMA, AKIŞLI CEVAP, DOĞAL SES, GROQ
   ===================================================================== */
const rawFetch = (...a) => (window.CapacitorWebFetch || window.fetch).apply(window, a);
const b64ToBytes = b64 => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const bytesToB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
let OUT_CTX = null;
function outCtx() { if (!OUT_CTX || OUT_CTX.state === "closed") OUT_CTX = new (window.AudioContext || window.webkitAudioContext)(); if (OUT_CTX.state === "suspended") OUT_CTX.resume(); return OUT_CTX; }
function pcm16ToBuffer(ctx, u8, rate = 24000) {
  const n = Math.floor(u8.length / 2), dv = new DataView(u8.buffer, u8.byteOffset, n * 2), buf = ctx.createBuffer(1, n, rate), ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
  return buf;
}

/* ================= 1) CANLI KONUŞMA (Gemini Live API) ================= */
const LIVE_MODELS = ["gemini-3.8-live", "gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-preview-12-2025", "gemini-2.5-flash-native-audio-preview-09-2025"];
let LIVE = null, LIVE_OFF_UNTIL = 0;
class LiveSession {
  constructor() { this.ws = null; this.playing = []; this.nextT = 0; this.userTxt = ""; this.botTxt = ""; this.uSpan = null; this.bSpan = null; this.lastAct = Date.now(); this.closed = false; this.acts = []; this.handle = null; this.model = ""; this.lite = false; this.reconnecting = false; this.endAfter = false; }
  setupMsg(model, lite) {
    const decl = TOOLS.map(t => { const d = { name: t.name, description: t.description }; if (Object.keys(t.props).length) { d.parameters = schemaFor(t, true); if (!t.required.length) delete d.parameters.required; } return d; });
    const setup = {
      model: "models/" + model,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SET.liveVoice || "Charon" } } } },
      systemInstruction: { parts: [{ text: systemPrompt() + LIVE_PERSONA() }] },
      tools: [{ functionDeclarations: decl }],
      inputAudioTranscription: {}, outputAudioTranscription: {}
    };
    if (!lite) {
      // hızlı ve doğal sıra alma + sınırsız süre + kopunca kaldığı yerden devam
      setup.realtimeInputConfig = { automaticActivityDetection: { startOfSpeechSensitivity: "START_SENSITIVITY_HIGH", endOfSpeechSensitivity: "END_SENSITIVITY_HIGH", prefixPaddingMs: 120, silenceDurationMs: Number(SET.liveSilence) || 600 } };
      setup.contextWindowCompression = { slidingWindow: {} };
      setup.sessionResumption = this.handle ? { handle: this.handle } : {};
    }
    return { setup };
  }
  async open(model, lite) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(SET.geminiKey)}`);
      let ready = false;
      const to = setTimeout(() => { if (!ready) { try { ws.close(); } catch {} rej(new Error("zaman aşımı")); } }, 8000);
      ws.onopen = () => ws.send(JSON.stringify(this.setupMsg(model, lite)));
      ws.onmessage = async ev => {
        let msg; try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : await ev.data.text()); } catch { return; }
        if (msg.setupComplete && !ready) { ready = true; clearTimeout(to); const old = this.ws; this.ws = ws; this.model = model; this.lite = lite; if (old && old !== ws) { old.onclose = null; try { old.close(); } catch {} } res(); return; }
        if (ws !== this.ws) return;
        if (msg.sessionResumptionUpdate && msg.sessionResumptionUpdate.resumable && msg.sessionResumptionUpdate.newHandle) this.handle = msg.sessionResumptionUpdate.newHandle;
        this.onMsg(msg);
      };
      ws.onerror = () => {};
      ws.onclose = ev => {
        clearTimeout(to);
        if (!ready) return rej(new Error(ev.reason || "bağlantı kapandı " + ev.code));
        if (ws !== this.ws || this.closed) return;
        if (/quota|exceed|limit/i.test(ev.reason || "")) { LIVE_OFF_UNTIL = Date.now() + 36e5; return this.stop("Canlı sohbet kotası doldu, normal moda geçtim."); }
        this.reconnect();
      };
    });
  }
  // Bağlantı koparsa ya da sunucu "süre doldu" derse sohbeti bölmeden yeniden bağlan
  async reconnect() {
    if (this.reconnecting || this.closed) return; this.reconnecting = true;
    for (let i = 0; i < 4 && !this.closed; i++) {
      try { await this.open(this.model, this.lite); this.reconnecting = false; if (this.lite || !this.handle) this.seed(); return; }
      catch (e) { await sleep(600 * (i + 1)); }
    }
    this.reconnecting = false; this.stop("Bağlantı koptu; tekrar konuşmak için Titus de.");
  }
  // Önceki konuşmayı bağlam olarak ver: sohbet kaldığı yerden devam etsin
  seed() {
    const h = CHAT.slice(-12).filter(m => m.content && m.role !== "sys").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content).slice(0, 600) }] }));
    if (h.length && this.ws && this.ws.readyState === 1) try { this.ws.send(JSON.stringify({ clientContent: { turns: h, turnComplete: false } })); } catch {}
  }
  async start() {
    // Mikrofon bağlantıdan ÖNCE açılır: "Titus" der demez konuşmaya başlayabilirsin, bağlanırken söylediklerin kaybolmaz
    this.pre = []; this.preLen = 0;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.inCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.inCtx.createMediaStreamSource(this.stream);
    this.proc = this.inCtx.createScriptProcessor(2048, 1, 1);
    const ratio = this.inCtx.sampleRate / 16000; let pend = [];
    this.proc.onaudioprocess = e => {
      if (this.closed) return;
      const d = e.inputBuffer.getChannelData(0); const n = Math.floor(d.length / ratio); const pcm = new Int16Array(n);
      let q = 0; for (let i = 0; i < n; i++) { const v = d[Math.floor(i * ratio)]; q += v * v; pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff; }
      const rms = Math.sqrt(q / n);
      // Hoparlörden çıkan sesi geri duymasın: Titus konuşurken sadece yüksek sesle söz kesilebilir
      if (this.isPlaying() && rms < (SET.liveDuplex ? 0.02 : 0.07)) pcm.fill(0); else if (rms > 0.03) this.lastAct = Date.now();
      const live = this.ws && this.ws.readyState === 1 && !this.reconnecting && this.ready;
      if (!live) { this.pre.push(pcm); this.preLen += pcm.length; while (this.preLen > 16000 * 8) this.preLen -= this.pre.shift().length; return; }
      if (this.pre.length) { pend = this.pre.concat(pend); this.pre = []; this.preLen = 0; }
      pend.push(pcm);
      if (pend.length >= 2) { const tot = pend.reduce((s, a) => s + a.length, 0), all = new Int16Array(tot); let o = 0; for (const a of pend) { all.set(a, o); o += a.length; } pend = [];
        this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: bytesToB64(new Uint8Array(all.buffer)), mimeType: "audio/pcm;rate=16000" } } })); }
    };
    src.connect(this.proc); this.proc.connect(this.inCtx.destination);
    setMode("listen", "Canlı · dinliyorum (bağlanıyor)"); $("#mic").classList.add("on");
    const models = [SET.liveModel, ...LIVE_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
    let err = null;
    outer: for (const m of models) for (const lite of [false, true]) { try { await this.open(m, lite); if (SET.liveModel !== m) { SET.liveModel = m; saveSet(); } err = null; break outer; } catch (e) { err = e; } }
    if (err) { try { this.proc.disconnect(); this.stream.getTracks().forEach(t => t.stop()); this.inCtx.close(); } catch {} throw err; }
    this.seed(); this.ready = true; this.lastAct = Date.now();
    this.idle = setInterval(() => { if (this.isPlaying() || this.reconnecting) return; if (this.endAfter || Date.now() - this.lastAct > (SET.liveIdle || 45) * 1000) this.stop(); }, 700);
    setMode("listen", "Canlı · konuş"); $("#mic").classList.add("on");
  }
  isPlaying() { return OUT_CTX && this.nextT > OUT_CTX.currentTime + 0.05; }
  stopAudio() { for (const s of this.playing) { try { s.stop(); } catch {} } this.playing = []; this.nextT = 0; }
  play(b64) {
    const ctx = outCtx(); const buf = pcm16ToBuffer(ctx, b64ToBytes(b64), 24000);
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination);
    const t = Math.max(ctx.currentTime + 0.02, this.nextT); s.start(t); this.nextT = t + buf.duration;
    this.playing.push(s); s.onended = () => { this.playing = this.playing.filter(x => x !== s); };
    setMode("speak", "Canlı · konuşuyor");
  }
  async onMsg(msg) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) { this.stopAudio(); setMode("listen", "Canlı · dinliyor"); }
      if (sc.inputTranscription && sc.inputTranscription.text) {
        this.userTxt += sc.inputTranscription.text; this.lastAct = Date.now();
        if (!this.uSpan) this.uSpan = bubble("user", ""); this.uSpan.textContent = this.userTxt.trim();
      }
      if (sc.modelTurn && sc.modelTurn.parts) for (const p of sc.modelTurn.parts) if (p.inlineData && p.inlineData.data) this.play(p.inlineData.data);
      if (sc.outputTranscription && sc.outputTranscription.text) {
        this.botTxt += sc.outputTranscription.text; if (!this.bSpan) this.bSpan = bubble("assistant", ""); this.bSpan.textContent = this.botTxt.trim();
        $("#log").scrollTop = 1e9;
      }
      if (sc.turnComplete || sc.generationComplete) {
        if (BYE_RX.test(this.userTxt.trim())) this.endAfter = true;
        if (this.userTxt.trim()) CHAT.push({ role: "user", content: this.userTxt.trim() });
        if (this.botTxt.trim()) CHAT.push({ role: "assistant", content: this.botTxt.trim() });
        if (this.acts.length && this.bSpan) { const a = document.createElement("div"); a.className = "acts"; a.textContent = this.acts.join(" · ") + " · canlı"; this.bSpan.parentElement.appendChild(a); }
        saveChat(); this.userTxt = ""; this.botTxt = ""; this.uSpan = null; this.bSpan = null; this.acts = []; this.lastAct = Date.now();
        setTimeout(() => { if (!this.closed && !this.isPlaying()) setMode("listen", "Canlı · dinliyor"); }, 300);
      }
    }
    if (msg.toolCall && msg.toolCall.functionCalls) {
      const responses = [];
      for (const fc of msg.toolCall.functionCalls) { this.acts.push(ACT_TR[fc.name] || fc.name); const r = await runTool(fc.name, fc.args || {}); responses.push({ id: fc.id, name: fc.name, response: { result: r } }); }
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      this.lastAct = Date.now();
    }
    if (msg.goAway) this.reconnect();
  }
  stop(note) {
    if (this.closed) return; this.closed = true;
    clearInterval(this.idle);
    try { this.proc && this.proc.disconnect(); } catch {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch {}
    try { this.inCtx && this.inCtx.close(); } catch {}
    try { this.ws && this.ws.close(); } catch {}
    setTimeout(() => this.stopAudio(), 1500);
    if (this.userTxt.trim()) { CHAT.push({ role: "user", content: this.userTxt.trim() }); saveChat(); }
    if (LIVE === this) LIVE = null;
    $("#mic").classList.remove("on"); setMode("", "Hazır");
    if (note) toast(note, 4000);
    resumeWake();
  }
}
const BYE_RX = /^(tamam(dır)?[, ]*)?(görüşürüz|hoşça kal|bu kadar|şimdilik bu kadar|teşekkürler titus|sağ ?ol titus|kapat|iyi geceler|bye)\b/i;
const LIVE_PERSONA = () => `
ŞU AN CANLI, KESİNTİSİZ BİR SESLİ SOHBETTESİN. Burak her cümlede "Titus" demek zorunda değil; sohbet akıp gidiyor.
Bir insan gibi konuş: doğal, sıcak, akıcı Türkçe; kısa cümleler; konuşma dilinde ("tabii", "hmm, bakalım", "anladım"). Yazı dili, madde işareti, uzun liste yok.
Sıra al: genelde 1-3 cümle söyle, sonra sözü ona bırak. Gerekirse kısa bir soru sor, ama her cevabı soruyla bitirme.
Önceki konuşulanları hatırla ve bağla ("az önce dediğin…"). Onu adıyla ara ama abartma. Yerinde hafif espri yapabilirsin.
Burak yarım cümle kurar, düzeltir ya da sözünü keserse doğal karşıla; söz kesildiğinde hemen sus ve dinle.
Anlamadığın bir şey olursa tahmin yürütme, kısaca sor. Bir işlem istenirse aracı hemen çağır, araç adlarını söyleme; işi yapınca kısaca söyle.
Burak "görüşürüz", "bu kadar", "sağ ol" gibi vedalaşırsa kısa ve sıcak bir vedayla bitir.`;
async function startLive() {
  if (LIVE) { LIVE.stop(); return true; }
  if (!SET.live || !SET.geminiKey || !navigator.onLine || Date.now() < LIVE_OFF_UNTIL || !window.WebSocket) return false;
  if (Jarvis) await nat(() => Jarvis.pauseWake());
  await stopSpeaking();
  const s = new LiveSession(); LIVE = s; setMode("think", "Canlı bağlanıyor…");
  try { await s.start(); go("home"); return true; }
  catch (e) { console.warn("live", e); try { s.ws && s.ws.close(); s.stream && s.stream.getTracks().forEach(t => t.stop()); } catch {} s.closed = true; LIVE = null; setMode("", "Hazır"); LIVE_OFF_UNTIL = Date.now() + 10 * 6e4; toast("Canlı mod açılamadı, normal moda geçtim (" + (e.message || e) + ")", 4500); return false; }
}

/* ================= 2) DOĞAL SES (Gemini TTS) ================= */
const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
const TTS_CACHE = new Map(); let TTS_OFF_UNTIL = 0, CUR_SRC = null;
async function geminiTtsBuffer(text) {
  const key = (SET.ttsVoice || "Charon") + "|" + text; if (TTS_CACHE.has(key)) return TTS_CACHE.get(key);
  const models = [SET.ttsModel, ...TTS_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  for (let i = 0; i < models.length; i++) {
    try {
      const j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent?key=${encodeURIComponent(SET.geminiKey)}`, {
        contents: [{ parts: [{ text: `Doğal, sıcak ve akıcı bir Türkçeyle, bir asistan gibi söyle: ${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SET.ttsVoice || "Charon" } } } }
      });
      const part = (((j.candidates || [])[0] || {}).content || {}).parts?.find(p => p.inlineData);
      if (!part) throw new Error("ses yok");
      const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || 24000);
      const buf = pcm16ToBuffer(outCtx(), b64ToBytes(part.inlineData.data), rate);
      if (SET.ttsModel !== models[i]) { SET.ttsModel = models[i]; saveSet(); }
      if (text.length < 80) { TTS_CACHE.set(key, buf); if (TTS_CACHE.size > 40) TTS_CACHE.delete(TTS_CACHE.keys().next().value); }
      return buf;
    } catch (e) { if (e.status === 429) { TTS_OFF_UNTIL = Date.now() + 30 * 6e4; throw e; } if (i === models.length - 1) throw e; }
  }
}
function playBuffer(buf) {
  return new Promise(res => {
    const ctx = outCtx(); const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination);
    CUR_SRC = s; s.onended = () => { if (CUR_SRC === s) CUR_SRC = null; res(); }; s.start();
  });
}
// Konuşma kuyruğu: cümleler sırayla, bir sonraki önceden hazırlanarak
class SpeechQueue {
  constructor() { this.q = []; this.buf = ""; this.running = null; this.stopped = false; }
  push(delta) {
    this.buf += delta;
    let m; while ((m = this.buf.match(/^([\s\S]*?[.!?…:])(\s+|$)/)) && m[1].trim().length > 1) { if (m[2] === "" && this.buf.length === m[1].length) break; this.add(m[1]); this.buf = this.buf.slice(m[0].length); }
  }
  add(sentence) {
    const t = sentence.replace(/[*_#`>|]/g, "").trim(); if (!t || this.stopped) return;
    const natural = SET.voiceEngine === "gemini" && SET.geminiKey && Date.now() > TTS_OFF_UNTIL;
    this.q.push({ t, p: natural ? geminiTtsBuffer(t).catch(() => null) : null });
    if (!this.running) this.running = this.run();
  }
  async run() {
    speaking = true; setMode("speak", "Konuşuyor");
    while (this.q.length && !this.stopped) {
      const it = this.q.shift(); const buf = it.p ? await it.p : null;
      if (this.stopped) break;
      if (buf) await playBuffer(buf); else await androidSpeak(it.t);
    }
    this.running = null; if (!this.q.length) { speaking = false; setMode("", "Hazır"); }
  }
  async finish() { if (this.buf.trim()) { this.add(this.buf); this.buf = ""; } while (this.running) await this.running; }
  stop() { this.stopped = true; this.q = []; }
}
let CUR_Q = null;
async function androidSpeak(clean) {
  try {
    if (TTS) { const o = { text: clean, lang: "tr-TR", rate: SET.rate, pitch: SET.pitch, volume: 1, category: "playback", queueStrategy: 0 }; if (SET.voiceIdx >= 0) o.voice = SET.voiceIdx; await TTS.speak(o); }
    else if ("speechSynthesis" in window) await new Promise(res => { const u = new SpeechSynthesisUtterance(clean); u.lang = "tr-TR"; u.rate = SET.rate; u.pitch = SET.pitch; const vs = speechSynthesis.getVoices(); if (SET.voiceIdx >= 0 && vs[SET.voiceIdx]) u.voice = vs[SET.voiceIdx]; u.onend = u.onerror = res; speechSynthesis.speak(u); });
  } catch {}
}
// speak'i kuyruk tabanlı yap
speak = async function (text, force = false) {
  if (!text || (!SET.speakReplies && !force)) return;
  const clean = String(text).replace(/[*_#`>|]/g, "").replace(/https?:\/\/\S+/g, "link");
  if (CUR_Q) CUR_Q.stop();
  const q = new SpeechQueue(); CUR_Q = q;
  const parts = clean.match(/[^.!?…]+[.!?…]*/g) || [clean];
  for (const p of parts) q.add(p);
  await q.finish(); if (CUR_Q === q) CUR_Q = null;
};
stopSpeaking = async function () {
  speaking = false; if (CUR_Q) { CUR_Q.stop(); CUR_Q = null; }
  if (CUR_SRC) { try { CUR_SRC.stop(); } catch {} CUR_SRC = null; }
  if (TTS) await nat(() => TTS.stop()); else try { speechSynthesis.cancel(); } catch {}
};

/* ================= 3) AKIŞLI CEVAP (Gemini SSE) ================= */
async function geminiStream(model, body, onDelta) {
  const r = await rawFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(SET.geminiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { let m = "HTTP " + r.status; try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch {} const e = new Error(m); e.status = r.status; throw e; }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "", parts = [], role = "model";
  for (;;) {
    const { value, done } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
      const c = j.candidates && j.candidates[0]; const ps = (c && c.content && c.content.parts) || [];
      for (const p of ps) { parts.push(p); if (p.text && !p.thought && onDelta) onDelta(p.text); }
    }
  }
  return { candidates: [{ content: { role, parts: compactParts(parts) } }] };
}
let STREAM_OK = true, CUR_DEEP = false, ON_DELTA = null;
// httpJson'u Gemini generateContent için akışlıya yönlendir (onDelta varsa)
{
  const baseHttp = httpJson;
  httpJson = async function (url, body, headers) {
    const m = String(url).match(/models\/([^:]+):generateContent\?key=/);
    if (m && ON_DELTA && STREAM_OK && body && body.tools && !(body.generationConfig && body.generationConfig.responseModalities)) {
      try { return await geminiStream(m[1], body, ON_DELTA); }
      catch (e) { if (e.status) throw e; STREAM_OK = false; console.warn("stream off", e); }
    }
    return baseHttp(url, body, headers);
  };
}

/* ================= 4) GROQ: hızlı ses tanıma + yedek beyin ================= */
const WHISPER_JUNK = /altyazı|abone ol|izlediğiniz için|teşekkürler\.?$|^\W*$|amara\.org|subtitles/i;
async function groqTranscribe(b64wav) {
  const fd = new FormData();
  fd.append("file", new Blob([b64ToBytes(b64wav)], { type: "audio/wav" }), "ses.wav");
  fd.append("model", "whisper-large-v3-turbo"); fd.append("language", "tr"); fd.append("temperature", "0"); fd.append("response_format", "json");
  fd.append("prompt", "Hey Titus, alarm kur, hatırlat, Kübra, Recast, KADRO, Netflix, self-tape, seçme, vardiya, Kadıköy.");
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + SET.groqKey }, body: fd });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { throw new Error("Groq yanıtı okunamadı"); }
  if (!r.ok) { const e = new Error((j.error && j.error.message) || "Groq hata " + r.status); e.status = r.status; throw e; }
  const txt = String(j.text || "").trim();
  return !txt || WHISPER_JUNK.test(txt) ? null : txt;
}
async function recordUtterance() {
  const rec = new WavRecorder(); GEM_REC = rec;
  let base = 0, nBase = 0, speechAt = 0, lastLoud = 0; const t0 = Date.now();
  rec.onLevel = rms => { const now = Date.now(); if (now - t0 < 300) { base += rms; nBase++; return; } const thr = Math.max(0.018, (nBase ? base / nBase : 0.005) * 3.2); if (rms > thr) { if (!speechAt) speechAt = now; lastLoud = now; } };
  await rec.start();
  await new Promise(res => { const iv = setInterval(() => { const now = Date.now(); if (rec.stopNow || (speechAt && now - lastLoud > 900) || (!speechAt && now - t0 > 7000) || now - t0 > 20000) { clearInterval(iv); res(); } }, 100); });
  const had = !!speechAt; const b64 = await rec.stop(); GEM_REC = null; return had ? b64 : null;
}
async function sttCapture() {
  const b64 = await recordUtterance(); if (!b64) return null;
  setMode("think", "Anlıyorum…");
  if (SET.stt === "groq" && SET.groqKey) { try { return await groqTranscribe(b64); } catch (e) { console.warn("groq stt", e); if (!SET.geminiKey) throw e; } }
  const txt = await plainGemini("Bu ses kaydında Burak'ın söylediğini kelimesi kelimesine yazıya dök. Konuşma Türkçe ağırlıklıdır, araya İngilizce kelime/isim girebilir: her kelimeyi söylendiği dilde yaz. Saatleri rakamla yaz. Sadece dökümü yaz. Anlaşılır konuşma yoksa ### yaz.", [{ inlineData: { mimeType: "audio/wav", data: b64 } }], null, { model: SET.sttModel || "gemini-3.5-flash-lite", fallback: ["gemini-3.1-flash-lite"], temperature: 0, max: 300 });
  const clean = String(txt || "").replace(/^["'“]|["'”]$/g, "").trim();
  return !clean || clean.includes("###") ? null : clean;
}
async function askGroq(history, onAct) {
  if (!SET.groqKey) throw new Error("NOGROQ");
  const t0 = Date.now();
  const tools = pickTools(history).map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: schemaFor(t, false) } }));
  const messages = [{ role: "system", content: systemPrompt() }, ...history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))];
  for (let step = 0; step < 8; step++) {
    const j = await httpJson("https://api.groq.com/openai/v1/chat/completions", { model: SET.groqModel || "llama-3.3-70b-versatile", messages, tools, tool_choice: "auto", temperature: 0.3, max_tokens: 800 }, { Authorization: "Bearer " + SET.groqKey });
    const msg = j.choices && j.choices[0] && j.choices[0].message; if (!msg) break;
    if (!msg.tool_calls || !msg.tool_calls.length) { LAST_MS = Date.now() - t0; return (msg.content || "").trim(); }
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
    const results = [];
    for (const tc of msg.tool_calls) { let args = {}; try { args = JSON.parse(tc.function.arguments || "{}"); } catch {} onAct(tc.function.name); const res = await runTool(tc.function.name, args); results.push({ name: tc.function.name, res }); messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(res) }); }
    if (step === 0) { const q = quickConfirm(results); if (q) { LAST_MS = Date.now() - t0; return q; } }
  }
  LAST_MS = Date.now() - t0; return "İşlemleri yaptım.";
}

/* ================= 5) HAZIR BRİFİNG ================= */
let BRIEF_CACHE = null;
async function prefetchBrief(force = false) {
  if (!force && BRIEF_CACHE && Date.now() - BRIEF_CACHE.at < 30 * 6e4) return BRIEF_CACHE;
  const [g, w] = await Promise.all([SET.scriptUrl ? script("briefData").catch(() => null) : null, weather().catch(() => null)]);
  BRIEF_CACHE = { at: Date.now(), takvim: g && g.etkinlikler, mailler: g && g.mailler, hava: w, gece: g && g.geceRaporu && g.geceRaporu.text };
  return BRIEF_CACHE;
}

/* ================= 6) SOHBET ÖZETİ (uzun süreli hafıza) ================= */
async function summarizeWeek() {
  if (!SET.geminiKey) return; S.journal = S.journal || [];
  const last = S.journal.length ? S.journal[S.journal.length - 1].at : 0;
  if (Date.now() - last < 6 * 864e5 || CHAT.length < 10) return;
  try {
    const txt = await plainGemini("Aşağıdaki sohbetten Burak için 4-6 maddelik kısa bir haftalık özet çıkar: neler planlandı, ne yapıldı, önemli kararlar, tekrar eden ihtiyaçlar. Sadece maddeleri yaz.\n\n" + CHAT.slice(-40).map(m => (m.role === "user" ? "Burak: " : "Titus: ") + m.content.slice(0, 300)).join("\n"), [], null, { max: 500 });
    if (txt) { S.journal.push({ at: Date.now(), week: weekKey(), text: txt }); S.journal = S.journal.slice(-12); save(); }
  } catch {}
}

/* ================= v1.5 ayar kartı ================= */
{
  const base = renderSettings;
  renderSettings = async function () {
    await base();
    const V = ["Charon", "Puck", "Fenrir", "Orus", "Iapetus", "Kore", "Aoede", "Leda", "Zephyr"];
    const opt = (k, list) => list.map(v => `<option ${SET[k] === v ? "selected" : ""}>${v}</option>`).join("");
    const tg = (k, label, sub) => `<label class="toggle"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" class="sw" data-set="${k}" ${SET[k] ? "checked" : ""}></label>`;
    const sttSel = document.querySelector('select[data-set="stt"]');
    if (sttSel && !sttSel.querySelector('option[value="groq"]')) sttSel.insertAdjacentHTML("afterbegin", `<option value="groq" ${SET.stt === "groq" ? "selected" : ""}>Groq Whisper — en hızlı ve çok doğru (Groq anahtarı gerekir)</option>`);
    const html = `<div class="card"><h3>CANLI KONUŞMA VE DOĞAL SES</h3>
      ${tg("live", "Canlı konuşma modu", "Gerçek zamanlı sesli sohbet: anında cevap, sözünü kesebilirsin. Kota dolarsa normal moda geçer.")}
      <div class="row"><div><div class="lbl">Canlı ses</div><select data-set="liveVoice">${opt("liveVoice", V)}</select></div><div><div class="lbl">Sessizlikte kapanma (sn)</div><input type="number" data-set="liveIdle" value="${SET.liveIdle}" min="8" max="120"></div></div>
      ${tg("liveDuplex", "Kulaklık takılıyken kullanıyorum", "Açıkken Titus konuşurken hafif sesle de sözünü kesebilirsin (hoparlörde yankı yapabilir)")}
      ${tg("convo", "Sohbet modu", "Cevaptan sonra tekrar 'Hey Titus' demeden konuşmaya devam et")}
      <div class="lbl">Normal modda ses</div><select data-set="voiceEngine"><option value="gemini" ${SET.voiceEngine === "gemini" ? "selected" : ""}>Gemini doğal ses (önerilen)</option><option value="android" ${SET.voiceEngine !== "gemini" ? "selected" : ""}>Telefonun sesi (internetsiz, robotik)</option></select>
      <div class="lbl">Doğal ses karakteri</div><select data-set="ttsVoice">${opt("ttsVoice", V)}</select>
      <button class="btn ghost sm" id="testNatural" style="margin-top:8px">Doğal sesi dene</button></div>
      <div class="card"><h3>GROQ (ÜCRETSİZ HIZ VE YEDEK)</h3><div class="form">
      <div class="lbl">Groq API anahtarı</div><input data-set="groqKey" type="password" value="${esc(SET.groqKey)}" placeholder="gsk_…">
      <div class="hint">console.groq.com → API Keys → Create. Kart istemez. Ses tanıma çok hızlanır; Gemini kotası dolarsa Titus Groq ile devam eder.</div>
      <button class="btn ghost sm" id="testGroq">Groq'u test et</button></div></div>`;
    const first = document.querySelector("#b-set .card:nth-of-type(2)");
    (first || $("#b-set").firstElementChild).insertAdjacentHTML("afterend", html);
  };
  const baseSet = onSetChange;
  onSetChange = async function (el) {
    const k = el.dataset.set;
    if (k === "liveIdle") { SET.liveIdle = Math.max(8, Math.min(120, Number(el.value) || 25)); return saveSet(); }
    if (k === "groqKey") { const had = !!SET.groqKey; SET.groqKey = el.value.trim(); if (SET.groqKey && !had) SET.stt = "groq"; await saveSet(); return renderSettings(); }
    return baseSet(el);
  };
}
document.addEventListener("click", async e => {
  if (e.target.closest("#testNatural")) { try { if (!SET.geminiKey) return toast("Önce Gemini anahtarı"); const b = await geminiTtsBuffer(`Merhaba ${SET.name}, ben Titus. Sesim artık böyle.`); await playBuffer(b); } catch (er) { toast("Doğal ses: " + (er.status === 429 ? "günlük ücretsiz ses kotası doldu, telefonun sesi kullanılacak" : er.message), 5000); } }
  if (e.target.closest("#testGroq")) { try { const r = await httpJson("https://api.groq.com/openai/v1/chat/completions", { model: SET.groqModel, messages: [{ role: "user", content: "Sadece 'tamam' yaz." }], max_tokens: 5 }, { Authorization: "Bearer " + SET.groqKey }); toast("✓ Groq: " + ((r.choices[0].message.content) || "tamam")); } catch (er) { toast("✗ Groq: " + er.message, 5000); } }
});

/* =====================================================================
   v2.0 — STÜDYO: sunum, belge, fotoğraf, görsel üretme, video, kart
   ===================================================================== */
const libLoaded = {};
function loadLib(src) { return libLoaded[src] || (libLoaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Kütüphane yüklenemedi: " + src)); document.head.appendChild(s); })); }
const blobToB64 = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.readAsDataURL(b); });
const pickFiles = (accept, multiple = false) => new Promise(res => { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = multiple; i.onchange = () => res([...(i.files || [])]); i.click(); });
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const fileImg = async f => { const u = URL.createObjectURL(f); const i = await loadImg(u); i._url = u; return i; };
const brand = () => (SET.brands || []).find(b => b.id === SET.brandId) || { name: SET.name, primary: "#2c0a0d", accent: "#ff3b3b", text: "#ffffff", font: "Arial", logo: "" };
const fname = (base, ext) => `${String(base || "jarvis").replace(/[^\wçğıöşüÇĞİÖŞÜ -]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "jarvis"}-${ymd(new Date())}.${ext}`;

/* ---------- dosya kaydetme ve paylaşma ---------- */
async function saveFile(blob, name, collection = "downloads") {
  const mime = blob.type || "application/octet-stream";
  if (!Jarvis) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return { ok: true, yer: "İndirilenler" }; }
  const CH = 768 * 1024, buf = new Uint8Array(await blob.arrayBuffer());
  await Jarvis.fileBegin({ name });
  for (let i = 0; i < buf.length; i += CH) await Jarvis.fileAppend({ name, data: bytesToB64(buf.subarray(i, i + CH)) });
  const r = await Jarvis.fileSave({ name, mime, collection });
  S.files = [{ name, mime, uri: r.uri, path: r.path, at: localISO(new Date()) }, ...(S.files || [])].slice(0, 60); save();
  return { ok: true, yer: r.path, uri: r.uri };
}
async function shareSaved(f) { if (Jarvis && f.uri) return Jarvis.share({ uri: f.uri, mime: f.mime }); toast("Paylaşım sadece telefonda"); }
async function toDrive(blob, name) { const data = await blobToB64(blob); return script("saveFile", { name, mime: blob.type, data, folder: "Titus" }); }

/* ---------- JSON üretimi ---------- */
async function geminiJSON(prompt, parts = []) {
  const t = await plainGemini(prompt + "\n\nSADECE geçerli JSON döndür, açıklama yazma.", parts, null, { temperature: 0.6, max: 6000, json: true });
  const m = String(t).match(/[\[{][\s\S]*[\]}]/); if (!m) throw new Error("Yapay zekâ geçerli bir taslak üretemedi");
  return JSON.parse(m[0]);
}

/* ---------- görsel üretme (Cloudflare Workers AI, ücretsiz) ---------- */
async function cfImage(prompt, w = 1024, h = 1024) {
  if (!SET.cfAccount || !SET.cfToken) throw new Error("Cloudflare bağlı değil (Ayarlar → Stüdyo).");
  let en = prompt;
  if (/[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|ile)\b/.test(prompt) && SET.geminiKey) { try { en = (await plainGemini("Translate this image description to a rich English image-generation prompt. Only output the prompt: " + prompt, [], null, { max: 200, temperature: 0.3, model: "gemini-3.5-flash-lite" })) || prompt; } catch {} }
  const cfU = `https://api.cloudflare.com/client/v4/accounts/${SET.cfAccount}/ai/run/@cf/black-forest-labs/flux-1-schnell`, cfH = { Authorization: "Bearer " + SET.cfToken };
  let j; try { j = await httpJson(cfU, { prompt: en, steps: 6, width: w, height: h }, cfH); } catch (e) { if (e.status !== 400) throw e; j = await httpJson(cfU, { prompt: en, steps: 4 }, cfH); }
  const b64 = j.result && (j.result.image || j.result); if (!b64 || typeof b64 !== "string") throw new Error((j.errors && j.errors[0] && j.errors[0].message) || "Görsel üretilemedi");
  return "data:image/jpeg;base64," + b64;
}

/* ---------- SUNUM (.pptx) ---------- */
async function makePresentation({ konu, slayt = 8, ton = "profesyonel", gorsel = true }) {
  const b = brand();
  const plan = await geminiJSON(`"${konu}" konusunda ${slayt} slaytlık Türkçe bir sunum hazırla. Ton: ${ton}. Hazırlayan: ${SET.name}${b.name ? " (" + b.name + ")" : ""}.
JSON şeması: {"title":"","subtitle":"","slides":[{"title":"","bullets":["kısa madde"],"notes":"konuşmacı notu","image":"(isteğe bağlı) görsel tarifi"}]}. Maddeler kısa ve etkili olsun (en fazla 5). En fazla 3 slayta görsel tarifi koy.`);
  await loadLib("lib/pptxgen.bundle.js");
  const p = new window.PptxGenJS(); p.layout = "LAYOUT_WIDE"; p.author = SET.name; p.title = plan.title;
  const C = c => String(c || "#000").replace("#", "");
  p.defineSlideMaster({ title: "J", background: { color: "FFFFFF" }, objects: [{ rect: { x: 0, y: 0, w: "100%", h: 0.18, fill: { color: C(b.accent) } } }, ...(b.logo ? [{ image: { data: b.logo, x: 12.2, y: 6.85, w: 0.9, h: 0.5, sizing: { type: "contain", w: 0.9, h: 0.5 } } }] : [])], slideNumber: { x: 0.4, y: 7.0, fontSize: 10, color: "888888" } });
  const t = p.addSlide(); t.background = { color: C(b.primary) };
  t.addText(plan.title || konu, { x: 0.7, y: 2.3, w: 12, h: 1.4, fontSize: 40, bold: true, color: C(b.text || "#FFFFFF"), fontFace: b.font });
  t.addText(plan.subtitle || "", { x: 0.7, y: 3.7, w: 12, h: 0.8, fontSize: 20, color: C(b.accent), fontFace: b.font });
  t.addText(`${SET.name} · ${fmtWhen(ymd(new Date()), false)}`, { x: 0.7, y: 6.4, w: 8, h: 0.5, fontSize: 12, color: "CCCCCC" });
  if (b.logo) t.addImage({ data: b.logo, x: 11.3, y: 6.1, w: 1.6, h: 0.9, sizing: { type: "contain", w: 1.6, h: 0.9 } });
  let imgs = 0;
  for (const s of plan.slides || []) {
    const sl = p.addSlide({ masterName: "J" });
    let img = null;
    if (gorsel && s.image && imgs < 3 && SET.cfToken) { try { img = await cfImage(s.image, 1024, 768); imgs++; } catch {} }
    sl.addText(s.title || "", { x: 0.6, y: 0.4, w: 12, h: 0.9, fontSize: 28, bold: true, color: C(b.primary), fontFace: b.font });
    sl.addText((s.bullets || []).map(x => ({ text: x, options: { bullet: { code: "25A0" }, breakLine: true } })), { x: 0.7, y: 1.5, w: img ? 6.6 : 12, h: 5, fontSize: 20, color: "333333", valign: "top", paraSpaceAfter: 10, fontFace: b.font });
    if (img) sl.addImage({ data: img, x: 7.6, y: 1.5, w: 5.2, h: 3.9, sizing: { type: "cover", w: 5.2, h: 3.9 } });
    if (s.notes) sl.addNotes(s.notes);
  }
  const blob = await p.write({ outputType: "blob" });
  const name = fname(plan.title || konu, "pptx");
  const r = await saveFile(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), name);
  S.docs = [{ id: uid(), type: "sunum", title: plan.title || konu, name, plan, at: localISO(new Date()) }, ...(S.docs || [])].slice(0, 40); save();
  return { ok: true, dosya: name, yer: r.yer, slayt: (plan.slides || []).length + 1 };
}

/* ---------- BELGE (.docx) ---------- */
async function makeDocument({ tur = "serbest", konu, detay = "" }) {
  const mem = S.memory.map(m => m.text).join("; ");
  const plan = await geminiJSON(`Türkçe bir ${tur} belgesi hazırla. Konu: ${konu}. Ek bilgi: ${detay}. ${tur === "cv" ? "Bu Burak'ın oyuncu CV'si: bildiğin bilgiler: " + mem + ". Bilmediğin yerleri [doldurun] diye bırak, uydurma." : ""}
JSON: {"title":"","sections":[{"heading":"","paragraphs":[""],"bullets":[""]}]}`);
  await loadLib("lib/docx.js");
  const D = window.docx; const ch = [];
  ch.push(new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun({ text: plan.title || konu, bold: true })] }));
  for (const s of plan.sections || []) {
    if (s.heading) ch.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun(s.heading)] }));
    for (const p of s.paragraphs || []) if (p) ch.push(new D.Paragraph({ children: [new D.TextRun(p)], spacing: { after: 120 } }));
    for (const x of s.bullets || []) if (x) ch.push(new D.Paragraph({ text: x, bullet: { level: 0 } }));
  }
  const doc = new D.Document({ creator: SET.name, title: plan.title, sections: [{ children: ch }] });
  const blob = await D.Packer.toBlob(doc);
  const name = fname(plan.title || konu, "docx");
  const r = await saveFile(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), name);
  S.docs = [{ id: uid(), type: tur, title: plan.title || konu, name, at: localISO(new Date()) }, ...(S.docs || [])].slice(0, 40); save();
  return { ok: true, dosya: name, yer: r.yer };
}

/* ---------- FOTOĞRAF EDİTÖRÜ ---------- */
const ED = { img: null, files: [], aspect: "orig", bri: 100, con: 100, sat: 100, warm: 0, filter: "none", text: "", bg: "none", logo: false, mask: null };
const ASPECTS = { orig: null, "1:1": 1, "4:5": 0.8, "9:16": 9 / 16, "16:9": 16 / 9, "8x10": 0.8 };
let SEG = null;
async function segmenter() {
  if (SEG) return SEG;
  const v = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
  const fs = await v.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  SEG = await v.ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite" }, outputConfidenceMasks: true, runningMode: "IMAGE" });
  return SEG;
}
async function personMask(img) {
  const seg = await segmenter(); const r = seg.segment(img); const m = r.confidenceMasks[0];
  const w = m.width, h = m.height, data = m.getAsFloat32Array(); const c = document.createElement("canvas"); c.width = w; c.height = h;
  const id = c.getContext("2d").createImageData(w, h); for (let i = 0; i < data.length; i++) { id.data[i * 4 + 3] = Math.round(Math.min(1, data[i] * 1.15) * 255); }
  c.getContext("2d").putImageData(id, 0, 0); m.close && m.close(); return c;
}
function filterCSS(o) {
  let f = `brightness(${o.bri}%) contrast(${o.con}%) saturate(${o.sat}%)`;
  if (o.filter === "bw") f += " grayscale(1)"; if (o.filter === "warm") f += " sepia(.25) saturate(1.1)"; if (o.filter === "cool") f += " hue-rotate(-12deg) saturate(.9)";
  if (o.filter === "cine") f += " contrast(1.15) saturate(.8) sepia(.12)"; if (o.warm) f += ` sepia(${Math.min(.5, Math.abs(o.warm) / 100)})` + (o.warm < 0 ? " hue-rotate(-20deg)" : "");
  return f;
}
async function renderPhoto(img, o, maxSide = 2400) {
  let sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height, sx = 0, sy = 0;
  const a = ASPECTS[o.aspect]; if (a) { if (sw / sh > a) { const nw = sh * a; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / a; sy = (sh - nh) * 0.35; sh = nh; } }
  const k = Math.min(1, maxSide / Math.max(sw, sh)); const W = Math.round(sw * k), H = Math.round(sh * k);
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const drawImg = (ctx, filt) => { ctx.filter = filt || "none"; ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H); ctx.filter = "none"; };
  if (o.bg !== "none") {
    const mask = o.mask || (o.mask = await personMask(img));
    const person = document.createElement("canvas"); person.width = W; person.height = H; const pg = person.getContext("2d");
    drawImg(pg, filterCSS(o)); pg.globalCompositeOperation = "destination-in";
    pg.drawImage(mask, sx * mask.width / (img.naturalWidth || img.width), sy * mask.height / (img.naturalHeight || img.height), sw * mask.width / (img.naturalWidth || img.width), sh * mask.height / (img.naturalHeight || img.height), 0, 0, W, H);
    if (o.bg === "blur") drawImg(g, filterCSS(o) + " blur(14px)");
    else if (o.bg === "white") { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); }
    else if (o.bg === "black") { g.fillStyle = "#111"; g.fillRect(0, 0, W, H); }
    else if (o.bg === "grey") { const gr = g.createRadialGradient(W / 2, H * .4, 10, W / 2, H / 2, Math.max(W, H) * .7); gr.addColorStop(0, "#9a9a9a"); gr.addColorStop(1, "#4a4a4a"); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    g.drawImage(person, 0, 0);
  } else drawImg(g, filterCSS(o));
  if (o.text) { const fs = Math.round(H * 0.055); g.font = `800 ${fs}px Rajdhani, Arial`; g.textAlign = "center"; g.lineWidth = fs * 0.12; g.strokeStyle = "rgba(0,0,0,.7)"; g.fillStyle = "#fff"; g.strokeText(o.text, W / 2, H - fs * 0.9); g.fillText(o.text, W / 2, H - fs * 0.9); }
  if (o.logo && brand().logo) { const L = await loadImg(brand().logo); const lw = W * 0.16, lh = lw * L.height / L.width; g.globalAlpha = 0.85; g.drawImage(L, W - lw - W * 0.03, H - lh - W * 0.03, lw, lh); g.globalAlpha = 1; }
  return c;
}
const canvasBlob = (c, type = "image/jpeg", q = 0.92) => new Promise(r => c.toBlob(r, type, q));
async function previewPhoto() {
  const el = $("#edPrev"); if (!el || !ED.img) return;
  try { const c = await renderPhoto(ED.img, ED, 900); el.src = c.toDataURL("image/jpeg", 0.8); } catch (e) { toast("Önizleme: " + e.message); }
}
async function savePhoto(img = ED.img, o = ED, name) {
  const c = await renderPhoto(img, o); const png = o.bg !== "none" && o.bg !== "blur" && o.bg !== "grey" && o.bg !== "white" && o.bg !== "black";
  const b = await canvasBlob(c, png ? "image/png" : "image/jpeg"); return saveFile(b, name || fname("foto", png ? "png" : "jpg"), "pictures");
}
async function batchEdit(files, pattern = "foto") {
  let n = 0; for (const f of files) { const img = await fileImg(f); const o = { ...ED, mask: null }; await savePhoto(img, o, fname(`${pattern}-${pad(++n)}`, "jpg")); URL.revokeObjectURL(img._url); }
  return n;
}
async function smartPick(files) {
  const thumbs = [];
  for (const f of files) { const img = await fileImg(f); const c = document.createElement("canvas"); const k = 384 / Math.max(img.width, img.height); c.width = img.width * k; c.height = img.height * k; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); thumbs.push({ f, url: img._url, b64: c.toDataURL("image/jpeg", 0.75).split(",")[1] }); }
  const scores = [];
  for (let i = 0; i < thumbs.length; i += 6) {
    const batch = thumbs.slice(i, i + 6);
    const r = await geminiJSON(`Bu ${batch.length} fotoğraf bir oyuncu headshot çekiminden. Her birini 0-100 arası puanla: netlik, gözler açık ve canlı mı, ifade, ışık, kadraj. JSON: [{"i":0,"score":0,"reason":"kısa Türkçe"}] (i = bu gruptaki sıra, 0'dan).`, batch.map(t => ({ inlineData: { mimeType: "image/jpeg", data: t.b64 } })));
    for (const x of r) if (batch[x.i]) scores.push({ ...batch[x.i], score: x.score, reason: x.reason });
  }
  return scores.sort((a, b) => b.score - a.score);
}

/* ---------- KOMPOZİT KART ---------- */
async function compositeCard(files, info) {
  const b = brand(); const W = 2400, H = 1600; const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const imgs = []; for (const f of files.slice(0, 5)) imgs.push(await fileImg(f));
  const cover = (img, x, y, w, h) => { const r = Math.max(w / img.width, h / img.height); const sw = w / r, sh = h / r; g.drawImage(img, (img.width - sw) / 2, (img.height - sh) * 0.3, sw, sh, x, y, w, h); };
  const pad2 = 30, bar = 220;
  if (imgs[0]) cover(imgs[0], pad2, pad2, 1000, H - bar - pad2 * 2);
  const gx = 1000 + pad2 * 2, gw = (W - gx - pad2 - pad2) / 2, gh = (H - bar - pad2 * 3) / 2;
  imgs.slice(1, 5).forEach((im, i) => cover(im, gx + (i % 2) * (gw + pad2), pad2 + Math.floor(i / 2) * (gh + pad2), gw, gh));
  g.fillStyle = b.primary || "#2c0a0d"; g.fillRect(0, H - bar, W, bar);
  g.fillStyle = "#fff"; g.font = "800 92px Rajdhani, Arial"; g.textBaseline = "middle"; g.fillText((info.name || SET.name).toLocaleUpperCase("tr-TR"), 60, H - bar / 2 - 30);
  g.font = "500 44px Rajdhani, Arial"; g.fillStyle = b.accent || "#ff3b3b"; g.fillText(info.stats || "", 60, H - bar / 2 + 52);
  g.textAlign = "right"; g.fillStyle = "#fff"; g.font = "600 40px Rajdhani, Arial"; g.fillText(info.contact || b.name || "", W - (b.logo ? 360 : 60), H - bar / 2);
  if (b.logo) { const L = await loadImg(b.logo); const lh = 140, lw = lh * L.width / L.height; g.drawImage(L, W - lw - 60, H - bar / 2 - lh / 2, lw, lh); }
  imgs.forEach(i => URL.revokeObjectURL(i._url));
  return saveFile(await canvasBlob(c, "image/jpeg", 0.93), fname("kompozit-" + (info.name || SET.name), "jpg"), "pictures");
}

/* ---------- VİDEO: kurgu, altyazı, slate, fotoğraftan video ---------- */
async function audioWavFromFile(file, start = 0, dur = null) {
  const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 16000, 16000);
  const buf = await ac.decodeAudioData(await file.arrayBuffer());
  const s = Math.floor(start * buf.sampleRate), e = Math.min(buf.length, dur ? s + Math.floor(dur * buf.sampleRate) : buf.length);
  const ch = buf.getChannelData(0).subarray(s, e); const ratio = buf.sampleRate / 16000, n = Math.floor(ch.length / ratio), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.max(-1, Math.min(1, ch[Math.floor(i * ratio)])) * 0x7fff;
  const out = new ArrayBuffer(44 + n * 2), v = new DataView(out), w = (p, t) => { for (let i = 0; i < t.length; i++) v.setUint8(p + i, t.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true); new Int16Array(out, 44).set(pcm);
  return { wav: new Uint8Array(out), rms: ch };
}
async function subtitlesFor(file, start, dur, lang = "tr") {
  const { wav } = await audioWavFromFile(file, start, dur); let segs = [];
  if (SET.groqKey) {
    const fd = new FormData(); fd.append("file", new Blob([wav], { type: "audio/wav" }), "a.wav"); fd.append("model", "whisper-large-v3-turbo"); fd.append("language", "tr"); fd.append("response_format", "verbose_json");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + SET.groqKey }, body: fd }); const j = await r.json();
    segs = (j.segments || []).map(s => ({ start: s.start, end: s.end, text: s.text.trim() })).filter(s => s.text && !WHISPER_JUNK.test(s.text));
  } else {
    segs = await geminiJSON("Bu ses kaydını Türkçe altyazıya dök. Her 1-2 saniyelik parça için zaman damgası ver. JSON: [{\"start\":0.0,\"end\":1.5,\"text\":\"\"}]", [{ inlineData: { mimeType: "audio/wav", data: bytesToB64(wav) } }]);
  }
  if (lang === "en" && segs.length) { try { const t = await geminiJSON("Bu Türkçe altyazıları doğal İngilizceye çevir, aynı sırayla. JSON: [\"...\"]\n" + JSON.stringify(segs.map(s => s.text))); segs.forEach((s, i) => { if (t[i]) s.text = t[i]; }); } catch {} }
  return segs;
}
async function autoTrim(file) {
  const { rms } = await audioWavFromFile(file); const win = 1600; let first = -1, last = -1; let mx = 0;
  const lv = []; for (let i = 0; i < rms.length; i += win) { let q = 0; for (let k = i; k < Math.min(rms.length, i + win); k++) q += rms[k] * rms[k]; const v = Math.sqrt(q / win); lv.push(v); mx = Math.max(mx, v); }
  const thr = mx * 0.18; lv.forEach((v, i) => { if (v > thr) { if (first < 0) first = i; last = i; } });
  return first < 0 ? null : { start: Math.max(0, first * 0.1 - 0.6), end: last * 0.1 + 0.8 };
}
/** clips: [{file|img, start, end, kind:"video"|"image"|"card", text}] */
async function renderVideo({ clips, format = "9:16", music = null, subs = "none", cleanAudio = true, narration = null, onProgress }) {
  const [W, H] = format === "16:9" ? [1280, 720] : format === "1:1" ? [1080, 1080] : [720, 1280];
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
  const ac = new (window.AudioContext || window.webkitAudioContext)(); const dest = ac.createMediaStreamDestination();
  let chain = dest; if (cleanAudio) { const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90; const comp = ac.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 3; hp.connect(comp); comp.connect(dest); chain = hp; }
  let mEl = null; if (music) { mEl = new Audio(URL.createObjectURL(music)); mEl.loop = true; const ms = ac.createMediaElementSource(mEl); const mg = ac.createGain(); mg.gain.value = narration || clips.some(c => c.kind === "video") ? 0.18 : 0.6; ms.connect(mg); mg.connect(dest); }
  const mime = ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5e6 } : undefined); const parts = []; rec.ondataavailable = e => e.data.size && parts.push(e.data);
  const b = brand(); let curSub = "";
  const drawCover = (src, sw, sh, zoom = 1, px = 0.5, py = 0.4) => { const r = Math.max(W / sw, H / sh) * zoom; const dw = sw * r, dh = sh * r; g.drawImage(src, (W - dw) * px, (H - dh) * py, dw, dh); };
  const drawSub = () => { if (!curSub) return; const fs = Math.round(W * 0.052); g.font = `700 ${fs}px Rajdhani, Arial`; g.textAlign = "center"; g.lineJoin = "round"; const words = curSub.split(" "); const lines = []; let l = ""; for (const w of words) { if (g.measureText(l + " " + w).width > W * 0.86 && l) { lines.push(l); l = w; } else l = (l ? l + " " : "") + w; } lines.push(l); lines.forEach((t, i) => { const y = H * 0.82 + i * fs * 1.15; g.lineWidth = fs * 0.18; g.strokeStyle = "rgba(0,0,0,.85)"; g.strokeText(t, W / 2, y); g.fillStyle = "#fff"; g.fillText(t, W / 2, y); }); };
  const drawCard = (title, sub) => { g.fillStyle = b.primary || "#2c0a0d"; g.fillRect(0, 0, W, H); g.fillStyle = b.accent || "#ff3b3b"; g.fillRect(W * .1, H * .5 + 6, W * .8, 4); g.textAlign = "center"; g.fillStyle = "#fff"; g.font = `800 ${Math.round(W * .075)}px Rajdhani, Arial`; g.fillText(title || "", W / 2, H * .47); g.font = `500 ${Math.round(W * .042)}px Rajdhani, Arial`; g.fillStyle = "#ddd"; (sub || "").split("\n").forEach((s, i) => g.fillText(s, W / 2, H * .57 + i * W * .055)); };
  const total = clips.reduce((s, c) => s + ((c.end ?? 3) - (c.start || 0)), 0); let done = 0;
  rec.start(500); if (mEl) mEl.play().catch(() => {});
  if (narration) { const src = ac.createBufferSource(); src.buffer = narration; src.connect(dest); src.start(); }
  for (const c of clips) {
    const dur = (c.end ?? 3) - (c.start || 0);
    if (c.kind === "video") {
      const v = document.createElement("video"); v.src = URL.createObjectURL(c.file); v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
      await new Promise(r => { v.onloadedmetadata = r; v.load(); });
      const vs = ac.createMediaElementSource(v); vs.connect(chain);
      if ((c.start || 0) > 0.01) { v.currentTime = c.start; await new Promise(r => { v.onseeked = r; }); }
      await v.play();
      await new Promise(res => {
        const tick = () => {
          const t = v.currentTime; if (t >= (c.end ?? v.duration) - 0.03 || v.ended) { v.pause(); return res(); }
          drawCover(v, v.videoWidth, v.videoHeight); curSub = ""; if (c.subs) { const s = c.subs.find(s => t - (c.start || 0) >= s.start && t - (c.start || 0) <= s.end + 0.2); curSub = s ? s.text : ""; } drawSub();
          onProgress && onProgress(Math.min(1, (done + t - (c.start || 0)) / total)); requestAnimationFrame(tick);
        }; requestAnimationFrame(tick);
      });
      vs.disconnect(); URL.revokeObjectURL(v.src);
    } else {
      const t0 = performance.now();
      await new Promise(res => { const tick = () => { const p = (performance.now() - t0) / 1000 / dur; if (p >= 1) return res();
        if (c.kind === "card") drawCard(c.text, c.sub); else { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); drawCover(c.img, c.img.width, c.img.height, 1.04 + p * 0.1, 0.5 - (c.pan || 0) * (p - .5) * .2, 0.4); if (c.text) { curSub = c.text; drawSub(); } }
        onProgress && onProgress(Math.min(1, (done + p * dur) / total)); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    }
    done += dur;
  }
  await sleep(300); await new Promise(r => { rec.onstop = r; rec.stop(); }); if (mEl) mEl.pause(); ac.close();
  const blob = new Blob(parts, { type: rec.mimeType || "video/webm" });
  const ext = (rec.mimeType || "").includes("mp4") ? "mp4" : "webm";
  return { blob, ext };
}
async function photoVideo(files, metin, format = "9:16") {
  const imgs = []; for (const f of files) imgs.push(await fileImg(f));
  let narration = null, per = 3;
  if (metin && SET.geminiKey) { try { narration = await geminiTtsBuffer(metin); per = Math.max(2.2, narration.duration / imgs.length); } catch {} }
  const clips = imgs.map((img, i) => ({ kind: "image", img, start: 0, end: per, pan: i % 2 ? 1 : -1 }));
  const r = await renderVideo({ clips, format, narration, onProgress: p => { const e = $("#vidProg"); if (e) e.textContent = `İşleniyor %${Math.round(p * 100)}`; } });
  imgs.forEach(i => URL.revokeObjectURL(i._url));
  return saveFile(r.blob, fname("foto-video", r.ext), "movies");
}
async function analyzeTape(file) {
  if (file.size > 19e6) throw new Error("Video 19 MB'den küçük olmalı (kısa bir parça seç).");
  const b64 = await blobToB64(file);
  return plainGemini(`Sen deneyimli bir casting direktörü ve oyunculuk koçusun. Bu self-tape'i izle ve Türkçe, yapıcı geri bildirim ver: 1) ilk izlenim, 2) göz teması ve odak, 3) yüz ifadesi ve duygunun inandırıcılığı, 4) tempo ve duraklamalar, 5) kadraj, ışık ve ses kalitesi, 6) bir sonraki çekim için 3 somut öneri. En fazla 220 kelime.`, [{ inlineData: { mimeType: file.type || "video/mp4", data: b64 } }], null, { max: 1200 });
}

/* ---------- PORTFOLYO SİTESİ ---------- */
async function portfolioSite() {
  const facts = S.memory.map(m => m.text).join("\n");
  const html = await plainGemini(`Burak için tek dosyalık, şık, mobil uyumlu bir oyuncu portfolyo web sayfası (HTML+CSS, JavaScript'siz) yaz. Türkçe. Bölümler: hakkımda, eğitim, işler (dizi/film/tiyatro), yetenekler, iletişim (Instagram @tuncbilekburak). Bilinenler:\n${facts}\nBilmediğin bilgileri uydurma, "[eklenecek]" yaz. Sadece HTML kodunu döndür.`, [], null, { max: 6000 });
  const code = (String(html).match(/<!DOCTYPE[\s\S]*<\/html>/i) || [html])[0];
  return saveFile(new Blob([code], { type: "text/html" }), fname("portfolyo", "html"));
}

/* ---------- araçlar ---------- */
TOOLS.push(
  T("sunum_hazirla", "PowerPoint sunumu (.pptx) hazırlar ve telefona kaydeder (görsellerle).", { konu: str("Konu ve amaç"), slayt: num("Slayt sayısı, varsayılan 8"), ton: str("Ton (profesyonel, samimi, ikna edici...)") }, ["konu"], a => makePresentation(a)),
  T("belge_hazirla", "Word belgesi (.docx) hazırlar: CV, teklif, mektup, sözleşme taslağı, rapor...", { tur: str("Tür", ["cv", "teklif", "mektup", "rapor", "sozlesme", "serbest"]), konu: str("Konu"), detay: str("Ek bilgiler") }, ["konu"], a => makeDocument(a)),
  T("gorsel_uret", "Yapay zekâyla görsel üretir (afiş, post, sunum görseli) ve galeriye kaydeder.", { aciklama: str("Görsel tarifi"), oran: str("Oran", ["1:1", "9:16", "16:9"]) }, ["aciklama"],
    async a => { const [w, h] = a.oran === "9:16" ? [768, 1344] : a.oran === "16:9" ? [1344, 768] : [1024, 1024]; const d = await anyImage(a.aciklama, w, h); const r = await saveFile(await (await fetch(d)).blob(), fname("gorsel", "jpg"), "pictures"); STUDIO_LAST = d; return { ok: true, yer: r.yer }; }),
  T("fotograf_duzenle", "Stüdyo'da açık fotoğrafı düzenleyip kaydeder.", { oran: str("Oran", ["orig", "1:1", "4:5", "9:16", "16:9", "8x10"]), filtre: str("Filtre", ["none", "bw", "warm", "cool", "cine"]), parlaklik: num("50-150"), kontrast: num("50-150"), doygunluk: num("0-200"), yazi: str("Üstüne yazı"), arka_plan: str("Arka plan", ["none", "blur", "white", "black", "grey", "remove"]) }, [],
    async a => { if (!ED.img) return { hata: "Önce Stüdyo → Fotoğraf'tan bir fotoğraf seç." }; Object.assign(ED, { aspect: a.oran || ED.aspect, filter: a.filtre || ED.filter, bri: a.parlaklik || ED.bri, con: a.kontrast || ED.con, sat: a.doygunluk ?? ED.sat, text: a.yazi ?? ED.text, bg: a.arka_plan || ED.bg }); await previewPhoto(); const r = await savePhoto(); return { ok: true, yer: r.yer }; }),
  T("portfolyo_sitesi", "Burak için oyuncu portfolyo web sayfası (HTML) hazırlar.", {}, [], () => portfolioSite()),
  T("studyo_ac", "Stüdyo ekranını açar (fotoğraf, video, kart, sunum bölümleri).", { bolum: str("Bölüm", ["doc", "photo", "image", "video", "card", "files"]) }, [], a => { go("studio"); openSec("studio", a.bolum || "doc"); return { ok: true }; })
);
Object.assign(ACT_TR, { sunum_hazirla: "📊 sunum", belge_hazirla: "📄 belge", gorsel_uret: "🎨 görsel", fotograf_duzenle: "🖼 fotoğraf", portfolyo_sitesi: "🌐 portfolyo" });
let STUDIO_LAST = null;

/* ---------- STÜDYO ARAYÜZÜ ---------- */
CUR.studio = "doc"; GROUP_EL.studio = "#b-studio";
const studioRange = (k, label, min, max) => `<div><div class="lbl">${label} <span id="v_${k}">${ED[k]}</span></div><input type="range" min="${min}" max="${max}" value="${ED[k]}" data-ed="${k}"></div>`;
FORMS.doc = FORMS.photo = FORMS.image = FORMS.video = FORMS.card = FORMS.files = null;
{
  const baseList2 = listHTML;
  listHTML = function (sec) {
    const busyNote = `<div class="hint" id="stBusy"></div>`;
    switch (sec) {
      case "doc": return `<div class="card"><h3>SUNUM</h3><div class="form"><input id="pzKonu" placeholder="Konu (ör. Recast Talent House tanıtımı)"><div class="row"><input id="pzN" type="number" value="8" min="3" max="20"><select id="pzTon"><option>profesyonel</option><option>samimi</option><option>ikna edici</option><option>yaratıcı</option></select></div><button class="btn" id="pzGo">📊 Sunum hazırla (.pptx)</button><div class="hint">Görseller için Cloudflare bağlıysa slaytlara otomatik görsel eklenir.</div></div></div>
        <div class="card"><h3>BELGE</h3><div class="form"><div class="row"><select id="dcTur"><option value="cv">CV</option><option value="teklif">Teklif</option><option value="mektup">Mektup</option><option value="rapor">Rapor</option><option value="sozlesme">Sözleşme taslağı</option><option value="serbest">Serbest</option></select><input id="dcKonu" placeholder="Konu"></div><textarea id="dcDetay" placeholder="Detaylar (isteğe bağlı)" style="min-height:60px"></textarea><button class="btn" id="dcGo">📄 Belge hazırla (.docx)</button></div></div>
        <div class="card"><h3>SUNUM PROVASI</h3><button class="btn ghost" id="pzRehearse">🎙 Provamı dinle ve değerlendir</button><div class="hint">Sunumu sesli anlat; tempo, dolgu kelimeler ve netlik için geri bildirim veririm.</div></div>
        <div class="card"><h3>PORTFOLYO</h3><button class="btn ghost" id="pfGo">🌐 Portfolyo web sayfamı hazırla</button></div>${busyNote}`;
      case "photo": return `<div class="card"><div class="row"><button class="btn" id="edPick">📷 Fotoğraf seç</button><button class="btn ghost" id="edBatch">Toplu düzenle</button><button class="btn ghost" id="edSmart">⭐ En iyileri seç</button></div>
        ${ED.img ? `<img id="edPrev" style="width:100%;border-radius:10px;margin-top:10px;background:#111">
        <div class="form" style="margin-top:8px"><div class="row"><select data-ed="aspect">${Object.keys(ASPECTS).map(k => `<option ${ED.aspect === k ? "selected" : ""} value="${k}">${k === "orig" ? "Orijinal oran" : k === "8x10" ? "Headshot 8x10" : k}</option>`).join("")}</select><select data-ed="filter"><option value="none">Filtre yok</option><option value="bw">Siyah-beyaz</option><option value="warm">Sıcak</option><option value="cool">Soğuk</option><option value="cine">Sinematik</option></select></div>
        <div class="row">${studioRange("bri", "Parlaklık", 50, 150)}${studioRange("con", "Kontrast", 50, 150)}</div><div class="row">${studioRange("sat", "Doygunluk", 0, 200)}${studioRange("warm", "Sıcaklık", -50, 50)}</div>
        <div class="row"><select data-ed="bg"><option value="none">Arka plan: aynen</option><option value="blur">Arka planı bulanıklaştır</option><option value="grey">Stüdyo grisi</option><option value="white">Beyaz</option><option value="black">Siyah</option><option value="remove">Kaldır (şeffaf PNG)</option></select><label class="hint" style="flex:0 0 auto"><input type="checkbox" data-ed="logo" ${ED.logo ? "checked" : ""} style="width:auto"> logo</label></div>
        <input data-ed="text" placeholder="Üstüne yazı (isteğe bağlı)" value="${esc(ED.text)}"><button class="btn" id="edSave">💾 Kaydet</button><div class="hint">Sesle de olur: "fotoğrafı siyah beyaz yap, arka planı bulanıklaştır, kaydet".</div></div>` : `<div class="hint">Bir fotoğraf seç; kırp, ışığını ayarla, filtre ve yazı ekle, arka planı değiştir.</div>`}</div>
        <div id="smartRes"></div>${busyNote}`;
      case "image": return `<div class="card"><h3>GÖRSEL ÜRET</h3><div class="form"><textarea id="giTxt" placeholder="Ne çizeyim? (ör. 'karanlık bir tiyatro sahnesinde tek spot ışığı, sinematik')" style="min-height:70px"></textarea><div class="row"><select id="giRatio"><option>1:1</option><option>9:16</option><option>16:9</option></select><button class="btn" id="giGo">🎨 Üret</button></div>${!SET.cfToken ? `<div class="hint">Cloudflare bağlı değil: Ayarlar → Stüdyo.</div>` : ""}</div>${STUDIO_LAST ? `<img src="${STUDIO_LAST}" style="width:100%;border-radius:10px;margin-top:10px">` : ""}</div>${busyNote}`;
      case "video": return `<div class="card"><h3>REELS / SHOWREEL</h3><div class="form"><button class="btn" id="vrPick">🎬 Klipleri seç</button><div id="vrList">${(VR.clips || []).map((c, i) => `<div class="step"><span>${i + 1}. ${esc(c.file.name.slice(0, 24))} · <input type="number" step="0.5" value="${c.start}" data-vr="${i}:start" style="width:64px;padding:4px"> – <input type="number" step="0.5" value="${c.end}" data-vr="${i}:end" style="width:64px;padding:4px"> sn</span><button class="x" data-vrdel="${i}">✕</button></div>`).join("")}</div>
        <div class="row"><select id="vrFmt"><option value="9:16">Dikey 9:16 (Reels)</option><option value="16:9">Yatay 16:9</option><option value="1:1">Kare 1:1</option></select><select id="vrSubs"><option value="none">Altyazı yok</option><option value="tr">Türkçe altyazı</option><option value="en">İngilizce altyazı</option></select></div>
        <input id="vrTitle" placeholder="Açılış kartı (ör. SHOWREEL 2026)"><input id="vrEnd" placeholder="Kapanış kartı (ör. Burak Tunçbilek · Recast)" value="${esc(SET.name)}">
        <div class="row"><button class="btn ghost" id="vrMusic">🎵 Müzik ${VR.music ? "✓" : "ekle"}</button><label class="hint" style="flex:0 0 auto"><input type="checkbox" id="vrClean" checked style="width:auto"> sesi iyileştir</label></div>
        <button class="btn" id="vrGo" ${VR.clips && VR.clips.length ? "" : "disabled"}>🎞 Videoyu oluştur</button></div></div>
        <div class="card"><h3>SELF-TAPE DÜZENLE</h3><div class="form"><input id="stRole" placeholder="Rol / proje (slate için)"><input id="stInfo" placeholder="Boy, yaş aralığı, ajans" value="${esc(brand().name || "")}"><button class="btn ghost" id="stGo">✂️ Self-tape seç → boşlukları kırp + slate ekle</button><button class="btn ghost" id="stAnalyze">🎭 Self-tape'imi analiz et</button></div></div>
        <div class="card"><h3>FOTOĞRAFTAN VİDEO</h3><div class="form"><textarea id="pvTxt" placeholder="Seslendirme metni (isteğe bağlı)" style="min-height:60px"></textarea><button class="btn ghost" id="pvGo">🖼→🎬 Fotoğrafları seç ve video yap</button></div></div>
        <div class="hint" id="vidProg"></div><div class="hint">Telefonda işleme gerçek süre kadar sürer; 1-2 dakikalık videolar idealdir.</div>`;
      case "card": return `<div class="card"><h3>KOMPOZİT KART (ZED CARD)</h3><div class="form"><input id="ccName" value="${esc(SET.name)}" placeholder="Ad Soyad"><input id="ccStats" placeholder="Boy 1.80 · Göz kahve · Saç siyah · Beden M"><input id="ccContact" placeholder="İletişim / ajans" value="${esc(brand().name || "")}"><button class="btn" id="ccGo">🗂 Fotoğrafları seç (1 büyük + 4 küçük) ve kart yap</button></div></div>
        <div class="card"><h3>MARKA KİTİ</h3>${(SET.brands || []).map(b => `<div class="step"><span><b style="color:${esc(b.accent)}">■</b> ${esc(b.name)}${b.id === SET.brandId ? " · aktif" : ""}</span><button class="btn ghost sm" data-brand="${b.id}">Seç</button><button class="x" data-brdel="${b.id}">✕</button></div>`).join("") || `<div class="hint">Marka yok.</div>`}
        <div class="form" style="margin-top:6px"><input id="brName" placeholder="Marka adı (ör. Recast Talent House)"><div class="row"><div><div class="lbl">Ana renk</div><input id="brP" type="color" value="#2c0a0d" style="padding:2px;height:40px"></div><div><div class="lbl">Vurgu</div><input id="brA" type="color" value="#ff3b3b" style="padding:2px;height:40px"></div></div><div class="row"><button class="btn ghost sm" id="brLogo">Logo seç</button><button class="btn sm" id="brAdd">+ Marka ekle</button></div></div></div>`;
      case "files": return `<div class="card"><h3>ÜRETİLEN DOSYALAR</h3>${(S.files || []).map((f, i) => `<div class="item"><div class="ic">${/pptx/.test(f.name) ? "📊" : /docx/.test(f.name) ? "📄" : /mp4|webm/.test(f.name) ? "🎬" : /html/.test(f.name) ? "🌐" : "🖼"}</div><div class="t"><div class="h">${esc(f.name)}</div><div class="meta">${esc(f.path || "")} · ${fmtWhen(f.at)}</div></div><button class="btn ghost sm" data-share="${i}">Paylaş</button></div>`).join("") || `<div class="empty">Henüz dosya yok.</div>`}</div>`;
    }
    return baseList2(sec);
  };
}
const VR = { clips: [], music: null };
document.addEventListener("input", e => { const k = e.target.dataset && e.target.dataset.ed; if (!k) return; ED[k] = e.target.type === "checkbox" ? e.target.checked : (e.target.type === "range" ? Number(e.target.value) : e.target.value); const v = $("#v_" + k); if (v) v.textContent = ED[k]; clearTimeout(ED._t); ED._t = setTimeout(previewPhoto, 250); });
document.addEventListener("change", e => {
  const k = e.target.dataset && e.target.dataset.ed; if (k && e.target.tagName === "SELECT") { ED[k] = e.target.value; previewPhoto(); }
  const vr = e.target.dataset && e.target.dataset.vr; if (vr) { const [i, f] = vr.split(":"); VR.clips[+i][f] = Number(e.target.value); }
});
async function busyRun(label, fn) { const el = $("#stBusy") || $("#vidProg"); if (el) el.textContent = "⏳ " + label + "…"; try { const r = await fn(); if (el) el.textContent = ""; return r; } catch (e) { if (el) el.textContent = ""; toast("✗ " + (e.message === "NOKEY" ? "Gemini anahtarı yok" : e.message), 5000); } }
document.addEventListener("click", async e => {
  const t = e.target.closest("#pzGo,#dcGo,#pzRehearse,#pfGo,#edPick,#edSave,#edBatch,#edSmart,[data-smsave],#giGo,#vrPick,[data-vrdel],#vrMusic,#vrGo,#stGo,#stAnalyze,#pvGo,#ccGo,#brLogo,#brAdd,[data-brand],[data-brdel],[data-share]");
  if (!t) return;
  if (t.id === "pzGo") { const konu = $("#pzKonu").value.trim(); if (!konu) return toast("Konu yaz"); const r = await busyRun("Sunum hazırlanıyor", () => makePresentation({ konu, slayt: +$("#pzN").value || 8, ton: $("#pzTon").value })); if (r) toast(`✓ ${r.dosya} → ${r.yer}`, 5000); }
  else if (t.id === "dcGo") { const konu = $("#dcKonu").value.trim(); if (!konu) return toast("Konu yaz"); const r = await busyRun("Belge hazırlanıyor", () => makeDocument({ tur: $("#dcTur").value, konu, detay: $("#dcDetay").value })); if (r) toast(`✓ ${r.dosya} → ${r.yer}`, 5000); }
  else if (t.id === "pzRehearse") { const b = await recordDialog("SUNUM PROVASI", "Sunumunu anlat (en fazla 9 dk).", 540); if (!b) return; const r = await busyRun("Dinliyorum", () => plainGemini("Sen bir sunum koçusun. Bu provayı dinle. Türkçe değerlendir: konuşma hızı, dolgu kelimeler (ııı, şey, yani) yaklaşık kaç kez, netlik, yapı, enerji, ve 3 somut öneri. En fazla 200 kelime.", [{ inlineData: { mimeType: "audio/wav", data: b } }], null, { max: 1200 })); if (r) { go("home"); bubble("assistant", "🎤 " + r); speak(r); } }
  else if (t.id === "pfGo") { const r = await busyRun("Portfolyo hazırlanıyor", () => portfolioSite()); if (r) toast("✓ portfolyo kaydedildi → " + r.yer, 5000); }
  else if (t.id === "edPick") { const [f] = await pickFiles("image/*"); if (!f) return; ED.img = await fileImg(f); ED.mask = null; renderSec("studio"); previewPhoto(); }
  else if (t.id === "edSave") { const r = await busyRun("Kaydediliyor", () => savePhoto()); if (r) toast("✓ Kaydedildi → " + r.yer); }
  else if (t.id === "edBatch") { const fs = await pickFiles("image/*", true); if (!fs.length) return; const n = await busyRun(`${fs.length} fotoğraf işleniyor`, () => batchEdit(fs, "foto")); if (n) toast(`✓ ${n} fotoğraf kaydedildi (Pictures/TITUS)`, 4000); }
  else if (t.id === "edSmart") { const fs = await pickFiles("image/*", true); if (!fs.length) return; const r = await busyRun(`${fs.length} fotoğraf değerlendiriliyor`, () => smartPick(fs)); if (r) { ED._smart = r; $("#smartRes").innerHTML = `<div class="card"><h3>EN İYİLER</h3>${r.map((x, i) => `<div class="item"><img src="${x.url}" style="width:64px;height:64px;object-fit:cover;border-radius:8px"><div class="t"><div class="h">${x.score}/100</div><div class="meta">${esc(x.reason)}</div></div>${i < 10 ? `<button class="btn ghost sm" data-smsave="${i}">Kaydet</button>` : ""}</div>`).join("")}</div>`; } }
  else if (t.dataset.smsave) { const x = ED._smart[+t.dataset.smsave]; await saveFile(x.f, x.f.name, "pictures"); toast("✓ Kaydedildi"); }
  else if (t.id === "giGo") { const txt = $("#giTxt").value.trim(); if (!txt) return toast("Tarif yaz"); const r = await busyRun("Görsel üretiliyor", () => runTool("gorsel_uret", { aciklama: txt, oran: $("#giRatio").value })); if (r && r.ok) { toast("✓ Galeriye kaydedildi"); renderSec("studio"); } else if (r) toast("✗ " + r.hata, 5000); }
  else if (t.id === "vrPick") { const fs = await pickFiles("video/*", true); for (const f of fs) { const v = document.createElement("video"); v.src = URL.createObjectURL(f); await new Promise(r => { v.onloadedmetadata = r; }); VR.clips.push({ file: f, start: 0, end: Math.min(Math.round(v.duration * 2) / 2, 30) }); URL.revokeObjectURL(v.src); } renderSec("studio"); }
  else if (t.dataset.vrdel) { VR.clips.splice(+t.dataset.vrdel, 1); renderSec("studio"); }
  else if (t.id === "vrMusic") { const [f] = await pickFiles("audio/*"); VR.music = f || null; renderSec("studio"); }
  else if (t.id === "vrGo") {
    const subs = $("#vrSubs").value, fmt = $("#vrFmt").value, title = $("#vrTitle").value.trim(), endT = $("#vrEnd").value.trim(), clean = $("#vrClean").checked;
    const r = await busyRun("Video hazırlanıyor", async () => {
      const clips = []; if (title) clips.push({ kind: "card", text: title, sub: SET.name, start: 0, end: 2.2 });
      for (const c of VR.clips) { const cc = { kind: "video", file: c.file, start: c.start, end: c.end }; if (subs !== "none") { $("#vidProg").textContent = "Altyazı çıkarılıyor…"; try { cc.subs = await subtitlesFor(c.file, c.start, c.end - c.start, subs); } catch (er) { toast("Altyazı: " + er.message); } } clips.push(cc); }
      if (endT) clips.push({ kind: "card", text: endT.split("·")[0].trim(), sub: endT.split("·").slice(1).join("·").trim() || brand().name || "", start: 0, end: 2.5 });
      const out = await renderVideo({ clips, format: fmt, music: VR.music, cleanAudio: clean, onProgress: p => { $("#vidProg").textContent = `İşleniyor %${Math.round(p * 100)}`; } });
      return saveFile(out.blob, fname(title || "showreel", out.ext), "movies");
    });
    if (r) { toast("🎬 Kaydedildi → " + r.yer, 5000); $("#vidProg").textContent = ""; }
  }
  else if (t.id === "stGo") {
    const [f] = await pickFiles("video/*"); if (!f) return;
    const r = await busyRun("Self-tape düzenleniyor", async () => {
      const tr = await autoTrim(f).catch(() => null); const v = document.createElement("video"); v.src = URL.createObjectURL(f); await new Promise(r => { v.onloadedmetadata = r; }); const D = v.duration; URL.revokeObjectURL(v.src);
      const start = tr ? tr.start : 0, end = tr ? Math.min(D, tr.end) : D;
      const clips = [{ kind: "card", text: SET.name, sub: [$("#stRole").value, $("#stInfo").value].filter(Boolean).join("\n"), start: 0, end: 3 }, { kind: "video", file: f, start, end }];
      const out = await renderVideo({ clips, format: "16:9", cleanAudio: true, onProgress: p => { $("#vidProg").textContent = `İşleniyor %${Math.round(p * 100)}`; } });
      return saveFile(out.blob, fname("selftape-" + ($("#stRole").value || "rol"), out.ext), "movies");
    });
    if (r) toast("✓ Self-tape hazır → " + r.yer, 5000);
  }
  else if (t.id === "stAnalyze") { const [f] = await pickFiles("video/*"); if (!f) return; const r = await busyRun("Self-tape izleniyor", () => analyzeTape(f)); if (r) { go("home"); bubble("assistant", "🎭 " + r); speak(r); } }
  else if (t.id === "pvGo") { const fs = await pickFiles("image/*", true); if (!fs.length) return; const r = await busyRun("Video hazırlanıyor", () => photoVideo(fs, $("#pvTxt").value.trim(), "9:16")); if (r) toast("🎬 Kaydedildi → " + r.yer, 5000); }
  else if (t.id === "ccGo") { const fs = await pickFiles("image/*", true); if (!fs.length) return; const r = await busyRun("Kart hazırlanıyor", () => compositeCard(fs, { name: $("#ccName").value, stats: $("#ccStats").value, contact: $("#ccContact").value })); if (r) toast("✓ Kompozit kart → " + r.yer, 5000); }
  else if (t.id === "brLogo") { const [f] = await pickFiles("image/*"); if (!f) return; const img = await fileImg(f); const c = document.createElement("canvas"); const k = 400 / Math.max(img.width, img.height); c.width = img.width * k; c.height = img.height * k; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); ED._logo = c.toDataURL("image/png"); toast("Logo seçildi"); }
  else if (t.id === "brAdd") { const name = $("#brName").value.trim(); if (!name) return toast("Marka adı yaz"); const b = { id: uid(), name, primary: $("#brP").value, accent: $("#brA").value, text: "#ffffff", font: "Arial", logo: ED._logo || "" }; SET.brands = [...(SET.brands || []), b]; SET.brandId = b.id; ED._logo = null; await saveSet(); renderSec("studio"); }
  else if (t.dataset.brand) { SET.brandId = t.dataset.brand; await saveSet(); renderSec("studio"); }
  else if (t.dataset.brdel) { SET.brands = SET.brands.filter(b => b.id !== t.dataset.brdel); await saveSet(); renderSec("studio"); }
  else if (t.dataset.share) shareSaved(S.files[+t.dataset.share]);
});

{ const baseGo = go; go = function (v) { baseGo(v); if (v === "studio") renderSec("studio"); }; }

/* =====================================================================
   v2.0 — BEYİN VE HAYAT: bilgi bankası, modlar, koçlar, yedek, gizlilik, kota, yerel beyin
   ===================================================================== */

/* ---------- 1) KİŞİSEL BİLGİ BANKASI (anlamsal arama) ---------- */
const KB = { db: null };
function kbDb() {
  if (KB.db) return Promise.resolve(KB.db);
  return new Promise((res, rej) => { const r = indexedDB.open("jarvis_kb", 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("chunks")) d.createObjectStore("chunks", { keyPath: "id" }); }; r.onsuccess = () => { KB.db = r.result; res(KB.db); }; r.onerror = () => rej(r.error); });
}
const kbTx = (mode, fn) => kbDb().then(d => new Promise((res, rej) => { const t = d.transaction("chunks", mode); const st = t.objectStore("chunks"); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }));
const EMB_MODELS = ["gemini-embedding-001", "text-embedding-004"];
async function embed(texts, task = "RETRIEVAL_DOCUMENT") {
  for (const m of [SET.embModel, ...EMB_MODELS].filter((x, i, a) => x && a.indexOf(x) === i)) {
    try {
      const j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${m}:batchEmbedContents?key=${encodeURIComponent(SET.geminiKey)}`, { requests: texts.map(t => ({ model: "models/" + m, content: { parts: [{ text: t }] }, taskType: task, outputDimensionality: 384 })) });
      if (SET.embModel !== m) { SET.embModel = m; saveSet(); }
      return j.embeddings.map(e => Float32Array.from(e.values));
    } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
  }
  throw new Error("Gömme modeli bulunamadı");
}
function chunkText(t, size = 900, overlap = 120) { const out = []; t = t.replace(/\s+\n/g, "\n").trim(); for (let i = 0; i < t.length; i += size - overlap) out.push(t.slice(i, i + size)); return out.filter(x => x.trim().length > 40); }
async function kbAdd(title, text, source = "belge") {
  const chunks = chunkText(text); if (!chunks.length) throw new Error("Metin çok kısa");
  const docId = uid(); let n = 0;
  for (let i = 0; i < chunks.length; i += 50) {
    const part = chunks.slice(i, i + 50); const vecs = await embed(part.map(c => title + "\n" + c));
    await kbTx("readwrite", st => part.forEach((c, k) => st.put({ id: docId + "_" + (i + k), docId, title, text: c, vec: Array.from(vecs[k]) })));
    n += part.length;
  }
  S.kbDocs = [{ id: docId, title, source, chunks: n, at: localISO(new Date()) }, ...(S.kbDocs || [])]; save();
  return { ok: true, baslik: title, parca: n };
}
async function kbSearch(q, k = 5) {
  const [qv] = await embed([q], "RETRIEVAL_QUERY");
  const all = await kbTx("readonly", st => st.getAll());
  const nq = Math.hypot(...qv);
  const scored = (all || []).map(c => { let d = 0, n = 0; for (let i = 0; i < c.vec.length; i++) { d += c.vec[i] * qv[i]; n += c.vec[i] * c.vec[i]; } return { c, s: d / (Math.sqrt(n) * nq || 1) }; }).sort((a, b) => b.s - a.s).slice(0, k);
  return scored.filter(x => x.s > 0.35).map(x => ({ kaynak: x.c.title, metin: x.c.text, benzerlik: Math.round(x.s * 100) / 100 }));
}
async function kbDelete(docId) { const all = await kbTx("readonly", st => st.getAll()); await kbTx("readwrite", st => all.filter(c => c.docId === docId).forEach(c => st.delete(c.id))); S.kbDocs = (S.kbDocs || []).filter(d => d.id !== docId); save(); }
async function fileText(f) {
  if (/pdf$/i.test(f.name) || f.type === "application/pdf") {
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise; let t = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 150); i++) { const pg = await pdf.getPage(i); const tc = await pg.getTextContent(); t += tc.items.map(x => x.str).join(" ") + "\n"; }
    return t;
  }
  if (/\.(png|jpe?g|webp)$/i.test(f.name)) { const b = await shrinkImage(f, 1600); return plainGemini("Bu belgedeki/görseldeki tüm yazıyı aynen çıkar.", [{ inlineData: { mimeType: "image/jpeg", data: b } }], null, { max: 4000 }); }
  return f.text();
}

/* ---------- 2) UZMAN MODLAR ---------- */
const MODES = {
  koc: { rx: /seçme|rol|sahne|replik|oyunculuk|karakter|self-?tape|prova|diksiyon/, txt: "UZMAN MOD — Oyunculuk koçu: somut, uygulanabilir, cesaretlendirici ama dürüst ol; teknik terimleri sade anlat." },
  yazilim: { rx: /kod|oyun|uygulama|apk|github|hata|bug|galerici|saha yıldızı|cephe|javascript|python/, txt: "UZMAN MOD — Yazılım danışmanı: net teknik adımlar ver, kısa kod örnekleri kullan." },
  ajans: { rx: /recast|ajans|oyuncu listesi|kadro|müşteri|başvuru|casting direktörü/, txt: "UZMAN MOD — Ajans yöneticisi: profesyonel, düzenli, iş odaklı ol; mail taslaklarında kurumsal dil kullan." },
  plan: { rx: /plan|program|hafta|gün(ümü)?|takvim|yetiştir|öncelik/, txt: "UZMAN MOD — Planlayıcı: zaman bloklarıyla, öncelik sırasıyla, gerçekçi plan yap; vardiya ve yol sürelerini hesaba kat." }
};
let CUR_MODE = "";
function modeFor(prompt) { const t = trLower(prompt); for (const [k, m] of Object.entries(MODES)) if (m.rx.test(t)) return m.txt; return ""; }
{
  const baseSys = systemPrompt;
  systemPrompt = function () {
    let s = baseSys();
    if (CUR_MODE) s += "\n" + CUR_MODE;
    if ((S.kbDocs || []).length) s += `\nBİLGİ BANKASI: ${S.kbDocs.length} belge var (${S.kbDocs.slice(0, 8).map(d => d.title).join(", ")}). Burak'ın belgeleri, senaryoları, CV'si hakkında sorularda önce bilgi_ara aracını kullan.`;
    const ppl = (S.people || []).filter(p => p.every); if (ppl.length) s += `\nÖNEMLİ KİŞİLER: ${ppl.map(p => `${p.name} (her ${p.every} günde bir; son: ${p.last || "?"})`).join(", ")}`;
    if ((S.issues || []).length) s += `\nSON HATALARIM (tekrarlama): ${S.issues.slice(-5).map(i => i.detail).join(" | ")}`;
    return s;
  };
}

/* ---------- 3) HATA GÜNLÜĞÜ (kendini düzelten Titus) ---------- */
function logIssue(type, detail) { S.issues = [...(S.issues || []), { at: localISO(new Date()), type, detail: String(detail).slice(0, 160) }].slice(-100); save(); }
{
  const baseRun = runTool;
  runTool = async function (name, args) { const r = await baseRun(name, args); if (r && r.hata && !/sadece telefonda|kapalı|bağlı değil/i.test(r.hata)) logIssue("araç", `${name}: ${r.hata}`); return r; };
}
const CORRECTION_RX = /^(hayır|yanlış|öyle değil|anlamadın|bunu demedim|yanlış anladın)/i;

/* ---------- 4) GİZLİLİK MODU + YEREL BEYİN + KOTA ---------- */
const SENSITIVE_RX = /(şifre|parola|pin kodu|kart numara|iban|tc kimlik|kimlik numara|banka hesab|hastalı|teşhis|ilaç|tahlil|maaş|borcum)/i;
const QUOTA = { day: "", n: {} };
function qCount(svc) { const d = ymd(new Date()); if (QUOTA.day !== d) { QUOTA.day = d; QUOTA.n = {}; } QUOTA.n[svc] = (QUOTA.n[svc] || 0) + 1; }
let GEMINI_OFF_UNTIL = 0;
async function askLocal(history, onAct) {
  if (!SET.localUrl) throw new Error("NOLOCAL");
  const base = SET.localUrl.replace(/\/$/, "");
  const tools = pickTools(history).map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: schemaFor(t, false) } }));
  const messages = [{ role: "system", content: systemPrompt() }, ...history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))];
  for (let step = 0; step < 6; step++) {
    const j = await httpJson(base + "/v1/chat/completions", { model: SET.localModel || "qwen2.5:3b", messages, tools, temperature: 0.3 });
    const msg = j.choices && j.choices[0] && j.choices[0].message; if (!msg) break;
    if (!msg.tool_calls || !msg.tool_calls.length) return (msg.content || "").trim();
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
    for (const tc of msg.tool_calls) { let a = {}; try { a = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch {} onAct(tc.function.name); messages.push({ role: "tool", tool_call_id: tc.id || tc.function.name, content: JSON.stringify(await runTool(tc.function.name, a)) }); }
  }
  return "İşlemleri yaptım.";
}
// askGemini'yi sarmala: gizlilik, kota yönlendirme, sayım
{
  const baseAsk = askGemini;
  askGemini = async function (history, onAct, attach) {
    const last = (history[history.length - 1] || {}).content || "";
    CUR_MODE = modeFor(last);
    if (CORRECTION_RX.test(last.trim())) logIssue("düzeltme", `Burak düzeltti: "${last.slice(0, 80)}" (önceki: ${(history[history.length - 2] || {}).content?.slice(0, 60) || "-"})`);
    if (SET.privacy && SENSITIVE_RX.test(last) && !attach) {
      if (SET.localUrl) { onAct("🔒 yerel"); return askLocal(history, onAct); }
      const off = offlineCommand(last); if (off) return "🔒 " + off;
      return "🔒 Gizlilik modu açık: bu konu hassas olduğu için buluta göndermedim. Bilgisayarında yerel beyin kurulursa (Ayarlar → Yerel beyin) bunu da konuşabiliriz.";
    }
    if (Date.now() < GEMINI_OFF_UNTIL && SET.groqKey && !attach) { onAct("groq"); qCount("groq"); return askGroq(history, onAct); }
    try { qCount("gemini"); return await baseAsk(history, onAct, attach); }
    catch (e) {
      if (e.status === 429) GEMINI_OFF_UNTIL = Date.now() + 15 * 6e4;
      if ((e.status === 429 || e.status >= 500) && !attach && SET.localUrl && !SET.groqKey) { onAct("yerel"); return askLocal(history, onAct); }
      throw e;
    }
  };
}

/* ---------- 5) ŞİFRELİ YEDEK (Drive) ---------- */
async function deriveKey(pass, salt) { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]); return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
async function encryptState(pass) { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)); const key = await deriveKey(pass, salt); const data = new TextEncoder().encode(JSON.stringify({ S, SET: { ...SET, geminiKey: "", claudeKey: "", groqKey: "", cfToken: "", scriptToken: "" }, CHAT })); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)); const out = new Uint8Array(28 + ct.length); out.set(salt); out.set(iv, 16); out.set(ct, 28); return bytesToB64(out); }
async function decryptState(b64, pass) { const u = b64ToBytes(b64); const key = await deriveKey(pass, u.slice(0, 16)); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(16, 28) }, key, u.slice(28)); return JSON.parse(new TextDecoder().decode(pt)); }
async function backupNow() { if (!SET.backupPass) throw new Error("Önce yedek şifresi belirle (Ayarlar → Yedek)."); const b = await encryptState(SET.backupPass); await script("saveFile", { name: `jarvis-yedek-${ymd(new Date())}.enc`, mime: "application/octet-stream", data: b, folder: "Titus Yedek", keep: 14 }); META.lastBackup = Date.now(); saveMeta(); return { ok: true }; }
setTimeout(() => autoBackup(), 20000);
async function autoBackup() { if (SET.scriptUrl && SET.backupPass && Date.now() - (META.lastBackup || 0) > 864e5) { try { await backupNow(); } catch (e) { console.warn("yedek", e); } } }
async function restoreLatest(pass) { const r = await script("getBackup", { folder: "Titus Yedek" }); if (!r.data) throw new Error("Yedek bulunamadı"); const obj = await decryptState(r.data, pass); S = Object.assign(EMPTY(), obj.S); CHAT = obj.CHAT || CHAT; const keep = { geminiKey: SET.geminiKey, groqKey: SET.groqKey, claudeKey: SET.claudeKey, cfToken: SET.cfToken, scriptToken: SET.scriptToken, scriptUrl: SET.scriptUrl }; SET = Object.assign({ ...DEF_SET }, obj.SET, keep); await saveSet(); saveChat(); save(); return { ok: true, tarih: r.name }; }

/* ---------- 6) ÖNEMLİ KİŞİLER ---------- */
A.addPerson = ({ name, every = 7 }) => { const p = { id: uid(), name, every: Number(every) || 7, last: "" }; S.people = [...(S.people || []), p]; save(); return p; };
A.touchPerson = ({ name }) => { const p = (S.people || []).find(p => trLower(p.name).includes(trLower(name))); if (!p) throw new Error("Kişi listede yok"); p.last = ymd(new Date()); save(); return { name: p.name, last: p.last }; };
function overduePeople() { const now = Date.now(); return (S.people || []).filter(p => p.every && (!p.last || now - parseDate(p.last) > p.every * 864e5)); }

/* ---------- 7) KOÇLAR VE PROVA (canlı) ---------- */
const COACH = {
  ingilizce: "Sen Burak'ın İngilizce konuşma koçusun. Onunla İngilizce sohbet et, seviyesine uygun konuş, hatalarını nazikçe ve kısaca Türkçe düzelt, telaffuz için ipucu ver. Ara sıra casting ve oyunculukla ilgili İngilizce kalıplar öğret.",
  diksiyon: "Sen bir diksiyon ve sahne konuşması hocasısın. Burak'a tekerlemeler, artikülasyon ve nefes egzersizleri yaptır; söyleyişini dinleyip netlik, vurgu ve tonlama için geri bildirim ver.",
  sinav: "Sen drama eğitmenliği sınavına hazırlayan bir eğitmensin. Burak'a drama yöntemleri, oyun ve doğaçlama teknikleri, ders planlama konularında sorular sor, cevabını değerlendir, eksikleri öğret.",
  partner: "Sen Burak'ın sahne partnerisin. Aşağıdaki sahnede diğer karakter(ler)i canlandır, onun repliklerini bekle, doğal tepki ver. Sahne bitince kısa bir oyunculuk geri bildirimi ver.\nSAHNE:\n"
};
async function startCoach(kind, extra = "") {
  SET.live = true; COACH_EXTRA = (COACH[kind] || "") + extra;
  const ok = await startLive(); if (!ok) toast("Canlı mod açılamadı; internet ve Gemini anahtarını kontrol et.");
  return { ok };
}
let COACH_EXTRA = "";
{
  const baseSys2 = systemPrompt;
  systemPrompt = function () { return baseSys2() + (LIVE && COACH_EXTRA ? "\n\nŞU ANKİ ROLÜN:\n" + COACH_EXTRA : ""); };
  const baseStop = LiveSession.prototype.stop;
  LiveSession.prototype.stop = function (n) { COACH_EXTRA = ""; return baseStop.call(this, n); };
}
// Replik ezber modu: kendi repliklerini adım adım gizler, söylediğini karşılaştırır
function similarity(a, b) { a = normTxt(a); b = normTxt(b); if (!a || !b) return 0; const aw = a.split(" "), bw = new Set(b.split(" ")); return aw.filter(w => bw.has(w)).length / Math.max(aw.length, b.split(" ").length); }
async function memorize() {
  const mine = LINES.list.map((l, i) => ({ ...l, i })).filter(l => l.who === LINES.me); if (!mine.length) return toast("Önce sahneyi ayrıştır ve rolünü seç.");
  const score = {}; let round = 0;
  for (const level of [1, 2, 3]) {
    round++; toast(`Tur ${round}/3 — ${level === 1 ? "ipuçlu" : level === 2 ? "ilk kelimeler" : "ezberden"}`, 2500);
    const order = [...mine].sort((a, b) => (score[a.i] || 0) - (score[b.i] || 0));
    for (const l of order) {
      const prev = LINES.list[l.i - 1]; if (prev && prev.who !== LINES.me) await speak(prev.text, true);
      if (level === 1) await speak("Senin repliğin: " + l.text.split(" ").slice(0, 4).join(" ") + "…", true);
      if (level === 2) await speak("İpucu: " + l.text.split(" ").slice(0, 2).join(" "), true);
      const heard = await listen(); const s = similarity(l.text, heard || ""); score[l.i] = s;
      if (s < 0.7) await speak(`Doğrusu: ${l.text}`, true); else await speak(s > 0.92 ? "Mükemmel." : "İyi.", true);
    }
  }
  const avg = Math.round(mine.reduce((t, l) => t + (score[l.i] || 0), 0) / mine.length * 100);
  META.lastLines = Date.now(); saveMeta();
  const msg = `Ezber çalışması bitti: ortalama %${avg}. ${avg >= 85 ? "Hazırsın!" : "Zayıf replikleri bir tur daha çalışalım."}`; bubble("assistant", "🧠 " + msg); speak(msg, true);
}
async function characterAnalysis() {
  if (!LINES.script) return toast("Önce sahneyi yapıştır.");
  const t = await plainGemini(`Bir oyunculuk koçu olarak bu sahnede "${LINES.me}" karakterini Burak için analiz et. Türkçe: 1) kısa karakter biyografisi (metinden çıkarılan + makul varsayımlar, varsayımları belirt), 2) sahnedeki hedefi ve engeli, 3) alt metin (her önemli replik için kısa not), 4) diğer karakterle ilişkisi, 5) fiziksel ve ses önerileri, 6) self-tape için 3 öneri.\n\nSAHNE:\n${LINES.script.slice(0, 6000)}`, [], null, { max: 2500 });
  A.addNote({ text: `🎭 ${LINES.me} karakter analizi\n` + t, project: "Rol" }); return t;
}
// Isınma rutinleri (sesli rehber)
const WARMUPS = {
  ses: [["Dik dur, omuzlarını bırak. Burnundan dört saniye nefes al, sekiz saniyede ver.", 30], ["Dudaklarını titreterek brrr sesiyle aşağıdan yukarı kay.", 30], ["Ağzın kapalı mmm diye mırıldan, yüzündeki titreşimi hisset.", 25], ["Abartılı şekilde a, e, i, o, u de; çeneni rahat bırak.", 25], ["Tekerleme: Şu köşe yaz köşesi, şu köşe kış köşesi, ortada su şişesi. Üç kez, her seferinde biraz daha hızlı.", 35], ["Bir repliğini fısıltıyla, sonra normal, sonra sahne sesiyle söyle.", 40]],
  beden: [["Boynunu yavaşça sağa sola çevir, sonra yarım daireler çiz.", 30], ["Omuzlarını öne ve arkaya beşer kez çevir.", 25], ["Kollarını iki yana aç, büyük daireler çiz.", 25], ["Belinden öne eğil, kollarını sarkıt, omur omur yavaşça doğrul.", 35], ["Yerinde hafifçe zıpla, tüm bedenini silkele.", 25], ["Gözlerini kapat, üç derin nefes al, karaktere geç.", 30]]
};
let WARM_RUN = false;
async function warmup(kind = "ses") {
  const list = WARMUPS[kind]; if (!list) return { hata: "Rutin yok" }; WARM_RUN = true; go("home"); bubble("sys", kind === "ses" ? "🎤 Ses ısınması" : "🧘 Beden ısınması");
  for (const [txt, sec] of list) { if (!WARM_RUN) break; bubble("assistant", txt); await speak(txt, true); await sleep(sec * 1000); }
  if (WARM_RUN) await speak("Isınma bitti, hazırsın.", true); WARM_RUN = false; return { ok: true };
}

/* ---------- 8) CASTING RADARI 2.0 ---------- */
async function scoreRadar(items) {
  const todo = items.filter(x => x.score === undefined && !/ev|kira/i.test(x.radar || "")).slice(0, 12); if (!todo.length || !SET.geminiKey) return items;
  try {
    const prof = SET.actorProfile || S.memory.map(m => m.text).join("; ");
    const r = await geminiJSON(`Oyuncu profili: ${prof}\nAşağıdaki casting ilanlarının her birini bu oyuncuya uygunluğuna göre 0-100 puanla (yaş, tip, cinsiyet, şehir, yetenek). JSON: [{"i":0,"score":0,"why":"kısa"}]\n` + todo.map((x, i) => `${i}. ${x.title}`).join("\n"));
    r.forEach(x => { if (todo[x.i]) { todo[x.i].score = x.score; todo[x.i].why = x.why; } });
  } catch {}
  return items;
}
{
  const baseRadar = radarCheck;
  radarCheck = async function () { const r = await baseRadar(); RADAR_CACHE = await scoreRadar(RADAR_CACHE); RADAR_CACHE.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)); renderSec("work"); return { ...r, yeni: RADAR_CACHE.filter(x => !x.seen).slice(0, 15) }; };
}

/* ---------- 9) GÖRÜNTÜLÜ CANLI MOD ---------- */
LiveSession.prototype.toggleCamera = async function () {
  if (this.cam) { clearInterval(this.camT); this.cam.getTracks().forEach(t => t.stop()); this.cam = null; const p = $("#camPrev"); if (p) p.remove(); return false; }
  this.cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: SET.camFacing || "environment", width: { ideal: 960 } } });
  const v = document.createElement("video"); v.id = "camPrev"; v.autoplay = true; v.playsInline = true; v.muted = true; v.srcObject = this.cam;
  v.style.cssText = "position:fixed;right:12px;bottom:calc(140px + var(--sb));width:120px;border-radius:12px;border:2px solid var(--cyan);z-index:40"; document.body.appendChild(v);
  const c = document.createElement("canvas"); c.width = 640; c.height = 480;
  this.camT = setInterval(() => { if (!this.ws || this.ws.readyState !== 1 || !v.videoWidth) return; c.height = Math.round(640 * v.videoHeight / v.videoWidth); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); this.ws.send(JSON.stringify({ realtimeInput: { video: { data: c.toDataURL("image/jpeg", 0.6).split(",")[1], mimeType: "image/jpeg" } } })); }, 1000);
  return true;
};
{ const baseStop2 = LiveSession.prototype.stop; LiveSession.prototype.stop = function (n) { if (this.cam) this.toggleCamera(); const b = $("#camBtn"); if (b) b.style.display = "none"; return baseStop2.call(this, n); }; }

/* ---------- 10) HEDEF PLANI (otonom görev) ---------- */
async function missionPlan({ hedef, gun = 30 }) {
  const plan = await geminiJSON(`Burak'ın hedefi: "${hedef}". ${gun} günlük, gerçekçi bir adım planı çıkar (vardiyaları ve oyunculuk işlerini düşün). Bugün: ${ymd(new Date())}. JSON: {"steps":[{"text":"","date":"YYYY-MM-DD","time":"HH:mm"}]} en fazla 15 adım.`);
  let n = 0; for (const s of plan.steps || []) { if (!s.text) continue; A.addTask({ text: s.text, date: s.date, project: "Hedef: " + hedef.slice(0, 30) }); if (s.date) A.addReminder({ text: "🎯 " + s.text, due: `${s.date}T${s.time || "10:00"}` }); n++; }
  A.addGoal({ text: hedef.slice(0, 40), target: n || 1 });
  return { ok: true, adim: n };
}

/* ---------- 11) yeni araçlar ---------- */
TOOLS.push(
  T("bilgi_ara", "Burak'ın kişisel bilgi bankasında (belgeler, senaryolar, CV, notlar) arar.", { soru: str("Ne aranıyor") }, ["soru"], async a => { const r = await kbSearch(a.soru); return r.length ? { sonuclar: r } : { sonuc: "Bilgi bankasında ilgili bir şey bulunamadı." }; }),
  T("bilgiye_ekle", "Verilen metni bilgi bankasına kaydeder.", { baslik: str("Başlık"), metin: str("Metin") }, ["baslik", "metin"], a => kbAdd(a.baslik, a.metin, "sohbet")),
  T("kisi_ekle", "Düzenli iletişimde kalmak istediği bir kişiyi ekler (her N günde hatırlatma).", { name: str("Kişi"), every: num("Kaç günde bir") }, ["name"], a => ({ ok: true, ...A.addPerson(a) })),
  T("kisi_gorustum", "Biriyle görüştüğünü/aradığını kaydeder.", { name: str("Kişi") }, ["name"], a => A.touchPerson(a)),
  T("koc_baslat", "Canlı koçluk/prova başlatır: ingilizce (konuşma pratiği), diksiyon, sinav (drama eğitmenliği), partner (sahne partneri, Replik'teki sahneyle).", { tur: str("Tür", ["ingilizce", "diksiyon", "sinav", "partner"]) }, ["tur"], a => startCoach(a.tur, a.tur === "partner" ? (LINES.script || "") + `\nBurak'ın rolü: ${LINES.me}` : "")),
  T("isinma", "Sesli ısınma rutini başlatır.", { tur: str("Tür", ["ses", "beden"]) }, [], a => { warmup(a.tur || "ses"); return { ok: true }; }),
  T("karakter_analizi", "Replik bölümündeki sahne için karakter analizi yapar ve not olarak kaydeder.", {}, [], async () => ({ analiz: await characterAnalysis() })),
  T("hedef_plani", "Büyük bir hedefi (ör. 'bu ay 10 castinge başvur') günlere yayılmış görev ve hatırlatıcılara böler.", { hedef: str("Hedef"), gun: num("Kaç gün") }, ["hedef"], a => missionPlan(a)),
  T("yedekle", "Tüm Titus verilerini şifreli olarak Google Drive'a yedekler.", {}, [], () => backupNow())
);
Object.assign(ACT_TR, { bilgi_ara: "📚 bilgi", bilgiye_ekle: "📚 kaydet", kisi_ekle: "👥 kişi", kisi_gorustum: "👥 görüşme", koc_baslat: "🎓 koç", isinma: "🔥 ısınma", karakter_analizi: "🎭 analiz", hedef_plani: "🎯 plan", yedekle: "🔐 yedek" });

/* ---------- 12) yeni bölümler: Bilgi (Plan), Kişiler (Hayat), Koç (Kariyer) ---------- */
{
  const baseList3 = listHTML;
  listHTML = function (sec) {
    if (sec === "kb") return `<div class="card"><h3>BİLGİ BANKASI</h3><div class="row"><button class="btn" id="kbFile">📄 Belge ekle (PDF, metin, fotoğraf)</button><button class="btn ghost" id="kbNotes">Notları ekle</button></div><div class="hint">Senaryolar, CV, Recast belgeleri… Titus sorularında bunlardan cevap verir. Örnek: "Lefter'deki rolümün adı neydi?"</div><div class="hint" id="kbBusy"></div></div>` +
      ((S.kbDocs || []).map(d => `<div class="item"><div class="ic">📚</div><div class="t"><div class="h">${esc(d.title)}</div><div class="meta">${d.chunks} parça · ${fmtWhen(d.at)}</div></div><button class="x" data-kbdel="${d.id}">✕</button></div>`).join("") || `<div class="empty">Belge yok.</div>`);
    if (sec === "people") { const od = new Set(overduePeople().map(p => p.id)); return `<div class="card"><form class="form" data-add="people"><div class="row"><input name="name" placeholder="Kişi (ör. Annem)" required><input name="every" type="number" value="7" style="max-width:80px"><button class="btn">+</button></div><div class="hint">Kaç günde bir aramak/görüşmek istiyorsun? Zamanı gelince hatırlatırım.</div></form></div>` +
      ((S.people || []).map(p => `<div class="item ${od.has(p.id) ? "late" : ""}"><div class="ic">👥</div><div class="t"><div class="h">${esc(p.name)}</div><div class="meta">her ${p.every} gün · son: ${p.last ? fmtWhen(p.last, false) : "—"}</div></div><button class="btn ghost sm" data-ptouch="${p.id}">Görüştüm</button><button class="x" data-del="people:${p.id}">✕</button></div>`).join("") || `<div class="empty">Kişi yok.</div>`); }
    if (sec === "coach") return `<div class="card"><h3>CANLI KOÇLAR</h3><div class="form"><button class="btn" data-coach="ingilizce">🇬🇧 İngilizce konuşma pratiği</button><button class="btn ghost" data-coach="diksiyon">🗣 Diksiyon hocası</button><button class="btn ghost" data-coach="sinav">📘 Drama eğitmenliği sınav hazırlığı</button><button class="btn ghost" data-coach="partner">🎭 Sahne partneri (Replik'teki sahne)</button></div></div>
      <div class="card"><h3>ISINMA</h3><div class="row"><button class="btn ghost" data-warm="ses">🎤 Ses ısınması</button><button class="btn ghost" data-warm="beden">🧘 Beden ısınması</button></div></div>
      <div class="card"><h3>HEDEF PLANI</h3><div class="form"><input id="msGoal" placeholder="ör. Bu ay 10 castinge başvur"><div class="row"><input id="msDays" type="number" value="30"><button class="btn" id="msGo">🎯 Planla</button></div></div></div>`;
    return baseList3(sec);
  };
  ADD.people = f => A.addPerson(f);
  const baseLines2 = linesHTML;
  linesHTML = function () { return baseLines2() + (LINES.list.length ? `<div class="card"><h3>HAZIRLIK</h3><div class="row"><button class="btn ghost" id="lnMem">🧠 Ezber modu</button><button class="btn ghost" id="lnChar">🎭 Karakter analizi</button></div><button class="btn ghost" data-coach="partner" style="margin-top:6px;width:100%">🎙 Canlı sahne partneri</button></div>` : ""); };
}
document.addEventListener("click", async e => {
  const t = e.target.closest("#nightOn,#nightOff,#kbFile,#kbNotes,[data-kbdel],[data-ptouch],[data-coach],[data-warm],#msGo,#lnMem,#lnChar,#camBtn,#bkNow,#bkRestore");
  if (!t) return;
  try {
    if (t.id === "nightOn") { if (!SET.geminiKey) return toast("Önce Gemini anahtarını gir"); await script("setGeminiKey", { key: SET.geminiKey }); toast("✓ Gece mesaisi açık (her gün 05:00)", 4000); }
    else if (t.id === "nightOff") { await script("setGeminiKey", { key: "" }); toast("Gece mesaisi kapatıldı"); }
    else if (t.id === "kbFile") { const fs = await pickFiles(".pdf,.txt,.md,.csv,.json,image/*", true); for (const f of fs) { $("#kbBusy").textContent = "⏳ " + f.name + " işleniyor…"; const txt = await fileText(f); const r = await kbAdd(f.name.replace(/\.\w+$/, ""), txt, "dosya"); toast(`✓ ${r.baslik}: ${r.parca} parça`); } $("#kbBusy").textContent = ""; renderSec("plan"); }
    else if (t.id === "kbNotes") { const txt = S.notes.map(n => n.text).join("\n\n") + "\n\n" + S.memory.map(m => m.text).join("\n"); const r = await kbAdd("Notlar ve hafıza " + ymd(new Date()), txt, "notlar"); toast(`✓ ${r.parca} parça eklendi`); renderSec("plan"); }
    else if (t.dataset.kbdel) { await kbDelete(t.dataset.kbdel); renderSec("plan"); }
    else if (t.dataset.ptouch) { const p = S.people.find(p => p.id === t.dataset.ptouch); p.last = ymd(new Date()); save(); }
    else if (t.dataset.coach) { const k = t.dataset.coach; if (k === "partner" && !LINES.script) return toast("Önce Kariyer → Replik'e sahneyi yapıştır."); await startCoach(k, k === "partner" ? LINES.script + `\nBurak'ın rolü: ${LINES.me}` : ""); }
    else if (t.dataset.warm) warmup(t.dataset.warm);
    else if (t.id === "msGo") { const h = $("#msGoal").value.trim(); if (!h) return toast("Hedef yaz"); toast("Planlanıyor…"); const r = await missionPlan({ hedef: h, gun: +$("#msDays").value || 30 }); toast(`✓ ${r.adim} adım takvime ve görevlere eklendi`, 4000); }
    else if (t.id === "lnMem") memorize();
    else if (t.id === "lnChar") { toast("Analiz ediliyor…"); const r = await characterAnalysis(); go("home"); bubble("assistant", "🎭 " + r); }
    else if (t.id === "camBtn") { if (LIVE) { const on = await LIVE.toggleCamera(); t.textContent = on ? "📷 Kamerayı kapat" : "📷 Kamera"; } }
    else if (t.id === "bkNow") { toast("Yedekleniyor…"); await backupNow(); toast("✓ Şifreli yedek Drive'a kaydedildi"); }
    else if (t.id === "bkRestore") { const p = prompt2 ? await prompt2("Yedek şifresi") : null; if (!p) return; const r = await restoreLatest(p); toast("✓ Geri yüklendi: " + r.tarih, 4000); renderAll(); drawChat(); }
  } catch (er) { toast("✗ " + (er.message === "NOKEY" ? "Gemini anahtarı yok" : er.message), 5000); }
});
function prompt2(label) { return new Promise(res => { $("#modalBox").innerHTML = `<h2>${esc(label)}</h2><input id="p2" type="password" style="margin-bottom:12px"><div class="row"><button class="btn ghost" id="mNo">Vazgeç</button><button class="btn" id="mYes">Tamam</button></div>`; $("#modal").classList.add("on"); $("#mNo").onclick = () => { $("#modal").classList.remove("on"); res(null); }; $("#mYes").onclick = () => { const v = $("#p2").value; $("#modal").classList.remove("on"); res(v); }; }); }
// canlı modda kamera düğmesi
{ const baseStart = LiveSession.prototype.start; LiveSession.prototype.start = async function () { await baseStart.call(this); let b = $("#camBtn"); if (!b) { b = document.createElement("button"); b.id = "camBtn"; b.className = "chip"; b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + var(--sb));z-index:41"; document.body.appendChild(b); } b.textContent = "📷 Kamera"; b.style.display = ""; }; }

/* ---------- 13) proaktif ek: kişiler ---------- */
{
  const baseProactive = proactive;
  proactive = async function (force) {
    await baseProactive(force);
    const od = overduePeople(); const key = "ppl" + ymd(new Date());
    if (od.length && META.pplDay !== key) { META.pplDay = key; saveMeta(); bubble("assistant", "💡 Bir süredir görüşmediğin kişiler: " + od.map(p => p.name).join(", ") + ". Arayalım mı?"); }
  };
}

/* ---------- 14) ayarlar: stüdyo, gizlilik, yedek, yerel beyin, profil ---------- */
{
  const base = renderSettings;
  renderSettings = async function () {
    await base();
    const tg = (k, label, sub) => `<label class="toggle"><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" class="sw" data-set="${k}" ${SET[k] ? "checked" : ""}></label>`;
    $("#b-set").insertAdjacentHTML("beforeend", `
    <div class="card"><h3>STÜDYO (GÖRSEL ÜRETME)</h3><div class="form"><div class="lbl">Cloudflare hesap kimliği (Account ID)</div><input data-set="cfAccount" value="${esc(SET.cfAccount)}"><div class="lbl">Cloudflare API token (Workers AI)</div><input data-set="cfToken" type="password" value="${esc(SET.cfToken)}"><div class="hint">dash.cloudflare.com → ücretsiz hesap → sağ üst profil → API Tokens → "Workers AI" şablonu → Create. Account ID ana sayfanın sağ altında. Günlük ücretsiz kota ile çalışır.</div></div></div>
    <div class="card"><h3>OYUNCU PROFİLİ (RADAR PUANLAMA)</h3><textarea data-set="actorProfile" placeholder="ör. 28 yaş, erkek, 1.80, İstanbul, dram ve dönem dizisi deneyimi, İngilizce orta" style="min-height:60px">${esc(SET.actorProfile || "")}</textarea></div>
    <div class="card"><h3>GİZLİLİK VE YEREL BEYİN</h3>${tg("privacy", "Gizlilik modu", "Şifre, banka, sağlık, maaş gibi konular buluta gönderilmez")}
      <div class="form"><div class="lbl">Yerel beyin adresi (bilgisayarında Ollama)</div><input data-set="localUrl" value="${esc(SET.localUrl || "")}" placeholder="http://192.168.1.20:11434"><div class="lbl">Yerel model</div><input data-set="localModel" value="${esc(SET.localModel || "qwen2.5:3b")}"><div class="hint">Bilgisayarda ollama.com'dan Ollama'yı kur, "ollama pull qwen2.5:3b" yaz, OLLAMA_HOST=0.0.0.0 ile çalıştır. Aynı Wi-Fi'de telefon bu beyni kullanır.</div></div></div>
    <div class="card"><h3>GECE MESAİSİ</h3><div class="hint" style="margin-top:0">Sen uyurken (05:00) Google tarafında Titus mailleri, takvimi ve casting radarını tarar, sabah brifingine "gece raporu" ekler. Bunun için Gemini anahtarın kendi Google Apps Script'ine (sadece senin hesabında) kaydedilir.</div><div class="row"><button class="btn ghost sm" id="nightOn">Gece mesaisini aç</button><button class="btn ghost sm" id="nightOff">Kapat</button></div></div>
    <div class="card"><h3>ŞİFRELİ YEDEK</h3><div class="form"><div class="lbl">Yedek şifresi (unutma; kurtarılamaz)</div><input data-set="backupPass" type="password" value="${esc(SET.backupPass || "")}"><div class="row"><button class="btn ghost sm" id="bkNow">Şimdi yedekle</button><button class="btn ghost sm" id="bkRestore">Son yedeği geri yükle</button></div><div class="hint">Google bağlıysa her gün otomatik, şifreli olarak Drive'daki "Titus Yedek" klasörüne yedeklenir (son 14 gün).</div></div></div>
    <div class="card"><h3>KULLANIM (BUGÜN)</h3><div class="hint" style="margin-top:0">${Object.entries(QUOTA.n).map(([k, v]) => `${k}: ${v}`).join(" · ") || "henüz yok"}${Date.now() < GEMINI_OFF_UNTIL ? " · Gemini kotası dolu → Groq kullanılıyor" : ""}</div>
      <div class="hint">Son hatalar: ${(S.issues || []).slice(-3).map(i => esc(i.detail)).join(" · ") || "yok"}</div></div>`);
  };
}

/* ---------- 15) sohbet senkronu (cihazlar arası) ---------- */
{
  const basePush = pushSync;
  pushSync = async function () { S.chat = CHAT.slice(-30); return basePush(); };
  const basePull = pullSync;
  pullSync = async function () { const before = S.updatedAt; await basePull(); if (S.updatedAt !== before && Array.isArray(S.chat) && S.chat.length) { CHAT = S.chat.slice(); saveChat(); drawChat(); } };
}

TOOL_GROUPS.push(
  [/sunum|slayt|powerpoint|pptx/, ["sunum_hazirla"]],
  [/belge|word|docx|dilekçe|rapor|cv|özgeçmiş|mektup|sözleşme/, ["belge_hazirla"]],
  [/görsel|resim çiz|çiz|afiş|poster|kapak|logo|illüstrasyon/, ["gorsel_uret"]],
  [/fotoğraf|foto|siyah beyaz|filtre|kırp|arka plan|bulanık/, ["fotograf_duzenle"]],
  [/portfolyo|site|web sayfa/, ["portfolyo_sitesi"]],
  [/stüdyo|video|reels|showreel|altyazı|kompozit|zed kart|self-?tape/, ["studyo_ac"]],
  [/neydi|ne zaman|hangi|belge|senaryo|cv|özgeçmiş|bilgi bankası|dosyamda|metinde|yazıyor/, ["bilgi_ara"]],
  [/bilgi bankasına|kaydet bunu|bunu sakla/, ["bilgiye_ekle"]],
  [/aramadım|görüşmedim|görüştüm|aradım|her .* günde|ilgilen|kişi ekle|annemi|babamı/, ["kisi_ekle", "kisi_gorustum"]],
  [/koç|pratik|ingilizce konuş|diksiyon|sınav|partner|sahne çalış|prova/, ["koc_baslat"]],
  [/ısın|egzersiz|nefes/, ["isinma"]],
  [/karakter|analiz/, ["karakter_analizi"]],
  [/hedef|bu ay|planla|adım adım/, ["hedef_plani"]],
  [/yedek/, ["yedekle"]]
);
/* =====================================================================
   v2.1 — RECAST BRIEF AKIŞI (yarı otomatik: Titus hazırlar, Burak onaylar)
   Brief → roller → KADRO'dan uygun oyuncular → müşteriye mail taslağı (+ oyunculara duyuru)
   ===================================================================== */
let RB = { mails: [], brief: null, plan: null, busy: "", mailId: "", from: "" };
const RB_KEY = "rb_seen";

async function rbParse(text) {
  return geminiJSON(`Sen Recast Talent House'un (casting ajansı) asistanısın. Aşağıdaki casting brief'ini çözümle. Türkçe JSON:
{"proje":"","tur":"dizi/film/reklam/tiyatro/klip/diğer","musteri":"","musteri_mail":"","cekim_tarihi":"","son_tarih":"","ucret":"","yer":"","roller":[{"ad":"","cinsiyet":"kadın/erkek/farketmez","yas":"ör. 25-35","tip":"fiziksel özellikler","ozellik":"yetenek/dil/deneyim","adet":1,"not":""}],"istenenler":"(self-tape, fotoğraf, CV vb.)","eksik_bilgiler":["brief'te eksik olan önemli bilgi"]}
BRIEF:
${String(text).slice(0, 9000)}`);
}

async function rbMatch(brief) {
  if (!SET.kadroSheetId) throw new Error("KADRO tablosu bağlı değil (Ayarlar → İş bağlantıları).");
  const r = await script("roster", { sheetId: SET.kadroSheetId });
  if (!r.satirlar || !r.satirlar.length) throw new Error("KADRO tablosu boş görünüyor");
  const list = r.satirlar.map(x => `#${x.n} ${x.t}`).join("\n");
  const plan = await geminiJSON(`Casting ajansı Recast için oyuncu öner. Her rol için KADRO'dan en uygun oyuncuları seç (rol başına en fazla ${SET.rbPerRole || 6}). Sadece listedeki kişileri seç, uydurma. Yaş, cinsiyet, tip, yetenek, şehir ve deneyime bak; tam uymayanları alma.
JSON: {"roller":[{"rol":"","oyuncular":[{"satir":0,"ad":"","puan":0-100,"neden":"kısa","link":"varsa profil/fotoğraf/showreel linki","mail":"varsa","telefon":"varsa"}]}],"uyari":"kadroda bu rol için uygun kimse yoksa belirt"}
ROLLER: ${JSON.stringify(brief.roller)}
PROJE: ${brief.proje} (${brief.tur})
KADRO (${r.toplam} kişi):
${list.slice(0, 120000)}`);
  (plan.roller || []).forEach(ro => (ro.oyuncular || []).forEach(o => { o.on = (o.puan ?? 70) >= 60; }));
  return plan;
}

function rbSelected() { return (RB.plan?.roller || []).map(r => ({ rol: r.rol, oyuncular: (r.oyuncular || []).filter(o => o.on) })).filter(r => r.oyuncular.length); }

async function rbClientMail() {
  const sel = rbSelected(); if (!sel.length) throw new Error("Hiç oyuncu seçili değil");
  const b = RB.brief;
  const body = await plainGemini(`Recast Talent House adına, müşteriye gönderilecek kurumsal ve sıcak bir Türkçe e-posta yaz. İmza: ${SET.name} — Recast Talent House. Proje: ${b.proje}. Müşteri: ${b.musteri || "-"}.
Her rol için başlık aç, altında önerilen oyuncuları madde madde yaz: ad soyad — tek cümlelik neden uygun — varsa link. Sonunda self-tape/seçme için uygun oldukları ve dönüş beklediğini belirt. Uydurma bilgi ekleme. Sadece e-posta gövdesini yaz.
SEÇİLENLER: ${JSON.stringify(sel)}`, [], null, { max: 1800 });
  const to = RB.from || b.musteri_mail || "";
  const subject = `${b.proje || "Casting"} — Recast oyuncu önerileri`;
  return script("gmailDraft", { to: (to.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [""])[0], subject, body });
}

async function rbActorMail() {
  const sel = rbSelected(); const b = RB.brief;
  const mails = [...new Set(sel.flatMap(r => r.oyuncular.map(o => o.mail).filter(m => m && /@/.test(m))))];
  const body = await plainGemini(`Recast Talent House'tan oyunculara gidecek kısa bir Türkçe duyuru e-postası yaz: yeni proje, rol bilgileri, tarih/ücret (varsa), istenenler ve son tarih. Uygunluk durumlarını bu maile cevap vererek bildirmelerini iste. İmza: ${SET.name} — Recast Talent House. Uydurma bilgi ekleme.
BRIEF: ${JSON.stringify({ proje: b.proje, tur: b.tur, cekim: b.cekim_tarihi, son: b.son_tarih, ucret: b.ucret, yer: b.yer, roller: b.roller, istenenler: b.istenenler })}`, [], null, { max: 900 });
  const r = await script("gmailDraft", { to: "recasttalent@gmail.com", subject: `Yeni proje: ${b.proje || "casting"} — uygunluk`, body: body + (mails.length ? "" : "\n\n(Oyuncuların mail adresi KADRO'da yok; WhatsApp'tan iletebilirsin.)"), bcc: mails.join(",") });
  return { ...r, alici: mails.length };
}

async function rbRun({ metin, mailId } = {}) {
  RB.busy = "Brief okunuyor…"; renderRB();
  try {
    let text = metin;
    if (mailId) { const m = RB.mails.find(x => x.id === mailId); if (m) { text = `Konu: ${m.konu}\nKimden: ${m.kimden}\n\n${m.metin}`; RB.from = m.yanitla || m.kimden; RB.mailId = m.id; } }
    if (!text) throw new Error("Brief metni yok");
    RB.brief = await rbParse(text);
    RB.busy = "KADRO taranıyor, oyuncular seçiliyor…"; renderRB();
    RB.plan = await rbMatch(RB.brief);
    S.rbHistory = [{ at: localISO(new Date()), proje: RB.brief.proje, roller: (RB.plan.roller || []).length }, ...(S.rbHistory || [])].slice(0, 30); save();
    if (RB.mailId) { META[RB_KEY] = [...new Set([...(META[RB_KEY] || []), RB.mailId])].slice(-80); saveMeta(); }
    return { proje: RB.brief.proje, roller: (RB.plan.roller || []).map(r => `${r.rol}: ${(r.oyuncular || []).filter(o => o.on).map(o => o.ad).join(", ") || "uygun yok"}`), eksik: RB.brief.eksik_bilgiler, not: "Kariyer → Recast'te onayla; müşteri mail taslağını tek dokunuşla oluşturabilirsin." };
  } finally { RB.busy = ""; renderRB(); }
}

function renderRB() { if (CUR.work === "recast" && $("#b-work")) renderSec("work"); }

function rbHTML() {
  const b = RB.brief, p = RB.plan;
  let h = `<div class="card"><h3>RECAST — BRIEF'TEN TEKLİFE</h3><div class="hint" style="margin-top:0">Brief'i yapıştır ya da Gmail'den seç. Titus rolleri çıkarır, KADRO'dan oyuncuları seçer, müşteri mailini taslak olarak hazırlar. Sen onaylamadan hiçbir şey gönderilmez.</div>
    <textarea id="rbText" placeholder="Casting brief'ini buraya yapıştır…" style="min-height:90px"></textarea>
    <div class="row" style="margin-top:6px"><button class="btn" id="rbGo">⚡ Hazırla</button><button class="btn ghost" id="rbMails">✉️ Gmail'den getir</button></div>
    ${RB.busy ? `<div class="hint">⏳ ${esc(RB.busy)}</div>` : ""}</div>`;
  if (RB.mails.length) h += `<div class="card"><h3>SON BRIEF MAİLLERİ</h3>${RB.mails.map(m => `<div class="item"><div class="ic">${m.okunmadi ? "🆕" : "✉️"}</div><div class="t"><div class="h">${esc(m.konu || "(konu yok)")}</div><div class="meta">${esc(m.kimden.replace(/<.*>/, ""))} · ${fmtWhen(m.tarih)}${(META[RB_KEY] || []).includes(m.id) ? " · ✓ hazırlandı" : ""}</div></div><button class="btn sm" data-rbmail="${m.id}">Hazırla</button></div>`).join("")}</div>`;
  if (b) h += `<div class="card"><h3>${esc(b.proje || "Proje")}</h3><div class="hint" style="margin-top:0">${[b.tur, b.musteri, b.cekim_tarihi && "Çekim: " + b.cekim_tarihi, b.son_tarih && "Son: " + b.son_tarih, b.ucret && "Ücret: " + b.ucret, b.yer].filter(Boolean).map(esc).join(" · ")}</div>
    ${(b.eksik_bilgiler || []).length ? `<div class="hint">⚠️ Eksik: ${b.eksik_bilgiler.map(esc).join(", ")}</div>` : ""}</div>`;
  if (p) {
    h += (p.roller || []).map((r, ri) => `<div class="card"><h3>${esc(r.rol)}</h3>${(r.oyuncular || []).map((o, oi) => `<label class="toggle"><span>${esc(o.ad)} <b style="color:var(--cyan)">${o.puan ?? ""}</b><small>${esc(o.neden || "")}${o.link ? " · " + esc(o.link.slice(0, 40)) : ""}</small></span><input type="checkbox" class="sw" data-rbpick="${ri}:${oi}" ${o.on ? "checked" : ""}></label>`).join("") || `<div class="empty">Kadroda uygun oyuncu bulunamadı.</div>`}</div>`).join("");
    if (p.uyari) h += `<div class="hint">ℹ️ ${esc(p.uyari)}</div>`;
    h += `<div class="card"><div class="form"><button class="btn" id="rbClient">📨 Müşteri mail taslağını oluştur</button><button class="btn ghost" id="rbActors">📣 Seçilen oyunculara duyuru taslağı (BCC)</button><div class="hint">Taslaklar Gmail'de hazırlanır; kontrol edip sen gönderirsin.</div></div></div>`;
  }
  return h;
}

{
  const base = listHTML;
  listHTML = function (sec) { return sec === "recast" ? rbHTML() : base(sec); };
}

document.addEventListener("click", async e => {
  const t = e.target.closest("#rbGo,#rbMails,[data-rbmail],#rbClient,#rbActors"); if (!t) return;
  try {
    if (t.id === "rbGo") { const v = $("#rbText").value.trim(); if (!v) return toast("Brief'i yapıştır"); await rbRun({ metin: v }); }
    else if (t.id === "rbMails") { RB.busy = "Gmail taranıyor…"; renderRB(); try { RB.mails = await script("briefMails", { days: 7, max: 10 }).then(r => r.mailler || []); } finally { RB.busy = ""; renderRB(); } if (!RB.mails.length) toast("Son 7 günde brief gibi görünen mail yok"); }
    else if (t.dataset.rbmail) await rbRun({ mailId: t.dataset.rbmail });
    else if (t.id === "rbClient") { toast("Mail yazılıyor…"); const r = await rbClientMail(); toast("✓ Müşteri mail taslağı Gmail'de hazır", 4500); }
    else if (t.id === "rbActors") { toast("Duyuru yazılıyor…"); const r = await rbActorMail(); toast(`✓ Duyuru taslağı hazır (${r.alici} oyuncu BCC)`, 4500); }
  } catch (er) { RB.busy = ""; renderRB(); toast("✗ " + (er.message === "NOKEY" ? "Gemini anahtarı yok" : er.message), 5000); }
});
document.addEventListener("change", e => {
  const t = e.target.closest("[data-rbpick]"); if (!t) return;
  const [ri, oi] = t.dataset.rbpick.split(":").map(Number); const o = RB.plan?.roller?.[ri]?.oyuncular?.[oi]; if (o) o.on = t.checked;
});

TOOLS.push(
  T("recast_brief", "Recast için casting brief'ini hazırlar: rolleri çıkarır, KADRO'dan uygun oyuncuları seçer. 'Yeni brief'i hazırla', 'son casting mailini hazırla' gibi isteklerde kullan. Metin verilmezse Gmail'deki en son brief mailini kullanır.", { metin: str("Brief metni (yoksa boş)") }, [],
    async a => { if (!a.metin) { RB.mails = (await script("briefMails", { days: 7, max: 6 })).mailler || []; const m = RB.mails.find(x => !(META[RB_KEY] || []).includes(x.id)) || RB.mails[0]; if (!m) return { hata: "Son 7 günde brief maili bulunamadı" }; const r = await rbRun({ mailId: m.id }); return r; } return rbRun({ metin: a.metin }); }),
  T("recast_teklif_maili", "Seçilen oyuncularla müşteriye gidecek mail taslağını Gmail'de oluşturur (göndermez). recast_brief'ten sonra Burak onaylayınca kullan.", {}, [], async () => { await rbClientMail(); return { ok: true, not: "Gmail taslağı hazır" }; }),
  T("recast_duyuru", "Seçilen oyunculara proje duyurusu taslağı (BCC) oluşturur.", {}, [], () => rbActorMail())
);
Object.assign(ACT_TR, { recast_brief: "🎬 brief", recast_teklif_maili: "📨 teklif", recast_duyuru: "📣 duyuru" });
TOOL_GROUPS.push([/brief|recast|teklif|oyuncu öner|casting mail|müşteri/, ["recast_brief", "recast_teklif_maili", "recast_duyuru"]]);

/* yeni brief maili gelince proaktif haber ver */
{
  const baseP = proactive;
  proactive = async function (force) {
    await baseP(force);
    if (!SET.scriptUrl || !SET.kadroSheetId || !SET.rbWatch) return;
    if (!force && Date.now() - (META.rbCheck || 0) < 2 * 36e5) return;
    META.rbCheck = Date.now(); saveMeta();
    try {
      const ms = (await script("briefMails", { days: 2, max: 5, unread: true })).mailler || [];
      const fresh = ms.filter(m => !(META.rbNotified || []).includes(m.id) && !(META[RB_KEY] || []).includes(m.id));
      if (fresh.length) { META.rbNotified = [...(META.rbNotified || []), ...fresh.map(m => m.id)].slice(-80); saveMeta(); RB.mails = ms; bubble("assistant", `💼 Yeni casting brief'i geldi: "${fresh[0].konu}". "Brief'i hazırla" dersen KADRO'dan oyuncuları seçip müşteri mailini taslak yaparım.`); }
    } catch {}
  };
}
{
  const base = renderSettings;
  renderSettings = async function () {
    await base();
    $("#b-set").insertAdjacentHTML("beforeend", `<div class="card"><h3>RECAST BRIEF</h3><label class="toggle"><span>Yeni brief maillerini haber ver<small>2 saatte bir Gmail'e bakar; KADRO bağlı olmalı</small></span><input type="checkbox" class="sw" data-set="rbWatch" ${SET.rbWatch ? "checked" : ""}></label>
      <div class="form"><div class="lbl">Rol başına en fazla öneri</div><input data-set="rbPerRole" type="number" value="${SET.rbPerRole || 6}"></div></div>`);
  };
}

/* =====================================================================
   v2.2 — RECAST AUDITION ERİŞİMİ: Titus işleri, başvuruları, tape durumlarını okur ve
   Burak'ın isteğine göre düzenler (her değişiklik önce onaya gelir).
   ===================================================================== */
let AUD_SCHEMA = null, AUD_AT = 0;
async function audSchema(force) {
  if (!force && AUD_SCHEMA && Date.now() - AUD_AT < 30 * 6e4) return AUD_SCHEMA;
  AUD_SCHEMA = await script("audInfo", { sheetId: SET.auditionSheetId || "" }); AUD_AT = Date.now();
  if (AUD_SCHEMA.id && SET.auditionSheetId !== AUD_SCHEMA.id) { SET.auditionSheetId = AUD_SCHEMA.id; saveSet(); }
  return AUD_SCHEMA;
}
const audShort = sc => (sc.sayfalar || []).map(p => `${p.ad} (${p.satir} kayıt): ${p.basliklar.join(", ")}${p.ornek[0] ? "\n  örnek: " + JSON.stringify(p.ornek[0]).slice(0, 300) : ""}`).join("\n");
const audFmt = v => /^1\d{12}$/.test(String(v)) ? fmtWhen(localISO(new Date(Number(v)))) : String(v).slice(0, 60);
function diffText(eski, yeni) { return Object.keys(yeni).map(k => `• ${k}: ${eski && eski[k] !== undefined ? `"${audFmt(eski[k])}" → ` : ""}"${audFmt(yeni[k])}"`).join("\n"); }

async function audFind(sayfa, ara) { return script("audRead", { sheetId: SET.auditionSheetId || "", sayfa, ara: ara || "", limit: 25 }); }

TOOLS.push(
  T("audition_yapi", "Recast Audition uygulamasının veri tablosundaki sayfaları (ör. ISLER, BASVURULAR, GONDERIMLER), sütunlarını ve örnek kayıtları gösterir. Audition ile ilgili bir şeyi okumadan/düzenlemeden önce bir kez çağır.", {}, [], async () => { const sc = await audSchema(true); return { tablo: sc.tablo, yapi: audShort(sc) }; }),
  T("audition_oku", "Recast Audition'dan kayıt okur/arar (işler, başvurular, tape durumları, gönderimler).", { sayfa: str("Sayfa adı, ör. ISLER"), ara: str("Aranacak kelime (proje, oyuncu adı, durum…) — boşsa en yeniler") }, ["sayfa"], a => audFind(a.sayfa, a.ara)),
  T("audition_duzenle", "Recast Audition'daki bir kaydı Burak'ın istediği gibi değiştirir (ör. işin son teslim tarihi, durum, açıklama, ücret, rol notu, tape durumu). Önce audition_oku ile kaydın id'sini ve sütunların mevcut biçimini öğren; tarih/sayı sütunlarını aynı biçimde yaz (ör. milisaniye zaman damgası ise milisaniye). Burak'a onay sorulur.", { sayfa: str("Sayfa"), id: str("Kaydın id'si"), degisiklikler_json: str('Değişecek sütunlar JSON olarak, ör. {"durum":"Kapandı"}') }, ["sayfa", "id", "degisiklikler_json"],
    async a => {
      let ch; try { ch = JSON.parse(a.degisiklikler_json); } catch { return { hata: "degisiklikler_json geçerli JSON değil" }; }
      let cur = null; try { cur = ((await audFind(a.sayfa, a.id)).satirlar || []).find(r => String(r.id) === String(a.id)); } catch {}
      if (!(await confirmBox(`Recast Audition · ${a.sayfa}${cur ? " · " + (cur.proje || cur.ad || cur.baslik || a.id) : ""}\n${diffText(cur, ch)}`, "Değiştir"))) return { iptal: true };
      const r = await script("audUpdate", { sheetId: SET.auditionSheetId || "", sayfa: a.sayfa, id: a.id, degisiklikler: ch });
      S.audLog = [{ at: localISO(new Date()), sayfa: a.sayfa, id: a.id, eski: r.eski, yeni: ch }, ...(S.audLog || [])].slice(0, 40); save();
      return { ok: true, eski: r.eski, not: "Audition uygulamasında sayfayı yenileyince görünür. Bu değişiklik oyunculara/müşteriye otomatik bildirim göndermez." };
    }),
  T("audition_ekle", "Recast Audition'a yeni kayıt ekler (ör. yeni iş). Önce audition_yapi ile sütunları öğren, uygulamanın kullandığı biçimde doldur. Burak'a onay sorulur.", { sayfa: str("Sayfa"), kayit_json: str("Yeni kayıt JSON (sütun adı: değer)") }, ["sayfa", "kayit_json"],
    async a => {
      let k; try { k = JSON.parse(a.kayit_json); } catch { return { hata: "kayit_json geçerli JSON değil" }; }
      if (!(await confirmBox(`Recast Audition · ${a.sayfa} sayfasına eklensin mi?\n${diffText(null, k)}`, "Ekle"))) return { iptal: true };
      return script("audAdd", { sheetId: SET.auditionSheetId || "", sayfa: a.sayfa, kayit: k });
    }),
  T("audition_geri_al", "Titus'un Recast Audition'da yaptığı son değişikliği geri alır.", {}, [],
    async () => { const l = (S.audLog || [])[0]; if (!l) return { hata: "Geri alınacak değişiklik yok" }; if (!(await confirmBox(`Son değişiklik geri alınsın mı?\n${l.sayfa} · ${diffText(l.yeni, l.eski)}`, "Geri al"))) return { iptal: true }; await script("audUpdate", { sheetId: SET.auditionSheetId || "", sayfa: l.sayfa, id: l.id, degisiklikler: l.eski }); S.audLog.shift(); save(); return { ok: true }; }),
  T("audition_ac", "Recast Audition uygulamasını açar.", {}, [], async () => { if (!SET.auditionUrl) return { hata: "Audition adresi yok (Ayarlar → Recast Audition)." }; await openUrl(SET.auditionUrl); return { ok: true }; })
);
Object.assign(ACT_TR, { audition_yapi: "🎞 audition", audition_oku: "🎞 audition", audition_duzenle: "✏️ audition", audition_ekle: "➕ audition", audition_geri_al: "↩️ audition", audition_ac: "🎞 aç" });
TOOL_GROUPS.push([/audition|self-?tape|tape|başvuru|seçme işi|işler|son teslim|reshoot|tekrar çek|müşteriye gönder|casting direkt/, ["audition_yapi", "audition_oku", "audition_duzenle", "audition_ekle", "audition_geri_al", "audition_ac"]]);
{
  const baseSys = systemPrompt;
  systemPrompt = function () {
    let s = baseSys();
    if (SET.scriptUrl) s += "\nRECAST AUDITION: Burak'ın ajans audition uygulamasına audition_* araçlarıyla erişebilirsin. Okumadan önce gerekirse audition_yapi ile yapıyı öğren. Değişiklikleri onun istediği şekilde, mevcut veri biçimini koruyarak yap; büyük toplu değişikliklerde önce ne yapacağını özetle." + (AUD_SCHEMA ? "\nAUDITION YAPISI:\n" + audShort(AUD_SCHEMA).slice(0, 2500) : "");
    return s;
  };
}
{
  const base = renderSettings;
  renderSettings = async function () {
    await base();
    $("#b-set").insertAdjacentHTML("beforeend", `<div class="card"><h3>RECAST AUDITION</h3><div class="form">
      <div class="lbl">Uygulama adresi</div><input data-set="auditionUrl" value="${esc(SET.auditionUrl || "")}" placeholder="https://recast-audition.netlify.app/#KODUN">
      <div class="lbl">"RECAST AUDITION — Veriler" tablo kimliği (boş bırakırsan adıyla bulunur)</div><input data-set="auditionSheetId" value="${esc(SET.auditionSheetId || "")}" placeholder="1AbC…">
      <div class="row"><button class="btn ghost sm" id="audTest">Bağlantıyı dene</button></div>
      <div class="hint">Titus işleri, başvuruları ve tape durumlarını okuyup senin istediğin gibi düzenler; her değişiklik önce onayına gelir, "geri al" diyebilirsin. Titus'un Google bağlantısı, Audition'ın kurulu olduğu Google hesabıyla aynı olmalı.</div></div></div>`);
  };
}
document.addEventListener("click", async e => {
  if (!e.target.closest("#audTest")) return;
  try { const sc = await audSchema(true); toast(`✓ ${sc.tablo}: ${(sc.sayfalar || []).map(p => p.ad + " " + p.satir).join(", ")}`, 6000); } catch (er) { toast("✗ " + er.message, 6000); }
});

/* =====================================================================
   v2.6 — SAĞLAMLIK + UYGULAMALAR + UYKU TRANSI + YZ VİDEO + EŞLEŞTİRME + AYARLAR DÜZENİ
   ===================================================================== */

/* ---------- 1) hata dayanıklılığı (HTTP 400 ve benzerleri) ---------- */
function friendlyErr(e) {
  const m = String((e && e.message) || e), st = e && e.status;
  try { logIssue("hata", (st ? st + " " : "") + m); } catch {}
  if (/api key not valid|api_key_invalid|permission denied/i.test(m) || st === 403) return "Gemini anahtarı geçersiz görünüyor. Ayarlar → Beyin bölümünden anahtarı kontrol eder misin?";
  if (st === 429 || /quota|kota|exhausted/i.test(m)) return "Ücretsiz kullanım kotası şu an dolu. Birkaç dakika sonra tekrar deneyelim" + (SET.groqKey ? "." : "; Ayarlar'a ücretsiz Groq anahtarı eklersen kota dolunca yedek beyinle devam ederim.");
  if (st >= 500) return "Google tarafında geçici bir sorun var, birazdan tekrar dener misin?";
  if (st === 400) return "Bu isteği işleyemedim (ayrıntısı Ayarlar → Son hatalar'da). Biraz farklı söyler misin?";
  return "Bir aksaklık oldu: " + m.slice(0, 140);
}
// Gemini'nin kabul ettiği sohbet sırası: boş mesaj yok, aynı rol art arda gelmez, kullanıcıyla başlar
function cleanHist(history) {
  const out = [];
  for (const m of history || []) {
    const c = String((m && m.content) || "").trim(); if (!c) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    if (out.length && out[out.length - 1].role === role) out[out.length - 1] = { role, content: out[out.length - 1].content + "\n" + c };
    else out.push({ role, content: c });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
// Akışlı cevapta parça parça gelen metinleri birleştir, boş parçaları at (geri gönderirken 400 olmasın)
function compactParts(parts) {
  const out = [];
  for (const p of parts || []) {
    if (!p) continue;
    const plain = typeof p.text === "string" && !p.thought && !p.thoughtSignature && !p.functionCall;
    if (plain && !p.text) continue;
    const last = out[out.length - 1];
    if (plain && last && typeof last.text === "string" && !last.thought && !last.thoughtSignature && !last.functionCall) last.text += p.text;
    else out.push(plain ? { text: p.text } : p);
  }
  return out;
}
{
  const base = askGemini;
  askGemini = async function (history, onAct, attach) {
    const h = cleanHist(history);
    if (!h.length) return "Seni duyamadım, tekrar söyler misin?";
    try { return await base(h, onAct, attach); }
    catch (e) {
      if (e.status !== 400 || /api key|api_key|NOKEY/i.test(e.message)) throw e;
      try { logIssue("400", e.message); } catch {}
      const od = ON_DELTA; ON_DELTA = null; // ikinci denemede akışsız ve geçmişsiz dene
      try { return await base(h.slice(-1), onAct, attach); }
      catch (e2) {
        if (SET.groqKey && !attach) { onAct("groq"); return askGroq(h, onAct); }
        throw e2;
      } finally { ON_DELTA = od; }
    }
  };
}

/* ---------- 2) görsel: Cloudflare varsa o, yoksa anahtarsız ücretsiz servis ---------- */
let POLL_AT = 0;
const blobToDataUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = rej; f.readAsDataURL(b); });
async function pollImage(prompt, w, h) {
  const wait = 16000 - (Date.now() - POLL_AT); if (POLL_AT && wait > 0) await sleep(wait); // anahtarsız kullanımda 15 sn'de 1 görsel
  POLL_AT = Date.now();
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 380))}?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
  for (const f of [rawFetch, (...a) => fetch(...a)]) {
    try { const r = await f(url); if (r.ok) { const b = await r.blob(); if (b && b.size > 3000) return await blobToDataUrl(b.type ? b : new Blob([b], { type: "image/jpeg" })); } } catch {}
  }
  return new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => { try { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); res(c.toDataURL("image/jpeg", 0.92)); } catch (e) { rej(e); } };
    im.onerror = () => rej(new Error("Görsel servisi şu an yanıt vermiyor, biraz sonra tekrar dene.")); im.src = url;
  });
}
async function anyImage(prompt, w = 1024, h = 1024) {
  if (SET.cfAccount && SET.cfToken) { try { return await cfImage(prompt, w, h); } catch (e) { try { logIssue("görsel", "Cloudflare: " + e.message); } catch {} } }
  let en = prompt;
  if (/[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|ile)\b/.test(prompt) && SET.geminiKey) { try { en = (await plainGemini("Translate this image description to a rich English image-generation prompt. Only output the prompt: " + prompt, [], null, { max: 200, temperature: 0.3 })) || prompt; } catch {} }
  return pollImage(en, Math.min(w, 1280), Math.min(h, 1280));
}

/* ---------- 3) yapay zekâ videosu: senaryo → görseller → seslendirme → video ---------- */
let AIV_BUSY = false;
async function aiVideo({ konu, sahne = 5, format = "9:16", seslendirme = true }, onStep = () => {}) {
  if (AIV_BUSY) throw new Error("Zaten bir video hazırlanıyor.");
  if (!konu) throw new Error("Video konusu ne olsun?");
  AIV_BUSY = true;
  try {
    const n = Math.max(3, Math.min(8, Number(sahne) || 5));
    const [w, h] = format === "16:9" ? [1024, 576] : format === "1:1" ? [768, 768] : [576, 1024];
    onStep("Senaryo yazılıyor…");
    const plan = await geminiJSON(`"${konu}" hakkında ${n} sahnelik kısa, akıcı bir video hazırla. Anlatım Türkçe ve sesli okunacak (her sahne 1-2 cümle). JSON: {"baslik":"","sahneler":[{"anlatim":"","gorsel":"English image prompt: cinematic, detailed, no text, no letters"}]}`);
    const sc = (plan.sahneler || []).filter(s => s && s.anlatim).slice(0, 8);
    if (!sc.length) throw new Error("Senaryo çıkarılamadı, konuyu biraz daha açık yazar mısın?");
    const clips = [];
    for (let i = 0; i < sc.length; i++) {
      onStep(`Görsel ${i + 1}/${sc.length} hazırlanıyor…`);
      try { const img = await loadImg(await anyImage(sc[i].gorsel || sc[i].anlatim, w, h)); clips.push({ kind: "image", img, text: sc[i].anlatim, pan: i % 2 ? 1 : -1 }); }
      catch (e) { clips.push({ kind: "card", text: plan.baslik || konu, sub: sc[i].anlatim.replace(/(.{1,34})(\s|$)/g, "$1\n").trim() }); }
    }
    const full = sc.map(s => s.anlatim).join(" ");
    let narration = null;
    if (seslendirme && SET.geminiKey) { onStep("Seslendiriliyor…"); try { narration = await geminiTtsBuffer(full); } catch (e) { try { logIssue("video", "seslendirme: " + e.message); } catch {} } }
    const total = narration ? narration.duration + 0.5 : sc.length * 3.6;
    clips.forEach((c, i) => { c.start = 0; c.end = Math.max(1.8, total * sc[i].anlatim.length / full.length); });
    onStep("Video işleniyor…");
    const r = await renderVideo({ clips, format, narration, cleanAudio: false, onProgress: p => onStep(`Video işleniyor %${Math.round(p * 100)}`) });
    const s = await saveFile(r.blob, fname("video-" + (plan.baslik || konu), r.ext), "movies");
    return { ok: true, yer: s.yer, baslik: plan.baslik || konu, sahne: sc.length, gorselli: clips.filter(c => c.kind === "image").length, sesli: !!narration };
  } finally { AIV_BUSY = false; }
}

/* ---------- 4) UYGULAMALARIM: daha önce yaptığımız her şey tek yerde ---------- */
const A_ = id => "https://claude.ai/artifact/" + id;
const MY_APPS = [
  { k: "audition", n: "Recast Audition", e: "🎬", c: "İş", set: "auditionUrl", u: A_("FDqkLhxBpP3Ar4tQNB94AZ"), d: "İş gönder, self-tape topla, müşteriye ilet" },
  { k: "kadro", n: "KADRO", e: "🗂", c: "İş", set: "kadroUrl", u: "", d: "Oyuncu kadrosu yönetimi" },
  { k: "selftape", n: "Self-Tape Okuyucu", e: "🎥", c: "İş", u: A_("WWFaSsPAaqAqGw7VtsLWa4"), d: "Karşı replikleri okur, kayıt alır" },
  { k: "kesit", n: "Kesit Kurgu", e: "✂️", c: "İş", u: A_("G4rD1YYkTbvbLwEBdF64RC"), d: "Video kurgu, showreel sihirbazı" },
  { k: "senaryo", n: "Senaryo Masası", e: "📝", c: "İş", u: A_("99uPyFnzRmmpUeKt4t4PJR"), d: "Senaryo yazım uygulaması" },
  { k: "casting", n: "Casting Masası", e: "📋", c: "İş", u: A_("NiR7qT4pgoADJ1zEb2Yn9h"), d: "Ajanslar için casting uygulaması" },
  { k: "atolye", n: "Atölye Paneli", e: "🎭", c: "İş", u: A_("C8FbAfv2WYKh8tqcSNqrJE"), d: "Atölye yönetimi ve başvuru" },
  { k: "acik", n: "Açık Stüdyo Paneli", e: "🏛", c: "İş", u: A_("YMexZbTmac9CRh8r2smsvi"), d: "React Açık Stüdyo ekip paneli" },
  { k: "react", n: "React Açık Stüdyo", e: "🎟", c: "İş", u: A_("HpVUQ5bCFjrsv7nsD9wnLv"), d: "Atölye başvuru ve görüşme" },
  { k: "transfer", n: "Recast Transfer", e: "📦", c: "İş", u: A_("KBbdKXsqeav5esRQKVNaCJ"), d: "Dosya gönderim demosu" },
  { k: "uyku", n: "Uyku Transı", e: "🌙", c: "Gelişim", u: A_("EusyDvvPxqhnCbNR43Dmdv"), d: "Kişisel uyku hipnozu (tam sürüm)" },
  { k: "replik", n: "Replik", e: "🇬🇧", c: "Gelişim", u: A_("G2gUa5nS94jq73nQwrNTuG"), d: "İngilizce öğrenme" },
  { k: "okuma", n: "Okuma Atölyesi", e: "📖", c: "Gelişim", u: A_("D38iR4tvyrMuuU96ckyNcm"), d: "Hızlı okuma antrenmanı" },
  { k: "filiz", n: "Filiz", e: "🌱", c: "Gelişim", u: A_("KA3KdDnUfAXhvCX4ty5gcL"), d: "Bütçeye göre iş planı" },
  { k: "kira", n: "Kira Radarı", e: "🏠", c: "Gelişim", u: A_("GBKEb7uVfknigTC7BWeD9R"), d: "Kiralık ilan takibi" },
  { k: "saha", n: "Saha Yıldızı", e: "⚽", c: "Oyun", u: A_("Nb1Zu1BdRdTXTRNmF68QPx"), d: "Futbol kariyer oyunu" },
  { k: "galerici", n: "Galerici", e: "🚗", c: "Oyun", u: A_("W17Y3E6HiXmRAG7KR6xChH"), d: "3D araba al-sat simülatörü" },
  { k: "cephe", n: "Cephe 1921", e: "🎖", c: "Oyun", u: A_("MR82LwnzN7SjeG76EgmL3E"), d: "Kurtuluş Savaşı oyunu" },
  { k: "sahnede", n: "Burak Sahnede", e: "🌟", c: "Oyun", u: A_("5uMBKKnvas6ePSqpqHnVJw"), d: "Oyuncu hayat simülasyonu" },
  { k: "okey", n: "Istaka Okey", e: "🀄", c: "Oyun", u: A_("U9sk8xD2q8mAnsHaUEZDbx"), d: "Okey ve 101" },
  { k: "tarih", n: "Tarihin İçinde", e: "🏺", c: "Oyun", u: A_("9YxPr8pSwrD4HgRAMTMfhH"), d: "Tarihî hayat ve strateji oyunu" },
  { k: "istiklal", n: "İstiklal Harbi", e: "🇹🇷", c: "Oyun", u: A_("DBp1JFcUWU1Rw39Nt7nEDr"), d: "Harekât ve hayat oyunu" }
];
const allApps = () => [...MY_APPS.map(a => ({ ...a, url: (a.set && SET[a.set]) || a.u })), ...(SET.customApps || []).map((a, i) => ({ k: "c" + i, n: a.n, e: "🔗", c: "Eklediklerim", url: a.u, d: a.u.replace(/^https?:\/\//, "").slice(0, 40), custom: i }))];
async function openMyApp(q) {
  const nq = normTxt(q || ""); const apps = allApps();
  const a = apps.find(a => a.k === q) || apps.find(a => normTxt(a.n) === nq) || apps.find(a => normTxt(a.n).includes(nq) || nq.includes(normTxt(a.n))) || apps.find(a => nq.split(" ").some(w => w.length > 3 && normTxt(a.n + " " + a.d).includes(w)));
  if (!a) return { hata: "Böyle bir uygulama bulamadım. Uygulamalar: " + apps.map(a => a.n).join(", ") };
  if (!a.url) { go("set"); return { hata: `${a.n} adresi kayıtlı değil. Ayarlar → Uygulama adresleri bölümüne yaz.` }; }
  await openUrl(a.url); return { ok: true, acildi: a.n };
}
function appsHTML() {
  const apps = allApps(); const cats = [...new Set(apps.map(a => a.c))];
  return `<div class="hint" style="margin:0 0 8px">Birlikte yaptığımız uygulamalar. Dokun, açılsın — ya da “Titus, Uyku Transı'nı aç” de. Claude hesabınla giriş yapılı tarayıcıda açılır.</div>` +
    cats.map(c => `<div class="card"><h3>${esc(c.toLocaleUpperCase("tr-TR"))}</h3><div class="appgrid">${apps.filter(a => a.c === c).map(a => `<button class="app${a.url ? "" : " off"}" data-myapp="${a.k}"><i>${a.e}</i><b>${esc(a.n)}</b><small>${esc(a.url ? a.d : "adres gir")}</small>${a.custom !== undefined ? `<span class="x" data-appdel="${a.custom}">✕</span>` : ""}</button>`).join("")}</div></div>`).join("") +
    `<div class="card"><h3>UYGULAMA EKLE</h3><div class="form"><input id="apN" placeholder="Ad"><div class="row"><input id="apU" placeholder="https://…"><button class="btn" id="apAdd">+</button></div></div></div>`;
}

/* ---------- 5) UYKU TRANSI (yerleşik, sesli) ---------- */
const HYP = { on: false, stop: false, status: "", ac: null };
const HYP_GOALS = { uyku: ["Derin uyku", "derin, kesintisiz ve dinlendirici bir uykuya dalmak"], stres: ["Günü bırak", "günün stresini ve düşüncelerini bırakıp gevşemek"], ozguven: ["Özgüven", "özgüven ve sahne cesareti"], kaygi: ["Seçme kaygısı", "seçme ve sahne kaygısını bırakıp sakin, hazır hissetmek"], odak: ["Odak", "odaklanma, disiplin ve motivasyon"] };
function brownNoise(ac, vol) {
  const len = ac.sampleRate * 4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; const g = ac.createGain(); g.gain.value = vol; src.connect(g); g.connect(ac.destination); src.start(); return g;
}
const hypStat = s => { HYP.status = s; const e = $("#hypStat"); if (e) e.textContent = s; };
async function hypnoStart({ amac = "uyku", dk = 10, ozel = "" } = {}) {
  if (HYP.on) return { hata: "Seans zaten sürüyor." };
  const goal = HYP_GOALS[amac] || HYP_GOALS.uyku; dk = Math.max(3, Math.min(30, Number(dk) || 10));
  HYP.on = true; HYP.stop = false; hypStat("Seans hazırlanıyor…"); if (CUR.life === "uyku") renderSec("life");
  try { if (Jarvis && SET.wake) await nat(() => Jarvis.pauseWake()); } catch {}
  let noise = null;
  try {
    const txt = await plainGemini(`${SET.name} için Türkçe bir hipnoz/gevşeme seansı metni yaz. Amaç: ${goal[1]}.${ozel ? " Kişisel not: " + ozel + "." : ""} Yaklaşık ${dk * 70} kelime.
Kurallar: ikinci tekil şahıs, şimdiki zaman, yavaş, yumuşak ve tekrarlı telkin dili; kısa cümleler. Başlık, madde işareti, parantez, sahne notu YOK — sadece okunacak metin. Paragrafları boş satırla ayır (her paragraf 2-4 cümle).
Akış: nefese odaklanma → bedeni baştan ayağa gevşetme → 10'dan 1'e sayarak derinleşme → huzurlu bir yer imgesi → amaca yönelik olumlu telkinler → ${amac === "uyku" || amac === "stres" ? "uykuya bırakma (uyandırma yok, son cümleler giderek sakinleşsin)" : "1'den 5'e sayarak zinde ve sakin uyanış"}. Tıbbi iddia ve vaat yok.`, [], null, { max: 5000, temperature: 0.85 });
    const paras = String(txt).split(/\n\s*\n/).map(p => p.replace(/[*_#]/g, "").trim()).filter(p => p.length > 10);
    if (!paras.length) throw new Error("Seans metni hazırlanamadı");
    const ac = HYP.ac = new (window.AudioContext || window.webkitAudioContext)(); noise = brownNoise(ac, 0.035);
    const getBuf = p => geminiTtsBuffer(p).catch(() => null);
    let next = getBuf(paras[0]);
    for (let i = 0; i < paras.length && !HYP.stop; i++) {
      hypStat(`Seans sürüyor · ${i + 1}/${paras.length}`);
      const buf = await next; next = i + 1 < paras.length ? getBuf(paras[i + 1]) : null;
      if (HYP.stop) break;
      if (buf) await new Promise(res => { const s = ac.createBufferSource(); s.buffer = buf; s.playbackRate.value = 0.94; const g = ac.createGain(); g.gain.value = 0.9; s.connect(g); g.connect(ac.destination); s.onended = res; HYP.src = s; s.start(); });
      else await speak(paras[i], true);
      for (let k = 0; k < 6 && !HYP.stop; k++) await sleep(500);
    }
    if (!HYP.stop && (amac === "uyku" || amac === "stres")) { hypStat("Seans bitti · ses yavaşça kısılıyor"); noise.gain.linearRampToValueAtTime(0, ac.currentTime + 240); for (let k = 0; k < 480 && !HYP.stop; k++) await sleep(500); }
    return { ok: true, sure_dk: dk };
  } catch (e) { toast("✗ " + friendlyErr(e), 5000); return { hata: e.message }; }
  finally {
    try { if (HYP.src) HYP.src.stop(); } catch {} try { if (HYP.ac) await HYP.ac.close(); } catch {}
    HYP.on = false; HYP.ac = null; hypStat(""); resumeWake(); if (CUR.life === "uyku") renderSec("life");
  }
}
function hypnoStop() { HYP.stop = true; try { if (HYP.src) HYP.src.stop(); } catch {} stopSpeaking(); }
function hypHTML() {
  return `<div class="card"><h3>UYKU TRANSI</h3>${HYP.on ? `<div class="hint" id="hypStat" style="margin-top:0;font-size:14px">${esc(HYP.status)}</div><button class="btn" id="hypStop" style="width:100%;margin-top:10px">■ Seansı bitir</button><div class="hint">Telefonu yanına koy, ekranı kapatabilirsin. Kulaklık önerilir.</div>` :
    `<div class="form"><div class="lbl">Bu geceki amaç</div><select id="hypGoal">${Object.entries(HYP_GOALS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join("")}</select>
     <div class="lbl">Süre</div><select id="hypMin"><option value="5">5 dakika</option><option value="10" selected>10 dakika</option><option value="15">15 dakika</option><option value="20">20 dakika</option></select>
     <div class="lbl">Kişisel not (isteğe bağlı)</div><input id="hypNote" placeholder="ör. yarın seçmem var, sakin uyanmak istiyorum">
     <button class="btn" id="hypGo">🌙 Seansı başlat</button></div>
     <div class="hint">Titus sana özel bir metin yazar, doğal sesle yavaşça okur; arkada hafif bir uğultu çalar. “Titus, uyku seansı başlat” da diyebilirsin. Tam sürüm için: <a href="#" data-myapp="uyku">Uyku Transı uygulaması</a>.</div>`}</div>`;
}

/* ---------- 6) bölümler ve tıklamalar ---------- */
{
  const base = listHTML;
  listHTML = function (sec) {
    if (sec === "apps") return appsHTML();
    if (sec === "uyku") return hypHTML();
    if (sec === "video") return base(sec) + `<div class="card"><h3>YAPAY ZEKÂ VİDEOSU</h3><div class="form"><input id="aivTopic" placeholder="Konu (ör. Kadıköy'de bir oyuncunun günü)"><div class="row"><select id="aivFmt"><option value="9:16">Dikey 9:16</option><option value="16:9">Yatay 16:9</option><option value="1:1">Kare</option></select><select id="aivN"><option value="4">4 sahne</option><option value="5" selected>5 sahne</option><option value="6">6 sahne</option><option value="8">8 sahne</option></select></div><button class="btn" id="aivGo">🎬 Videoyu oluştur</button><div class="hint" id="aivStat">Titus senaryoyu yazar, sahne görsellerini üretir, seslendirir ve videoyu Filmler/TITUS'a kaydeder. Cloudflare bağlı değilse ücretsiz servis kullanılır (sahne başına ~15 sn). İşlem sırasında uygulamayı açık tut.</div></div></div>`;
    return base(sec);
  };
}
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-appdel],[data-myapp],#apAdd,#hypGo,#hypStop,#aivGo,#pairMake,#pairCopy,#pairMail,[data-goapps]"); if (!t) return;
  try {
    if (t.dataset.appdel !== undefined) { e.stopPropagation(); SET.customApps.splice(+t.dataset.appdel, 1); await saveSet(); renderSec("studio"); }
    else if (t.dataset.myapp) { e.preventDefault(); const r = await openMyApp(t.dataset.myapp); if (r.hata) toast(r.hata, 4500); }
    else if (t.id === "apAdd") { const n = $("#apN").value.trim(); let u = $("#apU").value.trim(); if (!n || !u) return toast("Ad ve adres yaz"); if (!/^https?:\/\//.test(u)) u = "https://" + u; SET.customApps = [...(SET.customApps || []), { n, u }]; await saveSet(); renderSec("studio"); }
    else if (t.id === "hypGo") hypnoStart({ amac: $("#hypGoal").value, dk: +$("#hypMin").value, ozel: $("#hypNote").value.trim() });
    else if (t.id === "hypStop") hypnoStop();
    else if (t.id === "aivGo") { const k = $("#aivTopic").value.trim(); if (!k) return toast("Konu yaz"); t.disabled = true; try { const r = await aiVideo({ konu: k, format: $("#aivFmt").value, sahne: +$("#aivN").value }, s => { const el = $("#aivStat"); if (el) el.textContent = "⏳ " + s; }); const el = $("#aivStat"); if (el) el.textContent = `✓ Kaydedildi: ${r.yer} (${r.gorselli}/${r.sahne} sahne görselli${r.sesli ? ", seslendirmeli" : ""})`; toast("✓ Video hazır", 4000); } finally { t.disabled = false; } }
    else if (t.dataset.goapps !== undefined) { go("studio"); openSec("studio", "apps"); }
    else if (t.id === "pairMake") { $("#pairOut").value = pairCode(); $("#pairBox").style.display = ""; }
    else if (t.id === "pairCopy") { const v = $("#pairOut").value; try { await navigator.clipboard.writeText(v); toast("✓ Kod kopyalandı"); } catch { $("#pairOut").select(); toast("Kodu seçip kopyala"); } }
    else if (t.id === "pairMail") openUrl("mailto:?subject=" + encodeURIComponent("Titus bağlantı kodu") + "&body=" + encodeURIComponent($("#pairOut").value));
  } catch (er) { const el = $("#aivStat"); if (el && t.id === "aivGo") el.textContent = "✗ " + friendlyErr(er); toast("✗ " + friendlyErr(er), 5000); }
});

/* ---------- 7) araçlar ---------- */
TOOLS.push(
  T("video_olustur", "Verilen konuda yapay zekâyla kısa bir video üretir: senaryo yazar, sahne görsellerini üretir, seslendirir ve galeriye kaydeder. 1-3 dakika sürer.", { konu: str("Video konusu"), sahne: num("Sahne sayısı (3-8)"), format: str("Biçim", ["9:16", "16:9", "1:1"]) }, ["konu"],
    async a => { go("studio"); openSec("studio", "video"); const r = await aiVideo(a, s => { const el = $("#aivStat"); if (el) el.textContent = "⏳ " + s; setMode("think", s); }); return r; }),
  T("uygulamam_ac", "Burak'la birlikte yapılan uygulamalardan birini açar: Recast Audition, KADRO, Self-Tape Okuyucu, Uyku Transı, Kesit Kurgu, Senaryo Masası, Replik, Okuma Atölyesi, Filiz, Kira Radarı, Saha Yıldızı, Galerici, Cephe 1921, Burak Sahnede, Istaka Okey vb.", { ad: str("Uygulama adı") }, ["ad"], a => openMyApp(a.ad)),
  T("uyku_transi", "Yerleşik sesli hipnoz/gevşeme seansı başlatır.", { amac: str("Amaç", ["uyku", "stres", "ozguven", "kaygi", "odak"]), dakika: num("Süre (dakika)") }, [], a => { go("life"); openSec("life", "uyku"); hypnoStart({ amac: a.amac || "uyku", dk: a.dakika || 10 }); return { ok: true, not: "Seans birazdan başlıyor." }; }),
  T("uyku_transi_bitir", "Süren hipnoz seansını bitirir.", {}, [], () => { hypnoStop(); return { ok: true }; }),
  T("bilgisayara_soyle", "Bilgisayardaki Titus'a bir iş yaptırır (ör. 'Chrome'u aç', 'şu konuda görsel üret', 'masaüstündeki CV'yi maile ekle'). Bilgisayarda Titus açık olmalı.", { gorev: str("Bilgisayarda yapılacak iş") }, ["gorev"],
    async a => { const { id } = await script("pcPush", { cmd: { action: "ask", arg: a.gorev } }); for (let i = 0; i < 20; i++) { await sleep(3000); const r = await script("pcResult", { id }); if (r.result) return r.result; } return { hata: "Bilgisayardan cevap gelmedi; Titus bilgisayarda açık mı?" }; })
);
Object.assign(ACT_TR, { video_olustur: "🎬 video", uygulamam_ac: "🧩 uygulama", uyku_transi: "🌙 seans", uyku_transi_bitir: "🌙 bitti", bilgisayara_soyle: "💻 bilgisayar" });
TOOL_GROUPS.push(
  [/video|klip|reels/, ["video_olustur"]],
  [/uygulama|aç|audition|kadro|self-?tape|kurgu|senaryo|replik|okuma|filiz|oyun|okey|galerici|cephe|saha/, ["uygulamam_ac"]],
  [/hipnoz|trans|uyku|uyu|gevşe|rahatla|seans/, ["uyku_transi", "uyku_transi_bitir"]],
  [/bilgisayar/, ["bilgisayara_soyle"]],
  [/görsel|resim|afiş|poster/, ["gorsel_uret"]]
);
{
  const baseSys = systemPrompt;
  systemPrompt = function () { return baseSys() + "\nUYGULAMALAR: Burak'la yaptığınız uygulamaları uygulamam_ac ile açabilirsin. Video istenirse video_olustur, görsel istenirse gorsel_uret kullan (Cloudflare bağlı olmasa da çalışır). Bilgisayarda yapılacak işler için bilgisayara_soyle kullan."; };
}

/* ---------- 8) bilgisayarla eşleştirme (tek kod) + bilgisayardan gelen istekler ---------- */
function pairCode() {
  const o = { v: 1, u: SET.scriptUrl || "", t: SET.scriptToken || "", g: SET.geminiKey || "", q: SET.groqKey || "", ca: SET.cfAccount || "", ct: SET.cfToken || "", k: SET.kadroSheetId || "", a: SET.auditionSheetId || "", au: SET.auditionUrl || "", ku: SET.kadroUrl || "", n: SET.name || "", nt: SET.ntfyTopic || "" };
  return "TITUS1." + btoa(unescape(encodeURIComponent(JSON.stringify(o))));
}
let PH_BUSY = false;
async function phonePull() {
  if (!SET.scriptUrl || PH_BUSY || document.hidden || busy) return; PH_BUSY = true;
  try {
    const r = await script("phPull");
    for (const c of r.cmds || []) {
      if (c.kind === "note") { bubble("assistant", "💻 Bilgisayardan: " + c.text); CHAT.push({ role: "assistant", content: "Bilgisayardan gelen not: " + c.text }); saveChat(); }
      else { bubble("sys", "💻 Bilgisayardaki Titus'tan istek"); await send(String(c.text || "")); }
    }
  } catch {} finally { PH_BUSY = false; }
}
setInterval(phonePull, 45000); setTimeout(phonePull, 8000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(phonePull, 1500); });

/* ---------- 9) AYARLAR: katlanır, aranabilir, düzenli ---------- */
{
  const base = renderSettings;
  let SET_BUSY = false;
  renderSettings = async function () {
    if (SET_BUSY) return; SET_BUSY = true;
    try {
      const box = $("#b-set"); const y = box ? box.scrollTop : 0; const q0 = ($("#setSearch") || {}).value || "";
      await base();
      box.insertAdjacentHTML("beforeend", `
      <div class="card"><h3>UYGULAMA ADRESLERİ</h3><div class="form"><div class="lbl">KADRO adresi (Netlify)</div><input data-set="kadroUrl" value="${esc(SET.kadroUrl || "")}" placeholder="https://kadro….netlify.app/#KODUN"><div class="lbl">Recast Audition adresi (Netlify)</div><input data-set="auditionUrl" value="${esc(SET.auditionUrl || "")}" placeholder="https://recast-audition.netlify.app/#KODUN"><div class="hint">Bunları bir kez yaz; Stüdyo → Uygulamalar'dan ya da “Titus, KADRO'yu aç” diyerek açarsın.</div></div></div>
      <div class="card"><h3>BİLGİSAYARI BAĞLA</h3><div class="hint" style="margin-top:0">Bilgisayardaki Titus'u tek kodla bağla: Gmail, takvim, KADRO, görevler ve anahtarların hepsi bilgisayara geçer. Kodu kimseyle paylaşma.</div><button class="btn ghost sm" id="pairMake" style="margin-top:8px">Bağlantı kodu oluştur</button>
        <div id="pairBox" style="display:none;margin-top:8px"><textarea id="pairOut" readonly style="min-height:70px;font-size:11px"></textarea><div class="row" style="margin-top:6px"><button class="btn ghost sm" id="pairCopy">Kopyala</button><button class="btn ghost sm" id="pairMail">Kendime mail at</button></div><div class="hint">Bilgisayarda Titus → Ayarlar → “Telefondan bağlantı kodu” kutusuna yapıştır.</div></div></div>
      <div class="card"><h3>SON HATALAR</h3><div class="hint" style="margin-top:0">${(S.issues || []).slice(-8).reverse().map(i => `${esc((i.at || "").slice(5, 16).replace("T", " "))} · ${esc(i.detail)}`).join("<br>") || "Kayıtlı hata yok."}</div></div>`);
      // katlanır kartlar
      const open = new Set(META.setOpen || []); const cards = [...box.querySelectorAll(":scope > .card")];
      let nth = 0; cards.forEach(c => { const h = c.querySelector(":scope > h3"); if (!h) return; h.textContent = h.textContent.replace(/HEY Titus/g, "HEY TITUS"); const key = h.textContent.trim(); c.classList.add("fold"); c.dataset.key = key; if (open.has(key) || (!META.setOpen && nth === 0)) c.classList.add("open"); nth++; });
      box.insertAdjacentHTML("afterbegin", `<div class="setbar"><input id="setSearch" placeholder="Ayarlarda ara… (ör. ses, izin, yedek)" value="${esc(q0)}"><button class="btn ghost sm" id="setAll">Tümünü aç</button></div>`);
      const filt = () => { const q = trLower($("#setSearch").value.trim()); cards.forEach(c => { const hit = !q || trLower(c.textContent).includes(q); c.style.display = hit ? "" : "none"; c.classList.toggle("found", !!q && hit); }); };
      $("#setSearch").addEventListener("input", filt); if (q0) filt();
      box.scrollTop = y;
    } finally { SET_BUSY = false; }
  };
  document.addEventListener("click", e => {
    const all = e.target.closest("#setAll");
    if (all) { const cs = [...document.querySelectorAll("#b-set > .card.fold")]; const any = cs.some(c => !c.classList.contains("open")); cs.forEach(c => c.classList.toggle("open", any)); all.textContent = any ? "Tümünü kapat" : "Tümünü aç"; META.setOpen = any ? cs.map(c => c.dataset.key) : []; saveMeta(); return; }
    const h = e.target.closest("#b-set > .card.fold > h3"); if (!h) return;
    const c = h.parentElement; c.classList.toggle("open");
    META.setOpen = [...document.querySelectorAll("#b-set > .card.fold.open")].map(c => c.dataset.key); saveMeta();
  });
}

/* =====================================================================
   v2.7 — DOSYA/GÖRSEL ANALİZİ, KİMLİĞİ KORUYAN MONTAJ, MODEL KÜTÜPHANESİ,
          İSTEĞE SADIK GÖRSEL ÜRETİMİ (yaz → üret → kontrol et → düzelt), KONUŞAN VİDEO (bilgisayarda)
   ===================================================================== */

/* ---------- 1) her tür dosya ekleme ---------- */
const MAX_INLINE = 15 * 1024 * 1024;
let CTX_ATT = null; // son eklenen dosyalar: sonraki sorularda da bağlamda kalsın
let CUR_IMGS = []; // son eklenen fotoğraflar (base64 jpeg) — montaj/model için
const b64utf8 = s => btoa(unescape(encodeURIComponent(s)));
const extOf = n => (String(n).match(/\.(\w+)$/) || [, ""])[1].toLowerCase();
async function loadScript(src, glob) { if (glob && window[glob]) return window[glob]; await new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Kütüphane yüklenemedi (internet?)")); document.head.appendChild(s); }); return glob ? window[glob] : null; }
async function docxText(f) {
  const JSZip = await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", "JSZip");
  const z = await JSZip.loadAsync(await f.arrayBuffer()); const x = await z.file("word/document.xml").async("string");
  return x.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}
async function sheetText(f) {
  const X = await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "XLSX");
  const wb = X.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
  return wb.SheetNames.slice(0, 6).map(n => "## " + n + "\n" + X.utils.sheet_to_csv(wb.Sheets[n]).split("\n").slice(0, 500).join("\n")).join("\n\n");
}
async function fileToAttach(f) {
  const ext = extOf(f.name), type = f.type || "";
  if (type.startsWith("image/") || /^(jpe?g|png|webp|heic|gif|bmp)$/.test(ext)) { const data = await shrinkImage(f, 1600); return { mime: "image/jpeg", data, name: f.name, kind: "image" }; }
  if (type === "application/pdf" || ext === "pdf") { if (f.size > MAX_INLINE) throw new Error(`${f.name} çok büyük (en fazla 15 MB)`); return { mime: "application/pdf", data: await blobToB64(f), name: f.name, kind: "pdf" }; }
  if (/^(docx)$/.test(ext)) return { mime: "text/plain", data: b64utf8(`[${f.name}]\n` + (await docxText(f)).slice(0, 200000)), name: f.name, kind: "doc" };
  if (/^(xlsx|xls|ods)$/.test(ext)) return { mime: "text/plain", data: b64utf8(`[${f.name}]\n` + (await sheetText(f)).slice(0, 200000)), name: f.name, kind: "doc" };
  if (type.startsWith("audio/") || /^(mp3|m4a|wav|ogg|aac|opus)$/.test(ext)) { if (f.size > MAX_INLINE) throw new Error(`${f.name} çok büyük (en fazla 15 MB)`); return { mime: type || "audio/mpeg", data: await blobToB64(f), name: f.name, kind: "audio" }; }
  if (type.startsWith("video/") || /^(mp4|mov|webm|3gp)$/.test(ext)) { if (f.size > MAX_INLINE) throw new Error(`${f.name} çok büyük; 15 MB altı bir video seç (ya da bilgisayardaki Titus'a ver)`); return { mime: type || "video/mp4", data: await blobToB64(f), name: f.name, kind: "video" }; }
  if (type.startsWith("text/") || /^(txt|md|csv|json|srt|html|xml|log|js|py|ini)$/.test(ext)) return { mime: "text/plain", data: b64utf8(`[${f.name}]\n` + (await f.text()).slice(0, 300000)), name: f.name, kind: "doc" };
  if (/^(doc|ppt|pptx)$/.test(ext)) throw new Error(`${f.name}: bu biçimi okuyamıyorum; PDF olarak kaydedip gönder.`);
  throw new Error(`${f.name}: bu dosya türünü tanımıyorum.`);
}
function attachInfo() {
  const el = $("#attachInfo"); if (!el) return;
  const items = pendingAttach.length ? pendingAttach : (CTX_ATT ? CTX_ATT.items : []);
  if (!items.length) { el.innerHTML = ""; return; }
  const icon = a => ({ image: "🖼", pdf: "📄", doc: "📝", audio: "🎵", video: "🎬" }[a.kind] || "📎");
  el.innerHTML = (pendingAttach.length ? "Eklendi: " : "Bağlamda: ") + items.map(a => a.kind === "image" ? `<img src="data:image/jpeg;base64,${a.data}" style="height:34px;border-radius:6px;vertical-align:middle;margin-right:4px">` : `${icon(a)} ${esc(a.name || "")} `).join("") + ` <a href="#" id="attClear" style="color:var(--dim)">✕</a>` + (pendingAttach.length ? `<br><small>Ne yapayım? (ör. "bunu incele", "bu fotoğrafımı Paris'te yap", "bunu model olarak kaydet")</small>` : "");
}
async function pickAny(accept) {
  const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = accept || "image/*,application/pdf,.pdf,.doc,.docx,.xlsx,.xls,.csv,.txt,.md,.json,audio/*,video/*";
  inp.style.display = "none"; document.body.appendChild(inp);
  inp.onchange = async () => {
    const fs = [...(inp.files || [])].slice(0, 6); inp.remove(); if (!fs.length) return;
    let total = 0;
    for (const f of fs) {
      try { const a = await fileToAttach(f); total += a.data.length * 0.75; if (total > 18 * 1024 * 1024) { toast("Toplam boyut çok büyük; bazı dosyalar eklenmedi"); break; } pendingAttach.push(a); if (a.kind === "image") CUR_IMGS = [...CUR_IMGS.slice(-5), a.data]; }
      catch (e) { toast("✗ " + e.message, 5000); }
    }
    if (pendingAttach.some(a => a.kind === "image")) CUR_IMGS = pendingAttach.filter(a => a.kind === "image").map(a => a.data);
    attachInfo(); $("#q").focus();
  };
  inp.click();
}
pickPhoto = () => pickAny();
document.addEventListener("click", e => { if (e.target.closest("#attClear")) { e.preventDefault(); pendingAttach = []; CTX_ATT = null; CUR_IMGS = []; attachInfo(); } });
{
  const baseSend = send;
  send = async function (text, byVoice = false, attach = null, label = null) {
    const t = String(text || "").trim();
    if (!attach && pendingAttach.length) { attach = pendingAttach; pendingAttach = []; CTX_ATT = { items: attach, left: 4 }; }
    else if (!attach && CTX_ATT && CTX_ATT.left > 0 && t && !t.startsWith("__") && !/^(yeni konu|başka bir şey|tamam|teşekkür)/i.test(t)) { attach = CTX_ATT.items; CTX_ATT.left--; }
    else if (CTX_ATT && CTX_ATT.left <= 0) CTX_ATT = null;
    if (attach && attach.length) { const imgs = attach.filter(a => a.kind === "image" || (a.mime || "").startsWith("image/")); if (imgs.length) CUR_IMGS = imgs.map(a => a.data); }
    attachInfo();
    if (attach && attach.length && t && !label) { // kullanıcının mesajını eklerle birlikte göster
      const r = await baseSend(t, byVoice, attach, "📎 " + t); return r;
    }
    return baseSend(text, byVoice, attach, label);
  };
}

/* ---------- 2) görsel motorları ---------- */
const IMG_OFF = {}; // motor → kapalı olduğu zamana kadar
const offFor = (k, ms) => { IMG_OFF[k] = Date.now() + ms; try { META.imgOff = IMG_OFF; saveMeta(); } catch {} };
const isOff = k => (IMG_OFF[k] || (META.imgOff || {})[k] || 0) > Date.now();
const GEM_IMG_MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-2.0-flash-preview-image-generation"];
async function geminiImage(prompt, refs = []) {
  if (!SET.geminiKey || isOff("gemini")) throw new Error("kapalı");
  for (const m of GEM_IMG_MODELS) {
    if (isOff("g:" + m)) continue;
    try {
      const j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(SET.geminiKey)}`, {
        contents: [{ role: "user", parts: [...refs.map(d => ({ inlineData: { mimeType: "image/jpeg", data: d } })), { text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      });
      const p = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).find(p => p.inlineData && /^image\//.test(p.inlineData.mimeType || ""));
      if (p) return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
    } catch (e) { offFor("g:" + m, e.status === 429 ? 12 * 36e5 : e.status === 404 ? 7 * 864e5 : 30 * 6e4); }
  }
  offFor("gemini", 6 * 36e5); throw new Error("Gemini görsel kotası yok");
}
// Hugging Face (FLUX.1 Kontext) — ücretsiz hesapla günlük birkaç düzenleme; yüzü/kimliği korur
const KONTEXT_SPACES = ["black-forest-labs-flux-1-kontext-dev", "zerogpu-aoti-flux-1-kontext-dev"];
async function gradioCall(host, api, data, token) {
  const H = token ? { Authorization: "Bearer " + token } : {};
  const r1 = await rawFetch(`https://${host}.hf.space/gradio_api/call/${api}`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
  if (!r1.ok) { const e = new Error(`HF ${r1.status}`); e.status = r1.status; throw e; }
  const { event_id } = await r1.json();
  const r2 = await rawFetch(`https://${host}.hf.space/gradio_api/call/${api}/${event_id}`, { headers: H });
  const txt = await r2.text();
  const blocks = txt.split(/\n\n/); let ev = "", out = null, err = "";
  for (const b of blocks) { const e = (b.match(/^event:\s*(\w+)/m) || [])[1]; const d = (b.match(/^data:\s*(.*)$/m) || [])[1]; if (e) ev = e; if (e === "complete" && d) out = JSON.parse(d); if (e === "error") err = d || "hata"; }
  if (!out) { const e = new Error(/quota|GPU/i.test(err) ? "Hugging Face ücretsiz günlük GPU kotası doldu" : "Hugging Face: " + (err || ev || "cevap yok")); e.quota = /quota|GPU/i.test(err); throw e; }
  return out;
}
async function gradioUpload(host, blob, token) {
  const fd = new FormData(); fd.append("files", blob, "girdi.jpg");
  const r = await rawFetch(`https://${host}.hf.space/gradio_api/upload`, { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {}, body: fd });
  if (!r.ok) throw new Error("HF yükleme " + r.status);
  const [path] = await r.json(); return path;
}
async function kontextEdit(refB64, prompt) {
  if (isOff("hf")) throw new Error("Hugging Face kotası dolu");
  const blob = await (await fetch("data:image/jpeg;base64," + refB64)).blob(); let last;
  for (const host of [SET.hfSpace, ...KONTEXT_SPACES].filter(Boolean)) {
    try {
      const path = await gradioUpload(host, blob, SET.hfToken);
      const out = await gradioCall(host, "infer", [{ path, meta: { _type: "gradio.FileData" } }, prompt, Math.floor(Math.random() * 1e6), false, 2.5, 28], SET.hfToken);
      const f = out[0]; const url = f && (f.url || (f.path && `https://${host}.hf.space/gradio_api/file=${f.path}`));
      if (!url) throw new Error("boş sonuç");
      const b = await (await rawFetch(url, { headers: SET.hfToken ? { Authorization: "Bearer " + SET.hfToken } : {} })).blob();
      return await blobToDataUrl(b);
    } catch (e) { last = e; if (e.quota) { offFor("hf", 3 * 36e5); break; } }
  }
  throw last || new Error("Hugging Face yanıt vermedi");
}
// kimliği koruyarak düzenleme: Gemini görsel → HF Kontext
async function editKeepIdentity(refs, prompt) {
  const keep = "Keep the person's identity EXACTLY the same: same face, facial features, skin tone, hair, body shape, hands and arms. Do not beautify or change the person. Photorealistic, natural lighting matching the new scene, realistic shadows. ";
  const errs = [];
  try { return { img: await geminiImage(keep + prompt, refs.slice(0, 3)), motor: "Gemini" }; } catch (e) { errs.push("Gemini: " + e.message); }
  try { return { img: await kontextEdit(refs[0], keep + prompt), motor: "FLUX Kontext" }; } catch (e) { errs.push("HF: " + e.message); }
  const err = new Error("KIMLIK_YOK"); err.detail = errs; throw err;
}

/* ---------- 3) isteğe sadık üretim: yaz → üret → kontrol et → düzelt ---------- */
async function planImage(istek, { ref = false, model = null } = {}) {
  return geminiJSON(`Kullanıcı Türkçe bir görsel istiyor. İsteği, görsel yapay zekâsının TAM uygulayacağı ayrıntılı İngilizce bir prompt'a çevir.
Kurallar: kullanıcının söylediği HER ayrıntıyı (kişi sayısı, kıyafet, renk, mekân, saat, ışık, kamera açısı, poz, ifade, nesneler, yazı) koru ve açıkça yaz; kendinden yeni ana unsur ekleme; belirsiz kalanları gerçekçi ve sade doldur. Yazı istenmişse tırnak içinde aynen yaz.
${ref ? "Bir referans fotoğraf var: prompt DÜZENLEME talimatı olsun (ör. 'Place this person in ... , keep the face identical').\n" : ""}${model ? "Kullanılacak kişi/model tarifi (birebir koru): " + model + "\n" : ""}Gerçekçi istenmişse: "photorealistic, 35mm photo, natural skin texture" ekle.
JSON: {"prompt":"", "oran":"1:1|9:16|16:9 (istekte belli değilse uygun olanı seç)", "kontrol":["görselde mutlaka olması gereken 3-8 madde, Türkçe"]}
İSTEK: ${istek}`);
}
async function checkImage(dataUrl, istek, kontrol) {
  try {
    const r = await geminiJSON(`Bu görsel şu isteğe ne kadar uyuyor? İSTEK: "${istek}". KONTROL LİSTESİ: ${JSON.stringify(kontrol || [])}.
Her maddeye bak. JSON: {"puan":0-100,"eksikler":["Türkçe kısa"],"duzeltme":"eksikleri gideren İngilizce ek prompt cümlesi"}`, [{ inlineData: { mimeType: "image/jpeg", data: await toJpegB64(dataUrl, 1024) } }]);
    return r;
  } catch { return { puan: 70, eksikler: [] }; }
}
async function toJpegB64(src, max = 1280) {
  const im = await loadImg(src); const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement("canvas");
  c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}
const SIZE = { "1:1": [1024, 1024], "9:16": [768, 1344], "16:9": [1344, 768], "4:5": [896, 1120] };
async function smartImage({ istek, oran, refs = [], modelId = null, onStep = () => {} }) {
  let mdl = null; if (modelId) { mdl = await modelGet(modelId); if (!mdl) throw new Error("Böyle bir model kayıtlı değil"); refs = [...(mdl.imgs || []), ...refs].slice(0, 3); }
  onStep("İstek ayrıntılandırılıyor…");
  const plan = await planImage(istek, { ref: refs.length > 0, model: mdl && mdl.desc });
  const [w, h] = SIZE[oran || plan.oran] || SIZE["1:1"];
  let best = null, prompt = plan.prompt || istek, notes = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    onStep(attempt ? `Düzeltiliyor (${attempt + 1}. deneme)…` : "Görsel üretiliyor…");
    let img, motor;
    if (refs.length) {
      try { ({ img, motor } = await editKeepIdentity(refs, prompt)); }
      catch (e) {
        if (e.message !== "KIMLIK_YOK") throw e;
        notes.push("Yüzü birebir koruyan ücretsiz motorlara şu an ulaşılamadı; tarife göre çizildi (yüz farklı olabilir).");
        img = await anyImage((mdl ? mdl.desc + ". " : "") + prompt, w, h); motor = "metinden";
        refs = [];
      }
    } else { img = await anyImage(prompt, w, h); motor = SET.cfAccount && SET.cfToken ? "Cloudflare FLUX" : "FLUX (ücretsiz)"; }
    onStep("İsteğe uygunluğu kontrol ediliyor…");
    const c = await checkImage(img, istek, plan.kontrol);
    if (!best || (c.puan || 0) > best.puan) best = { img, puan: c.puan || 0, eksik: c.eksikler || [], motor };
    if ((c.puan || 0) >= 80 || !c.duzeltme) break;
    prompt = prompt + " " + c.duzeltme;
  }
  return { ...best, notlar: notes };
}

/* ---------- 4) model kütüphanesi (yüz/kişi/karakter) ---------- */
const MDB = { db: null };
const mdb = () => MDB.db ? Promise.resolve(MDB.db) : new Promise((res, rej) => { const r = indexedDB.open("titus_models", 1); r.onupgradeneeded = () => r.result.createObjectStore("m", { keyPath: "id" }); r.onsuccess = () => { MDB.db = r.result; res(MDB.db); }; r.onerror = () => rej(r.error); });
const mtx = (mode, fn) => mdb().then(d => new Promise((res, rej) => { const t = d.transaction("m", mode); const q = fn(t.objectStore("m")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
const modelList = () => mtx("readonly", s => s.getAll()).then(a => a || []);
async function modelGet(q) { const all = await modelList(); const n = normTxt(String(q || "")); return all.find(m => m.id === q) || all.find(m => normTxt(m.name) === n) || all.find(m => n && (normTxt(m.name).includes(n) || n.includes(normTxt(m.name)))) || null; }
async function modelSave({ ad, imgs, not = "" }) {
  if (!imgs || !imgs.length) throw new Error("Önce modelin fotoğraflarını ekle (📎) — farklı açılardan 1-3 net fotoğraf en iyisi.");
  const small = await Promise.all(imgs.slice(0, 3).map(d => toJpegB64("data:image/jpeg;base64," + d, 1024)));
  const desc = await plainGemini(`Bu fotoğraflardaki kişiyi bir görsel yapay zekâsının birebir yeniden çizebileceği şekilde İngilizce tarif et: yaş aralığı, cinsiyet, ten rengi, yüz şekli, gözler, kaşlar, burun, dudaklar, çene, saç (renk, uzunluk, stil), sakal/bıyık, belirgin işaretler (ben, iz, dövme), boy-yapı, tipik kıyafet. Tek paragraf, sadece fiziksel özellikler, isim yok.${not ? " Ek not: " + not : ""}`, small.map(d => ({ inlineData: { mimeType: "image/jpeg", data: d } })), null, { max: 600, temperature: 0.2 });
  const old = await modelGet(ad); const m = { id: old ? old.id : uid(), name: ad, desc: String(desc).trim(), imgs: small, at: localISO(new Date()) };
  await mtx("readwrite", s => s.put(m));
  if (SET.scriptUrl) script("saveFile", { name: `model-${m.id}.json`, mime: "application/json", data: b64utf8(JSON.stringify(m)), folder: "TITUS Modeller", replace: true }).catch(() => {});
  return m;
}
const modelDel = id => mtx("readwrite", s => s.delete(id));
async function modelsFromDrive() {
  if (!SET.scriptUrl) return 0;
  const r = await script("listFolder", { folder: "TITUS Modeller" }); let n = 0; const have = new Set((await modelList()).map(m => m.id));
  for (const f of r.files || []) { const id = (f.name.match(/^model-(.+)\.json$/) || [])[1]; if (!id || have.has(id)) continue; try { const g = await script("getFileB64", { id: f.id }); const m = JSON.parse(decodeURIComponent(escape(atob(g.data)))); await mtx("readwrite", s => s.put(m)); n++; } catch {} }
  return n;
}

/* ---------- 5) Stüdyo ekranı: Görsel / Montaj / Modeller ---------- */
let STUDIO_RES = null;
async function showResult(r, title) {
  STUDIO_RES = r;
  const s = await saveFile(await (await fetch(r.img)).blob(), fname(title || "gorsel", "jpg"), "pictures");
  const el = $("#smOut");
  if (el) el.innerHTML = `<img src="${r.img}" style="width:100%;border-radius:12px;margin-top:8px"><div class="hint">✓ ${esc(s.yer)} · motor: ${esc(r.motor)} · uyum: %${r.puan}${r.eksik && r.eksik.length ? " · eksik: " + esc(r.eksik.join(", ")) : ""}${r.notlar && r.notlar.length ? "<br>⚠️ " + esc(r.notlar.join(" ")) : ""}</div>`;
  return s;
}
{
  const base = listHTML;
  listHTML = function (sec) {
    if (sec === "image") return `<div class="card"><h3>GÖRSEL ÜRET</h3><div class="form"><textarea id="smTxt" placeholder="Ne istiyorsan ayrıntılı yaz: kim, nerede, ne giyiyor, ışık, açı… (ör. 'gece yağmurlu Kadıköy iskelesinde siyah paltolu bir adam, arkadan sokak lambası, sinematik')"></textarea>
      <div class="row"><select id="smRatio"><option value="">Oran: otomatik</option><option value="1:1">Kare</option><option value="9:16">Dikey 9:16</option><option value="4:5">Instagram 4:5</option><option value="16:9">Yatay 16:9</option></select><select id="smModel"><option value="">Model yok</option></select></div>
      <button class="btn" id="smGo">✨ Üret</button><div class="hint" id="smStat">Titus isteğini ayrıntılandırır, üretir, sonra görsele bakıp isteğinle karşılaştırır; eksik varsa düzeltip yeniden üretir.</div><div id="smOut"></div></div></div>`;
    if (sec === "photo") return `<div class="card"><h3>FOTOĞRAFIMI MONTAJLA</h3><div class="form"><button class="btn ghost" id="mjPick">📷 Fotoğraf seç (1-3)</button><div id="mjPrev" class="hint"></div><select id="mjModel"><option value="">…ya da kayıtlı model kullan</option></select>
      <textarea id="mjTxt" placeholder="Nerede, nasıl olsun? (ör. 'Paris'te Eyfel önünde, akşamüstü, bej trençkot giymiş, kameraya gülümsüyor')"></textarea><div class="row"><select id="mjRatio"><option value="">Oran: fotoğraf gibi</option><option value="4:5">4:5</option><option value="9:16">9:16</option><option value="1:1">Kare</option><option value="16:9">16:9</option></select></div>
      <button class="btn" id="mjGo">🪄 Montajla (yüz aynı kalsın)</button><div class="hint" id="smStat">Yüzün, elin, kolun değişmeden başka ortama yerleştirilir. Ücretsiz kimlik koruyan motor: Hugging Face (Ayarlar → Stüdyo'ya ücretsiz HF token ekle; günde birkaç montaj).</div><div id="smOut"></div></div></div>` + base(sec);
    if (sec === "models") return `<div class="card"><h3>MODELLERİM</h3><div class="hint" style="margin-top:0">Bir kişiyi (kendin, bir oyuncu, bir karakter) 1-3 net fotoğrafla kaydet; Titus sonra onu farklı ortamlarda, kıyafetlerde ve videolarda kullanır. Sohbette: fotoğrafları ekle → “bunu Burak adıyla model olarak kaydet”.</div>
      <div class="form" style="margin-top:8px"><input id="mdName" placeholder="Model adı (ör. Burak)"><input id="mdNote" placeholder="Not (isteğe bağlı: boy, sakal yok vb.)"><button class="btn" id="mdAdd">📷 Fotoğraf seç ve kaydet</button><button class="btn ghost sm" id="mdSync">☁️ Drive'dan modelleri getir</button></div><div id="mdList" style="margin-top:8px"><div class="empty">Yükleniyor…</div></div></div>`;
    return base(sec);
  };
}
async function fillModelSelects() {
  const ms = await modelList();
  for (const id of ["#smModel", "#mjModel"]) { const el = $(id); if (el) el.insertAdjacentHTML("beforeend", ms.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")); }
  const L = $("#mdList"); if (L) L.innerHTML = ms.map(m => `<div class="item"><img src="data:image/jpeg;base64,${m.imgs[0]}" style="width:54px;height:54px;object-fit:cover;border-radius:10px"><div class="t"><div class="h">${esc(m.name)}</div><div class="meta">${m.imgs.length} fotoğraf · ${esc(m.desc.slice(0, 90))}…</div></div><button class="x" data-mddel="${m.id}">✕</button></div>`).join("") || `<div class="empty">Kayıtlı model yok.</div>`;
}
{
  const baseR = renderSec;
  renderSec = function (g) { const r = baseR(g); if (g === "studio") setTimeout(fillModelSelects, 0); return r; };
}
let MJ_IMGS = [];
async function pickImgs(n = 3) {
  return new Promise(res => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true; inp.style.display = "none"; document.body.appendChild(inp);
    inp.onchange = async () => { const fs = [...(inp.files || [])].slice(0, n); inp.remove(); const out = []; for (const f of fs) { try { out.push(await shrinkImage(f, 1600)); } catch {} } res(out); }; inp.click(); });
}
const stat = s => { const e = $("#smStat"); if (e) e.textContent = "⏳ " + s; };
document.addEventListener("click", async e => {
  const t = e.target.closest("#smGo,#mjPick,#mjGo,#mdAdd,#mdSync,[data-mddel]"); if (!t) return;
  try {
    if (t.id === "smGo") { const istek = $("#smTxt").value.trim(); if (!istek) return toast("Ne istediğini yaz"); t.disabled = true; try { const r = await smartImage({ istek, oran: $("#smRatio").value, modelId: $("#smModel").value || null, onStep: stat }); stat("Bitti"); await showResult(r, istek); } finally { t.disabled = false; } }
    else if (t.id === "mjPick") { MJ_IMGS = await pickImgs(3); $("#mjPrev").innerHTML = MJ_IMGS.map(d => `<img src="data:image/jpeg;base64,${d}" style="height:60px;border-radius:8px;margin-right:4px">`).join(""); }
    else if (t.id === "mjGo") { const istek = $("#mjTxt").value.trim(); const mid = $("#mjModel").value; if (!istek) return toast("Nasıl bir ortam istediğini yaz"); if (!MJ_IMGS.length && !mid) return toast("Fotoğraf seç ya da model seç"); t.disabled = true; try { const r = await smartImage({ istek, oran: $("#mjRatio").value, refs: MJ_IMGS, modelId: mid || null, onStep: stat }); stat("Bitti"); await showResult(r, "montaj"); } finally { t.disabled = false; } }
    else if (t.id === "mdAdd") { const ad = $("#mdName").value.trim(); if (!ad) return toast("Model adı yaz"); const imgs = await pickImgs(3); if (!imgs.length) return; toast("Model inceleniyor…"); const m = await modelSave({ ad, imgs, not: $("#mdNote").value.trim() }); toast(`✓ ${m.name} kaydedildi`); renderSec("studio"); }
    else if (t.id === "mdSync") { const n = await modelsFromDrive(); toast(n ? `✓ ${n} model geldi` : "Yeni model yok"); renderSec("studio"); }
    else if (t.dataset.mddel) { await modelDel(t.dataset.mddel); renderSec("studio"); }
  } catch (er) { const m = er.message === "KIMLIK_YOK" ? "Yüzü koruyan ücretsiz motorlara şu an ulaşılamadı. Ayarlar → Stüdyo'ya ücretsiz Hugging Face token ekle ya da biraz sonra dene." : friendlyErr(er); const s = $("#smStat"); if (s) s.textContent = "✗ " + m; toast("✗ " + m, 6000); }
});

/* ---------- 6) araçlar ---------- */
const TOOL_IDX = n => TOOLS.findIndex(t => t.name === n);
{ const i = TOOL_IDX("gorsel_uret"); if (i >= 0) TOOLS.splice(i, 1); }
TOOLS.push(
  T("gorsel_uret", "İsteğe birebir uyan görsel üretir: isteği ayrıntılandırır, üretir, sonucu kontrol edip eksikse düzeltir; galeriye kaydeder. Kayıtlı bir model (kişi) kullanılabilir.", { istek: str("Kullanıcının isteği, TÜM ayrıntılarıyla ve kendi sözleriyle"), oran: str("Oran", ["1:1", "9:16", "4:5", "16:9"]), model: str("Kayıtlı model adı (varsa)") }, ["istek"],
    async a => { go("studio"); openSec("studio", "image"); const r = await smartImage({ istek: a.istek, oran: a.oran, modelId: a.model ? ((await modelGet(a.model)) || {}).id || a.model : null, onStep: stat }); const s = await showResult(r, a.istek); return { ok: true, yer: s.yer, uyum: r.puan, eksikler: r.eksik, motor: r.motor, not: r.notlar.join(" ") }; }),
  T("fotograf_montaj", "Burak'ın eklediği fotoğraftaki kişiyi (ya da kayıtlı modeli) yüzü, eli, kolu DEĞİŞMEDEN başka bir ortama/kıyafete/pozla yerleştirir, gerçekçi montaj yapar.", { istek: str("Yeni ortam/kıyafet/poz, kullanıcının sözleriyle"), model: str("Kayıtlı model adı (fotoğraf eklenmediyse)"), oran: str("Oran", ["4:5", "9:16", "1:1", "16:9"]) }, ["istek"],
    async a => { const m = a.model ? await modelGet(a.model) : null; if (!CUR_IMGS.length && !m) return { hata: "Önce 📎 ile fotoğrafını ekle ya da kayıtlı bir model adı söyle." }; go("studio"); openSec("studio", "photo"); const r = await smartImage({ istek: a.istek, oran: a.oran, refs: m ? [] : CUR_IMGS, modelId: m ? m.id : null, onStep: stat }); const s = await showResult(r, "montaj"); return { ok: true, yer: s.yer, uyum: r.puan, motor: r.motor, not: r.notlar.join(" ") }; }),
  T("model_kaydet", "Eklenen fotoğraflardaki kişiyi isimle model olarak hafızaya kaydeder (sonra görsel ve videolarda kullanılır).", { ad: str("Model adı"), not: str("Ek not") }, ["ad"],
    async a => { const m = await modelSave({ ad: a.ad, imgs: CUR_IMGS, not: a.not || "" }); return { ok: true, model: m.name, foto: m.imgs.length, tarif: m.desc.slice(0, 200) }; }),
  T("modeller", "Kayıtlı modelleri listeler.", {}, [], async () => ({ modeller: (await modelList()).map(m => m.name) })),
  T("konusan_video", "Gerçekçi konuşan karakter videosu üretir (dudak senkronlu). Kayıtlı model ya da eklenen fotoğraf kullanılır. Ağır iş olduğu için bilgisayardaki Titus yapar.", { metin: str("Karakterin söyleyeceği metin"), model: str("Kayıtlı model adı"), ortam: str("Ortam/kıyafet (isteğe bağlı)") }, ["metin"],
    async a => {
      if (!SET.scriptUrl) return { hata: "Bunun için bilgisayardaki Titus gerekli; önce Ayarlar → Bilgisayarı bağla." };
      const m = a.model ? await modelGet(a.model) : null;
      if (m) await script("saveFile", { name: `model-${m.id}.json`, mime: "application/json", data: b64utf8(JSON.stringify(m)), folder: "TITUS Modeller", replace: true });
      const { id } = await script("pcPush", { cmd: { action: "ask", arg: `konusan_video aracını kullan: model="${m ? m.name : ""}", ortam="${a.ortam || ""}", metin="${a.metin}". Bitince sonucu telefona gönder.` } });
      return { ok: true, not: "Bilgisayardaki Titus'a iletildi; video birkaç dakikada hazır olunca haber verecek (Videolar/Titus klasörü).", id };
    })
);
Object.assign(ACT_TR, { gorsel_uret: "🎨 görsel", fotograf_montaj: "🪄 montaj", model_kaydet: "🧍 model", modeller: "🧍 modeller", konusan_video: "🗣 konuşan video" });
TOOL_GROUPS.push(
  [/görsel|resim|çiz|afiş|poster|kapak|logo|illüstrasyon|fotoğraf|foto|montaj|ortam|mekân|yerleştir|arka ?plan/, ["gorsel_uret", "fotograf_montaj"]],
  [/model|kendim|yüz|kaydet|hafızana al|hatırla bu kişi/, ["model_kaydet", "modeller", "gorsel_uret", "fotograf_montaj"]],
  [/konuşan|konuşsun|dudak|avatar|söylesin/, ["konusan_video"]]
);
{
  const baseSys = systemPrompt;
  systemPrompt = function () {
    return baseSys() + `
GÖRSEL VE DOSYALAR: Burak dosya/fotoğraf eklediğinde (mesajında görsel/PDF varsa) önce onu dikkatle incele ve somut cevap ver; "göremiyorum" deme. Eklenen fotoğrafla "başka ortamda/kıyafetle yap" derse fotograf_montaj; "bunu model olarak kaydet/hafızana al" derse model_kaydet; "şunu çiz/üret" derse gorsel_uret kullan. İsteği araca KISALTMADAN, tüm ayrıntılarıyla ver. Konuşan karakter videosu istenirse konusan_video.` + (CUR_IMGS.length ? `\nŞU AN ${CUR_IMGS.length} fotoğraf ekli (montaj/model için hazır).` : "");
  };
}

/* ---------- 7) ayarlar: Hugging Face ---------- */
{
  const base = renderSettings;
  renderSettings = async function () {
    await base();
    const card = [...document.querySelectorAll("#b-set > .card")].find(c => /STÜDYO/.test((c.querySelector("h3") || {}).textContent || ""));
    const html = `<div class="lbl">Hugging Face token (ücretsiz — yüzü koruyan montaj için)</div><input data-set="hfToken" type="password" value="${esc(SET.hfToken || "")}" placeholder="hf_…"><div class="hint">huggingface.co → ücretsiz hesap → Settings → Access Tokens → New token (Read). Günde birkaç montaj/düzenleme hakkı verir.</div><div class="lbl">Özel HF düzenleme alanı (isteğe bağlı)</div><input data-set="hfSpace" value="${esc(SET.hfSpace || "")}" placeholder="ör. kullanici-flux-1-kontext-dev">`;
    if (card) { const f = card.querySelector(".form") || card; f.insertAdjacentHTML("beforeend", html); }
  };
}

/* =====================================================================
   v3.0 — BÜYÜK GÜNCELLEME: Faz 1–10 (364 yetenek) + çoklu Gmail
   Tüm yetenekler tek katalogda (skills.json): her biri ya davranış kuralı (mode),
   ya yapay zekâ görevi (ask), ya mevcut bir araç (tool), ya da özel bir fonksiyon (fn).
   ===================================================================== */
const APP_VER = "3.0", APP_RUN = "__RUN__";
const X = () => (S.x && typeof S.x === "object" ? S.x : (S.x = {}));
const XL = k => (Array.isArray(X()[k]) ? X()[k] : (X()[k] = []));
const deacc = s => trLower(s).replace(/[çğıöşüâîû]/g, c => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }[c]));
const toks = s => deacc(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length >= 3);
const fence = t => String(t || "").replace(/^\s*```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
const today = () => ymd(new Date());

/* ---------- katalog ---------- */
let SKILLS = [];
const SKILLS_READY = (async () => {
  try { const r = await fetch("skills.json"); SKILLS = await r.json(); } catch (e) { console.warn("skills.json", e); SKILLS = []; }
})();
const allSkills = () => [...SKILLS, ...XL("userSkills").map(u => ({ id: "u-" + u.id, faz: 99, n: u.n, k: "ask", w: !!u.w, f: false, d: false, no: false, on: false, durum: "tam", a: u.a, not: "Kendi eklediğin yetenek", user: true }))];
const modeOn = s => s.k === "mode" && ((SET.modes || {})[s.id] ?? s.on);
function skillScore(s, q) {
  const qt = toks(q); if (!qt.length) return 0;
  const nt = toks(s.n), at = toks(s.a);
  let sc = 0;
  for (const w of qt) {
    const p = w.slice(0, Math.min(5, w.length));
    if (nt.some(x => x.startsWith(p) || p.startsWith(x.slice(0, 5)))) sc += 3;
    else if (at.some(x => x.startsWith(p))) sc += 1;
  }
  if (deacc(s.n) === deacc(q)) sc += 20;
  return sc / Math.sqrt(qt.length + 1);
}
function findSkill(q) {
  const all = allSkills(); const nq = deacc(q || "");
  const exact = all.find(s => s.id === q || deacc(s.n) === nq); if (exact) return { s: exact, alts: [] };
  const sc = all.map(s => ({ s, v: skillScore(s, q) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  return { s: sc.length && sc[0].v >= 1.2 ? sc[0].s : null, alts: sc.slice(0, 5).map(x => x.s.n) };
}

/* ---------- eklenen dosyalar (yetenekler ekranı için) ---------- */
let SK_ATT = [];
function attParts() {
  const items = SK_ATT.length ? SK_ATT : pendingAttach.length ? pendingAttach : (CTX_ATT ? CTX_ATT.items : []);
  return items.map(a => ({ inlineData: { mimeType: a.mime, data: a.data } }));
}
async function pickAttach(accept) {
  const fs = await pickFiles(accept || "image/*,application/pdf,.pdf,.docx,.xlsx,.csv,.txt,.md,audio/*,video/*", true);
  const out = []; for (const f of fs.slice(0, 5)) { try { out.push(await fileToAttach(f)); } catch (e) { toast("✗ " + e.message, 4000); } }
  return out;
}
const camShot = () => new Promise(res => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.capture = "environment"; i.style.display = "none"; document.body.appendChild(i); i.onchange = async () => { const f = i.files && i.files[0]; i.remove(); if (!f) return res(null); try { res(await shrinkImage(f, 1600)); } catch { res(null); } }; i.click(); });

/* ---------- internet aramalı Gemini (kaynak linkleriyle) ---------- */
async function grounded(prompt, max = 1800) {
  if (!SET.geminiKey) throw new Error("NOKEY");
  const models = [SET.geminiModel, ...GEMINI_FALLBACK].filter((m, i, a) => m && a.indexOf(m) === i);
  let last;
  for (const m of models) {
    try {
      const gc = { temperature: 0.4, maxOutputTokens: max }; const th = thinkCfg(m, "low"); if (th) gc.thinkingConfig = th;
      const j = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(SET.geminiKey)}`, { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: gc });
      const c = j.candidates && j.candidates[0];
      const text = ((c && c.content && c.content.parts) || []).filter(p => p.text && !p.thought).map(p => p.text).join("").trim();
      const src = ((c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || []).filter(g => g.web).map(g => ({ title: g.web.title || "", uri: g.web.uri || "" }));
      return { text, src };
    } catch (e) { last = e; if (e.status === 400 && /thinking/i.test(e.message)) { NO_THINK.add(m); continue; } if ([404, 429, 400, 503, 500].includes(e.status)) continue; throw e; }
  }
  throw last || new Error("Arama yapılamadı");
}

/* ---------- metinden Word belgesi ---------- */
async function docFromText(title, text, extra = []) {
  await loadLib("lib/docx.js");
  const D = window.docx; const ch = [new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun({ text: title, bold: true })] })];
  for (const raw of String(text).split("\n")) {
    const l = raw.replace(/\*\*/g, "").trimEnd(); if (!l.trim()) continue;
    const h = l.match(/^(#{1,3})\s+(.*)/);
    if (h) ch.push(new D.Paragraph({ heading: h[1].length === 1 ? D.HeadingLevel.HEADING_1 : D.HeadingLevel.HEADING_2, children: [new D.TextRun(h[2])] }));
    else if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) ch.push(new D.Paragraph({ text: l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), bullet: { level: 0 } }));
    else ch.push(new D.Paragraph({ children: [new D.TextRun(l)], spacing: { after: 120 } }));
  }
  for (const e of extra) ch.push(new D.Paragraph({ children: [new D.TextRun({ text: e, size: 18 })] }));
  const doc = new D.Document({ creator: SET.name, title, sections: [{ children: ch }] });
  const blob = await D.Packer.toBlob(doc); const name = fname(title, "docx");
  const r = await saveFile(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), name);
  S.docs = [{ id: uid(), type: "rapor", title, name, at: localISO(new Date()) }, ...(S.docs || [])].slice(0, 40); save();
  return { dosya: name, yer: r.yer };
}

/* ---------- genel bağlam ---------- */
function userCtx() {
  const mem = (S.memory || []).slice(0, 25).map(m => m.text).join("; ");
  return `Kullanıcı: ${SET.name}. İstanbul'da yaşayan oyuncu; Recast Talent House casting ajansında çalışıyor; Kadıköy'de barda gece vardiyaları var; kendi uygulama ve oyunlarını geliştiriyor. Şu an: ${DAYS[new Date().getDay()]} ${localISO(new Date())}.${mem ? "\nBildiklerin: " + mem : ""}`;
}

/* ---------- yetenek çalıştırıcı ---------- */
const FN = {};
async function askSkill(s, girdi, opt = {}) {
  const prompt = `GÖREV — ${s.n}: ${s.a}\n\n${userCtx()}\n\nKULLANICININ İSTEĞİ / GİRDİSİ: ${girdi || "(ek girdi yok; görevi kullanıcıya göre genel olarak uygula)"}\n\nTürkçe yaz (görev başka dil istemiyorsa). Ekranda okunacak; gerekirse kısa başlıklar ve maddeler kullan. Bilmediğin bilgiyi uydurma. Telifli metinleri (şarkı sözü, oyun metni) uzun alıntılama.`;
  const parts = s.f || opt.files ? attParts() : [];
  let text, src = [];
  if (s.w && !parts.length) { const g = await grounded(prompt, 3000); text = g.text; src = g.src; }
  else text = await plainGemini(prompt, parts, s.w ? [{ google_search: {} }] : null, { max: 3500, temperature: 0.6 });
  const out = { metin: text };
  if (src.length) out.kaynaklar = src.slice(0, 8);
  if (s.d) { try { const d = await docFromText(s.n + (girdi ? " — " + girdi.slice(0, 40) : ""), text, src.map((x, i) => `[${i + 1}] ${x.title} ${x.uri}`)); out.belge = d.dosya; out.yer = d.yer; } catch (e) { out.belge_hata = e.message; } }
  if (s.no) { A.addNote({ text: `${s.n}: ${text.slice(0, 1500)}`, project: "Titus" }); out.not = "Not olarak kaydedildi"; }
  return out;
}
async function runSkill(s, girdi = "", ctx = {}) {
  girdi = String(girdi || "").trim();
  logUse("yetenek:" + s.n);
  if (s.k === "mode") {
    const l = trLower(girdi); const off = /kapat|kapa\b|iptal|istemiyorum|durdur|pasif/.test(l); const tog = /değiştir|tersine|toggle/.test(l); const on = tog ? !modeOn(s) : !off;
    SET.modes = { ...(SET.modes || {}), [s.id]: on }; saveSet();
    return { ok: true, mod: s.n, durum: on ? "açık" : "kapalı", kural: s.a };
  }
  if (s.k.startsWith("tool:")) {
    const [, tool, arg] = s.k.split(":");
    const t = TOOLS.find(t => t.name === tool); if (!t) return askSkill(s, girdi);
    const imgs = (SK_ATT.length ? SK_ATT : pendingAttach).filter(a => a.kind === "image"); if (imgs.length) CUR_IMGS = imgs.map(a => a.data);
    const args = {}; const first = arg || t.required[0] || Object.keys(t.props)[0]; if (first) args[first] = girdi || s.a;
    if (tool === "koc_baslat") args.tur = "partner";
    return runTool(tool, args);
  }
  if (s.k.startsWith("fn:")) {
    const h = FN[s.k.slice(3)];
    if (!h) return askSkill(s, girdi);
    if (!h.run) { if (ctx.fromChat) { go("skills"); showSkill(s.id); return { ok: true, not: s.n + " ekranı açıldı; ayarı oradan yapabilir." }; } return { ok: true }; }
    let r = await h.run(girdi, s, ctx);
    if (typeof r === "string") r = { metin: r };
    if (r && r.talimat && !ctx.fromChat) { go("home"); await send(r.talimat, false, null, "🧠 " + s.n + (girdi ? ": " + girdi : "")); return { ok: true, metin: "Sohbette yürütüldü." }; }
    return r;
  }
  return askSkill(s, girdi);
}

/* ---------- kullanım günlüğü (alışkanlık öğrenme, hız) ---------- */
function logUse(k) { try { const d = new Date(); META.use = [...(META.use || []), { k, h: d.getHours(), g: d.getDay(), t: Date.now() }].slice(-400); saveMeta(); } catch {} }

/* ---------- sohbetten yetenek kullanımı ---------- */
let LAST_USER = "";
TOOLS.push(
  T("yetenek_calistir", "Titus'un 360+ yeteneğinden birini çalıştırır (ör. 'Derin araştırma modu', 'Monolog kütüphanesi', 'Dolandırıcılık dedektörü', 'Uygulama fabrikası', 'Hesap, tablo ve grafik çalışma alanı', 'Ev arama ajanı'...). Sistem mesajındaki İLGİLİ YETENEKLER listesine bak. Davranış modlarını açıp kapatmak için de kullanılır.", { ad: str("Yeteneğin adı (yaklaşık olabilir)"), girdi: str("Yeteneğe verilecek istek/ayrıntılar, kullanıcının sözleriyle") }, ["ad"],
    async a => { await SKILLS_READY; const f = findSkill(a.ad); if (!f.s) return { hata: "Bu adla yetenek bulamadım", benzerler: f.alts }; const r = await runSkill(f.s, a.girdi || "", { fromChat: true }); return { yetenek: f.s.n, ...(r || {}) }; }),
  T("yetenek_ara", "Titus'un yeteneklerinde arar (hangi yetenekler var, hangisi işe yarar).", { arama: str("Ne aranıyor") }, ["arama"],
    async a => { await SKILLS_READY; return { yetenekler: allSkills().map(s => ({ s, v: skillScore(s, a.arama) })).filter(x => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 8).map(x => `${x.s.n} (Faz ${x.s.faz}, ${x.s.durum}): ${x.s.a}`) }; }),
  T("yetenekleri_ac", "Yetenekler ekranını açar (istenirse belirli bir yetenekte).", { ad: str("Yetenek adı (ops.)") }, [],
    async a => { await SKILLS_READY; go("skills"); if (a.ad) { const f = findSkill(a.ad); if (f.s) showSkill(f.s.id); } return { ok: true }; })
);
TOOL_CORE.push("yetenek_calistir", "yetenek_ara");
Object.assign(ACT_TR, { yetenek_calistir: "🧠 yetenek", yetenek_ara: "🔎 yetenekler", yetenekleri_ac: "🧠 yetenekler" });
{
  const basePick = pickTools;
  pickTools = function (history) { const h = history.filter(m => m.role === "user").slice(-1)[0]; LAST_USER = h ? h.content : ""; return basePick(history); };
}

/* ---------- sistem mesajına: açık modlar, kişiselleştirme, ilgili yetenekler ---------- */
{
  const baseSys = systemPrompt;
  systemPrompt = function () {
    if (SET.guest) return guestPrompt();
    let s = baseSys();
    const modes = allSkills().filter(modeOn);
    if (modes.length) s += "\n\nDAVRANIŞ KURALLARIN (her cevapta uygula):\n" + modes.map(m => "- " + m.a).join("\n");
    const P = SET.pers || {};
    if (P.ciddiyet || P.espri || P.uzunluk) s += `\nKİŞİLİK AYARI: ciddiyet ${P.ciddiyet ?? 5}/10, espri ${P.espri ?? 5}/10, cevap uzunluğu ${["çok kısa", "kısa", "orta", "uzun"][P.uzunluk ?? 1]}.`;
    if (SET.hitap) s += `\nHİTAP: Kullanıcıya "${SET.hitap}" diye hitap et.`;
    if (SET.nightMode || nightNow()) s += "\nGECE MODU: Fısıltı gibi sakin, çok kısa cevap ver.";
    const vals = XL("values"), donts = XL("donts"), gl = XL("glossary"), ints = XL("interests");
    if (vals.length) s += "\nÖNCELİKLERİ VE BAŞARI ÖLÇÜTLERİ: " + vals.map(v => v.metin || v.deger || JSON.stringify(v)).join("; ");
    if (donts.length) s += "\nKESİNLİKLE YAPMA: " + donts.map(v => v.metin || JSON.stringify(v)).join("; ");
    if (gl.length) s += "\nKİŞİSEL SÖZLÜK: " + gl.map(g => `${g.terim}: ${g.anlam}`).join("; ");
    if (ints.length) s += "\nİLGİ ALANLARI: " + ints.map(g => g.alan || g.metin).join(", ");
    if (SET.styleProfile) s += "\nBURAK ADINA YAZARKEN (mail, mesaj, gönderi) ŞU YAZIM TARZINI KULLAN: " + SET.styleProfile;
    const asst = XL("assistants").find(a => a.id === SET.activeAsst);
    if (asst) s += `\n\nÖZEL ASİSTAN MODU — "${asst.name}": ${asst.prompt}`;
    const pm = XL("projectmem"); const lu = deacc(LAST_USER);
    const hit = pm.filter(p => p.proje && lu.includes(deacc(p.proje).split(" ")[0]));
    if (hit.length) s += "\nPROJE HAFIZASI: " + hit.map(p => `${p.proje}: ${p.bilgi}`).join(" | ");
    const bad = XL("fb").filter(f => f.v < 0).slice(-3);
    if (bad.length) s += "\nBEĞENİLMEYEN CEVAPLARIN (bunlara benzeme): " + bad.map(b => b.t.slice(0, 120)).join(" | ");
    if (LAST_USER && SKILLS.length) {
      const top = allSkills().filter(x => x.k !== "mode").map(x => ({ x, v: skillScore(x, LAST_USER) })).filter(o => o.v >= 1.5).sort((a, b) => b.v - a.v).slice(0, 5);
      if (top.length) s += "\nİLGİLİ YETENEKLER (gerekirse yetenek_calistir ile kullan): " + top.map(o => `${o.x.n} — ${o.x.a.slice(0, 90)}`).join(" | ");
    }
    s += "\nYETENEK SİSTEMİ: 360'tan fazla yeteneğin var (araştırma, belge, çeviri, koçluk, oyun, finans, oyunculuk...). Kullanıcı bir yeteneğin adını söylerse ya da istek bir yeteneğe uyuyorsa yetenek_calistir kullan; emin değilsen yetenek_ara.";
    return s;
  };
}
function guestPrompt() {
  return `Sen Titus'sun, kibar ve yardımsever bir asistansın. MİSAFİR MODU AÇIK: Şu an telefonu sahibi değil bir misafir kullanıyor. Sahibinin kişisel bilgilerini (hafıza, takvim, mail, notlar, kişiler, finans, konum) ASLA paylaşma, bu bilgilere erişen araçları kullanma. Genel sorulara, hava durumuna, internette aramaya, hesap ve zamanlayıcıya yardım edebilirsin. Türkçe ve kısa konuş. Şu an: ${localISO(new Date())}.`;
}
const nightNow = () => SET.nightAuto && (new Date().getHours() >= 23 || new Date().getHours() < 6);
{
  const basePick2 = pickTools;
  pickTools = function (history) {
    let l = basePick2(history);
    if (SET.guest) l = l.filter(t => ["hava_durumu", "internette_ara", "zamanlayici_kur", "alarm_kur", "yetenek_ara"].includes(t.name));
    const off = new Set(SET.toolOff || []); return l.filter(t => !off.has(t.name));
  };
}

/* ---------- araç güvenliği: izinler, sesli parola, geri alma, eylem günlüğü ---------- */
const CRITICAL = new Set(["mail_taslagi", "whatsapp_mesaj", "sms_hazirla", "ara", "ekranda_dokun", "ekrana_yaz", "bilgisayar", "bilgisayara_soyle", "audition_duzenle", "audition_ekle", "recast_teklif_maili", "akilli_ev"]);
const READONLY = /^(takvim_listele|mail_ozeti|hava_durumu|internette_ara|bildirimleri_oku|kadro_sorgula|radar_kontrol|ekrani_gor|bilgi_ara|yetenek_ara|yol_suresi|harcama_ozeti|modeller|audition_oku|audition_yapi)$/;
let UNDO = [];
{
  const baseRun = runTool;
  runTool = async function (name, args) {
    if ((SET.toolOff || []).includes(name)) return { hata: "Bu araç İzin sistemi'nden kapatılmış (Yetenekler → İzin sistemi)." };
    if (SET.passphrase && CRITICAL.has(name)) {
      const p = await prompt2("Sesli parola / ikinci onay: parolanı yaz (" + (ACT_TR[name] || name) + ")");
      if (!p || trLower(p.trim()) !== trLower(SET.passphrase.trim())) return { ok: false, iptal: true, not: "Parola doğrulanmadı; işlem yapılmadı." };
    }
    const mut = !READONLY.test(name) && name !== "yetenek_calistir";
    if (mut) { UNDO.push({ at: Date.now(), name, snap: JSON.stringify(S) }); UNDO = UNDO.slice(-6); }
    const t0 = Date.now(); const res = await baseRun(name, args);
    try { const L = XL("actlog"); L.unshift({ at: localISO(new Date()), name, args: JSON.stringify(args || {}).slice(0, 160), ok: !(res && (res.hata || res.iptal)), ms: Date.now() - t0 }); X().actlog = L.slice(0, 150); } catch {}
    if (res && res.hata) { try { logIssue("araç", `${name}: ${res.hata}`); } catch {} }
    return res;
  };
}
function undoLast() {
  const u = UNDO.pop(); if (!u) return { hata: "Geri alınacak işlem yok." };
  const keepLog = X().actlog; S = Object.assign(EMPTY(), JSON.parse(u.snap)); X().actlog = keepLog; save();
  const ext = /mail|whatsapp|sms|ara$|bilgisayar|audition|recast|akilli/.test(u.name);
  return { ok: true, geri_alindi: ACT_TR[u.name] || u.name, not: ext ? "Titus içindeki kayıt geri alındı; ama dışarıda yapılan iş (taslak, mesaj ekranı, tablo) varsa onu elle kontrol et." : "Geri alındı." };
}
TOOLS.push(T("geri_al", "Titus'un yaptığı son işlemi geri alır (hatırlatıcı, görev, not, harcama vb.).", {}, [], () => undoLast()));
Object.assign(ACT_TR, { geri_al: "↩️ geri al" });
TOOL_GROUPS.push([/geri al|iptal et|vazgeç|yanlış oldu|sil onu/, ["geri_al"]]);

/* ---------- ağ: veri maskeleme + kota sayacı ---------- */
const MASKS = [[/\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi, "[IBAN]"], [/\b(?:\d[ -]?){15}\d\b/g, "[KART]"], [/\b[1-9]\d{10}\b/g, "[TCKN]"]];
const maskText = t => MASKS.reduce((s, [r, v]) => s.replace(r, v), String(t));
{
  const baseHttp = httpJson;
  httpJson = async function (url, body, headers) {
    if (/generativelanguage\.googleapis/.test(url)) {
      const k = today(); META.q = META.q && META.q.d === k ? META.q : { d: k, n: 0, err: 0 }; META.q.n++; saveMeta();
      if (SET.mask !== false && body && body.contents) {
        for (const c of body.contents) for (const p of c.parts || []) if (typeof p.text === "string") p.text = maskText(p.text);
      }
      try { return await baseHttp(url, body, headers); } catch (e) { if (e.status === 429) { META.q.err++; saveMeta(); } throw e; }
    }
    return baseHttp(url, body, headers);
  };
}

/* ---------- akıllı önbellek: aynı soruya hızlı cevap ---------- */
const GCACHE = new Map();
{
  const basePG = plainGemini;
  plainGemini = async function (prompt, parts = [], tools = null, opt = {}) {
    const cacheable = SET.cache !== false && (!parts || !parts.length) && String(prompt).length < 4000 && !opt.nocache;
    const key = cacheable ? JSON.stringify([prompt, tools, opt.json, opt.model]) : null;
    if (key && GCACHE.has(key)) { const c = GCACHE.get(key); if (Date.now() - c.t < (tools ? 30 : 10) * 6e4) return c.v; GCACHE.delete(key); }
    const v = await basePG(prompt, parts, tools, opt);
    if (key && v) { GCACHE.set(key, { t: Date.now(), v }); if (GCACHE.size > 60) GCACHE.delete(GCACHE.keys().next().value); }
    return v;
  };
}

/* ---------- internete göre mod: zayıf bağlantıda hafif model ---------- */
const slowNet = () => { const c = navigator.connection; return SET.netMode === "hafif" || (SET.netMode !== "normal" && c && /(^|-)2g|3g/.test(c.effectiveType || "")) || batSave(); };
{
  const baseAsk = askGemini;
  askGemini = async function (history, onAct, attach) {
    if (!slowNet()) return baseAsk(history, onAct, attach);
    const m = SET.geminiModel, sp = SET.speed; SET.geminiModel = "gemini-3.5-flash-lite"; SET.speed = "hizli";
    try { return await baseAsk(history, onAct, attach); } finally { if (SET.geminiModel === "gemini-3.5-flash-lite") SET.geminiModel = m; SET.speed = sp; }
  };
}

/* ---------- pil dostu mod ---------- */
let BAT = { level: 1, charging: true };
try { navigator.getBattery && navigator.getBattery().then(b => { const u = () => { BAT = { level: b.level, charging: b.charging }; }; u(); b.onlevelchange = u; b.onchargingchange = u; }); } catch {}
const batSave = () => SET.battery === "acik" || (SET.battery !== "kapali" && !BAT.charging && BAT.level < 0.2);
let PULL_N = 0;
{
  const baseScript = script;
  script = async function (action, data = {}) {
    if (action === "phPull" && batSave() && (PULL_N++ % 4)) return { ok: true, cmds: [] };
    const r = await baseScript(action, data);
    if (action === "phPull" && r && Array.isArray(r.cmds)) {
      const ring = r.cmds.filter(c => c.kind === "ring"); r.cmds = r.cmds.filter(c => c.kind !== "ring");
      if (ring.length) ringPhone();
    }
    return r;
  };
}
function ringPhone() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)(); const g = ac.createGain(); g.gain.value = 0.9; g.connect(ac.destination);
    for (let i = 0; i < 24; i++) { const o = ac.createOscillator(); o.type = "square"; o.frequency.value = i % 2 ? 880 : 1320; o.connect(g); o.start(ac.currentTime + i * 0.5); o.stop(ac.currentTime + i * 0.5 + 0.35); }
    setTimeout(() => ac.close(), 13000);
  } catch {}
  try { navigator.vibrate && navigator.vibrate([600, 300, 600, 300, 600, 300, 600]); } catch {}
  toast("📱 Bilgisayardan telefon çaldırıldı — buradayım!", 8000);
}

/* ---------- telaffuz sözlüğü (konuşurken) ---------- */
{
  const baseSpeak = speak;
  speak = function (text, force) {
    let t = String(text || "");
    for (const p of XL("pronounce").filter(p => p.tur !== "duzelt" && p.yazi && p.okunus)) t = t.replace(new RegExp(p.yazi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), p.okunus);
    if (SET.hitap) t = t.replace(/\befendim\b/g, SET.hitap);
    return baseSpeak(t, force);
  };
}

/* ---------- sohbet katmanı: dinleme modu, sesli menü, internetsiz kuyruk, düzeltmeler, geçmiş, hız ---------- */
const LISTEN = { on: false, buf: [] };
const VOICE_NAV = [[/^(ayarlar(ı)? aç|ayarlara git)$/, "set"], [/^(plan(a|'a)? git|planı aç)$/, "plan"], [/^(hayat(a|'a)? git|hayatı aç)$/, "life"], [/^(kariyer(e|'e)? git|kariyeri aç)$/, "work"], [/^(stüdyo(ya|'ya)? git|stüdyoyu aç)$/, "studio"], [/^(yetenekler(i)? aç|yeteneklere git)$/, "skills"], [/^(ana ?sayfa(ya)? (git|dön)|sohbete dön)$/, "home"]];
{
  const baseSend = send;
  send = async function (text, byVoice = false, attach = null, label = null) {
    let t = String(text || "").trim(); if (!t) return;
    if (byVoice) for (const p of XL("pronounce").filter(p => p.tur === "duzelt" && p.yazi && p.okunus)) t = t.replace(new RegExp("\\b" + p.yazi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), p.okunus);
    const low = trLower(t).replace(/[.!?]+$/, "");
    for (const [rx, v] of VOICE_NAV) if (rx.test(low)) { go(v); if (v === "skills") renderSkills(); toast("→ " + v); return; }
    if (/^geri al$/.test(low)) { const r = undoLast(); bubble("assistant", r.hata || ("↩️ " + r.geri_alindi + " geri alındı. " + (r.not || ""))); return; }
    if (LISTEN.on && !t.startsWith("__")) {
      if (/^(bitti|tamam bu kadar|özetle|dinlemeyi bitir)$/.test(low)) { LISTEN.on = false; const all = LISTEN.buf.join("\n"); LISTEN.buf = []; return baseSend(`Ben konuşurken araya girmeden dinledin. Şimdi söylediklerimin hepsini özetle: ana fikirler, kararlar, yapılacaklar. Yapılacakları istersem eklemek için sor.\n\nSÖYLEDİKLERİM:\n${all}`, byVoice, null, "👂 Dinleme özeti"); }
      LISTEN.buf.push(t); bubble("user", t); bubble("sys", "👂 dinliyorum… (bitince 'bitti' de)"); return;
    }
    if (!navigator.onLine && !attach && !t.startsWith("__")) {
      let q = null; try { q = await quickCommand(t); } catch {}
      if (!q) { META.offq = [...(META.offq || []), { t, at: Date.now() }].slice(-30); saveMeta(); bubble("user", t); bubble("assistant", "İnternet yok; bunu sıraya aldım, bağlantı gelince hemen yapacağım."); return; }
    }
    if (!t.startsWith("__")) { META.hist = [t, ...(META.hist || []).filter(x => x !== t)].slice(0, 80); saveMeta(); logUse("sohbet"); }
    const t0 = Date.now(); let ok = true;
    try { return await baseSend(t, byVoice, attach, label); }
    catch (e) { ok = false; throw e; }
    finally {
      try { META.perf = [...(META.perf || []), { at: Date.now(), ms: Date.now() - t0, ok, q: t.slice(0, 50) }].slice(-200); saveMeta(); } catch {}
      if (SET.liveNotes) liveNoteTick();
    }
  };
}
window.addEventListener("online", async () => {
  const q = META.offq || []; if (!q.length) return; META.offq = []; saveMeta();
  bubble("sys", `🌐 Bağlantı geldi; sıradaki ${q.length} işi yapıyorum`);
  for (const x of q) { while (busy) await sleep(800); try { await send(x.t); } catch {} }
});
let LN_N = 0;
async function liveNoteTick() {
  if (++LN_N % 6) return;
  try { const conv = CHAT.slice(-12).map(m => (m.role === "user" ? "Burak: " : "Titus: ") + m.content).join("\n"); const t = await plainGemini("Bu konuşmadan kalıcı olarak not edilmeye değer önemli noktaları (karar, tarih, isim, yapılacak) en fazla 4 kısa madde olarak çıkar. Önemli bir şey yoksa sadece YOK yaz.\n\n" + conv, [], null, { max: 300, temperature: 0.2, nocache: true }); if (t && !/^\s*YOK/i.test(t)) A.addNote({ text: "🗒 Sohbet notu: " + t, project: "Sohbet notları" }); } catch {}
}

/* ---------- beğen / beğenme ---------- */
{
  const baseBubble = bubble;
  bubble = function (role, text) {
    const s = baseBubble(role, text);
    if (role === "assistant" && SET.feedback !== false && text && text.length > 20) {
      const box = document.createElement("span"); box.className = "fbk"; box.innerHTML = `<button data-fb="1">👍</button><button data-fb="-1">👎</button>`;
      box.dataset.t = String(text).slice(0, 300); s.parentElement.appendChild(box);
    }
    return s;
  };
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-fb]"); if (!b) return;
  const box = b.parentElement; const v = +b.dataset.fb; XL("fb").push({ at: localISO(new Date()), v, t: box.dataset.t }); X().fb = XL("fb").slice(-80); save();
  if (v < 0) { try { logIssue("beğenilmedi", box.dataset.t.slice(0, 120)); } catch {} }
  box.innerHTML = v > 0 ? "👍 teşekkürler" : "👎 not ettim, düzelteceğim"; box.classList.add("done");
});

/* ---------- genel kayıt listeleri (Gemini ile doğal dilde yönetilir) ---------- */
const COLS = {
  books: ["Kitaplar", "ad, yazar, durum (okunacak/okunuyor/bitti), kaldigi_yer, ozet"],
  items: ["Eşyalar", "esya, yer"],
  subs: ["Abonelikler", "ad, tutar, yenilenme (YYYY-MM-DD), periyot (aylık/yıllık)"],
  payments: ["Alınacak ödemeler", "kimden, tutar, is, son_tarih (YYYY-MM-DD), durum (bekliyor/alındı)"],
  watchlist: ["İzleme/okuma listesi", "ad, tur (film/dizi/kitap), durum (izlenecek/izlendi), puan, not"],
  ideas: ["Fikir defteri", "fikir, kategori, oncelik (1-5)"],
  journal: ["Günlük", "tarih, tur (oyunculuk/genel), metin"],
  lesson: ["Günün dersleri", "tarih, ders"],
  glossary: ["Kişisel sözlük", "terim, anlam"],
  pronounce: ["Telaffuz ve düzeltme listesi", "yazi, okunus, tur (okunus=Titus böyle okusun / duzelt=yanlış duyulan kelime yazi, doğrusu okunus)"],
  donts: ["Yapma listesi", "metin"],
  values: ["Öncelikler ve başarı ölçütleri", "metin"],
  interests: ["İlgi alanları", "alan"],
  appointments: ["Düzenli randevular", "ne, tarih (YYYY-MM-DDTHH:mm), tekrar (none/weekly/monthly)"],
  chores: ["Ev işleri", "is, gun (Pazartesi..Pazar), sorumlu"],
  countdown: ["Geri sayımlar", "ne, tarih (YYYY-MM-DD)"],
  split: ["Borç–alacak", "kisi, tutar (pozitif=bana borçlu, negatif=ben borçluyum), aciklama, tarih"],
  savings: ["Birikim hedefleri", "hedef, tutar, biriken, son_tarih, meydan_okuma"],
  vault: ["Belge kasası", "belge, tur (garanti/sözleşme/fiş/fatura), tarih, bitis (YYYY-MM-DD), dosya, not — KİMLİK/KART NUMARASI SAKLAMA"],
  tax: ["Vergi ve beyan hatırlatmaları", "ne, tarih (YYYY-MM-DD), not"],
  premium: ["Prim günleri", "ne, gun (ayın günü), not"],
  teamtasks: ["Ekip görevleri", "kisi, is, son_tarih, durum (açık/bitti)"],
  briefarchive: ["Brief arşivi", "proje, musteri, tarih, rol_tipleri, ozet"],
  decisions: ["Kararlar", "karar, secenekler, gerekce, tarih, sonuc (sonradan)"],
  crm: ["Kişi kartları", "ad, iliski (müşteri/arkadaş/aile/iş), son_konusma, notlar, takip (YYYY-MM-DD)"],
  projectmem: ["Proje hafızası", "proje, bilgi"],
  voices: ["Karakter ses bankası", "karakter, ses (Charon/Kore/Puck/Fenrir/Aoede/Leda/Orus/Zephyr), not"],
  reels: ["Showreel listesi", "sahne, proje, tarih, eklendi (evet/hayır)"],
  appts: ["Randevular", "ne, tarih"]
};
async function colRun(key, g, opt = {}) {
  const [title, fields] = COLS[key]; const L = XL(key);
  if (!g) return { liste: title, kayitlar: L.slice(0, 40) };
  const j = await geminiJSON(`"${title}" listesini yönetiyorsun. Alanlar: ${fields}.\nMevcut kayıtlar: ${JSON.stringify(L.slice(0, 80))}\nŞu an: ${localISO(new Date())}.\nKullanıcı dedi ki: "${g}"\nNe yapılmalı? JSON: {"islem":"ekle|guncelle|sil|cevap","kayit":{alanlar},"id":"guncelle/sil için kaydın id'si","cevap":"kullanıcıya kısa Türkçe cevap (listeden soru sorduysa cevabı burada ver)","hatirlat":"YYYY-MM-DDTHH:mm ya da boş","hatirlat_metin":"","tekrar":"none|daily|weekly|monthly"}`);
  let rec = null;
  if (j.islem === "ekle" && j.kayit) { rec = { id: uid(), ...j.kayit, at: localISO(new Date()) }; L.unshift(rec); }
  else if (j.islem === "guncelle") { rec = L.find(x => x.id === j.id); if (rec) Object.assign(rec, j.kayit || {}); }
  else if (j.islem === "sil") { const i = L.findIndex(x => x.id === j.id); if (i >= 0) L.splice(i, 1); }
  if (j.hatirlat && parseDate(j.hatirlat)) A.addReminder({ text: j.hatirlat_metin || `${title}: ${g}`, due: j.hatirlat.length === 10 ? j.hatirlat + "T10:00" : j.hatirlat, repeat: REP[j.tekrar] !== undefined ? j.tekrar : "none" });
  X()[key] = L.slice(0, 300); save();
  if (opt.after && rec) await opt.after(rec);
  return { ok: true, islem: j.islem, cevap: j.cevap || "Tamam.", kayit: rec || undefined };
}
const recLine = r => Object.entries(r).filter(([k]) => !["id", "at"].includes(k)).map(([k, v]) => `<b>${esc(k)}</b>: ${esc(typeof v === "object" ? JSON.stringify(v) : v)}`).join(" · ");
function colUI(key) {
  const [title] = COLS[key]; const L = XL(key);
  let extra = "";
  if (key === "split") { const by = {}; L.forEach(r => { by[r.kisi] = (by[r.kisi] || 0) + (Number(r.tutar) || 0); }); extra = Object.entries(by).map(([k, v]) => `<div class="hint">${esc(k)}: ${v >= 0 ? "sana " + money(v) + " borçlu" : "sen " + money(-v) + " borçlusun"}</div>`).join(""); }
  if (key === "countdown") extra = L.map(r => { const d = Math.ceil((parseDate(r.tarih) - new Date()) / 864e5); return `<div class="hint">⏳ ${esc(r.ne)}: ${isNaN(d) ? "?" : d >= 0 ? d + " gün kaldı" : "geçti"}</div>`; }).join("");
  if (key === "savings") extra = L.map(r => { const p = Math.min(100, Math.round((Number(r.biriken) || 0) / (Number(r.tutar) || 1) * 100)); return `<div class="hint">💰 ${esc(r.hedef)}: %${p}</div>`; }).join("");
  return `${extra}<div class="sklist">${L.length ? L.slice(0, 60).map(r => `<div class="item"><div class="t"><div class="meta" style="color:var(--fg)">${recLine(r)}</div></div><button class="x" data-coldel="${key}:${r.id}">✕</button></div>`).join("") : `<div class="empty">${esc(title)}: henüz kayıt yok. Aşağıya yaz ya da Titus'a söyle.</div>`}</div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-coldel]"); if (!b) return;
  const [k, id] = b.dataset.coldel.split(":"); X()[k] = XL(k).filter(r => r.id !== id); save(); refreshSkill();
});
const colFn = (key, opt) => ({ ui: () => colUI(key), run: g => colRun(key, g, opt), input: "Ekle, güncelle ya da sor (ör. doğal dille)" });
Object.assign(FN, {
  books: colFn("books"), items: colFn("items"), subs: colFn("subs"), payments: colFn("payments"), watchlist: colFn("watchlist"), ideas: colFn("ideas"),
  journal: colFn("journal"), glossary: colFn("glossary"), pronounce: colFn("pronounce"), donts: colFn("donts"), values: colFn("values"),
  appointments: colFn("appointments"), chores: colFn("chores"), countdown: colFn("countdown"), split: colFn("split"), savings: colFn("savings"),
  tax: colFn("tax"), premium: colFn("premium"), teamtasks: colFn("teamtasks"), briefarchive: colFn("briefarchive"), crm: colFn("crm"), projectmem: colFn("projectmem"), voices: colFn("voices")
});
FN.lesson = { ...colFn("lesson"), run: async g => { if (!META.lessonRem) { A.addReminder({ text: "📘 Günün dersi ne oldu? Titus'a söyle.", due: today() + "T22:30", repeat: "daily" }); META.lessonRem = 1; saveMeta(); } return colRun("lesson", g); } };
FN.decision = { ...colFn("decisions"), run: async g => {
  if (!g) return colRun("decisions", "");
  const an = await plainGemini(`Karar asistanısın. ${userCtx()}\nKarar: ${g}\nSeçenekleri karşılaştır: artılar/eksiler tablosu (metin olarak), riskler, kullanıcının hedeflerine uygunluk, net bir öneri ve neden. Kısa ve net.`, [], null, { max: 1600 });
  const r = await colRun("decisions", "ekle: karar=" + g.slice(0, 120) + "; gerekce=" + an.slice(0, 300));
  A.addReminder({ text: "🧭 Karar takibi: \"" + g.slice(0, 60) + "\" nasıl sonuçlandı?", due: ymd(new Date(Date.now() + 30 * 864e5)) + "T19:00" });
  return { metin: an, kayit: r.cevap, not: "30 gün sonra sonucunu soracağım." };
} };
FN.vault = { ...colFn("vault"), input: "Belge hakkında yaz ya da 📎 fotoğraf ekle (kimlik/kart numarası saklanmaz)", run: async (g, s) => {
  const parts = attParts();
  if (parts.length) {
    const j = await geminiJSON(`Bu bir belge/fiş/fatura/garanti fotoğrafı. Bilgileri çıkar. KİMLİK, KART, HESAP NUMARALARINI ASLA YAZMA. JSON: {"belge":"","tur":"garanti|sözleşme|fiş|fatura|diğer","tarih":"YYYY-MM-DD","bitis":"YYYY-MM-DD ya da boş","tutar":"","not":""}`, parts);
    let dosya = ""; try { const a = SK_ATT[0] || (CTX_ATT && CTX_ATT.items[0]); if (a && a.kind === "image") { const r = await saveFile(await (await fetch("data:image/jpeg;base64," + a.data)).blob(), fname("belge-" + (j.belge || "kasa"), "jpg"), "pictures"); dosya = r.yer; } } catch {}
    const rec = { id: uid(), ...j, dosya, at: localISO(new Date()) }; XL("vault").unshift(rec); save();
    if (j.bitis && parseDate(j.bitis)) A.addReminder({ text: `📁 ${j.belge} bitiyor (${j.bitis})`, due: ymd(new Date(parseDate(j.bitis) - 14 * 864e5)) + "T10:00" });
    return { ok: true, kaydedildi: rec, not: j.bitis ? "Bitişten 2 hafta önce hatırlatacağım." : "" };
  }
  return colRun("vault", maskText(g));
} };
FN.archive = { ui: () => timelineHTML(), input: "Ne zaman ne oldu? diye sor", run: async g => {
  const tl = timeline().slice(0, 250).map(e => `${e.d} ${e.k}: ${e.t}`).join("\n");
  return { metin: await plainGemini(`Kullanıcının hayat arşivi (zaman çizelgesi):\n${tl}\n\nSoru: ${g || "Son ayların kısa özetini çıkar"}\nSadece bu kayıtlara dayanarak Türkçe cevap ver; kayıtta yoksa söyle.`, [], null, { max: 1200 }) };
} };
function timeline() {
  const ev = [];
  (S.auditions || []).forEach(a => ev.push({ d: (a.date || "").slice(0, 10), k: "🎭 " + a.type, t: a.title }));
  (S.applications || []).forEach(a => ev.push({ d: a.date || "", k: "📨 başvuru", t: `${a.project} ${a.role || ""} (${a.status})` }));
  (S.notes || []).forEach(n => ev.push({ d: (n.created || "").slice(0, 10), k: "📝 not", t: n.text.slice(0, 90) }));
  (S.goals || []).forEach(g => ev.push({ d: g.week || "", k: "🎯 hedef", t: g.text }));
  (S.dates || []).forEach(g => ev.push({ d: g.md || "", k: "🎂 " + g.kind, t: g.name }));
  XL("journal").forEach(j => ev.push({ d: j.tarih || (j.at || "").slice(0, 10), k: "📔 günlük", t: (j.metin || "").slice(0, 90) }));
  XL("decisions").forEach(j => ev.push({ d: (j.at || "").slice(0, 10), k: "🧭 karar", t: j.karar }));
  (S.memory || []).forEach(m => m.at && ev.push({ d: m.at.slice(0, 10), k: "🧠 hafıza", t: m.text }));
  return ev.filter(e => e.d).sort((a, b) => b.d.localeCompare(a.d));
}
const timelineHTML = () => `<div class="sklist">${timeline().slice(0, 80).map(e => `<div class="item"><div class="t"><div class="h">${esc(e.k)} · ${esc(e.t)}</div><div class="meta">${esc(e.d)}</div></div></div>`).join("") || '<div class="empty">Henüz kayıt yok.</div>'}</div>`;

/* ---------- ayar tipi yetenekler ---------- */
function setFn(key, label, type, opts, after) {
  return {
    ui: () => {
      const v = SET[key];
      if (type === "bool") return `<label class="tg"><input type="checkbox" data-sk="${key}" ${v ? "checked" : ""}> ${esc(label)}</label>`;
      if (type === "choice") return `<div class="lbl">${esc(label)}</div><select data-sk="${key}">${opts.map(o => `<option value="${o[0]}" ${String(v ?? opts[0][0]) === o[0] ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
      return `<div class="lbl">${esc(label)}</div><input data-sk="${key}" value="${esc(v || "")}" placeholder="${esc(opts || "")}">`;
    },
    run: async g => {
      const l = trLower(g);
      if (type === "bool") SET[key] = !/kapat|kapa|iptal|istemiyorum|durdur/.test(l);
      else if (type === "choice") {
        const offv = o => /^(kapali|0|normal|kirmizi|otomatik|600)$/.test(o[0]);
        let o = opts.find(o => l.includes(trLower(o[1]).split(" ")[0]) || l.split(/\s+/).includes(o[0])) || opts.find(o => /\d/.test(o[0]) && l.match(/\d+/) && o[0] === l.match(/\d+/)[0]);
        if (!o && /kapat|kapa\b|iptal|normale/.test(l)) o = opts.find(offv);
        if (!o && (!l || /aç|etkin|başlat|evet|aktif/.test(l))) o = opts.find(x => !offv(x)) || opts[1];
        if (o) SET[key] = o[0]; else return { hata: "Seçenekler: " + opts.map(o => o[1]).join(", ") };
      }
      else { SET[key] = g.replace(/^(.*?)(olsun|yap|ayarla)$/i, "$1").trim(); }
      saveSet(); if (after) after(); applyLook();
      return { ok: true, ayar: label, deger: type === "bool" ? (SET[key] ? "açık" : "kapalı") : SET[key] };
    }
  };
}
document.addEventListener("change", e => {
  const el = e.target.closest("[data-sk]"); if (!el) return;
  const k = el.dataset.sk; SET[k] = el.type === "checkbox" ? el.checked : el.type === "range" || el.type === "number" ? Number(el.value) : el.value; saveSet(); applyLook();
  if (k === "face") drawFace(); if (k === "breaks") setupBreaks(); toast("✓ Kaydedildi");
});
Object.assign(FN, {
  nightmode: setFn("nightMode", "Gece modu (fısıltı ses, karanlık ekran, kısa cevap)", "bool"),
  bigtext: setFn("bigText", "Büyük yazı ve yüksek kontrast", "bool"),
  onehand: setFn("oneHand", "Tek elle kullanım (içerik ekranın altına)", "bool"),
  theme: setFn("theme", "Tema rengi", "choice", [["kirmizi", "Kırmızı"], ["mavi", "Mavi"], ["yesil", "Yeşil"], ["mor", "Mor"], ["altin", "Altın"]]),
  dysfont: setFn("dysFont", "Okuma dostu yazı tipi (geniş aralık)", "bool"),
  guest: setFn("guest", "Misafir modu (kişisel bilgi vermez)", "bool"),
  battery: setFn("battery", "Pil dostu mod", "choice", [["otomatik", "Otomatik (%20 altında)"], ["acik", "Hep açık"], ["kapali", "Kapalı"]]),
  netmode: setFn("netMode", "İnternete göre mod", "choice", [["otomatik", "Otomatik"], ["hafif", "Hep hafif"], ["normal", "Hep normal"]]),
  readmode: setFn("speakReplies", "Cevapları sesli oku (okuma modu)", "bool"),
  noise: setFn("noiseMode", "Gürültülü ortam modu (daha güçlü ses tanıma, daha uzun sessizlik payı)", "bool", null, () => { SET.liveSilence = SET.noiseMode ? 900 : 600; if (SET.noiseMode && SET.groqKey) SET.stt = "groq"; saveSet(); }),
  interrupt: setFn("liveSilence", "Söz kesme hassasiyeti (canlı sohbette susunca kaç ms sonra cevap versin)", "choice", [["400", "Çok hızlı (400 ms)"], ["600", "Normal (600 ms)"], ["900", "Sabırlı (900 ms)"], ["1300", "Çok sabırlı (1300 ms)"]]),
  address: setFn("hitap", "Hitap (ör. Burak, patron, efendim)", "text", "Burak"),
  passphrase: setFn("passphrase", "Kritik işlemlerden önce sorulacak parola (boş = kapalı)", "text", "ör. kırmızı kartal"),
  mask: setFn("mask", "Buluta giderken IBAN/kart/TC numaralarını gizle", "bool"),
  feedback: setFn("feedback", "Cevaplarda 👍/👎 düğmeleri", "bool"),
  livenotes: setFn("liveNotes", "Sohbetten otomatik not çıkar", "bool"),
  shake: setFn("shake", "Telefonu sallayınca sıradaki hatırlatıcıyı oku", "bool"),
  headset: setFn("headset", "Kulaklık düğmesiyle Titus'u dinlet", "bool"),
  face: setFn("face", "Konuşan Titus yüzü", "bool"),
  rain: setFn("rainAlert", "Yağmur başlamadan haber ver", "bool"),
  breaks: setFn("breaks", "Mola hatırlatıcı (dakika, 0 = kapalı)", "choice", [["0", "Kapalı"], ["30", "30 dk"], ["45", "45 dk"], ["60", "60 dk"], ["90", "90 dk"]]),
  dailyword: setFn("dailyWord", "Her gün bir kelime (İngilizce/oyunculuk terimi) bildirimi", "bool"),
  notifauto: { ...setFn("notifAuto", "Banka bildirimlerinden otomatik harcama ekle", "bool"), run: async () => notifAutoRun(true) },
  reelremind: { ...setFn("reelRemind", "Yeni çekim bitince showreel güncelleme hatırlat", "bool"), run: async () => { SET.reelRemind = true; saveSet(); return reelScan(); } },
  volume: { ui: () => `<div class="lbl">Ses yüksekliği ${Math.round((SET.ttsVol ?? 1) * 100)}%</div><input type="range" min="0.2" max="1" step="0.05" value="${SET.ttsVol ?? 1}" data-sk="ttsVol"><label class="tg"><input type="checkbox" data-sk="autoVol" ${SET.autoVol ? "checked" : ""}> Ortama göre ayarla (gece kısık)</label>`, run: async g => { const n = Number((g.match(/\d+/) || [])[0]); if (n) SET.ttsVol = Math.min(1, Math.max(0.2, n / 100)); else SET.autoVol = true; saveSet(); return { ok: true, ses: SET.ttsVol, otomatik: !!SET.autoVol }; } },
  personality: { ui: () => { const P = SET.pers || {}; const r = (k, l, mx, d) => `<div class="lbl">${l}: <span>${P[k] ?? d}</span></div><input type="range" min="0" max="${mx}" value="${P[k] ?? d}" data-pers="${k}">`; return r("ciddiyet", "Ciddiyet", 10, 5) + r("espri", "Espri", 10, 5) + r("uzunluk", "Cevap uzunluğu (0 çok kısa – 3 uzun)", 3, 1); },
    run: async g => { const j = await geminiJSON(`Kullanıcı asistanın kişiliğini ayarlıyor: "${g}". Mevcut: ${JSON.stringify(SET.pers || {})}. JSON: {"ciddiyet":0-10,"espri":0-10,"uzunluk":0-3}`); SET.pers = { ...(SET.pers || {}), ...j }; saveSet(); return { ok: true, kisilik: SET.pers }; } },
  profiles: { ui: () => `<div class="sklist">${XL("profiles").map(p => `<div class="item"><div class="t"><div class="h">${esc(p.name)}</div></div><button class="btn ghost" data-prof="${p.id}">Uygula</button><button class="x" data-coldel="profiles:${p.id}">✕</button></div>`).join("") || '<div class="empty">Kayıtlı profil yok.</div>'}</div><div class="row"><input id="profName" placeholder="Profil adı (ör. İş, Ev)"><button class="btn" id="profSave">Şu anki ayarları kaydet</button></div>`,
    run: async g => { const p = XL("profiles").find(p => deacc(g).includes(deacc(p.name))); if (!p) return { hata: "Profil bulunamadı", profiller: XL("profiles").map(p => p.name) }; applyProfile(p); return { ok: true, profil: p.name }; } },
  permissions: { ui: () => `<div class="hint">İşaretini kaldırdığın araçları Titus kullanamaz.</div><div class="permgrid">${TOOLS.map(t => `<label class="tg"><input type="checkbox" data-perm="${t.name}" ${(SET.toolOff || []).includes(t.name) ? "" : "checked"}> ${esc(ACT_TR[t.name] || t.name)}</label>`).join("")}</div>` },
  a11y: { run: async () => { a11yPass(); return { ok: true, not: "Tüm düğmelere ekran okuyucu etiketleri eklendi." }; } },
  tablet: { ui: () => `<div class="hint">Geniş ekranda (tablet/katlanır/yatay) bölümler otomatik iki sütun olur.</div>` },
  notifbar: { ui: () => `<div class="hint">Uyandırma kelimesi açıkken Titus kalıcı bildirimde durur; bildirime dokununca açılır. Ayarlar → Uyandırma.</div>` },
  widget: { run: async () => { try { updateWidget(); } catch {} return { ok: true, not: "Ana ekran widget'ı güncellendi (ana ekranda boş yere uzun bas → Widget'lar → Titus)." }; } },
  voicemenu: { ui: () => `<div class="hint">Söyleyebileceklerin: "ayarları aç", "plan'a git", "hayata git", "kariyere git", "stüdyoya git", "yetenekleri aç", "ana sayfaya dön", "geri al".</div>` },
  listenmode: { run: async () => { LISTEN.on = true; LISTEN.buf = []; go("home"); return { ok: true, not: "Dinleme modu açık: araya girmeden dinleyeceğim; bitince 'bitti' de, özetleyeyim." }; } }
});
document.addEventListener("input", e => {
  const el = e.target.closest("[data-pers]"); if (!el) return;
  SET.pers = { ...(SET.pers || {}), [el.dataset.pers]: Number(el.value) }; saveSet(); const sp = el.previousElementSibling && el.previousElementSibling.querySelector("span"); if (sp) sp.textContent = el.value;
});
document.addEventListener("change", e => {
  const el = e.target.closest("[data-perm]"); if (!el) return;
  const off = new Set(SET.toolOff || []); el.checked ? off.delete(el.dataset.perm) : off.add(el.dataset.perm); SET.toolOff = [...off]; saveSet();
});
const PROF_KEYS = ["personality", "pers", "speakReplies", "theme", "nightMode", "modes", "hitap", "battery", "netMode", "activeAsst", "bigText", "feedback", "liveNotes"];
function applyProfile(p) { for (const k of PROF_KEYS) if (k in p.set) SET[k] = p.set[k]; saveSet(); applyLook(); toast("✓ Profil: " + p.name); }
document.addEventListener("click", e => {
  const t = e.target.closest("#profSave,[data-prof]"); if (!t) return;
  if (t.id === "profSave") { const n = $("#profName").value.trim(); if (!n) return toast("Profil adı yaz"); const set = {}; PROF_KEYS.forEach(k => { if (SET[k] !== undefined) set[k] = JSON.parse(JSON.stringify(SET[k])); }); XL("profiles").push({ id: uid(), name: n, set }); save(); refreshSkill(); }
  else { const p = XL("profiles").find(p => p.id === t.dataset.prof); if (p) applyProfile(p); }
});

/* ---------- görünüm ---------- */
const THEMES = { kirmizi: ["#ff2a3d", "255,42,61"], mavi: ["#2ab3ff", "42,179,255"], yesil: ["#29e07a", "41,224,122"], mor: ["#a46bff", "164,107,255"], altin: ["#ffb52a", "255,181,42"] };
function applyLook() {
  const b = document.body; if (!b) return;
  b.classList.toggle("big", !!SET.bigText); b.classList.toggle("onehand", !!SET.oneHand); b.classList.toggle("dys", !!SET.dysFont);
  b.classList.toggle("night", !!SET.nightMode || nightNow()); b.classList.toggle("guest", !!SET.guest);
  const th = THEMES[SET.theme]; const R = document.documentElement;
  if (th && SET.theme !== "kirmizi") { R.style.setProperty("--cyan", th[0]); R.style.setProperty("--cyan2", `rgba(${th[1]},.75)`); R.style.setProperty("--line", `rgba(${th[1]},.22)`); R.style.setProperty("--acc", th[0]); R.style.setProperty("--accrgb", th[1]); b.dataset.theme = SET.theme; }
  else { ["--cyan", "--cyan2", "--line", "--acc", "--accrgb"].forEach(v => R.style.removeProperty(v)); delete b.dataset.theme; }
}
function a11yPass() {
  document.querySelectorAll("button:not([aria-label])").forEach(b => { const t = (b.textContent || "").trim(); if (t) b.setAttribute("aria-label", t.replace(/\s+/g, " ").slice(0, 60)); });
  document.querySelectorAll("input:not([aria-label]),textarea:not([aria-label]),select:not([aria-label])").forEach(i => { const p = i.getAttribute("placeholder"); if (p) i.setAttribute("aria-label", p); });
  const log = $("#log"); if (log) log.setAttribute("aria-live", "polite");
}

/* =================== ÇOKLU GMAIL =================== */
async function scriptAt(acc, action, data = {}) {
  if (!acc || acc.main) return script(action, data);
  const r = await fetch(acc.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: acc.token, action, ...data }) });
  let txt = await r.text(); const mv = !txt.trim().startsWith("{") && txt.match(/HREF="([^"]+)"/i);
  if (mv) txt = await (await fetch(mv[1].replace(/&amp;/g, "&"))).text();
  let j; try { j = JSON.parse(txt); } catch { throw new Error(`${acc.name}: Google yanıtı okunamadı (dağıtım "Herkes" erişimli mi?)`); }
  if (!j.ok) throw new Error(`${acc.name}: ${j.error || "hata"}`); return j;
}
const accounts = () => [...(SET.scriptUrl ? [{ id: "main", name: SET.mainAccName || "Ana hesap", email: SET.mainEmail || "", url: SET.scriptUrl, token: SET.scriptToken, main: true }] : []), ...(SET.accounts || [])];
function pickAccounts(h) {
  const all = accounts(); if (!h || /tüm|hepsi|bütün|all/.test(trLower(h))) return all;
  const n = deacc(h); const f = all.filter(a => deacc(a.name).includes(n) || n.includes(deacc(a.name)) || deacc(a.email || "").includes(n) || (n.includes("ana") && a.main));
  return f.length ? f : all;
}
{
  const i1 = TOOL_IDX("mail_ozeti"); if (i1 >= 0) TOOLS.splice(i1, 1);
  const i2 = TOOL_IDX("mail_taslagi"); if (i2 >= 0) TOOLS.splice(i2, 1);
}
TOOLS.push(
  T("mail_ozeti", "Gmail'deki son/okunmamış mailleri getirir; BİRDEN FAZLA GMAIL HESABI bağlı olabilir. hesap: hesap adı/e-postası ya da 'tümü' (varsayılan tümü). query Gmail arama ifadesi (ör. 'is:unread', 'from:recasttalent').", { query: str("Gmail arama"), max: num("Hesap başına en fazla, varsayılan 8"), hesap: str("Hangi hesap (ad/e-posta) ya da 'tümü'") }, [],
    async a => {
      const accs = pickAccounts(a.hesap); if (!accs.length) return { hata: "Google/Gmail bağlantısı yok (Ayarlar → Google ya da Yetenekler → Birden fazla Gmail hesabı)." };
      const res = await Promise.all(accs.map(acc => scriptAt(acc, "gmail", { query: a.query || "is:unread in:inbox", max: a.max || 8 }).then(j => ({ hesap: acc.name + (acc.email ? " <" + acc.email + ">" : ""), mailler: j.mailler })).catch(e => ({ hesap: acc.name, hata: e.message }))));
      return accs.length === 1 ? { hesap: res[0].hesap, ...(res[0].hata ? { hata: res[0].hata } : { mailler: res[0].mailler }) } : { hesaplar: res };
    }),
  T("mail_taslagi", "Gmail'de taslak mail oluşturur (göndermez). Birden fazla hesap varsa hesap ile hangi hesaptan yazılacağını seç (varsayılan ana hesap).", { to: str("Alıcı e-posta"), subject: str("Konu"), body: str("Metin"), hesap: str("Hangi hesaptan (ad/e-posta)") }, ["subject", "body"],
    async a => {
      const acc = a.hesap ? pickAccounts(a.hesap)[0] : accounts()[0]; if (!acc) return { hata: "Gmail bağlı değil." };
      if (!(await confirmBox(`Gmail taslağı (${acc.name}) oluşturulsun mu?\n${a.to || "(alıcı yok)"} · ${a.subject}`, "Oluştur"))) return { ok: false, iptal: true };
      const { hesap, ...rest } = a; const j = await scriptAt(acc, "gmailDraft", rest); return { ...j, hesap: acc.name };
    }),
  T("gmail_hesaplari", "Bağlı Gmail hesaplarını listeler.", {}, [], async () => ({ hesaplar: accounts().map(a => `${a.name}${a.email ? " <" + a.email + ">" : ""}${a.main ? " (ana)" : ""}`) }))
);
Object.assign(ACT_TR, { mail_ozeti: "✉️ mail", mail_taslagi: "✉️ taslak", gmail_hesaplari: "✉️ hesaplar" });
TOOL_GROUPS.push([/mail|gmail|hesap|e-?posta/, ["gmail_hesaplari"]]);
FN.accounts = {
  ui: () => `<div class="hint">Her Gmail hesabı için: o hesapla script.google.com'a gir → yeni proje → Code.gs'yi yapıştır (TOKEN'ı değiştir) → Dağıt → Web uygulaması (Ben olarak çalıştır, Herkes erişebilir) → linki ve şifreyi buraya ekle.</div>
    <div class="sklist">${accounts().map(a => `<div class="item"><div class="ic">✉️</div><div class="t"><div class="h">${esc(a.name)}${a.main ? " · ana" : ""}</div><div class="meta">${esc(a.email || "e-posta: test et")}</div></div><button class="btn ghost" data-acctest="${a.id}">Test</button>${a.main ? "" : `<button class="x" data-accdel="${a.id}">✕</button>`}</div>`).join("") || '<div class="empty">Henüz hesap yok. Önce Ayarlar → Google bağlantısı kur.</div>'}</div>
    <div class="form"><input id="acName" placeholder="Hesap adı (ör. İş, Kişisel, Recast)"><input id="acUrl" placeholder="Apps Script linki (https://script.google.com/macros/s/…/exec)"><input id="acTok" type="password" placeholder="O hesabın gizli şifresi (TOKEN)"><button class="btn" id="acAdd">+ Hesap ekle ve test et</button></div>`
};
document.addEventListener("click", async e => {
  const t = e.target.closest("#acAdd,[data-acctest],[data-accdel]"); if (!t) return;
  try {
    if (t.id === "acAdd") {
      const name = $("#acName").value.trim(), url = $("#acUrl").value.trim(), token = $("#acTok").value.trim();
      if (!name || !/^https:\/\/script\.google\.com\//.test(url) || !token) return toast("Ad, geçerli Apps Script linki ve şifre gerekli");
      const acc = { id: uid(), name, url, token }; t.disabled = true; toast("Test ediliyor…");
      const j = await scriptAt(acc, "ping"); acc.email = j.email || ""; SET.accounts = [...(SET.accounts || []), acc]; saveSet(); toast("✓ " + name + " bağlandı " + (acc.email || "")); refreshSkill();
    } else if (t.dataset.acctest) {
      const acc = accounts().find(a => a.id === t.dataset.acctest); const j = await scriptAt(acc, "ping");
      if (acc.main) { SET.mainEmail = j.email || ""; } else { acc.email = j.email || ""; } saveSet(); toast("✓ Çalışıyor " + (j.email || "")); refreshSkill();
    } else if (t.dataset.accdel) { if (!(await confirmBox("Hesap kaldırılsın mı?", "Kaldır"))) return; SET.accounts = (SET.accounts || []).filter(a => a.id !== t.dataset.accdel); saveSet(); refreshSkill(); }
  } catch (er) { toast("✗ " + er.message, 6000); t.disabled = false; }
});
{ // eşleştirme kodu: ek hesaplar bilgisayara da gitsin
  const basePair = pairCode;
  pairCode = function () { const c = basePair(); try { const o = JSON.parse(decodeURIComponent(escape(atob(c.slice(7))))); o.acc = (SET.accounts || []).map(a => ({ n: a.name, u: a.url, t: a.token, e: a.email || "" })); o.tg = SET.tgOn ? 1 : 0; return "TITUS1." + b64utf8(JSON.stringify(o)); } catch { return c; } };
}

/* =================== OTOMATİK GÜNCELLEME =================== */
const REPO = "Mendusa27/Jarvis-1";
async function checkUpdate(manual) {
  if (!NATIVE && !manual) return { yeni: false };
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("GitHub'a ulaşılamadı (" + r.status + ")");
    const j = await r.json(); const tag = j.tag_name || ""; const m = tag.match(/^v([\d.]+)-(\d+)/);
    const apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
    const newer = m && (cmpVer(m[1], APP_VER) > 0 || (m[1] === APP_VER && /^\d+$/.test(APP_RUN) && Number(m[2]) > Number(APP_RUN)));
    META.updChk = today(); saveMeta();
    if (newer && apk) {
      META.updUrl = apk.browser_download_url; META.updTag = tag; saveMeta();
      const sp = bubble("sys", `⬆️ Yeni Titus sürümü hazır: ${tag}. `); const b = document.createElement("button"); b.className = "btn"; b.textContent = "İndir ve kur"; b.dataset.upd = "1"; sp.parentElement.appendChild(b);
      return { yeni: true, surum: tag, link: apk.browser_download_url };
    }
    if (manual) toast("✓ Titus güncel (" + APP_VER + (/^\d+$/.test(APP_RUN) ? "-" + APP_RUN : "") + ")");
    return { yeni: false, surum: APP_VER, son: tag };
  } catch (e) { if (manual) toast("✗ " + e.message); return { hata: e.message }; }
}
const cmpVer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
document.addEventListener("click", e => { if (e.target.closest("[data-upd]")) { openUrl(META.updUrl); toast("İndirme başladı; bitince dosyaya dokunup 'Güncelle' de.", 6000); } });
FN.update = { ui: () => `<div class="hint">Kurulu: v${APP_VER}${/^\d+$/.test(APP_RUN) ? "-" + APP_RUN : ""} · son kontrol: ${META.updChk || "hiç"}</div><button class="btn" data-skrun="1">Güncellemeyi kontrol et</button>`, run: async () => checkUpdate(true) };

/* =================== TAKİPLER (sayfa / fiyat / konu) =================== */
FN.watch = {
  ui: () => `<div class="hint">Takipleri Google tarafı saatte bir kontrol eder (telefon kapalıyken bile). Değişiklik olunca burada, bildirimde (ntfy) ve Telegram'da haber verir.</div>
    <div class="sklist">${XL("watch").map(w => `<div class="item"><div class="ic">${w.tur === "konu" ? "📰" : "👁"}</div><div class="t"><div class="h">${esc(w.ad)}</div><div class="meta">${esc(w.tur === "konu" ? "konu: " + w.konu : w.url)}${w.kosul ? " · koşul: " + esc(w.kosul) : ""}${w.son ? " · son: " + esc(w.son) : ""}</div></div><button class="x" data-wdel="${w.id}">✕</button></div>`).join("") || '<div class="empty">Takip yok. Aşağıya doğal dille yaz: "şu linkteki fiyat 3000 altına düşünce haber ver".</div>'}</div>
    <button class="btn ghost" id="wCheck">Şimdi kontrol et</button>`,
  input: "Ne takip edilsin? (link + koşul ya da konu)",
  run: async g => {
    if (!g) return watchCheckNow();
    const j = await geminiJSON(`Kullanıcı bir takip kurmak istiyor: "${g}". JSON: {"tur":"sayfa|konu","ad":"kısa ad","url":"sayfa ise tam link","konu":"konu ise arama konusu","anahtar":"sayfada aranacak kelimeler, virgülle (ops.)","kosul":"haber verme koşulu, doğal dille (ops.)"}`);
    if (j.tur !== "konu" && !/^https?:\/\//.test(j.url || "")) return { hata: "Sayfa takibi için tam link gerekli (https://…)." };
    const w = { id: uid(), tur: j.tur === "konu" ? "konu" : "sayfa", ad: j.ad || g.slice(0, 40), url: j.url || "", konu: j.konu || "", anahtar: j.anahtar || "", kosul: j.kosul || "" };
    XL("watch").push(w); save(); const r = await watchSync();
    return { ok: true, takip: w.ad, not: r.hata ? "Kaydedildi ama Google'a gönderilemedi: " + r.hata : "Saatte bir kontrol edeceğim." };
  }
};
FN.research_watch = FN.watch;
async function watchSync() { try { if (!SET.scriptUrl) return { hata: "Google bağlı değil" }; await script("watchSet", { list: XL("watch"), ntfy: SET.ntfyTopic || "", gkey: SET.geminiKey }); return { ok: true }; } catch (e) { return { hata: e.message }; } }
async function watchCheckNow() { if (!SET.scriptUrl) return { hata: "Google bağlı değil" }; await watchSync(); const r = await script("watchRunNow"); const res = r.sonuc || []; res.forEach(x => { const w = XL("watch").find(w => w.id === x.id); if (w) w.son = x.durum; }); save(); refreshSkill(); return { ok: true, sonuc: res }; }
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-wdel],#wCheck"); if (!t) return;
  try { if (t.id === "wCheck") { toast("Kontrol ediliyor…"); const r = await watchCheckNow(); toast(r.hata ? "✗ " + r.hata : "✓ " + (r.sonuc || []).map(x => x.ad + ": " + x.durum).join(" · "), 7000); } else { X().watch = XL("watch").filter(w => w.id !== t.dataset.wdel); save(); await watchSync(); refreshSkill(); } } catch (er) { toast("✗ " + er.message, 5000); }
});

/* =================== DERİN ARAŞTIRMA (+ kaynak puanı, çelişkiler, kaldığı yerden devam) =================== */
async function deepResearch(q, onStep = () => {}) {
  const job = { id: uid(), kind: "research", arg: q, at: Date.now(), done: [], plan: null };
  const prev = (META.jobs || []).find(j => j.kind === "research" && j.arg === q && !j.fin); const J = prev || job;
  if (!prev) { META.jobs = [...(META.jobs || []), J].slice(-10); saveMeta(); }
  if (!J.plan) { onStep("Plan çıkarılıyor"); const p = await geminiJSON(`Araştırma konusu: "${q}". ${userCtx()}\nBu konuyu derinlemesine araştırmak için 4-6 farklı açıdan alt soru üret. Türkçe kaynakları da düşün. JSON: {"baslik":"","alt":["..."]}`); J.plan = p; saveMeta(); }
  const subs = J.plan.alt || [q];
  const pending = subs.filter(s => !J.done.find(d => d.q === s));
  onStep(`${pending.length} alt soru paralel araştırılıyor`);
  const got = await Promise.all(pending.map(s => grounded(`Şunu internette araştır ve Türkçe, bilgi yoğun cevap ver (rakam, tarih, isim): ${s}\nAna konu: ${q}`, 1800).then(r => ({ q: s, ...r })).catch(e => ({ q: s, text: "(araştırılamadı: " + e.message + ")", src: [] }))));
  J.done.push(...got); saveMeta();
  const srcs = []; const add = x => { let i = srcs.findIndex(s => s.uri === x.uri); if (i < 0) { srcs.push(x); i = srcs.length - 1; } return i + 1; };
  const notes = J.done.map(d => `### ${d.q}\n${d.text}\nKaynaklar: ${d.src.map(s => "[" + add(s) + "] " + s.title).join(", ")}`).join("\n\n");
  onStep("Rapor yazılıyor");
  const report = await plainGemini(`Sen titiz bir araştırmacısın. Aşağıdaki bulgulardan "${J.plan.baslik || q}" hakkında kapsamlı Türkçe rapor yaz.
Bölümler: # Özet (5-6 cümle) / # Bulgular (alt başlıklarla, her iddiadan sonra [n] kaynak numarası) / # Çelişen bilgiler (kaynaklar farklı şey söylüyorsa ikisini de numarasıyla göster; yoksa "belirgin çelişki yok") / # Kaynak güvenilirliği (her kaynağa 1-5 puan ve tek cümle neden: resmî, akademik, köklü haber, blog, forum) / # Sonuç ve öneriler.
Uydurma bilgi ekleme; bulgularda olmayanı yazma.\n\nBULGULAR:\n${notes}\n\nKAYNAK LİSTESİ:\n${srcs.map((s, i) => `[${i + 1}] ${s.title}`).join("\n")}`, [], null, { max: 6000, temperature: 0.3, nocache: true });
  J.fin = true; saveMeta();
  const d = await docFromText("Araştırma — " + (J.plan.baslik || q), report, ["", "KAYNAKLAR", ...srcs.map((s, i) => `[${i + 1}] ${s.title} — ${s.uri}`)]);
  return { metin: report, kaynaklar: srcs.slice(0, 12), belge: d.dosya, yer: d.yer };
}
FN.research = { input: "Neyi araştırayım?", run: (g, s, ctx) => g ? deepResearch(g, x => { const o = $("#skOut"); if (o && !ctx.fromChat) o.textContent = "⏳ " + x; }) : { hata: "Konu yaz." } };

/* =================== TELEGRAM =================== */
FN.telegram = {
  ui: () => `<div class="hint">1) Telegram'da @BotFather → /newbot → bota ad ver → verdiği token'ı buraya yapıştır. 2) "Bağla"ya bas. 3) Kendi botuna Telegram'dan "merhaba" yaz — ilk yazan sen olduğun için bot sadece sana cevap verir. "telefon: …" ile telefondaki Titus'a, "bilgisayar: …" ile bilgisayardakine iş gönderirsin.</div>
    <input id="tgTok" type="password" placeholder="Bot token (123456:ABC…)" value="${esc(SET.tgToken || "")}"><div class="row"><button class="btn" id="tgGo">Bağla</button><button class="btn ghost" id="tgTest">Test mesajı</button><button class="btn ghost" id="tgOff">Kapat</button></div><div class="hint">Durum: ${SET.tgOn ? "bağlı" : "kapalı"}</div>`,
  run: async g => { if (!SET.tgOn) return { hata: "Telegram bağlı değil: Yetenekler → Telegram'dan Titus." }; await script("tgSend", { text: g || "Titus'tan selam 👋" }); return { ok: true, gonderildi: true }; }
};
document.addEventListener("click", async e => {
  const t = e.target.closest("#tgGo,#tgTest,#tgOff"); if (!t) return;
  try {
    if (t.id === "tgGo") { const tok = $("#tgTok").value.trim(); if (!/^\d+:[\w-]{20,}$/.test(tok)) return toast("Geçerli bot token'ı yapıştır"); const r = await script("tgSetup", { botToken: tok, gkey: SET.geminiKey }); SET.tgToken = tok; SET.tgOn = true; saveSet(); toast("✓ Bağlandı: @" + (r.bot || "bot") + " — şimdi bota Telegram'dan yaz", 7000); refreshSkill(); }
    else if (t.id === "tgTest") { await script("tgSend", { text: "✅ Titus test mesajı" }); toast("Gönderildi (önce bota bir kez yazmış olman gerekir)"); }
    else { await script("tgSetup", { off: true }); SET.tgOn = false; saveSet(); refreshSkill(); }
  } catch (er) { toast("✗ " + er.message, 6000); }
});

/* =================== DIŞARIDAN KOMUT (webhook) =================== */
FN.webhook = {
  ui: () => { const sec = SET.hookSecret || ""; const u = SET.scriptUrl && sec ? `${SET.scriptUrl}?hook=${sec}&text=` : ""; return `<div class="hint">Tasker, Kısayollar, IFTTT gibi uygulamalar bu adrese istek atınca Titus komutu yapar (telefon açıkken ~45 sn içinde).</div>${u ? `<input readonly value="${esc(u)}MESAJ"><button class="btn ghost" id="hkCopy">Kopyala</button>` : ""}<button class="btn" id="hkMake">${sec ? "Yeni adres üret" : "Adres oluştur"}</button>`; }
};
document.addEventListener("click", async e => {
  const t = e.target.closest("#hkMake,#hkCopy"); if (!t) return;
  try { if (t.id === "hkMake") { const s = uid() + uid(); await script("hookSet", { secret: s }); SET.hookSecret = s; saveSet(); refreshSkill(); toast("✓ Adres hazır"); } else { await navigator.clipboard.writeText(`${SET.scriptUrl}?hook=${SET.hookSecret}&text=`); toast("Kopyalandı"); } } catch (er) { toast("✗ " + er.message, 5000); }
});

/* =================== HESAP / TABLO / GRAFİK =================== */
function runSandbox(code, ms = 6000) {
  return new Promise(res => {
    const src = `onmessage=()=>{try{const r=(function(){"use strict";\n${code}\n})();postMessage({ok:1,r:JSON.parse(JSON.stringify(r===undefined?null:r))})}catch(e){postMessage({ok:0,e:String(e&&e.message||e)})}}`;
    let w; try { w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); } catch (e) { return res({ ok: 0, e: "Çalışma alanı açılamadı: " + e.message }); }
    const to = setTimeout(() => { w.terminate(); res({ ok: 0, e: "Süre aşıldı (sonsuz döngü?)" }); }, ms);
    w.onmessage = m => { clearTimeout(to); w.terminate(); res(m.data); }; w.onerror = er => { clearTimeout(to); w.terminate(); res({ ok: 0, e: er.message }); }; w.postMessage(1);
  });
}
async function calcRun(g) {
  let err = "", code = "";
  for (let i = 0; i < 3; i++) {
    code = fence(await plainGemini(`Şu isteği JavaScript ile HESAPLA (tahmin etme, kodla hesapla): "${g}"\n${err ? "Önceki kodun hata verdi: " + err + "\nKod:\n" + code + "\nDüzelt.\n" : ""}Sadece bir fonksiyon GÖVDESİ yaz (en sonda return ile). Dönüş nesnesi: {"cevap":"Türkçe kısa sonuç cümlesi","tablo":[["Başlık1","Başlık2"],["değer","değer"]] (isteğe bağlı),"grafik":{"tur":"bar|line","baslik":"","etiketler":["..."],"degerler":[sayılar]} (isteğe bağlı)}. fetch, DOM, import kullanma. Para birimini ₺ ile yaz. Açıklama yazma, sadece kod.`, [], null, { temperature: 0, max: 2500, nocache: i > 0 }));
    const r = await runSandbox(code);
    if (r.ok && r.r) return { ...r.r, kod: code };
    err = r.e || "boş sonuç";
  }
  return { hata: "Hesaplanamadı: " + err };
}
function chartSVG(g) {
  const v = (g.degerler || []).map(Number).filter(n => !isNaN(n)); if (!v.length) return "";
  const W = 320, H = 170, max = Math.max(...v, 0), min = Math.min(...v, 0), rng = max - min || 1, bw = W / v.length;
  const y = n => H - 20 - (n - min) / rng * (H - 40);
  const bars = g.tur === "line" ? `<polyline fill="none" stroke="var(--acc,#ff2a3d)" stroke-width="2.5" points="${v.map((n, i) => `${i * bw + bw / 2},${y(n)}`).join(" ")}"/>` + v.map((n, i) => `<circle cx="${i * bw + bw / 2}" cy="${y(n)}" r="3" fill="var(--acc,#ff2a3d)"/>`).join("")
    : v.map((n, i) => `<rect x="${i * bw + 4}" y="${Math.min(y(n), y(0))}" width="${Math.max(2, bw - 8)}" height="${Math.abs(y(n) - y(0))}" rx="3" fill="var(--acc,#ff2a3d)"/>`).join("");
  const lab = (g.etiketler || []).map((l, i) => `<text x="${i * bw + bw / 2}" y="${H - 4}" font-size="9" fill="#aaa" text-anchor="middle">${esc(String(l).slice(0, 8))}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#111;border-radius:10px;margin-top:8px">${bars}${lab}<text x="6" y="12" font-size="10" fill="#ddd">${esc(g.baslik || "")}</text></svg>`;
}
const tableHTML = t => Array.isArray(t) && t.length ? `<div style="overflow:auto"><table class="sktab">${t.map((r, i) => `<tr>${(r || []).map(c => i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join("")}</tr>`).join("")}</table></div>` : "";
FN.calc = { input: "Ne hesaplanacak? (ör. 'aylık 18.500 maaşla %30 birikim 1 yılda', 'kredi 200 bin, %3.2 aylık, 24 ay taksit tablosu')", run: async g => { if (!g) return { hata: "Hesap yaz." }; const r = await calcRun(g); if (r.hata) return r; return { metin: r.cevap, tablo: r.tablo, grafik: r.grafik, html: tableHTML(r.tablo) + (r.grafik ? chartSVG(r.grafik) : "") }; } };

/* =================== HAFIZA YÖNETİMİ =================== */
function memPurge() {
  const now = Date.now(); const keep = [], gone = [];
  for (const m of S.memory || []) (m.exp && parseDate(m.exp) < now ? gone : keep).push(m);
  if (gone.length) { S.memory = keep; X().memArchive = [...gone, ...XL("memArchive")].slice(0, 200); save(); }
  S.memory.sort((a, b) => (b.imp || 0) - (a.imp || 0));
}
FN.memory = {
  ui: () => `<div class="hint">★ önemli · ⏳ kısa süreli (7 gün sonra arşive gider) · ✎ düzelt · ✕ sil</div><div class="sklist">${(S.memory || []).map(m => `<div class="item"><div class="t"><div class="h" contenteditable="true" data-memedit="${m.id}">${esc(m.text)}</div><div class="meta">${m.at ? esc(m.at.slice(0, 10)) : ""}${m.exp ? " · ⏳ " + esc(m.exp.slice(0, 10)) : ""}</div></div><button class="x ${m.imp ? "on" : ""}" data-memimp="${m.id}">★</button><button class="x" data-memexp="${m.id}">⏳</button><button class="x" data-memdel="${m.id}">✕</button></div>`).join("") || '<div class="empty">Hafıza boş.</div>'}</div><button class="btn ghost" id="memConf">Çelişkileri ve eskiyenleri bul</button><div class="hint">Arşiv: ${XL("memArchive").length} bilgi</div>`,
  input: "Hafızaya sor ya da düzelt (ör. 'adresim değişti: …')",
  run: async g => {
    if (!g) return memConflicts();
    const j = await geminiJSON(`Kullanıcının kalıcı hafızası: ${JSON.stringify((S.memory || []).map(m => ({ id: m.id, text: m.text })))}\nKullanıcı: "${g}"\nJSON: {"islem":"ekle|guncelle|sil|cevap","id":"","text":"yeni/güncel bilgi tek cümle","kisa":true/false (geçici bilgi mi),"onemli":true/false,"cevap":"kısa Türkçe cevap"}`);
    if (j.islem === "ekle" && j.text) S.memory.unshift({ id: uid(), text: j.text, at: localISO(new Date()), imp: j.onemli ? 1 : 0, exp: j.kisa ? localISO(new Date(Date.now() + 7 * 864e5)) : undefined });
    else if (j.islem === "guncelle") { const m = S.memory.find(m => m.id === j.id); if (m) { m.text = j.text || m.text; m.at = localISO(new Date()); } }
    else if (j.islem === "sil") S.memory = S.memory.filter(m => m.id !== j.id);
    save(); return { ok: true, cevap: j.cevap };
  }
};
async function memConflicts() {
  const t = await plainGemini(`Kullanıcının hafızasındaki bilgiler:\n${(S.memory || []).map(m => `[${m.id}] (${(m.at || "").slice(0, 10)}) ${m.text}`).join("\n")}\n\nBugün: ${today()}. Birbiriyle ÇELİŞEN, TEKRARLANAN ya da ESKİMİŞ olabilecek bilgileri bul. Her biri için id'leri ve önerini (birleştir/sil/güncelle) yaz. Yoksa "Sorun yok" de. Kısa.`, [], null, { max: 1200, nocache: true });
  return { metin: t };
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-memimp],[data-memexp],[data-memdel],#memConf"); if (!t) return;
  if (t.id === "memConf") { runFromUI("memory", ""); return; }
  const id = t.dataset.memimp || t.dataset.memexp || t.dataset.memdel; const m = S.memory.find(m => m.id === id); if (!m) return;
  if (t.dataset.memimp) m.imp = m.imp ? 0 : 1; else if (t.dataset.memexp) m.exp = m.exp ? undefined : localISO(new Date(Date.now() + 7 * 864e5)); else S.memory = S.memory.filter(x => x.id !== id);
  save(); refreshSkill();
});
document.addEventListener("focusout", e => { const el = e.target.closest && e.target.closest("[data-memedit]"); if (!el) return; const m = S.memory.find(m => m.id === el.dataset.memedit); if (m && el.textContent.trim() && el.textContent.trim() !== m.text) { m.text = el.textContent.trim(); m.at = localISO(new Date()); save(); toast("✓ Düzeltildi"); } });
FN.memweekly = { run: async () => { const wk = Date.now() - 7 * 864e5; const m = (S.memory || []).filter(x => x.at && parseDate(x.at) > wk).map(x => x.text); const n = (S.notes || []).filter(x => parseDate(x.created) > wk).map(x => x.text.slice(0, 150)); if (!m.length && !n.length) return { metin: "Bu hafta yeni bir şey öğrenmedim." }; return { metin: await plainGemini(`Bu hafta kullanıcı hakkında öğrenilenler:\n${m.join("\n")}\nBu haftaki notlar:\n${n.join("\n")}\n\n"Bu hafta öğrendiklerim" başlıklı 5-8 maddelik kısa bir özet yaz; yanlış olabilecekleri "doğru mu?" diye işaretle.`, [], null, { max: 900 }) }; } };

/* =================== ÖZEL ASİSTANLAR =================== */
FN.assistants = {
  ui: () => `<div class="sklist">${XL("assistants").map(a => `<div class="item ${SET.activeAsst === a.id ? "late" : ""}"><div class="ic">🤖</div><div class="t"><div class="h">${esc(a.name)}${SET.activeAsst === a.id ? " · AÇIK" : ""}</div><div class="meta">${esc(a.prompt.slice(0, 120))}</div></div><button class="btn ghost" data-asst="${a.id}">${SET.activeAsst === a.id ? "Kapat" : "Aç"}</button><button class="x" data-coldel="assistants:${a.id}">✕</button></div>`).join("") || '<div class="empty">Henüz özel asistan yok.</div>'}</div><div class="form"><input id="asN" placeholder="Asistan adı (ör. Senaryo Doktoru)"><textarea id="asP" placeholder="Talimatları (nasıl davransın, neyi bilsin, nasıl konuşsun)"></textarea><button class="btn" id="asAdd">+ Oluştur</button></div>`,
  input: "Asistan aç/kapat ya da tarif et (ör. 'İngilizce mülakat hocası yap')",
  run: async g => {
    const l = trLower(g); const hit = XL("assistants").find(a => l.includes(trLower(a.name)));
    if (/kapat|normale dön/.test(l)) { SET.activeAsst = ""; saveSet(); return { ok: true, not: "Özel asistan kapatıldı." }; }
    if (hit) { SET.activeAsst = hit.id; saveSet(); return { ok: true, acik: hit.name }; }
    if (!g) return { asistanlar: XL("assistants").map(a => a.name) };
    const j = await geminiJSON(`Kullanıcı özel bir yapay zekâ asistanı istiyor: "${g}". Ona ad ve ayrıntılı Türkçe sistem talimatı yaz. JSON: {"name":"","prompt":""}`);
    const a = { id: uid(), name: j.name || g.slice(0, 30), prompt: j.prompt || g }; XL("assistants").push(a); SET.activeAsst = a.id; save(); saveSet();
    return { ok: true, olusturuldu: a.name, acik: true, talimat: undefined };
  }
};
document.addEventListener("click", e => {
  const t = e.target.closest("#asAdd,[data-asst]"); if (!t) return;
  if (t.id === "asAdd") { const n = $("#asN").value.trim(), p = $("#asP").value.trim(); if (!n || !p) return toast("Ad ve talimat yaz"); XL("assistants").push({ id: uid(), name: n, prompt: p }); save(); }
  else { SET.activeAsst = SET.activeAsst === t.dataset.asst ? "" : t.dataset.asst; saveSet(); }
  refreshSkill();
});

/* =================== CANLI ÇEVİRİ, YÖNETMEN =================== */
COACH.ceviri = "Sen canlı tercümansın. Türkçe duyduğunu doğal İngilizceye, İngilizce (ya da başka dil) duyduğunu Türkçeye çevir. Sadece çeviriyi söyle, yorum ekleme. İki kişi arasında köprü ol.";
COACH.yonetmen = "Sen deneyimli bir self-tape yönetmenisin. Kamera açıkken kadraja bak: ışık (yüz aydınlık mı, gölge), kadraj (göz hizası, baş boşluğu), arka plan, ses; çekim sırasında oyuncuya kısa yönlendirmeler ver (tempo, duraklama, göz çizgisi, enerji). Her çekimden sonra tek somut not ver.";
FN.translate = { input: "Hangi diller? (varsayılan Türkçe ↔ İngilizce)", run: async g => { const r = await startCoach("ceviri", g ? "\nDiller: " + g : ""); return r.ok ? { ok: true, not: "Canlı çeviri başladı; konuşun." } : { hata: "Canlı mod açılamadı." }; } };
FN.director = { run: async g => { const r = await startCoach("yonetmen", g ? "\nSahne/rol: " + g : ""); if (r.ok) setTimeout(() => toast("📷 Kamera düğmesine basarak beni kameraya bağla", 6000), 1500); return r.ok ? { ok: true, not: "Yönetmen modu açık; kamera düğmesiyle görüntüyü paylaş." } : { hata: "Canlı mod açılamadı." }; } };

/* =================== HAREKETLİ TİTUS YÜZÜ =================== */
function drawFace() {
  let f = $("#tface"); const r = $("#reactor");
  if (!SET.face) { if (f) f.remove(); if (r) r.style.display = ""; return; }
  if (!f && r) {
    f = document.createElement("div"); f.id = "tface"; f.innerHTML = `<svg viewBox="0 0 120 120"><defs><radialGradient id="tfg"><stop offset="0" stop-color="rgba(var(--accrgb,255,42,61),.35)"/><stop offset="1" stop-color="transparent"/></radialGradient></defs><circle cx="60" cy="60" r="58" fill="url(#tfg)"/><circle cx="60" cy="60" r="44" fill="none" stroke="var(--acc,#ff2a3d)" stroke-width="2" opacity=".7"/><ellipse class="eye" cx="44" cy="52" rx="6" ry="6" fill="var(--acc,#ff2a3d)"/><ellipse class="eye" cx="76" cy="52" rx="6" ry="6" fill="var(--acc,#ff2a3d)"/><ellipse id="tmouth" cx="60" cy="80" rx="14" ry="2" fill="var(--acc,#ff2a3d)"/></svg>`;
    f.onclick = () => r.click(); r.parentElement.insertBefore(f, r); r.style.display = "none";
  }
  let t = 0, blink = 0;
  cancelAnimationFrame(drawFace._raf);
  const loop = () => {
    const m = $("#tmouth"); if (!m) return; t++;
    const talk = speaking || (typeof LIVE !== "undefined" && LIVE && LIVE.speaking);
    m.setAttribute("ry", talk ? (3 + Math.abs(Math.sin(t / 3.1)) * 9 + Math.random() * 2).toFixed(1) : "2");
    if (++blink > 180) blink = 0; document.querySelectorAll("#tface .eye").forEach(e => e.setAttribute("ry", blink < 6 ? "1" : "6"));
    drawFace._raf = requestAnimationFrame(loop);
  };
  loop();
}

/* =================== UYGULAMA FABRİKASI + KENDİNİ GENİŞLETEN TİTUS / EKLENTİLER =================== */
function openHtml(html, title) {
  let o = $("#htmlView"); if (o) o.remove();
  o = document.createElement("div"); o.id = "htmlView"; o.innerHTML = `<div class="hvbar"><b>${esc(title || "Uygulama")}</b><button class="btn ghost" id="hvClose">✕ Kapat</button></div><iframe sandbox="allow-scripts allow-forms allow-modals allow-popups"></iframe>`;
  document.body.appendChild(o); o.querySelector("iframe").srcdoc = html; $("#hvClose").onclick = () => o.remove();
}
async function appFactory(g) {
  const html = fence(await plainGemini(`Tek dosyalık, tamamen bağımsız, mobil uyumlu bir HTML uygulaması/oyunu yaz.\nİSTEK: ${g}\nKurallar: CSS ve JavaScript aynı dosyada; dış bağlantı yok (gerekirse sadece https://cdn.jsdelivr.net); Türkçe arayüz; koyu tema, kırmızı vurgu; dokunmatik uyumlu; veriyi localStorage'da sakla (try/catch ile); hatasız çalışsın. Sadece <!DOCTYPE html> ile başlayan kodu döndür, açıklama yazma.`, [], null, { max: 16000, temperature: 0.4, nocache: true }));
  if (!/<html|<!doctype/i.test(html)) throw new Error("Uygulama kodu üretilemedi, tekrar dene.");
  const name = (await plainGemini(`Bu uygulama için 2-3 kelimelik Türkçe ad: ${g}. Sadece adı yaz.`, [], null, { max: 20 })).replace(/["\n]/g, "").slice(0, 30) || "Uygulamam";
  const r = await saveFile(new Blob([html], { type: "text/html" }), fname(name, "html"));
  const a = { id: uid(), n: name, html: html.length < 250000 ? html : "", yer: r.yer, at: localISO(new Date()), istek: g };
  X().apps = [a, ...XL("apps")].slice(0, 30); save(); openHtml(html, name);
  return { ok: true, uygulama: name, yer: r.yer, not: "Uygulamalarım'a eklendi; istediğin zaman açabilirsin." };
}
FN.appfactory = { input: "Ne yapayım? (ör. 'seçme günü için geri sayım ve kontrol listesi', 'basit hafıza oyunu')", ui: () => `<div class="sklist">${XL("apps").map(a => `<div class="item"><div class="ic">🧩</div><div class="t"><div class="h">${esc(a.n)}</div><div class="meta">${esc(a.at.slice(0, 10))} · ${esc(a.yer || "")}</div></div><button class="btn ghost" data-tapp="${a.id}">Aç</button><button class="x" data-coldel="apps:${a.id}">✕</button></div>`).join("")}</div>`, run: g => g ? appFactory(g) : { hata: "Ne yapayım?" } };
FN.extend = {
  ui: () => `<div class="hint">Kendi yeteneğini ekle: ad + ne yapacağını yaz. Titus onu da yetenek listesine katar ve sohbette kullanır. Uygulama fabrikasında yaptıkların da Uygulamalarım'da.</div><div class="sklist">${XL("userSkills").map(u => `<div class="item"><div class="ic">➕</div><div class="t"><div class="h">${esc(u.n)}</div><div class="meta">${esc(u.a.slice(0, 120))}</div></div><button class="x" data-coldel="userSkills:${u.id}">✕</button></div>`).join("") || '<div class="empty">Eklediğin yetenek yok.</div>'}</div><div class="form"><input id="usN" placeholder="Yetenek adı"><textarea id="usA" placeholder="Ne yapsın? (Gemini'ye talimat)"></textarea><label class="tg"><input type="checkbox" id="usW"> İnternette arasın</label><button class="btn" id="usAdd">+ Ekle</button></div>`,
  run: async g => { if (!g) return { yetenekler: XL("userSkills").map(u => u.n) }; const j = await geminiJSON(`Kullanıcı Titus'a yeni bir yetenek eklemek istiyor: "${g}". JSON: {"n":"kısa ad","a":"Gemini'ye ayrıntılı görev talimatı","w":true/false internet araması gerekir mi}`); XL("userSkills").push({ id: uid(), n: j.n, a: j.a, w: !!j.w }); save(); return { ok: true, eklendi: j.n }; }
};
document.addEventListener("click", e => {
  const t = e.target.closest("#usAdd,[data-tapp]"); if (!t) return;
  if (t.id === "usAdd") { const n = $("#usN").value.trim(), a = $("#usA").value.trim(); if (!n || !a) return toast("Ad ve talimat yaz"); XL("userSkills").push({ id: uid(), n, a, w: $("#usW").checked }); save(); refreshSkill(); toast("✓ Yetenek eklendi"); }
  else { const a = XL("apps").find(x => x.id === t.dataset.tapp); if (a && a.html) openHtml(a.html, a.n); else toast("Dosya: " + (a && a.yer)); }
});
{
  const baseApps = appsHTML;
  appsHTML = function () { const L = XL("apps"); return baseApps() + (L.length ? `<div class="card"><h3>TİTUS'UN YAPTIKLARI</h3><div class="appgrid">${L.map(a => `<button class="app" data-tapp="${a.id}"><i>🧩</i><b>${esc(a.n)}</b><small>${esc(a.at.slice(0, 10))}</small></button>`).join("")}</div></div>` : ""); };
}

/* =================== SİSTEM: test, durum, hız, önbellek, taşıma, gizlilik... =================== */
async function selfTest(onStep = () => {}) {
  await SKILLS_READY; const all = allSkills(); const rep = { toplam: all.length, kontrol: [], sorun: [] };
  const by = {}; all.forEach(s => { by[s.durum] = (by[s.durum] || 0) + 1; });
  for (const s of all) {
    if (s.k.startsWith("fn:") && !FN[s.k.slice(3)]) rep.sorun.push(s.n + ": işleyici yok (yapay zekâ göreviyle çalışır)");
    if (s.k.startsWith("tool:") && !TOOLS.find(t => t.name === s.k.split(":")[1])) rep.sorun.push(s.n + ": araç yok");
  }
  const chk = async (ad, f) => { onStep(ad); const t0 = Date.now(); try { const r = await f(); rep.kontrol.push(`✓ ${ad} (${Date.now() - t0} ms)${r ? " · " + r : ""}`); } catch (e) { rep.kontrol.push(`✗ ${ad}: ${e.message === "NOKEY" ? "anahtar yok" : e.message}`); } };
  await chk("Gemini beyni", async () => { const t = await plainGemini("Sadece 'tamam' yaz.", [], null, { max: 10, nocache: true }); if (!t) throw new Error("boş cevap"); });
  await chk("İnternet araması", async () => { const g = await grounded("Bugün İstanbul'da hava nasıl? Tek cümle.", 200); return g.src.length + " kaynak"; });
  await chk("Hesap çalışma alanı", async () => { const r = await runSandbox("return 6*7"); if (!r.ok || r.r !== 42) throw new Error(r.e || "yanlış sonuç"); });
  await chk("Hava durumu", async () => { await weather(); });
  for (const a of accounts()) await chk("Google: " + a.name, async () => { const j = await scriptAt(a, "ping"); return j.email || ""; });
  if (SET.groqKey) await chk("Groq yedek beyin", async () => { const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + SET.groqKey } }); if (!r.ok) throw new Error("HTTP " + r.status); });
  await chk("Word belgesi kütüphanesi", async () => { await loadLib("lib/docx.js"); if (!window.docx) throw new Error("yüklenmedi"); });
  await chk("Güncelleme sunucusu", async () => { const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`); if (!r.ok) throw new Error("HTTP " + r.status); });
  const ok = rep.kontrol.filter(x => x.startsWith("✓")).length;
  rep.ozet = `${all.length} yetenek kayıtlı (tam: ${by.tam || 0}, yapay zekâ ile: ${by.yz || 0}, kısmi: ${by["kısmi"] || 0}, yapılamayan: ${by.yok || 0}). Canlı kontroller: ${ok}/${rep.kontrol.length} başarılı.${rep.sorun.length ? " Yapısal uyarı: " + rep.sorun.length : " Yapısal sorun yok."}`;
  META.lastTest = { at: localISO(new Date()), ozet: rep.ozet }; saveMeta();
  return { metin: rep.ozet + "\n\n" + rep.kontrol.join("\n") + (rep.sorun.length ? "\n\n" + rep.sorun.join("\n") : ""), ...rep };
}
FN.selftest = { run: (g, s, ctx) => selfTest(x => { const o = $("#skOut"); if (o && !ctx.fromChat) o.textContent = "⏳ " + x; }) };
function statusText() {
  const q = META.q && META.q.d === today() ? META.q : { n: 0, err: 0 };
  const perf = (META.perf || []).slice(-30); const avg = perf.length ? Math.round(perf.reduce((a, b) => a + b.ms, 0) / perf.length) : 0;
  const hours = new Date().getHours() + new Date().getMinutes() / 60; const rate = hours > 0.5 ? q.n / hours : 0;
  return [`İnternet: ${navigator.onLine ? "var" : "YOK"}${navigator.connection ? " (" + navigator.connection.effectiveType + ")" : ""}`, `Beyin: ${SET.geminiKey ? SET.geminiModel : "Gemini anahtarı yok"}${SET.groqKey ? " · yedek Groq" : ""}`,
    `Google hesapları: ${accounts().length}`, `Telegram: ${SET.tgOn ? "bağlı" : "kapalı"}`, `Bugün Gemini isteği: ${q.n}${q.err ? " (kota hatası " + q.err + ")" : ""}`,
    `Kota tahmini: ${rate ? `saatte ~${rate.toFixed(0)} istek; bu hızla gün sonunda ~${Math.round(q.n + rate * (24 - hours))}` : "yeterli veri yok"} (ücretsiz katmanda modele göre günlük ~250–1000)`,
    `Ortalama cevap süresi: ${avg ? (avg / 1000).toFixed(1) + " sn" : "-"}`, `Pil: %${Math.round(BAT.level * 100)}${BAT.charging ? " şarjda" : ""}${batSave() ? " · tasarruf AÇIK" : ""}`,
    `Akışlı sesli cevap: açık (cevap gelirken konuşmaya başlar)`, `İnternetsiz kuyruk: ${(META.offq || []).length} iş`, `Son test: ${META.lastTest ? META.lastTest.at + " · " + META.lastTest.ozet : "hiç"}`].join("\n");
}
FN.status = { ui: () => `<pre class="skpre">${esc(statusText())}</pre>`, run: async () => ({ metin: statusText() }) };
FN.speed = { ui: () => speedHTML(), run: async () => { const p = (META.perf || []); if (p.length < 3) return { metin: "Henüz yeterli kullanım verisi yok." }; const slow = [...p].sort((a, b) => b.ms - a.ms).slice(0, 5); const ok = p.filter(x => x.ok).length; const al = XL("actlog"); const fail = al.filter(a => !a.ok); return { metin: `Son ${p.length} istek: ortalama ${(p.reduce((a, b) => a + b.ms, 0) / p.length / 1000).toFixed(1)} sn, başarı %${Math.round(ok / p.length * 100)}.\nEn yavaşlar: ${slow.map(s => `"${s.q}" ${(s.ms / 1000).toFixed(1)} sn`).join("; ")}\nAraç kullanımı: ${al.length} (başarısız ${fail.length}${fail.length ? ": " + [...new Set(fail.map(f => f.name))].join(", ") : ""}).\nÖneri: ${p.reduce((a, b) => a + b.ms, 0) / p.length > 6000 ? "Ayarlar → hız 'hızlı' yap ya da İnternete göre mod'u 'hafif' seç." : "Hız iyi görünüyor."}` }; } };
function speedHTML() { const p = (META.perf || []).slice(-24); if (!p.length) return '<div class="empty">Veri yok.</div>'; const mx = Math.max(...p.map(x => x.ms)); return `<div class="bars">${p.map(x => `<span title="${esc(x.q)}" style="height:${Math.max(4, x.ms / mx * 60)}px;background:${x.ok ? "var(--acc,#ff2a3d)" : "#666"}"></span>`).join("")}</div>`; }
FN.cache = { ui: () => `<label class="tg"><input type="checkbox" data-sk="cache" ${SET.cache !== false ? "checked" : ""}> Akıllı önbellek (aynı soruya 10 dk içinde anında cevap)</label><div class="hint">Önbellekte: ${GCACHE.size} cevap</div>`, run: async () => { GCACHE.clear(); return { ok: true, not: "Önbellek temizlendi." }; } };
FN.compress = { run: async () => { if (CHAT.length < 10) return { metin: "Sohbet zaten kısa." }; const old = CHAT.slice(0, -8); const sum = await plainGemini("Bu konuşmanın kalıcı önemi olan kısmını 4-6 cümlede özetle (kararlar, istekler, bilgiler):\n" + old.map(m => (m.role === "user" ? "Burak: " : "Titus: ") + m.content).join("\n").slice(-12000), [], null, { max: 500, nocache: true }); S.journal = [...(S.journal || []), { week: weekKey(), text: "Sohbet özeti: " + sum }].slice(-60); CHAT = CHAT.slice(-8); saveChat(); save(); drawChat(); return { ok: true, metin: "Sohbet sıkıştırıldı: " + sum }; } };
FN.prewarm = { run: async () => { const out = []; try { await script("briefData"); out.push("brifing verisi hazır"); } catch (e) { out.push("brifing: " + e.message); } try { await weather(); out.push("hava hazır"); } catch {} return { ok: true, metin: out.join(", ") }; } };
async function bootCheck(manual) {
  const p = [];
  if (!SET.geminiKey) p.push("Gemini anahtarı yok (Ayarlar → Beyin)");
  if (!navigator.onLine) p.push("İnternet yok — internetsiz komutlar ve kuyruk çalışıyor");
  if (SET.scriptUrl) { try { await script("ping"); } catch (e) { p.push("Google bağlantısı: " + e.message); } }
  try { await loadLib("lib/docx.js"); } catch { p.push("Belge kütüphanesi yüklenemedi"); }
  if (!SKILLS.length) p.push("Yetenek kataloğu yüklenemedi");
  if (p.length && (manual || !META.bootWarn || META.bootWarn !== p.join("|"))) { META.bootWarn = p.join("|"); saveMeta(); bubble("sys", "⚠️ Açılış kontrolü: " + p.join(" · ")); }
  return { ok: !p.length, sorunlar: p };
}
FN.bootcheck = { run: () => bootCheck(true) };
FN.backuptest = { run: async () => {
  if (!SET.scriptUrl) return { hata: "Google bağlı değil." };
  const r = [];
  try { const j = await script("load"); const d = j.data || {}; r.push(`✓ Drive senkron dosyası okunuyor: ${(d.reminders || []).length} hatırlatıcı, ${(d.tasks || []).length} görev, ${(d.notes || []).length} not, ${(d.memory || []).length} hafıza (${d.updatedAt ? new Date(d.updatedAt).toLocaleString("tr-TR") : "?"})`); } catch (e) { r.push("✗ Senkron dosyası: " + e.message); }
  try { const b = await script("getBackup", {}); r.push(b.data ? `✓ Şifreli yedek bulundu: ${b.name} (${Math.round(b.data.length * 0.75 / 1024)} KB) — geri yükleme Ayarlar → Yedek'ten şifreyle yapılır` : "• Şifreli yedek yok (Ayarlar → Yedek ile oluştur)"); } catch (e) { r.push("✗ Yedek: " + e.message); }
  return { metin: r.join("\n") };
} };
FN.migrate = {
  ui: () => `<div class="hint">Yeni telefona geçerken: buradan "Taşıma dosyası" kaydet (anahtarların da içinde — kimseyle paylaşma), yeni telefonda Titus'u kur ve "Taşıma dosyasını yükle"ye bas.</div><div class="row"><button class="btn" id="mgOut">💾 Taşıma dosyası kaydet</button><button class="btn ghost" id="mgIn">📂 Taşıma dosyasını yükle</button></div>`,
};
document.addEventListener("click", async e => {
  const t = e.target.closest("#mgOut,#mgIn"); if (!t) return;
  try {
    if (t.id === "mgOut") { const r = await saveFile(new Blob([JSON.stringify({ titus: 3, SET, S, META, CHAT })], { type: "application/json" }), "titus-tasima-" + today() + ".json"); toast("✓ " + r.yer, 5000); }
    else { const [f] = await pickFiles(".json,application/json"); if (!f) return; const o = JSON.parse(await f.text()); if (!o.titus || !o.SET) throw new Error("Bu bir Titus taşıma dosyası değil"); if (!(await confirmBox("Bu cihazdaki Titus verileri dosyadakilerle değiştirilsin mi?", "Değiştir"))) return; SET = Object.assign({ ...DEF_SET }, o.SET); S = Object.assign(EMPTY(), o.S || {}); CHAT = o.CHAT || []; Object.assign(META, o.META || {}); await saveSet(); save(); saveChat(); saveMeta(); toast("✓ Taşındı; uygulama yenileniyor"); setTimeout(() => location.reload(), 1200); }
  } catch (er) { toast("✗ " + er.message, 5000); }
});
FN.privacy = {
  ui: () => { const cats = [["Sohbet geçmişi", CHAT.length, "chat"], ["Kalıcı hafıza", (S.memory || []).length, "memory"], ["Notlar", (S.notes || []).length, "notes"], ["Harcamalar", (S.expenses || []).length, "expenses"], ["Kişiler", (S.people || []).length, "people"], ["Eylem günlüğü", XL("actlog").length, "actlog"], ["Kullanım istatistiği", (META.use || []).length + (META.perf || []).length, "use"], ["Kayıtlı dosya listesi", (S.files || []).length, "files"], ["Komut geçmişi", (META.hist || []).length, "hist"]];
    return `<div class="hint">Titus'un sakladığı her şey cihazında ve (bağlıysa) kendi Google Drive'ında durur. Hiçbir yere satılmaz/paylaşılmaz; yapay zekâ cevabı için sadece o anki istek Google Gemini'ye gider.</div><div class="sklist">${cats.map(c => `<div class="item"><div class="t"><div class="h">${c[0]}</div><div class="meta">${c[1]} kayıt</div></div><button class="x" data-pvdel="${c[2]}">Sil</button></div>`).join("")}</div>`; }
};
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-pvdel]"); if (!t) return; const k = t.dataset.pvdel;
  if (!(await confirmBox("Bu veriler kalıcı olarak silinsin mi?", "Sil"))) return;
  if (k === "chat") { CHAT = []; saveChat(); drawChat(); } else if (k === "use") { META.use = []; META.perf = []; saveMeta(); } else if (k === "hist") { META.hist = []; saveMeta(); } else if (k === "actlog") { X().actlog = []; save(); } else { S[k] = []; save(); }
  refreshSkill(); toast("✓ Silindi");
});
FN.offlineq = { ui: () => `<div class="hint">İnternet yokken verdiğin işler sıraya girer, bağlantı gelince yapılır. Sırada: ${(META.offq || []).length}</div>${(META.offq || []).map(q => `<div class="hint">• ${esc(q.t)}</div>`).join("")}` };
FN.offline = { ui: () => `<div class="hint">İnternetsiz çalışanlar: "10 dakika sonra … hatırlat", "yarın 9'da … hatırlat", "not al: …", "görev ekle: …", "alarm kur 7:30", "zamanlayıcı 5 dakika", "fener aç", "saat kaç". Cevaplar telefonun kendi sesiyle okunur. Diğer istekler internet gelince yapılmak üzere sıraya girer. Ses tanıma internetsizken telefonun kendi Türkçe tanıyıcısıyla (Ayarlar → Ses tanıma: cihaz) çalışır; tam ansiklopedi/yapay zekâ cevabı internetsiz yapılamaz.</div>` };
FN.history = { ui: () => `<div class="sklist">${(META.hist || []).slice(0, 40).map((h, i) => `<div class="item"><div class="t"><div class="h">${esc(h)}</div></div><button class="btn ghost" data-hist="${i}">↻</button></div>`).join("") || '<div class="empty">Geçmiş yok.</div>'}</div>` };
document.addEventListener("click", e => { const t = e.target.closest("[data-hist]"); if (t) { const h = (META.hist || [])[+t.dataset.hist]; if (h) { go("home"); send(h); } } });
FN.actionlog = { ui: () => `<div class="sklist">${XL("actlog").slice(0, 60).map(a => `<div class="item ${a.ok ? "" : "late"}"><div class="t"><div class="h">${esc(ACT_TR[a.name] || a.name)} ${a.ok ? "✓" : "✗"}</div><div class="meta">${esc(a.at.replace("T", " "))} · ${esc(a.args)} · ${a.ms} ms</div></div></div>`).join("") || '<div class="empty">Henüz işlem yok.</div>'}</div>` };
FN.undo = { run: async () => undoLast() };
FN.resume = { ui: () => { const j = (META.jobs || []).filter(x => !x.fin); return j.length ? j.map(x => `<div class="item"><div class="t"><div class="h">${esc(x.kind)}: ${esc(x.arg)}</div><div class="meta">${x.done.length} adım bitti</div></div><button class="btn ghost" data-resume="${x.id}">Devam</button></div>`).join("") : '<div class="empty">Yarım kalan iş yok.</div>'; } };
document.addEventListener("click", e => { const t = e.target.closest("[data-resume]"); if (!t) return; const j = (META.jobs || []).find(x => x.id === t.dataset.resume); if (j) { go("skills"); showSkill("f1-3"); runFromUI("research", j.arg); } });

/* =================== OTOMASYON: kurallar, zamanlı mesaj, rutin editörü, sihirli kelime =================== */
FN.rules = {
  ui: () => `<div class="hint">Örnekler: "her gün 08:00'de brifing ver", "pil %20'nin altına düşünce pil tasarrufunu aç", "bildirimde 'kargo' geçerse bana söyle", "uygulama açılınca bugünün görevlerini oku". Titus açıkken (uyandırma açıksa arka planda) çalışır.</div><div class="sklist">${XL("rules").map(r => `<div class="item"><div class="ic">⚡</div><div class="t"><div class="h">EĞER ${esc(r.tur)} ${esc(r.deger)}</div><div class="meta">O ZAMAN: ${esc(r.eylem)}${r.son ? " · son: " + esc(r.son) : ""}</div></div><button class="x" data-coldel="rules:${r.id}">✕</button></div>`).join("") || '<div class="empty">Kural yok.</div>'}</div>`,
  input: "Kuralı doğal dille yaz",
  run: async g => { if (!g) return { kurallar: XL("rules").map(r => `${r.tur} ${r.deger} → ${r.eylem}`) }; const j = await geminiJSON(`Kullanıcı bir otomasyon kuralı yazdı: "${g}". JSON: {"tur":"saat|pil|bildirim|acilis","deger":"saat ise HH:MM; pil ise yüzde sayısı; bildirim ise aranacak kelime; acilis ise boş","eylem":"koşul olunca Titus'a verilecek komut (Türkçe, tam cümle)"}`); if (!["saat", "pil", "bildirim", "acilis"].includes(j.tur)) return { hata: "Bu kuralı anlayamadım; saat, pil, bildirim ya da açılış koşulu kullan." }; const r = { id: uid(), ...j }; XL("rules").push(r); save(); return { ok: true, kural: `${r.tur} ${r.deger} → ${r.eylem}` }; }
};
let RULE_BUSY = false;
async function ruleTick(boot) {
  if (RULE_BUSY || busy) return; RULE_BUSY = true;
  try {
    const now = new Date(), hm = pad(now.getHours()) + ":" + pad(now.getMinutes()), d = today();
    for (const r of XL("rules")) {
      let fire = false;
      if (r.tur === "saat" && r.deger === hm && r.son !== d + hm) { fire = true; r.son = d + hm; }
      else if (r.tur === "pil" && !BAT.charging && BAT.level * 100 < Number(r.deger) && r.son !== d) { fire = true; r.son = d; }
      else if (r.tur === "acilis" && boot) fire = true;
      else if (r.tur === "bildirim" && Jarvis && now.getMinutes() % 5 === 0 && r.chk !== hm) { r.chk = hm; const n = await runTool("bildirimleri_oku", { limit: 15 }); const hit = JSON.stringify(n || {}); if (trLower(hit).includes(trLower(r.deger)) && r.son !== hash(hit)) { r.son = hash(hit); fire = true; } }
      if (fire) { save(); bubble("sys", "⚡ Kural: " + r.eylem); await send(r.eylem); }
    }
    for (const m of XL("sched")) if (!m.done && parseDate(m.at) <= now) { m.done = true; save(); if (await confirmBox(`Zamanlı mesaj zamanı geldi:\n${m.kim}: ${m.mesaj}`, "Gönder")) await runTool("whatsapp_mesaj", { kim: m.kim, mesaj: m.mesaj }); }
    if (SET.safetyDue && Date.now() > SET.safetyDue) { SET.safetyDue = 0; saveSet(); if (!(await confirmBox("Eve vardın mı? (Hayır dersen konumunu " + (SET.partnerName || "yakınına") + " gönderiyorum)", "Vardım", "Hayır, gönder"))) await safetyAlert("Eve dönüşte henüz varmadım, haberin olsun."); }
  } catch (e) { console.warn("rule", e); } finally { RULE_BUSY = false; }
}
setInterval(() => ruleTick(false), 30000); setTimeout(() => ruleTick(true), 9000);
FN.schedmsg = { ui: () => `<div class="sklist">${XL("sched").filter(m => !m.done).map(m => `<div class="item"><div class="t"><div class="h">${esc(m.kim)}: ${esc(m.mesaj)}</div><div class="meta">${esc(fmtWhen(m.at))}</div></div><button class="x" data-coldel="sched:${m.id}">✕</button></div>`).join("") || '<div class="empty">Zamanlı mesaj yok.</div>'}</div>`, input: "Kime, ne, ne zaman? (ör. 'yarın 10'da Kübra'ya iyi ki doğdun yaz')",
  run: async g => { const j = await geminiJSON(`Şu an ${localISO(new Date())}. Kullanıcı zamanlı mesaj istiyor: "${g}". JSON: {"kim":"","mesaj":"","at":"YYYY-MM-DDTHH:mm"}`); if (!j.kim || !j.mesaj || !parseDate(j.at)) return { hata: "Kime, ne ve ne zaman olduğunu anlayamadım." }; const m = { id: uid(), ...j }; XL("sched").push(m); save(); A.addReminder({ text: `📨 Zamanlı mesaj: ${j.kim} — ${j.mesaj.slice(0, 60)}`, due: j.at }); return { ok: true, not: `${fmtWhen(j.at)} için hazır; zamanı gelince bildirim gelir, tek dokunuşla WhatsApp'ta gönderirsin.` }; } };
FN.routineedit = {
  ui: () => `<div class="hint">Her rutinin adımlarını düzenleyebilirsin. Adım türleri: dnd, torch, speak, reminder, shiftEnd, whatsapp, app, url, focus, brief, plan, sleep, webhook.</div>${(S.routines || []).map((r, i) => `<div class="card"><b>${esc(r.name)}</b>${r.trigger ? ` · tetik: ${esc(r.trigger)}` : ""}<textarea data-rtn="${i}" style="min-height:90px;font-family:monospace;font-size:12px">${esc(JSON.stringify(r.steps || [], null, 1))}</textarea><div class="row"><button class="btn ghost" data-rtnsave="${i}">Kaydet</button><button class="btn ghost" data-rtnrun="${esc(r.name)}">Çalıştır</button><button class="x" data-rtndel="${i}">✕</button></div></div>`).join("") || '<div class="empty">Rutin yok. "Sihirli kelimeler" ile oluştur.</div>'}`
};
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-rtnsave],[data-rtnrun],[data-rtndel]"); if (!t) return;
  if (t.dataset.rtnsave !== undefined) { const i = +t.dataset.rtnsave; try { const steps = JSON.parse($(`[data-rtn="${i}"]`).value); if (!Array.isArray(steps)) throw new Error("Liste olmalı"); S.routines[i].steps = steps; save(); toast("✓ Rutin kaydedildi"); } catch (er) { toast("✗ Biçim hatalı: " + er.message, 5000); } }
  else if (t.dataset.rtnrun) { go("home"); send("Rutini çalıştır: " + t.dataset.rtnrun); }
  else { if (await confirmBox("Rutin silinsin mi?", "Sil")) { S.routines.splice(+t.dataset.rtndel, 1); save(); refreshSkill(); } }
});
FN.magic = { input: "Sihirli kelime ve ne yapacağı (ör. 'Gösteri zamanı: telefonu sessize al, feneri kapat, sahne notlarımı oku')", run: g => g ? { talimat: `rutin_olustur aracıyla şu sihirli kelime rutinini oluştur (rutinin adı sihirli kelime olsun): ${g}. Sonra oluşturduğunu tek cümleyle söyle.` } : { hata: "Kelime ve işleri yaz." } };

/* =================== AJANLAR =================== */
async function agentTeam(g, onStep = () => {}) {
  onStep("Araştırmacı çalışıyor");
  const subs = (await geminiJSON(`Görev: "${g}". ${userCtx()}\nBu iş için araştırılması gereken 2-4 alt konu. JSON: {"alt":["..."]}`)).alt || [g];
  const found = await Promise.all(subs.map(s => grounded("Araştır, Türkçe ve bilgi yoğun cevap ver: " + s + " (ana görev: " + g + ")", 1400).catch(() => ({ text: "", src: [] }))));
  const notes = found.map((f, i) => `## ${subs[i]}\n${f.text}`).join("\n\n"); const src = found.flatMap(f => f.src);
  onStep("Yazar taslağı yazıyor");
  const draft = await plainGemini(`Sen yazarsın. Görev: ${g}\n${userCtx()}\nAraştırma notları:\n${notes}\n\nGörevi eksiksiz yerine getiren çıktıyı Türkçe yaz (başlıklar, maddeler).`, [], null, { max: 5000, nocache: true });
  onStep("Denetçi kontrol ediyor");
  const fin = await plainGemini(`Sen titiz bir denetçi/editörsün. Görev: ${g}\nTaslak:\n${draft}\n\nAraştırma notları (doğruluk için):\n${notes.slice(0, 8000)}\n\nTaslağı kontrol et: hatalı/uydurma bilgi, eksik, çelişki, gereksiz uzunluk. Düzeltilmiş SON METNİ yaz; en sona "Denetçi notu:" ile 2-3 maddede neyi düzelttiğini ekle.`, [], null, { max: 6000, nocache: true });
  const d = await docFromText("Ekip çalışması — " + g.slice(0, 50), fin, ["", "KAYNAKLAR", ...src.slice(0, 15).map((s, i) => `[${i + 1}] ${s.title} — ${s.uri}`)]);
  return { metin: fin, belge: d.dosya, yer: d.yer };
}
FN.team = { input: "Büyük iş ne? (ör. 'Recast için 2026 sektör raporu', 'kısa film yatırım dosyası')", run: (g, s, ctx) => g ? agentTeam(g, x => { const o = $("#skOut"); if (o && !ctx.fromChat) o.textContent = "⏳ " + x; }) : { hata: "İşi yaz." } };
const T_ = s => ({ run: g => ({ talimat: s.replace("{g}", g || "") }) });
Object.assign(FN, {
  recastpack: T_("Recast tek komut paketi: {g}. Önce kadro_sorgula ile uygun oyuncuları bul; seçilenler için belge_hazirla ile portfolyo belgesi hazırla; her oyuncu/ilgili kişi için mail_taslagi ile kişiselleştirilmiş taslak oluştur (göndermeden). Sonunda ne yaptığını madde madde söyle."),
  shiftplan: T_("Vardiyalarımı, seçme/çekimlerimi, takvimimi ve görevlerimi birlikte değerlendir (takvim_listele kullan). Önümüzdeki 7 günde çakışmaları ve sıkışık günleri bul, çözüm öner; onaylarsam hatırlatıcı/görev ekle. {g}"),
  sundayplan: T_("Pazar akşamı haftalık planlama yap: takvim_listele ile gelecek haftaya bak; açık görevler, seçmeler, vardiyalar ve hedeflerle günlere yayılmış bir plan çıkar; en önemli 3 hedefi belirle; onaylarsam görev ve hatırlatıcı ekle. {g}"),
  prioritize: T_("Açık görevlerimi Eisenhower matrisine göre (acil-önemli / önemli-acil değil / acil-önemli değil / ikisi de değil) sırala; bugün yapmam gereken ilk 3 işi söyle. {g}"),
  procrastinate: T_("Erteleme önleyici: '{g}' işini 5-10 dakikalık küçük adımlara böl, adımları gorev_ekle ile ekle, ilk adım için 10 dakikalık odak_baslat başlat ve beni nazikçe motive et."),
  tasktree: T_("Görev ağacı: '{g}' hedefini ana adımlara ve alt görevlere böl (ağaç şeklinde göster); tarihleriyle gorev_ekle ile ekle."),
  rolecal: T_("Rol hazırlık takvimi: '{g}'. Çekim/seçme tarihine kadar günlük rol çalışma planı çıkar (metin ezberi, karakter analizi, fiziksel çalışma, prova); her günü gorev_ekle ile tarihli ekle ve önemli günlere hatırlatıcı kur."),
  auditionday: T_("Seçme günü modu: {g}. Seçmenin saatini ve adresini kayıtlardan bul; yol_suresi ile ne zaman çıkmam gerektiğini hesapla ve hatırlatıcı kur; hava durumuna bak; son tekrar için kısa bir plan ver; motive edici tek cümleyle bitir."),
  agenda: T_("Haftalık ekip toplantısı gündemi hazırla: açık ekip görevleri, son brief'ler, başvuru durumları ve takvimden derle; madde madde gündem çıkar ve istersem not_al ile kaydet. {g}"),
  weekly: T_("Ajans haftalık raporu: audition_oku ve kadro_sorgula araçlarıyla bu haftaki brief, gönderim ve dönüş sayılarını çıkar; kısa bir rapor yaz ve not_al ile kaydet. {g}"),
  rehearsal: T_("Prova çizelgesi: {g}. Ekibin uygun saatlerini değerlendir, çakışmasız prova planı öner; onaylarsam takvim_ekle ile takvime ekle."),
  nightq: { input: "Gece yapılacak iş (bilgisayardaki Titus yapar)", run: async g => { if (!g) return { hata: "İşi yaz." }; if (!SET.scriptUrl) return { hata: "Bilgisayar bağlantısı için Google bağlantısı gerekli." }; const { id } = await script("pcPush", { cmd: { action: "ask", arg: "GECE İŞİ (acele etme, bitince sonucu telefona not olarak gönder): " + g, night: true } }); XL("nightq").push({ id, g, at: localISO(new Date()) }); save(); return { ok: true, not: "Bilgisayardaki Titus'un kuyruğuna eklendi; bilgisayar açıkken yapıp sonucu sabah telefona gönderecek." }; } },
  pconly: { run: async (g, s) => { if (!SET.scriptUrl) return { hata: "Bu yetenek bilgisayardaki Titus'ta çalışır; önce bilgisayarı bağla (Ayarlar → Bilgisayar)." }; const { id } = await script("pcPush", { cmd: { action: "ask", arg: `yetenek_calistir aracını kullan: ad="${s.n}", girdi="${g}". Bitince sonucu telefona bildir.` } }); return { ok: true, not: `"${s.n}" bilgisayardaki Titus'a iletildi.`, id }; } },
  findphone: { ui: () => `<div class="hint">Telefonunu bulamazsan bilgisayardaki Titus'a "telefonumu çaldır" de: telefon (Titus açıkken / arka planda) yüksek sesle öter ve titrer.</div><button class="btn ghost" id="ringTest">Şimdi dene</button>` },
  screentime: { ui: () => `<div class="hint">Android'in ekran süresi istatistiğini okumak ayrı bir sistem izni ve yeni yerel kod gerektiriyor; bu sürümde yok. Yerine: Kurallar'a "her gün 23:00'te telefonu bırakmamı hatırlat" ekleyebilirsin. Telefonun kendi Dijital Denge ekranını açayım mı?</div><button class="btn ghost" id="dwOpen">Dijital Dengeyi aç</button>` },
  ambientsound: { ui: () => `<div class="hint">Kapı zili/alarm gibi ortam seslerini sürekli dinleyip tanımak ücretsiz ve pil dostu şekilde yapılamıyor; bu yetenek eklenmedi. Android'in kendi "Ses bildirimleri" özelliği (Erişilebilirlik) bunu yapıyor.</div>` }
});
document.addEventListener("click", e => { if (e.target.closest("#ringTest")) ringPhone(); if (e.target.closest("#dwOpen")) runTool("uygulama_ac", { ad: "Dijital Denge" }); });

/* =================== VERİYE DAYALI YAPAY ZEKÂ YETENEKLERİ =================== */
FN.brain = { input: "Ne arıyorsun? (notlarda, hafızada, belgelerde, maillerde)", run: async g => {
  if (!g) return { hata: "Ne arayayım?" };
  const nt = toks(g); const hit = arr => arr.filter(x => toks(JSON.stringify(x)).some(w => nt.some(q => w.startsWith(q.slice(0, 5))))).slice(0, 12);
  let kb = []; try { kb = await kbSearch(g, 5); } catch {}
  let mails = []; try { const r = await runTool("mail_ozeti", { query: g, max: 5 }); mails = r.hesaplar ? r.hesaplar.flatMap(h => (h.mailler || []).map(m => ({ ...m, hesap: h.hesap }))) : (r.mailler || []); } catch {}
  const ctx = { notlar: hit(S.notes || []).map(n => n.text), hafiza: hit(S.memory || []).map(m => m.text), belgeler: kb, mailler: mails.slice(0, 8), gunluk: hit(XL("journal")), kisiler: hit(XL("crm")), kararlar: hit(XL("decisions")) };
  const a = await plainGemini(`İkinci beyin araması. Soru: "${g}"\nKullanıcının kendi kayıtları:\n${JSON.stringify(ctx).slice(0, 20000)}\n\nSadece bu kayıtlara dayanarak Türkçe cevap ver; her bilginin nereden geldiğini (not/hafıza/belge/mail/günlük) parantezle belirt. Kayıtlarda yoksa açıkça söyle. Bağlantılı konular varsa sonunda "Bağlantılı:" ile göster.`, [], null, { max: 1600, nocache: true });
  return { metin: a, bulunan: Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, v.length])) };
} };
FN.doublecheck = { run: async g => {
  const last = [...CHAT].reverse().find(m => m.role === "assistant"); const q = [...CHAT].reverse().find(m => m.role === "user");
  const target = g || (last && last.content); if (!target) return { hata: "Kontrol edilecek cevap yok." };
  const prompt = `Bir yapay zekâ asistanının cevabını bağımsız olarak doğrula. Soru: ${q ? q.content : "(bilinmiyor)"}\nCevap: ${target}\n\nHata, uydurma, eksik ya da riskli bilgi var mı? Kısa Türkçe değerlendir: "Doğru", "Kısmen doğru" ya da "Yanlış" ile başla, sonra nedenini ve doğrusunu yaz.`;
  if (SET.groqKey) { try { const j = await httpJson("https://api.groq.com/openai/v1/chat/completions", { model: SET.groqModel || "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], max_tokens: 700 }, { Authorization: "Bearer " + SET.groqKey }); return { metin: "🔁 İkinci model (Groq Llama): " + j.choices[0].message.content }; } catch {} }
  const g2 = await grounded(prompt + " Gerekirse internette kontrol et.", 900); return { metin: "🔁 İkinci kontrol (internetle): " + g2.text, kaynaklar: g2.src.slice(0, 5) };
} };
FN.style = { ui: () => `<div class="hint">${SET.styleProfile ? "Kayıtlı tarzın: " + esc(SET.styleProfile) : "Henüz tarz kaydı yok."}</div>`, input: "Kendi yazdığın 2-3 mesaj/mail örneğini yapıştır", run: async g => { if (!g || g.length < 80) return { hata: "Tarzını öğrenmem için en az birkaç cümlelik kendi yazdığın örnekleri yapıştır." }; const p = await plainGemini(`Bu metinler kullanıcının kendi yazdıkları. Yazım tarzını başka bir yazar taklit edebilsin diye 5-7 maddede tarif et (hitap, cümle uzunluğu, samimiyet, emoji, kapanış, sık kullandığı ifadeler). Kısa yaz.\n\n${g}`, [], null, { max: 600, nocache: true }); SET.styleProfile = p.replace(/\n+/g, " ").slice(0, 900); saveSet(); return { ok: true, metin: "Tarzını öğrendim: " + p }; } };
FN.inbox = { run: async () => {
  const r = await runTool("mail_ozeti", { query: "in:inbox newer_than:3d", max: 15 }); if (r.hata) return r;
  const mails = r.hesaplar ? r.hesaplar.flatMap(h => (h.mailler || []).map(m => ({ ...m, hesap: h.hesap }))) : (r.mailler || []).map(m => ({ ...m, hesap: r.hesap }));
  if (!mails.length) return { metin: "Son 3 günde mail yok." };
  return { metin: await plainGemini(`Bu mailleri (birden fazla hesaptan olabilir) şu gruplara ayır: 📋 Brief/iş teklifi, 📨 Başvuru dönüşü, 💳 Fatura/ödeme, 👥 Kişisel, 📰 Bülten/reklam. Her grubu önem sırasına koy; cevap gerekenleri ⚠️ ile işaretle; hangi hesaptan geldiğini yaz. Kısa.\n\n${JSON.stringify(mails).slice(0, 18000)}`, [], null, { max: 1500 }) };
} };
FN.trends = { run: async () => { let items = []; try { items = (await script("radarGet")).items || []; } catch (e) { return { hata: "Radar okunamadı: " + e.message }; } if (!items.length) return { metin: "Radarda ilan yok; önce Kariyer → Radar'dan casting sitelerini ekle." }; return { metin: await plainGemini(`Bu casting ilanlarından istatistik çıkar: en çok aranan yaş aralıkları, cinsiyet, tipler/özellikler, proje türleri (dizi/film/reklam), şehirler. Yüzdelerle kısa özet ve kullanıcıya (erkek oyuncu) 2 öneri.\n\n${items.slice(0, 120).map(i => i.title).join("\n")}`, [], null, { max: 1200 }) }; } };
async function rosterRows() { if (!SET.kadroSheetId) throw new Error("KADRO tablosu bağlı değil (Ayarlar → İş bağlantıları)."); const r = await script("roster", { sheetId: SET.kadroSheetId }); return r; }
FN.kadroclean = { run: async () => { const r = await rosterRows(); return { metin: await plainGemini(`KADRO oyuncu tablosu (başlıklar + satırlar). Veri temizliği yap: aynı kişinin tekrar eden kayıtları, eksik kritik alanlar (telefon, yaş, şehir, fotoğraf linki), tutarsız biçimler (telefon, tarih). Satır numaralarıyla liste ver ve düzeltme öner.\n\n${JSON.stringify(r).slice(0, 30000)}`, [], null, { max: 2500 }) }; } };
FN.sheetask = { input: "KADRO'ya ne sormak istersin? (ör. 'İstanbul'da 25-35 yaş kaç erkek oyuncu var, şehirlere göre dağılım')", run: async g => { if (!g) return { hata: "Soru yaz." }; const r = await rosterRows(); const j = await geminiJSON(`Tablo: ${JSON.stringify(r).slice(0, 30000)}\nSoru: "${g}"\nTabloyu dikkatle say ve cevapla. JSON: {"cevap":"Türkçe kısa cevap","tablo":[["başlık",...],[...]],"grafik":{"tur":"bar","baslik":"","etiketler":[],"degerler":[]}}`); return { metin: j.cevap, html: tableHTML(j.tablo) + (j.grafik && j.grafik.degerler ? chartSVG(j.grafik) : "") }; } };
FN.auditionstats = { run: async () => { const ap = S.applications || []; if (!ap.length && !(S.auditions || []).length) return { metin: "Henüz başvuru/seçme kaydı yok." }; const by = {}; ap.forEach(a => { by[a.status] = (by[a.status] || 0) + 1; }); const pos = (by.olumlu || 0) + (by.callback || 0) + (by["geri dönüş"] || 0); const t = [["Durum", "Sayı"], ...Object.entries(by)]; return { metin: `Toplam ${ap.length} başvuru, ${(S.auditions || []).length} seçme/çekim. Dönüş oranı ~%${ap.length ? Math.round(pos / ap.length * 100) : 0}.`, html: tableHTML(t) + chartSVG({ tur: "bar", baslik: "Başvuru durumları", etiketler: Object.keys(by), degerler: Object.values(by) }) }; } };
FN.summary = { input: "Özetlenecek metni yapıştır ya da 📎 dosya ekle", run: async g => { const parts = attParts(); if (!g && !parts.length) return { hata: "Metin ya da dosya ver." }; return { metin: await plainGemini(`Şu içeriği üç seviyede özetle:\n# Tek cümle\n# Bir paragraf\n# Detaylı (maddeler, önemli rakamlar)\n\n${g || "(ekteki dosya)"}`, parts, null, { max: 2500 }) }; } };
FN.chatmap = { run: async () => { if (CHAT.length < 4) return { metin: "Sohbet çok kısa." }; return { metin: await plainGemini("Bu sohbette konuşulan başlıkları sırayla çıkar (her biri tek satır, kısa) ve her başlığın sonucunu (karar/yapıldı/açık) yaz:\n" + CHAT.map(m => (m.role === "user" ? "Burak: " : "Titus: ") + m.content).join("\n").slice(-15000), [], null, { max: 900 }) }; } };
FN.interests = { ...colFn("interests"), run: async g => { if (g) return colRun("interests", g); const t = await geminiJSON(`Kullanıcının hafızası ve son konuşmalarından ilgi alanlarını çıkar. Hafıza: ${(S.memory || []).map(m => m.text).join("; ")}\nKonuşmalar: ${CHAT.filter(m => m.role === "user").map(m => m.content).join(" | ").slice(-5000)}\nJSON: {"alanlar":["..."]}`); X().interests = (t.alanlar || []).map(a => ({ id: uid(), alan: a })); save(); return { ok: true, metin: "İlgi alanların: " + (t.alanlar || []).join(", ") }; } };
FN.yearreview = { run: async () => { const tl = timeline().filter(e => e.d.startsWith(String(new Date().getFullYear()))); const exp = (S.expenses || []).filter(e => (e.date || "").startsWith(String(new Date().getFullYear()))).reduce((a, b) => a + b.amount, 0); const t = await plainGemini(`Kullanıcının ${new Date().getFullYear()} yılı kayıtları:\n${tl.map(e => `${e.d} ${e.k}: ${e.t}`).join("\n").slice(0, 20000)}\nToplam kayıtlı harcama: ${money(exp)}. Alışkanlıklar: ${(S.habits || []).map(h => h.name + " " + h.log.length + " gün").join(", ")}\n\nSıcak ve motive edici bir "Yılın Özeti" raporu yaz: öne çıkanlar, roller/seçmeler, işler, alışkanlıklar, rakamlarla yıl, öğrenilenler, gelecek yıl için 3 hedef önerisi.`, [], null, { max: 3000 }); const d = await docFromText("Yılın Özeti " + new Date().getFullYear(), t); return { metin: t, belge: d.dosya, yer: d.yer }; } };
FN.onthisday = { run: async () => { const d = new Date(); const key = (d.getFullYear() - 1) + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); const hits = timeline().filter(e => e.d.slice(0, 10) === key); return { metin: hits.length ? "Geçen yıl bugün: " + hits.map(h => `${h.k} ${h.t}`).join("; ") : "Geçen yıl bugüne ait kaydın yok." }; } };
FN.habits = { run: async () => { const u = META.use || []; if (u.length < 15) return { metin: "Seni tanımak için biraz daha kullanım lazım (şu an " + u.length + " kayıt)." }; const by = {}; u.forEach(x => { const k = x.h + ":" + x.k; by[k] = (by[k] || 0) + 1; }); const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25); return { metin: await plainGemini(`Kullanım kayıtları (saat:iş → kaç kez): ${JSON.stringify(top)}\nGün ritmine dair 3 gözlem (hangi saatlerde ne yapıyor, en verimli saatler) ve otomatik rutin olarak kurulabilecek 2-3 öneri yaz (ör. 'her sabah 9'da brifing'). Kısa.`, [], null, { max: 800 }) }; } };
FN.proactive = { run: async () => { try { await proactive(true); } catch {} return { ok: true, not: "Proaktif kontrol yapıldı; öneri varsa sohbette." }; } };
FN.slots = { input: "Kime, ne için ve kaç dakikalık randevu?", run: async g => { let ev = []; try { ev = (await runTool("takvim_listele", { days: 7 })).etkinlikler || []; } catch {} const t = await plainGemini(`Önümüzdeki 7 günün takvimi: ${JSON.stringify(ev)}\nVardiyalar: ${JSON.stringify((S.shifts || []).slice(-14))}\nŞu an ${localISO(new Date())}. İstek: ${g || "1 saatlik görüşme"}\n10:00-19:00 arasındaki boş zamanlardan 3-4 uygun aralık seç; sonra bu saatleri öneren kibar bir mail metni yaz (konu satırıyla).`, [], null, { max: 1200, nocache: true }); return { metin: t, not: "İstersen 'bunu mail taslağı yap' de." }; } };
FN.outfit = { run: async g => { const w = await weather(); return { metin: await plainGemini(`Hava: ${JSON.stringify(w)}. Bugünkü planlar: ${JSON.stringify((S.auditions || []).filter(a => (a.date || "").startsWith(today())))} ${JSON.stringify((S.shifts || []).filter(s => s.date === today()))}. ${g || ""}\nBurak için bugün ne giymeli? Kısa ve pratik öneri (seçme varsa kameraya uygun sade renkler).`, [], null, { max: 400 }) }; } };
FN.fx = { run: async () => { const r = await (await fetch("https://open.er-api.com/v6/latest/USD")).json(); if (r.result !== "success") throw new Error("Kur alınamadı"); const t = r.rates.TRY; const eur = t / r.rates.EUR, gbp = t / r.rates.GBP; let gold = ""; try { gold = (await grounded("Bugün gram altın ve çeyrek altın kaç TL? Tek cümle.", 150)).text; } catch {} return { metin: `💵 1 USD = ${t.toFixed(2)} ₺ · 💶 1 EUR = ${eur.toFixed(2)} ₺ · 💷 1 GBP = ${gbp.toFixed(2)} ₺ (${r.time_last_update_utc.slice(5, 16)})${gold ? "\n🥇 " + gold : ""}` }; } };
FN.device = { run: async () => { const o = []; o.push(`Pil: %${Math.round(BAT.level * 100)}${BAT.charging ? " (şarjda)" : ""}`); try { const e = await navigator.storage.estimate(); o.push(`Titus depolaması: ${(e.usage / 1048576).toFixed(1)} MB`); } catch {} if (navigator.deviceMemory) o.push(`Bellek: ~${navigator.deviceMemory} GB`); o.push(`Kayıtlı dosya: ${(S.files || []).length}, belge: ${(S.docs || []).length}`); return { metin: o.join("\n") + "\n\nÖneri: " + (BAT.level < 0.25 && !BAT.charging ? "Pil düşük: pil dostu modu aç." : "Durum iyi.") + " Bilgisayar için: 'bilgisayarın durumunu söyle' de." }; } };
FN.ambient = { run: async () => { ambientOn(); return { ok: true }; } };
async function ambientOn() {
  let o = $("#ambient"); if (o) return; o = document.createElement("div"); o.id = "ambient"; document.body.appendChild(o);
  let lock = null; try { lock = await navigator.wakeLock.request("screen"); } catch {}
  let w = ""; try { const x = await weather(); w = x.simdi || ""; } catch {}
  const draw = () => { const d = new Date(); const nx = S.reminders.filter(r => !r.done).sort((a, b) => a.due.localeCompare(b.due))[0]; o.innerHTML = `<div class="amClock">${pad(d.getHours())}:${pad(d.getMinutes())}</div><div class="amDate">${DAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}</div><div class="amW">${esc(w)}</div>${nx ? `<div class="amN">⏰ ${esc(nx.text)} · ${fmtWhen(nx.due)}</div>` : ""}<div class="amHint">Çıkmak için dokun</div>`; };
  draw(); const iv = setInterval(draw, 20000); o.onclick = () => { clearInterval(iv); try { lock && lock.release(); } catch {} o.remove(); };
}
FN.shared = { ui: () => `<div class="hint">Ortak liste Google E-Tablolar'da tutulur; linki sevdiklerinle paylaşınca onlar da görür/ekler.</div>${SET.sharedUrl ? `<button class="btn ghost" id="shOpen">Ortak listeyi aç</button>` : ""}`, input: "Ortak listeye ekle ya da 'listeyi göster' (ör. 'market: süt, ekmek')", run: async g => { const r = await script("sharedList", /göster|listele|neler var/.test(trLower(g)) || !g ? {} : { add: g }); SET.sharedUrl = r.url; saveSet(); return { ok: true, liste: r.rows, link: r.url }; } };
document.addEventListener("click", e => { if (e.target.closest("#shOpen")) openUrl(SET.sharedUrl); });
FN.teamprofiles = { ui: () => `<div class="hint">Ekip arkadaşının telefonuna Titus'u kurması yeterli; kendi Gemini anahtarını ve kendi Google bağlantısını kendisi girer. Ortak işler için "Ekip görevleri" ve "Sevdiklerinle ortak alan" (paylaşılan tablo) kullanılır. Senin anahtarlarını içeren eşleştirme kodunu başkasıyla PAYLAŞMA.</div>` };
FN.safety = { input: "Kaç dakika sonra eve varmış olursun? ya da 'acil'", run: async g => { if (/acil|yardım|tehlike/.test(trLower(g))) return safetyAlert("🚨 Acil durum, yardıma ihtiyacım olabilir."); const n = Number((g.match(/\d+/) || [])[0]) || 45; SET.safetyDue = Date.now() + n * 6e4; saveSet(); A.addReminder({ text: "🏠 Eve vardın mı? Titus'a 'vardım' de.", due: localISO(new Date(SET.safetyDue)) }); return { ok: true, not: `${n} dakika sonra soracağım; cevap vermezsen ${SET.partnerName || "yakınına"} konumunla mesaj hazırlarım. Varınca "vardım" de.` }; } };
async function safetyAlert(msg) { let loc = ""; try { const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })); loc = ` Konumum: https://maps.google.com/?q=${p.coords.latitude},${p.coords.longitude}`; } catch {} return runTool("whatsapp_mesaj", { kim: SET.partnerName || "Kübra", mesaj: msg + loc }); }
{ const baseSend2 = send; send = async function (text, byVoice, attach, label) { if (SET.safetyDue && /^(eve )?vardım|evdeyim$/i.test(String(text || "").trim())) { SET.safetyDue = 0; saveSet(); bubble("assistant", "Sevindim, iyi geceler. 🏠"); return; } return baseSend2(text, byVoice, attach, label); }; }
async function notifAutoRun(manual) {
  if (!Jarvis) return { hata: "Bildirim okuma sadece telefonda." };
  const n = await runTool("bildirimleri_oku", { limit: 30 }); const list = n.bildirimler || n.notifications || n.items || [];
  const bank = list.filter(x => /harcama|ödeme|tutar|TL|₺|kartınız|POS|alışveriş|çekildi/i.test(JSON.stringify(x))).filter(x => !(META.bankSeen || []).includes(hash(JSON.stringify(x))));
  if (!bank.length) return { metin: manual ? "Yeni banka bildirimi yok." : "" };
  const j = await geminiJSON(`Bu banka/ödeme bildirimlerinden harcamaları çıkar (para girişi değil, sadece çıkış). JSON: {"harcamalar":[{"tutar":sayı,"yer":"","kategori":"Yemek|Market|Ulaşım|Kira|Fatura|Eğlence|Kişisel|Sağlık|Diğer"}]}\n${JSON.stringify(bank).slice(0, 6000)}`);
  META.bankSeen = [...(META.bankSeen || []), ...bank.map(x => hash(JSON.stringify(x)))].slice(-300); saveMeta();
  const hs = (j.harcamalar || []).filter(h => h.tutar > 0);
  for (const h of hs) A.addExpense({ amount: h.tutar, category: h.kategori || "Diğer", note: "🏦 " + (h.yer || "banka bildirimi") });
  if (hs.length) toast(`🏦 ${hs.length} harcama bildirimden eklendi`, 4000);
  return { ok: true, eklenen: hs };
}
setInterval(() => { if (SET.notifAuto && !document.hidden) notifAutoRun(false).catch(() => {}); }, 20 * 6e4);
function reelScan() { let n = 0; for (const a of S.auditions || []) if (a.done && /çekim/.test(a.type || "") && !a.reelAsked) { a.reelAsked = 1; n++; A.addReminder({ text: `🎞 "${a.title}" çekimi bitti: görüntüler gelince showreel'i güncelle.`, due: ymd(new Date(Date.now() + 21 * 864e5)) + "T12:00" }); } if (n) save(); return { ok: true, not: n ? n + " çekim için showreel hatırlatması kuruldu." : "Yeni biten çekim yok." }; }
setInterval(() => { if (SET.reelRemind) reelScan(); }, 30 * 6e4);
FN.devpanel = { ui: () => `<input data-sk="ghUser" value="${esc(SET.ghUser || "Mendusa27")}" placeholder="GitHub kullanıcı adı"><input data-sk="ghToken" type="password" value="${esc(SET.ghToken || "")}" placeholder="GitHub token (isteğe bağlı; özel projeler için)">`, run: async () => {
  const H = SET.ghToken ? { Authorization: "Bearer " + SET.ghToken } : {}; const u = SET.ghUser || "Mendusa27";
  const repos = await (await fetch(`https://api.github.com/users/${u}/repos?sort=pushed&per_page=6`, { headers: H })).json(); if (!Array.isArray(repos)) throw new Error(repos.message || "GitHub okunamadı");
  const rows = await Promise.all(repos.map(async r => { let run = ""; try { const j = await (await fetch(`https://api.github.com/repos/${r.full_name}/actions/runs?per_page=1`, { headers: H })).json(); const x = j.workflow_runs && j.workflow_runs[0]; if (x) run = `${x.conclusion === "success" ? "✅" : x.conclusion === "failure" ? "❌" : "⏳"} ${x.name} #${x.run_number}`; } catch {} return [r.name, (r.pushed_at || "").slice(0, 10), run || "-"]; }));
  return { metin: `${u}: son ${rows.length} proje`, html: tableHTML([["Proje", "Son değişiklik", "Son derleme"], ...rows]) };
} };
FN.releasenotes = { input: "Proje (varsayılan Jarvis-1)", run: async g => { const repo = /\//.test(g) ? g : `${SET.ghUser || "Mendusa27"}/${g || "Jarvis-1"}`; const H = SET.ghToken ? { Authorization: "Bearer " + SET.ghToken } : {}; const c = await (await fetch(`https://api.github.com/repos/${repo}/commits?per_page=25`, { headers: H })).json(); if (!Array.isArray(c)) throw new Error(c.message || "Okunamadı"); return { metin: await plainGemini(`Bu commit mesajlarından kullanıcıların anlayacağı Türkçe sürüm notu yaz (Yenilikler / Düzeltmeler / İyileştirmeler):\n${c.map(x => "- " + x.commit.message.split("\n")[0]).join("\n")}`, [], null, { max: 1000 }) }; } };
FN.repobackup = { input: "Proje adı (ör. Jarvis-1)", run: async g => { const repo = /\//.test(g) ? g : `${SET.ghUser || "Mendusa27"}/${g || "Jarvis-1"}`; const r = await script("urlToDrive", { url: `https://api.github.com/repos/${repo}/zipball`, name: repo.replace("/", "-") + "-" + today() + ".zip", folder: "Titus Proje Yedekleri", auth: SET.ghToken || "" }); return { ok: true, not: "Drive'a yedeklendi: Titus Proje Yedekleri/" + r.name }; } };
FN.web = { ui: () => `<div class="hint">Titus'un web sürümü (bilgisayar tarayıcısından): <b>https://mendusa27.github.io/Jarvis-1/</b> — ilk açılışta Gemini anahtarını oraya da girersin. Bir kerelik açma: GitHub'da projede Settings → Pages → Source: "GitHub Actions", sonra Actions → "Titus web sürümü" → Run workflow. Telefon özellikleri (alarm, bildirim, ekran) web'de çalışmaz; sohbet, belge, araştırma, yetenekler çalışır.</div><button class="btn ghost" id="webOpen">Aç</button>` };
document.addEventListener("click", e => { if (e.target.closest("#webOpen")) openUrl("https://mendusa27.github.io/Jarvis-1/"); });

/* =================== SES / VİDEO / FOTOĞRAF YETENEKLERİ =================== */
function wavFromBuffers(bufs) {
  const rate = bufs[0].sampleRate; const len = bufs.reduce((a, b) => a + b.length, 0) + bufs.length * Math.round(rate * 0.25);
  const pcm = new Int16Array(len); let o = 0;
  for (const b of bufs) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) pcm[o++] = Math.max(-1, Math.min(1, d[i])) * 32767; o += Math.round(rate * 0.25); }
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf); const w = (p, s) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm); return new Blob([buf], { type: "audio/wav" });
}
function chunkTxt(t, n = 380) { const out = []; let cur = ""; for (const s of String(t).split(/(?<=[.!?…])\s+|\n+/)) { if ((cur + " " + s).length > n && cur) { out.push(cur.trim()); cur = s; } else cur += " " + s; } if (cur.trim()) out.push(cur.trim()); return out.filter(Boolean); }
async function audiobook(text, onStep = () => {}) {
  if (!SET.geminiKey) throw new Error("NOKEY");
  const vmap = {}; XL("voices").forEach(v => { if (v.karakter && v.ses) vmap[deacc(v.karakter)] = v.ses; });
  const lines = String(text).split("\n").filter(l => l.trim()); const segs = [];
  for (const l of lines) { const m = l.match(/^\s*([A-ZÇĞİÖŞÜa-zçğıöşü ]{2,20}):\s*(.+)/); const v = m && vmap[deacc(m[1].trim())]; for (const c of chunkTxt(v ? m[2] : l)) segs.push({ c, v: v || null }); }
  if (segs.length > 80) throw new Error("Metin çok uzun (en fazla ~25.000 karakter). Bölerek ver.");
  const bufs = []; const orig = SET.ttsVoice;
  try { for (let i = 0; i < segs.length; i++) { onStep(`Seslendiriliyor ${i + 1}/${segs.length}`); if (segs[i].v) SET.ttsVoice = segs[i].v; else SET.ttsVoice = orig; bufs.push(await geminiTtsBuffer(segs[i].c)); await sleep(350); } } finally { SET.ttsVoice = orig; }
  const r = await saveFile(wavFromBuffers(bufs), fname("seslendirme", "wav"), "music");
  return { ok: true, yer: r.yer, parca: segs.length };
}
FN.audiobook = { input: "Seslendirilecek metin (karakterli metinde 'AD: replik' biçimi; sesleri Karakter ses bankası'ndan)", run: (g, s, ctx) => { const parts = attParts(); if (!g && !parts.length) return { hata: "Metin yapıştır." }; return audiobook(g, x => { const o = $("#skOut"); if (o && !ctx.fromChat) o.textContent = "⏳ " + x; }); } };

async function mediaAsk(prompt, parts, json) { if (!parts.length) throw new Error("Önce 📎 ile dosya/fotoğraf ekle."); return json ? geminiJSON(prompt, parts) : plainGemini(prompt, parts, null, { max: 3500 }); }
async function recorderRun(g) {
  let parts = attParts();
  if (!parts.length) { const b = await recordDialog("KAYIT", "Görüşme/prova kaydediliyor (en fazla 9 dk). Karşı tarafın onayını almayı unutma.", 540); if (!b) return { iptal: true }; parts = [{ inlineData: { mimeType: "audio/wav", data: b } }]; }
  const j = await geminiJSON(`Bu ses/video kaydını dinle. Konuşmacıları ayır (Konuşmacı 1, 2… ya da isim geçiyorsa isimle). ${g || ""}\nJSON: {"baslik":"","dokum":"konuşmacılı tam döküm (uzunsa önemli kısımlar)","ozet":"5-8 cümle","kararlar":["..."],"gorevler":[{"is":"","kim":"","tarih":"YYYY-MM-DD ya da boş"}]}`, parts);
  A.addNote({ text: `🎙 ${j.baslik || "Kayıt"}\n${j.ozet}\nKararlar: ${(j.kararlar || []).join("; ")}`, project: "Kayıtlar" });
  const gs = j.gorevler || []; if (gs.length && await confirmBox(`${gs.length} görev bulundu, eklensin mi?\n${gs.map(x => "• " + x.is).join("\n")}`, "Ekle")) gs.forEach(x => A.addTask({ text: x.is + (x.kim ? " (" + x.kim + ")" : ""), date: x.tarih || "" }));
  let d = null; try { d = await docFromText(j.baslik || "Kayıt dökümü", `# Özet\n${j.ozet}\n# Kararlar\n${(j.kararlar || []).map(k => "- " + k).join("\n")}\n# Görevler\n${gs.map(x => "- " + x.is).join("\n")}\n# Döküm\n${j.dokum}`); } catch {}
  return { metin: `${j.baslik || ""}\n${j.ozet}\n\nKararlar: ${(j.kararlar || []).join("; ") || "-"}\nGörevler: ${gs.map(x => x.is).join("; ") || "-"}`, belge: d && d.dosya };
}
FN.recorder = { input: "İsteğe bağlı: kayıt ne hakkında? (📎 ile ses/video dosyası da ekleyebilirsin; yoksa kayıt başlar)", run: g => recorderRun(g) };
FN.voicemsg = { input: "📎 ile sesli mesaj dosyasını ekle", run: async () => ({ metin: await mediaAsk("Bu sesli mesajı yazıya dök, sonra 2-3 cümlede özetle ve cevap gerekiyorsa kısa bir cevap önerisi yaz.", attParts()) }) };
FN.videosearch = { input: "Videoda ne arıyorsun? (📎 video ekle, en fazla 15 MB)", run: async g => ({ metin: await mediaAsk(`Bu videoyu izle. ${g ? `"${g}" ile ilgili yerleri dakika:saniye zamanlarıyla bul.` : "Olayların zaman çizelgesini (dakika:saniye) çıkar ve kısa döküm yaz."}`, attParts()) }) };
FN.camask = { input: "Ne sormak istiyorsun?", run: async g => { let parts = attParts(); if (!parts.length) { const d = await camShot(); if (!d) return { iptal: true }; parts = [{ inlineData: { mimeType: "image/jpeg", data: d } }]; } return { metin: await plainGemini(g || "Bu fotoğrafta ne var? Kısaca açıkla ve işime yarayacak bir bilgi ver.", parts, null, { max: 1200 }) }; } };
FN.camtranslate = { input: "Hangi dile? (varsayılan Türkçe)", run: async g => { let parts = attParts(); if (!parts.length) { const d = await camShot(); if (!d) return { iptal: true }; parts = [{ inlineData: { mimeType: "image/jpeg", data: d } }]; } return { metin: await plainGemini(`Fotoğraftaki tüm yazıyı (el yazısı dahil) aynen oku ve yaz; sonra ${g || "Türkçeye"} çevir. Biçim: ORİJİNAL: … / ÇEVİRİ: …`, parts, null, { max: 2000 }) }; } };
FN.billread = { run: async () => { let parts = attParts(); if (!parts.length) { const d = await camShot(); if (!d) return { iptal: true }; parts = [{ inlineData: { mimeType: "image/jpeg", data: d } }]; } const j = await geminiJSON(`Bu bir fatura. JSON: {"ad":"kurum/fatura türü","tutar":sayı,"son_odeme":"YYYY-MM-DD","donem":""}`, parts); const r = await runTool("fatura_ekle", { name: j.ad || "Fatura", amount: Number(j.tutar) || 0, day: j.son_odeme ? Number(j.son_odeme.slice(8, 10)) : 1, kind: "fatura" }); if (j.son_odeme && parseDate(j.son_odeme) > new Date()) A.addReminder({ text: `🧾 ${j.ad} faturası son gün (${money(Number(j.tutar) || 0)})`, due: ymd(new Date(parseDate(j.son_odeme) - 2 * 864e5)) + "T10:00" }); return { ok: true, fatura: j, kayit: r }; } };
FN.mirror = { input: "Hedef duygu/ifade (ör. 'kırgın ama gururlu')", run: async g => { let parts = attParts(); if (!parts.length) { const d = await camShot(); if (!d) return { iptal: true }; parts = [{ inlineData: { mimeType: "image/jpeg", data: d } }]; } return { metin: await plainGemini(`Bir oyunculuk koçusun. Fotoğraftaki yüz ifadesini oku (göz, kaş, ağız, çene, gerginlik). Hedef ifade: "${g || "doğal ve sakin"}". Ne kadar örtüşüyor (0-100)? Neyi değiştirmeli? 3 somut öneri. Kısa.`, parts, null, { max: 900 }) }; } };
FN.besttake = { input: "📎 aynı repliğin 2-5 kaydını ekle (video/ses, her biri ≤15 MB)", run: async g => { const parts = attParts(); if (parts.length < 2) return { hata: "En az 2 kayıt ekle." }; return { metin: await mediaAsk(`Bunlar aynı sahnenin/repliğin ${parts.length} farklı denemesi (sırayla 1, 2, …). ${g || ""} Her birini oyunculuk açısından puanla (inandırıcılık, metne sadakat, tempo, ses, görüntü) ve en iyisini nedeniyle seç.`, parts) }; } };
FN.phototheme = { run: async g => { const key = today(); if (!META.ptheme || META.ptheme.d !== key) { META.ptheme = { d: key, t: await plainGemini("Bugün için yaratıcı, tek cümlelik bir fotoğraf teması ver (oyuncu/sanatçı bakışıyla). Sadece temayı yaz.", [], null, { max: 60 }) }; saveMeta(); } const parts = attParts(); if (!parts.length) return { metin: "📸 Bugünün teması: " + META.ptheme.t + "\nÇekince 📎 ile ekle, puanlayayım." }; return { metin: await plainGemini(`Bugünün teması: ${META.ptheme.t}. Bu fotoğrafı temaya uygunluk, kompozisyon, ışık ve yaratıcılık açısından 100 üzerinden puanla, kısa yorum ve bir ipucu ver.`, parts, null, { max: 600 }) }; } };
FN.gallery = { run: async () => { const fs = await pickFiles("image/*", true); if (!fs.length) return { iptal: true }; const r = await smartPick(fs.slice(0, 30)); return { metin: `En iyi ${Math.min(5, r.length)}: ` + r.slice(0, 5).map((x, i) => `${i + 1}) ${x.f.name} — ${x.score} (${x.reason})`).join("\n") + (r.length > 5 ? `\nEn zayıflar: ${r.slice(-3).map(x => x.f.name).join(", ")}` : "") }; } };
async function cutClips(file, prompt, format) {
  const a = await fileToAttach(file); const j = await geminiJSON(prompt + ` Video süresini dikkate al. JSON: {"klipler":[{"bas":saniye,"son":saniye,"neden":""}]}`, [{ inlineData: { mimeType: a.mime, data: a.data } }]);
  const clips = (j.klipler || []).filter(c => c.son > c.bas).slice(0, 8).map(c => ({ kind: "video", file, start: Number(c.bas), end: Number(c.son) }));
  if (!clips.length) throw new Error("Uygun an bulunamadı.");
  const out = await renderVideo({ clips, format, cleanAudio: true }); const r = await saveFile(out.blob, fname("klip", out.ext), "movies");
  return { ok: true, yer: r.yer, klipler: (j.klipler || []).map(k => `${k.bas}-${k.son} sn: ${k.neden}`) };
}
FN.clips = { input: "Ne tür anlar? (ör. 'en komik 3 an', 'en güçlü oyunculuk anı') — 📎 video ekle", run: async g => { const [f] = await pickFiles("video/*"); if (!f) return { iptal: true }; return cutClips(f, `Bu uzun videodan ${g || "paylaşılabilecek en iyi 3-5 anı"} seç (her biri 5-40 sn).`, "9:16"); } };
FN.trailer = { input: "Oyun adı / fragman tarzı", run: async g => { const [f] = await pickFiles("video/*"); if (!f) return { iptal: true }; return cutClips(f, `Bu oyun kaydından ${g || "oyunun"} için heyecan verici 20-40 saniyelik fragman oluşturacak 4-7 kısa an seç (aksiyon, görsel güzellik, merak).`, "16:9"); } };
FN.slidevideo = { input: "Sunumun konusu / metni (bilgisayardaki Titus seslendirip videoya çevirir)", run: async g => { if (!SET.scriptUrl) return { hata: "Bilgisayar bağlantısı gerekli." }; const { id } = await script("pcPush", { cmd: { action: "ask", arg: `story_video ya da video aracıyla şu sunumu seslendirilmiş videoya çevir ve sonucu telefona bildir: ${g}` } }); return { ok: true, not: "Bilgisayardaki Titus'a iletildi.", id }; } };

/* ---------- çizimli ızgaralar: çizgi roman, storyboard, moodboard, hedef panosu, alıntı kartı ---------- */
async function gridImages(title, items, cols = 2, onStep = () => {}, w = 768, h = 768) {
  const imgs = [];
  for (let i = 0; i < items.length; i++) { onStep(`Çiziliyor ${i + 1}/${items.length}`); try { imgs.push(await imgEl(await anyImage(items[i].prompt, w, h))); } catch (e) { imgs.push(null); } }
  const rows = Math.ceil(items.length / cols), cw = 540, ch = Math.round(cw * h / w), cap = 70, pad2 = 16;
  const c = document.createElement("canvas"); c.width = cols * cw + (cols + 1) * pad2; c.height = 90 + rows * (ch + cap + pad2) + pad2; const g = c.getContext("2d");
  g.fillStyle = "#0b0b0d"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#fff"; g.font = "bold 40px sans-serif"; g.fillText(title.slice(0, 40), pad2, 58);
  items.forEach((it, i) => {
    const x = pad2 + (i % cols) * (cw + pad2), y = 90 + Math.floor(i / cols) * (ch + cap + pad2);
    g.fillStyle = "#1c1c20"; g.fillRect(x, y, cw, ch); if (imgs[i]) g.drawImage(imgs[i], x, y, cw, ch); else { g.fillStyle = "#777"; g.font = "22px sans-serif"; g.fillText("(çizilemedi)", x + 20, y + 40); }
    g.strokeStyle = "#ff2a3d"; g.lineWidth = 3; g.strokeRect(x, y, cw, ch);
    g.fillStyle = "#eee"; g.font = "20px sans-serif"; wrapText(g, `${i + 1}. ${it.caption || ""}`, x + 4, y + ch + 26, cw - 8, 24, 2);
  });
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9)); const r = await saveFile(blob, fname(title, "jpg"), "pictures");
  return { ok: true, yer: r.yer, panel: items.length, img: URL.createObjectURL(blob) };
}
function wrapText(g, t, x, y, mw, lh, max = 3) { const ws = String(t).split(/\s+/); let line = "", n = 0; for (const w of ws) { const tt = line ? line + " " + w : w; if (g.measureText(tt).width > mw && line) { g.fillText(line, x, y); y += lh; line = w; if (++n >= max - 1) { line = ws.slice(ws.indexOf(w)).join(" "); if (g.measureText(line).width > mw) { while (g.measureText(line + "…").width > mw && line.length) line = line.slice(0, -1); line += "…"; } break; } } else line = tt; } if (line) g.fillText(line, x, y); }
const imgEl = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("görsel yüklenemedi")); i.src = src; });
async function panelsFromStory(kind, g, n) {
  const j = await geminiJSON(`${kind} için "${g}" konusunu ${n} panele böl. Her panel için İngilizce, ayrıntılı, aynı karakter tarifini tekrar eden bir görsel üretim istemi (${kind === "storyboard" ? "cinematic storyboard sketch, camera angle stated" : kind === "comic" ? "comic book panel, bold ink lines, vibrant colors" : "aesthetic mood photo"}) ve kısa Türkçe alt yazı yaz. JSON: {"baslik":"","paneller":[{"prompt":"","caption":""}]}`);
  return j;
}
const gridFn = (kind, n, cols, label) => ({ input: label, run: async (g, s, ctx) => { if (!g) return { hata: "Konu/hikâye yaz." }; const j = await panelsFromStory(kind, g, n); const r = await gridImages(j.baslik || g, (j.paneller || []).slice(0, n), cols, x => { const o = $("#skOut"); if (o && !ctx.fromChat) o.textContent = "⏳ " + x + " (ücretsiz çizim motoru ~15 sn/panel)"; }); return { ...r, html: `<img src="${r.img}" style="width:100%;border-radius:10px">` }; } });
FN.comic = gridFn("comic", 4, 2, "Hikâye (4 panel çizgi roman)");
FN.storyboard = gridFn("storyboard", 6, 2, "Senaryo/sahne (6 kare storyboard)");
FN.moodboard = gridFn("moodboard", 6, 3, "Rol/proje (ilham panosu)");
FN.visionboard = { run: async (g, s, ctx) => { const goals = [...(S.goals || []).map(x => x.text), ...XL("values").map(v => v.metin), g].filter(Boolean).slice(0, 6); if (!goals.length) return { hata: "Önce hedef ekle ya da hedeflerini yaz." }; const j = await geminiJSON(`Bu hedefler için ilham verici, gerçekçi fotoğraf tarzı İngilizce görsel istemleri yaz: ${JSON.stringify(goals)}. JSON: {"paneller":[{"prompt":"","caption":"hedefin kısa Türkçe hali"}]}`); const r = await gridImages("Hedef Panom", (j.paneller || []).slice(0, 6), 3, x => { const o = $("#skOut"); if (o && !ctx.fromChat) o.textContent = "⏳ " + x; }); return { ...r, html: `<img src="${r.img}" style="width:100%;border-radius:10px">` }; } };
FN.quotecard = { input: "Alıntı metni — kimin sözü", run: async g => { if (!g) return { hata: "Alıntıyı yaz." }; const [q, who] = g.split(/\s[—–-]\s/); let bg = null; try { bg = await imgEl(await anyImage(`minimal dark cinematic abstract background, soft red light, for a quote card about: ${q.slice(0, 120)}`, 1024, 1024)); } catch {} const c = document.createElement("canvas"); c.width = c.height = 1080; const x = c.getContext("2d"); x.fillStyle = "#0b0b0d"; x.fillRect(0, 0, 1080, 1080); if (bg) { x.globalAlpha = 0.55; x.drawImage(bg, 0, 0, 1080, 1080); x.globalAlpha = 1; } x.fillStyle = "#ff2a3d"; x.font = "bold 160px serif"; x.fillText("“", 70, 230); x.fillStyle = "#fff"; x.font = "52px serif"; wrapText(x, q.trim(), 100, 330, 880, 70, 8); if (who) { x.fillStyle = "#ff2a3d"; x.font = "bold 38px sans-serif"; x.fillText("— " + who.trim(), 100, 980); } const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92)); const r = await saveFile(blob, fname("alinti", "jpg"), "pictures"); return { ok: true, yer: r.yer, html: `<img src="${URL.createObjectURL(blob)}" style="width:100%;border-radius:10px">` }; } };

/* ---------- GIF ve sticker (yerleşik GIF kodlayıcı) ---------- */
function gifEncode(frames, W, H, delayCs = 50) {
  const out = []; const B = b => out.push(b & 255), W16 = v => { B(v); B(v >> 8); }; const S_ = s => [...s].forEach(c => B(c.charCodeAt(0)));
  S_("GIF89a"); W16(W); W16(H); B(0xF7); B(0); B(0);
  for (let r = 0; r < 8; r++) for (let g = 0; g < 8; g++) for (let b = 0; b < 4; b++) { B(r * 255 / 7); B(g * 255 / 7); B(b * 255 / 3); }
  B(0x21); B(0xFF); B(11); S_("NETSCAPE2.0"); B(3); B(1); W16(0); B(0);
  for (const fr of frames) {
    B(0x21); B(0xF9); B(4); B(0); W16(delayCs); B(0); B(0);
    B(0x2C); W16(0); W16(0); W16(W); W16(H); B(0);
    const idx = new Uint8Array(W * H); for (let i = 0, p = 0; i < idx.length; i++, p += 4) idx[i] = ((fr[p] >> 5) << 5) | ((fr[p + 1] >> 5) << 2) | (fr[p + 2] >> 6);
    const minCode = 8; B(minCode); const clear = 256, eoi = 257; let dict = new Map(), next = 258, size = 9; let bits = 0, nb = 0; const bytes = [];
    const emit = c => { bits |= c << nb; nb += size; while (nb >= 8) { bytes.push(bits & 255); bits >>>= 8; nb -= 8; } };
    emit(clear); let cur = idx[0];
    for (let i = 1; i < idx.length; i++) { const k = idx[i]; const key = cur * 256 + k; const v = dict.get(key); if (v !== undefined) { cur = v; continue; } emit(cur); if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; } else { emit(clear); dict = new Map(); next = 258; size = 9; } cur = k; }
    emit(cur); emit(eoi); if (nb > 0) bytes.push(bits & 255);
    for (let i = 0; i < bytes.length; i += 255) { const ch = bytes.slice(i, i + 255); B(ch.length); ch.forEach(B); } B(0);
  }
  B(0x3B); return new Blob([new Uint8Array(out)], { type: "image/gif" });
}
async function makeGif(files, sticker) {
  const S0 = sticker ? 512 : 480; const frames = [];
  for (const f of files.slice(0, 12)) { const img = await imgEl(URL.createObjectURL(f)); const c = document.createElement("canvas"); c.width = c.height = S0; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, S0, S0); const k = Math.max(S0 / img.width, S0 / img.height); const pad3 = sticker ? 24 : 0; const k2 = sticker ? Math.min((S0 - 2 * pad3) / img.width, (S0 - 2 * pad3) / img.height) : k; const w = img.width * k2, h = img.height * k2; g.drawImage(img, (S0 - w) / 2, (S0 - h) / 2, w, h); frames.push(g.getImageData(0, 0, S0, S0).data); }
  if (sticker) { const c = document.createElement("canvas"); c.width = c.height = S0; const g = c.getContext("2d"); const img = await imgEl(URL.createObjectURL(files[0])); g.fillStyle = "#fff"; g.beginPath(); g.roundRect ? g.roundRect(0, 0, S0, S0, 60) : g.rect(0, 0, S0, S0); g.fill(); const k = Math.min((S0 - 48) / img.width, (S0 - 48) / img.height); g.drawImage(img, (S0 - img.width * k) / 2, (S0 - img.height * k) / 2, img.width * k, img.height * k); const blob = await new Promise(r => c.toBlob(r, "image/png")); return { blob, ext: "png" }; }
  return { blob: gifEncode(frames, S0, S0, 45), ext: "gif" };
}
FN.gif = { input: "'sticker' yazarsan tek fotoğraftan sticker yapar; yoksa seçtiğin fotoğraflardan GIF", run: async g => { const fs = await pickFiles("image/*", true); if (!fs.length) return { iptal: true }; const st = /sticker|çıkartma/.test(trLower(g)); const o = await makeGif(fs, st); const r = await saveFile(o.blob, fname(st ? "sticker" : "titus-gif", o.ext), "pictures"); return { ok: true, yer: r.yer, html: `<img src="${URL.createObjectURL(o.blob)}" style="max-width:100%;border-radius:10px">` }; } };

/* ---------- şemalar: kavram haritası, karakter ilişkileri, sahne bloklaması ---------- */
function drawGraph(title, nodes, edges, opt = {}) {
  const c = document.createElement("canvas"); c.width = 1200; c.height = 1200; const g = c.getContext("2d");
  g.fillStyle = "#0b0b0d"; g.fillRect(0, 0, 1200, 1200); g.fillStyle = "#fff"; g.font = "bold 40px sans-serif"; g.fillText(title.slice(0, 45), 30, 60);
  const pos = {}; const n = nodes.length;
  if (opt.stage) { g.strokeStyle = "#444"; g.lineWidth = 4; g.strokeRect(100, 150, 1000, 800); g.fillStyle = "#333"; g.fillRect(100, 950, 1000, 60); g.fillStyle = "#aaa"; g.font = "26px sans-serif"; g.fillText("SEYİRCİ", 540, 990); g.fillText("ARKA SAHNE", 520, 140); }
  nodes.forEach((nd, i) => { if (opt.stage && nd.x != null) pos[nd.id] = [100 + nd.x / 100 * 1000, 150 + nd.y / 100 * 800]; else if (i === 0 && opt.center) pos[nd.id] = [600, 640]; else { const k = opt.center ? i - 1 : i, m = opt.center ? n - 1 : n; const a = k / Math.max(1, m) * Math.PI * 2 - Math.PI / 2; pos[nd.id] = [600 + Math.cos(a) * 400, 640 + Math.sin(a) * 400]; } });
  g.lineWidth = 3; g.font = "22px sans-serif";
  for (const e of edges) { const a = pos[e.from], b = pos[e.to]; if (!a || !b) continue; g.strokeStyle = e.color || "rgba(255,42,61,.7)"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); if (opt.arrow) { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const ex = b[0] - Math.cos(ang) * 70, ey = b[1] - Math.sin(ang) * 70; g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - Math.cos(ang - 0.4) * 22, ey - Math.sin(ang - 0.4) * 22); g.lineTo(ex - Math.cos(ang + 0.4) * 22, ey - Math.sin(ang + 0.4) * 22); g.fill(); } if (e.label) { g.fillStyle = "#ddd"; g.fillText(e.label.slice(0, 22), (a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2 - 6); } }
  nodes.forEach((nd, i) => { const [x, y] = pos[nd.id]; const r = i === 0 && opt.center ? 95 : 70; g.fillStyle = i === 0 && opt.center ? "#ff2a3d" : "#1d1d22"; g.strokeStyle = "#ff2a3d"; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); g.fillStyle = "#fff"; g.font = "bold 22px sans-serif"; g.textAlign = "center"; wrapText(g, nd.label, x, y - 6, r * 1.8, 24, 3); g.textAlign = "left"; });
  if (opt.note) { g.fillStyle = "#bbb"; g.font = "22px sans-serif"; wrapText(g, opt.note, 30, 1110, 1140, 28, 3); }
  return c;
}
async function graphSave(c, title) { const blob = await new Promise(r => c.toBlob(r, "image/png")); const r = await saveFile(blob, fname(title, "png"), "pictures"); return { ok: true, yer: r.yer, html: `<img src="${URL.createObjectURL(blob)}" style="width:100%;border-radius:10px">` }; }
FN.mindmap = { input: "Konu", run: async g => { if (!g) return { hata: "Konu yaz." }; const j = await geminiJSON(`"${g}" için kavram haritası: merkez + 6-9 ana kavram, aralarında anlamlı bağlantılar. JSON: {"merkez":"","kavramlar":[{"id":"k1","label":"kısa"}],"baglar":[{"from":"m","to":"k1","label":"ops."}]}  (merkezin id'si "m")`); const nodes = [{ id: "m", label: j.merkez || g }, ...(j.kavramlar || []).slice(0, 10)]; const edges = (j.baglar || []).length ? j.baglar : nodes.slice(1).map(n => ({ from: "m", to: n.id })); return graphSave(drawGraph("Kavram haritası: " + g, nodes, edges, { center: true }), "kavram-haritasi"); } };
FN.relmap = { input: "Senaryo metnini yapıştır ya da 📎 ekle", run: async g => { const parts = attParts(); if (!g && !parts.length) return { hata: "Senaryo ver." }; const j = await geminiJSON(`Bu senaryodaki karakterleri ve aralarındaki ilişkileri çıkar (aile, aşk, düşman, iş, sır...). JSON: {"baslik":"","karakterler":[{"id":"c1","label":"ad"}],"iliskiler":[{"from":"c1","to":"c2","label":"ilişki"}]}\n${g.slice(0, 30000)}`, parts); return graphSave(drawGraph(j.baslik || "Karakter ilişkileri", (j.karakterler || []).slice(0, 12), j.iliskiler || [], {}), "iliski-haritasi"); } };
FN.blocking = { input: "Sahne metni/tarifi (📎 de olur)", run: async g => { const parts = attParts(); const j = await geminiJSON(`Bu sahne için kuşbakışı sahne bloklaması: karakterlerin başlangıç konumları (x,y yüzde; y=100 seyirciye yakın) ve hareketleri. JSON: {"baslik":"","konumlar":[{"id":"a","label":"karakter","x":0-100,"y":0-100}],"hareketler":[{"from":"a","to":"a2","label":"replik/ an"}],"not":"yönetmen notu"} (hareket hedefleri için ayrı konum nesnesi ekle, ör. id a2 label 'Ali (2)')\n${g.slice(0, 20000)}`, parts); return graphSave(drawGraph(j.baslik || "Sahne bloklaması", (j.konumlar || []).slice(0, 14), j.hareketler || [], { stage: true, arrow: true, note: j.not }), "bloklama"); } };
FN.survey = { input: "Anket ne hakkında? (ör. 'oyun sonrası seyirci yorumu')", run: async g => { if (!g) return { hata: "Konu yaz." }; const j = await geminiJSON(`"${g}" için kısa seyirci/müşteri anketi: 5-7 soru. JSON: {"baslik":"","sorular":[{"soru":"","tur":"puan|coktan|metin","secenekler":["..."]}]}`); const r = await script("makeForm", { title: j.baslik || g, questions: j.sorular || [] }); const qr = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(r.url)}`; return { ok: true, link: r.url, duzenle: r.edit, html: `<a href="#" data-open="${esc(r.url)}">${esc(r.url)}</a><img src="${qr}" style="width:70%;display:block;margin:10px auto;background:#fff;padding:10px;border-radius:10px">` }; } };
document.addEventListener("click", e => { const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openUrl(a.dataset.open); } });

/* ---------- şarkı koçu (perde ölçer) ve ses/tempo ölçer ---------- */
const NOTES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
function pitchOf(buf, rate) { let rms = 0; for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length); if (rms < 0.012) return -1; let best = -1, bc = 0; for (let lag = Math.floor(rate / 1000); lag < Math.floor(rate / 70); lag++) { let c = 0; for (let i = 0; i < buf.length - lag; i += 2) c += buf[i] * buf[i + lag]; if (c > bc) { bc = c; best = lag; } } return best > 0 ? rate / best : -1; }
let METER = null;
async function meterStart(kind) {
  meterStop(); const st = await navigator.mediaDevices.getUserMedia({ audio: true }); const ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 2048; ac.createMediaStreamSource(st).connect(an);
  const buf = new Float32Array(an.fftSize); METER = { st, ac, hist: [], t0: Date.now(), kind };
  const tick = () => { if (!METER) return; an.getFloatTimeDomainData(buf); const el = $("#mtrOut"); let rms = 0; for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length); const db = Math.round(20 * Math.log10(rms + 1e-6) + 90);
    if (kind === "sing") { const f = pitchOf(buf, ac.sampleRate); if (f > 0) { const n = 12 * Math.log2(f / 440) + 69; const r = Math.round(n); const cents = Math.round((n - r) * 100); METER.hist.push(cents); if (el) el.innerHTML = `<div class="big">${NOTES[(r % 12 + 12) % 12]}${Math.floor(r / 12) - 1}</div><div class="hint">${f.toFixed(1)} Hz · ${cents > 0 ? "+" : ""}${cents} sent ${Math.abs(cents) < 15 ? "✅ tam" : cents > 0 ? "⬆ tiz" : "⬇ pes"}</div>`; } }
    else { METER.hist.push(db); if (el) el.innerHTML = `<div class="big">${db} dB</div><div class="hint">${db < 55 ? "🔈 çok alçak — sesini yükselt" : db > 82 ? "🔊 çok yüksek" : "✅ iyi seviye"}</div><div class="bars">${METER.hist.slice(-40).map(v => `<span style="height:${Math.max(3, (v - 40) * 1.2)}px"></span>`).join("")}</div>`; }
    METER.raf = requestAnimationFrame(tick); };
  tick();
}
function meterStop() { if (!METER) return null; cancelAnimationFrame(METER.raf); METER.st.getTracks().forEach(t => t.stop()); METER.ac.close(); const m = METER; METER = null; return m; }
FN.singcoach = { ui: () => `<div id="mtrOut" class="card" style="text-align:center"><div class="hint">Başlat'a bas ve bir nota söyle.</div></div><div class="row"><button class="btn" data-mtr="sing">🎤 Başlat</button><button class="btn ghost" data-mtr="stop">Durdur ve değerlendir</button></div>` };
FN.tempo = { ui: () => `<div id="mtrOut" class="card" style="text-align:center"><div class="hint">Konuşurken ses seviyeni ölçer. Hız için "Kayıtla hız ölç".</div></div><div class="row"><button class="btn" data-mtr="vol">🎙 Ses ölç</button><button class="btn ghost" data-mtr="stop">Durdur</button><button class="btn ghost" data-mtr="wpm">⏱ Kayıtla hız ölç</button></div>` };
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-mtr]"); if (!t) return; const k = t.dataset.mtr;
  try {
    if (k === "sing" || k === "vol") await meterStart(k === "sing" ? "sing" : "vol");
    else if (k === "stop") { const m = meterStop(); if (m && m.hist.length > 20) { const h = m.hist; const avg = h.reduce((a, b) => a + b, 0) / h.length; $("#mtrOut").innerHTML += `<div class="hint">${m.kind === "sing" ? `Ortalama sapma ${Math.round(h.reduce((a, b) => a + Math.abs(b), 0) / h.length)} sent: ${Math.abs(avg) < 20 ? "perden iyi 👏" : avg > 0 ? "genelde biraz tiz söylüyorsun" : "genelde biraz pes söylüyorsun"}` : `Ortalama ${Math.round(avg)} dB, ${Math.round((Date.now() - m.t0) / 1000)} sn`}</div>`; } }
    else if (k === "wpm") { const b = await recordDialog("HIZ ÖLÇ", "30-60 sn normal konuş ya da metin oku.", 90); if (!b) return; const sec = Math.round(b.length * 0.75 / 32000); const r = await plainGemini("Bu kaydı yazıya dök ve SADECE şu biçimde yaz: KELİME=<sayı> | DOLGU=<ıı, eee gibi dolgu sayısı> | YORUM=<tempo, vurgu, netlik hakkında tek cümle>", [{ inlineData: { mimeType: "audio/wav", data: b } }], null, { max: 300, nocache: true }); const n = Number((r.match(/KELİME=(\d+)/) || [])[1]) || 0; $("#mtrOut").innerHTML = `<div class="big">${sec ? Math.round(n / sec * 60) : "?"} kelime/dk</div><div class="hint">${esc(r)} · ideal sahne/sunum hızı 130-160 kelime/dk</div>`; }
  } catch (er) { toast("✗ " + er.message, 5000); }
});

/* ---------- zamanlayıcılar: yağmur, mola, günün kelimesi, sallama, kulaklık ---------- */
async function notifyNow(title, body) { try { if (LN) await LN.schedule({ notifications: [{ id: hash(title + body + Date.now()) % 2000000000, title, body, schedule: { at: new Date(Date.now() + 1500) } }] }); } catch {} toast(title + " — " + body, 6000); }
async function rainCheck() {
  if (!SET.rainAlert || META.rainAt && Date.now() - META.rainAt < 3 * 36e5) return;
  try { const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${SET.lat}&longitude=${SET.lng}&hourly=precipitation_probability&forecast_hours=3&timezone=Europe%2FIstanbul`)).json(); const p = (j.hourly && j.hourly.precipitation_probability) || []; const mx = Math.max(0, ...p.slice(0, 3)); if (mx >= 60) { META.rainAt = Date.now(); saveMeta(); notifyNow("☔ Yağmur geliyor", `Önümüzdeki saatlerde yağış ihtimali %${mx}. Şemsiyeni al.`); } } catch {}
}
setInterval(rainCheck, 30 * 6e4); setTimeout(rainCheck, 20000);
let BREAK_IV = null;
function setupBreaks() { clearInterval(BREAK_IV); const m = Number(SET.breaks) || 0; if (m > 0) BREAK_IV = setInterval(() => { const h = new Date().getHours(); if (h >= 8 && h < 23) notifyNow("💧 Mola zamanı", "Su iç, 20 saniye uzağa bak, omuzlarını gevşet."); }, m * 6e4); }
async function dailyWordTick() {
  if (!SET.dailyWord || META.dw === today() || !SET.geminiKey) return;
  try { const w = await plainGemini("Bugünün kelimesi: oyuncu ve casting dünyasında işe yarayan bir İngilizce kelime/ifade ya da oyunculuk terimi seç. Biçim: KELİME — anlamı — tek örnek cümle. Tek satır.", [], null, { max: 80 }); META.dw = today(); saveMeta(); notifyNow("📖 Günün kelimesi", w); } catch {}
}
setTimeout(dailyWordTick, 15000);
let SHAKE_T = 0;
window.addEventListener("devicemotion", e => { if (!SET.shake) return; const a = e.accelerationIncludingGravity; if (!a) return; const f = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z); if (f > 42 && Date.now() - SHAKE_T > 4000) { SHAKE_T = Date.now(); const nx = S.reminders.filter(r => !r.done).sort((x, y) => x.due.localeCompare(y.due))[0]; speak(nx ? `Sıradaki hatırlatıcın: ${nx.text}, ${fmtWhen(nx.due)}.` : "Bekleyen hatırlatıcın yok.", true); } });
window.addEventListener("keydown", e => { if (SET.headset && (e.key === "MediaPlayPause" || e.key === "MediaTrackNext")) { e.preventDefault(); const m = $("#mic"); if (m) m.click(); } });
try { if (navigator.mediaSession) navigator.mediaSession.setActionHandler("play", () => { if (SET.headset) { const m = $("#mic"); if (m) m.click(); } }); } catch {}
{
  const baseNight = applyLook;
  setInterval(() => baseNight(), 10 * 6e4);
}
{
  const basePlay = playBuffer;
  playBuffer = function (buf) {
    let vol = SET.ttsVol ?? 1; if (SET.autoVol) { const h = new Date().getHours(); if (h >= 23 || h < 7) vol *= 0.55; } if (SET.nightMode) vol *= 0.6;
    if (vol >= 0.99) return basePlay(buf);
    return new Promise(res => { const ctx = outCtx(); const s = ctx.createBufferSource(); s.buffer = buf; const g = ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(ctx.destination); CUR_SRC = s; s.onended = () => { if (CUR_SRC === s) CUR_SRC = null; res(); }; s.start(); });
  };
}

FN.batchphoto = { input: "Desen (ör. 'headshot', varsayılan 'foto') — sonra fotoğrafları seç", run: async g => { const fs = await pickFiles("image/*", true); if (!fs.length) return { iptal: true }; const n = await batchEdit(fs, (g || "foto").replace(/\s+/g, "-").slice(0, 20)); return { ok: true, not: `${n} fotoğraf düzenlenip kaydedildi (Resimler/TITUS). Ayarları Stüdyo → Fotoğraf'tan değiştirebilirsin.` }; } };

/* ---------- sohbeti kaydet, otomatik etiketleme ---------- */
FN.savechat = { run: async () => { if (!CHAT.length) return { hata: "Sohbet boş." }; const t = CHAT.map(m => `${m.role === "user" ? "**" + SET.name + ":**" : "**Titus:**"} ${m.content}`).join("\n"); const d = await docFromText("Sohbet — " + localISO(new Date()).replace("T", " "), t); return { ok: true, belge: d.dosya, yer: d.yer }; } };
FN.autotag = { run: async () => {
  const L = (S.notes || []).filter(n => !n.project).slice(0, 60); if (!L.length) return { metin: "Etiketsiz not yok." };
  const j = await geminiJSON(`Bu notları konularına göre etiketle (kısa Türkçe etiket: İş, Oyunculuk, Recast, Kişisel, Finans, Proje: <ad>, Sağlık, Alışveriş, Fikir...). JSON: {"etiketler":[{"id":"","etiket":""}]}\n${JSON.stringify(L.map(n => ({ id: n.id, text: n.text.slice(0, 200) })))}`);
  let n = 0; for (const e of j.etiketler || []) { const x = S.notes.find(k => k.id === e.id); if (x && e.etiket) { x.project = e.etiket; n++; } } save();
  return { ok: true, metin: `${n} not etiketlendi.` };
} };
setInterval(() => { if (SET.autoTag && SET.geminiKey && !document.hidden && (S.notes || []).some(n => !n.project)) FN.autotag.run().catch(() => {}); }, 60 * 6e4);

/* =================== YETENEKLER EKRANI =================== */
const SKV = { q: "", faz: "all", open: null };
const DUR = { tam: ["✅", "tam çalışıyor"], yz: ["🧠", "yapay zekâ ile"], "kısmi": ["◐", "kısmi"], yok: ["✕", "yapılamıyor"] };
const KIND_TR = k => k === "mode" ? "davranış modu" : k === "ask" ? "yapay zekâ görevi" : k.startsWith("tool:") ? "araç" : "özel";
function skillCard(s) {
  const open = SKV.open === s.id; const d = DUR[s.durum] || ["", s.durum];
  const h = s.k.startsWith("fn:") ? FN[s.k.slice(3)] : null;
  let body = "";
  if (open) {
    body += `<div class="skdesc">${esc(s.a)}${s.not ? `<div class="hint">ℹ️ ${esc(s.not)}</div>` : ""}</div>`;
    if (s.k === "mode") body += `<label class="tg"><input type="checkbox" data-mode="${s.id}" ${modeOn(s) ? "checked" : ""}> Bu davranış ${modeOn(s) ? "açık" : "kapalı"}</label>`;
    else {
      if (h && h.ui) { try { body += `<div class="skui">${h.ui(s)}</div>`; } catch (e) { body += `<div class="hint">✗ ${esc(e.message)}</div>`; } }
      const needsRun = !h || h.run;
      if (needsRun && s.durum !== "yok") {
        const ph = (h && h.input) || (s.f ? "İsteğin (📎 ile dosya/fotoğraf ekleyebilirsin)" : "İsteğin / ayrıntılar (boş bırakabilirsin)");
        body += `<div class="form"><textarea id="skIn" placeholder="${esc(ph)}"></textarea><div class="row">${s.f || (h && /📎/.test(h.input || "")) ? `<button class="btn ghost" id="skAtt">📎 ${SK_ATT.length ? SK_ATT.length + " dosya" : "Ekle"}</button>` : ""}<button class="btn" data-skrun="1">▶ Çalıştır</button></div></div>`;
      }
      body += `<div id="skOut" class="skout"></div>`;
    }
  }
  return `<div class="card skc ${open ? "open" : ""}" data-skid="${s.id}"><div class="skh" data-sktoggle="${s.id}"><span class="skn">${esc(s.n)}</span><span class="skb">${s.faz === 0 ? "Gmail" : s.faz === 99 ? "Senin" : "F" + s.faz}</span><span class="skd" title="${d[1]}">${d[0]}</span></div>${open ? body : `<div class="skmeta">${esc(s.a.slice(0, 90))}${s.a.length > 90 ? "…" : ""}</div>`}</div>`;
}
function renderSkills() {
  const el = $("#b-skills"); if (!el) return;
  const all = allSkills(); const q = SKV.q.trim();
  let list = all.filter(s => SKV.faz === "all" || (SKV.faz === "on" ? modeOn(s) : SKV.faz === "u" ? s.faz === 99 : String(s.faz) === SKV.faz));
  if (q) list = list.map(s => ({ s, v: skillScore(s, q) + (deacc(s.n).includes(deacc(q)) ? 5 : 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).map(x => x.s);
  const cnt = {}; all.forEach(s => { cnt[s.durum] = (cnt[s.durum] || 0) + 1; });
  const fz = [["all", "Tümü"], ["0", "Gmail"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [String(n), "Faz " + n]), ["on", "Açık modlar"], ["u", "Eklediklerim"]];
  el.innerHTML = `<div class="skhead"><button class="btn ghost" id="skBack">← Geri</button><input id="skQ" placeholder="🔎 ${all.length} yetenekte ara…" value="${esc(SKV.q)}"></div>
    <div class="hint" style="margin:4px 0 8px">✅ tam ${cnt.tam || 0} · 🧠 yapay zekâ ${cnt.yz || 0} · ◐ kısmi ${cnt["kısmi"] || 0} · ✕ yok ${cnt.yok || 0} — Sohbette de kullanabilirsin: "Titus, monolog kütüphanesini aç", "derin araştırma yap: …"</div>
    <div class="chips skf">${fz.map(f => `<button class="chip ${SKV.faz === f[0] ? "on" : ""}" data-skfaz="${f[0]}">${f[1]}</button>`).join("")}</div>
    <div id="skList">${list.slice(0, 400).map(skillCard).join("") || '<div class="empty">Bulunamadı.</div>'}</div>`;
}
function refreshSkill() { if ($("#v-skills.on")) { const sc = $("#b-skills").scrollTop; renderSkills(); const o = SKV.open && document.querySelector(`[data-skid="${SKV.open}"]`); if (o) $("#b-skills").scrollTop = sc; } }
function showSkill(id) { SKV.open = id; SKV.q = ""; SKV.faz = "all"; renderSkills(); setTimeout(() => { const o = document.querySelector(`[data-skid="${id}"]`); if (o) o.scrollIntoView({ block: "start" }); }, 30); }
function outHTML(r) {
  if (!r) return "";
  if (r.hata) return `<div class="hint err">✗ ${esc(r.hata === "NOKEY" ? "Gemini anahtarı yok (Ayarlar → Beyin)" : r.hata)}${r.benzerler ? " · Benzer: " + esc(r.benzerler.join(", ")) : ""}</div>`;
  if (r.iptal) return `<div class="hint">Vazgeçildi.</div>`;
  const txt = r.metin || r.cevap || r.not || (r.ok ? "✓ Tamam" : "");
  const rest = Object.fromEntries(Object.entries(r).filter(([k]) => !["metin", "cevap", "not", "ok", "html", "kaynaklar", "img", "kod", "tablo", "grafik"].includes(k)));
  return `${txt ? `<div class="skres">${esc(txt)}</div>` : ""}${r.html || ""}${r.kaynaklar && r.kaynaklar.length ? `<div class="hint">Kaynaklar: ${r.kaynaklar.map((k, i) => `<a href="#" data-open="${esc(k.uri)}">[${i + 1}] ${esc(k.title)}</a>`).join(" ")}</div>` : ""}${Object.keys(rest).length ? `<div class="hint">${esc(Object.entries(rest).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ").slice(0, 600))}</div>` : ""}${txt && txt.length > 40 ? `<div class="row"><button class="btn ghost" data-skcopy="1">Kopyala</button><button class="btn ghost" data-sknote="1">Not al</button><button class="btn ghost" data-skdoc="1">Belge</button><button class="btn ghost" data-sksay="1">🔊</button></div>` : ""}`;
}
let SK_LAST = null;
async function runFromUI(fnOrId, girdi) {
  await SKILLS_READY;
  const s = allSkills().find(x => x.id === fnOrId) || allSkills().find(x => x.k === "fn:" + fnOrId) || allSkills().find(x => x.id === SKV.open);
  if (!s) return;
  const o = $("#skOut"); if (o) o.innerHTML = `<div class="hint">⏳ ${esc(s.n)} çalışıyor…</div>`;
  let r; try { r = await runSkill(s, girdi, { fromChat: false }); } catch (e) { r = { hata: friendlyErr(e) }; }
  SK_LAST = { s, r }; const o2 = $("#skOut"); if (o2) o2.innerHTML = outHTML(r); else if (r && (r.metin || r.hata)) toast((r.metin || r.hata).slice(0, 140), 6000);
  if (s.k.startsWith("fn:") && FN[s.k.slice(3)] && FN[s.k.slice(3)].ui) { const ui = document.querySelector(`[data-skid="${s.id}"] .skui`); if (ui) try { ui.innerHTML = FN[s.k.slice(3)].ui(s); } catch {} }
  return r;
}
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-sktoggle],[data-skfaz],#skBack,[data-skrun],#skAtt,[data-skcopy],[data-sknote],[data-skdoc],[data-sksay],[data-goskills]"); if (!t) return;
  if (t.dataset.goskills !== undefined) { go("skills"); renderSkills(); return; }
  if (t.dataset.sktoggle) { SKV.open = SKV.open === t.dataset.sktoggle ? null : t.dataset.sktoggle; SK_ATT = []; renderSkills(); const o = document.querySelector(`[data-skid="${SKV.open}"]`); if (o) o.scrollIntoView({ block: "nearest" }); return; }
  if (t.dataset.skfaz) { SKV.faz = t.dataset.skfaz; SKV.open = null; renderSkills(); return; }
  if (t.id === "skBack") { go("home"); return; }
  if (t.id === "skAtt") { SK_ATT = await pickAttach(); t.textContent = "📎 " + SK_ATT.length + " dosya"; return; }
  if (t.dataset.skrun) { t.disabled = true; try { await runFromUI(SKV.open, ($("#skIn") || {}).value || ""); } finally { t.disabled = false; } return; }
  const txt = SK_LAST && SK_LAST.r && (SK_LAST.r.metin || SK_LAST.r.cevap || ""); if (!txt) return;
  if (t.dataset.skcopy) { try { await navigator.clipboard.writeText(txt); toast("Kopyalandı"); } catch { toast("Kopyalanamadı"); } }
  else if (t.dataset.sknote) { A.addNote({ text: `${SK_LAST.s.n}: ${txt}`, project: "Titus" }); toast("✓ Not alındı"); }
  else if (t.dataset.skdoc) { try { const d = await docFromText(SK_LAST.s.n, txt, (SK_LAST.r.kaynaklar || []).map((k, i) => `[${i + 1}] ${k.title} ${k.uri}`)); toast("✓ " + d.dosya + " → " + d.yer, 5000); } catch (er) { toast("✗ " + er.message); } }
  else if (t.dataset.sksay) speak(txt.slice(0, 1500), true);
});
document.addEventListener("input", e => { if (e.target.id === "skQ") { SKV.q = e.target.value; clearTimeout(renderSkills._t); renderSkills._t = setTimeout(() => { const pos = e.target.selectionStart; renderSkills(); const q = $("#skQ"); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 250); } });
document.addEventListener("change", e => { const el = e.target.closest("[data-mode]"); if (!el) return; SET.modes = { ...(SET.modes || {}), [el.dataset.mode]: el.checked }; saveSet(); toast(el.checked ? "✓ Açıldı" : "Kapatıldı"); renderSkills(); });
{
  const baseGo = go;
  go = function (v) { baseGo(v); if (v === "skills") renderSkills(); };
}
{
  const baseRS = renderSettings;
  renderSettings = async function () {
    await baseRS();
    const b = $("#b-set"); if (!b) return;
    b.insertAdjacentHTML("afterbegin", `<div class="card"><h3>🧠 YETENEKLER (${allSkills().length})</h3><div class="hint" style="margin-top:0">Faz 1–10'un tamamı, çoklu Gmail, takipler, Telegram, otomatik güncelleme, kişilik, gizlilik ve daha fazlası.</div><div class="row"><button class="btn" data-goskills>Yetenekleri aç</button><button class="btn ghost" id="setAcc">✉️ Gmail hesapları</button><button class="btn ghost" id="setUpd">⬆️ Güncelle</button></div></div>`);
  };
}
document.addEventListener("click", e => { if (e.target.closest("#setAcc")) { go("skills"); showSkill("gmail"); } if (e.target.closest("#setUpd")) checkUpdate(true); });

/* =================== açılış işleri =================== */
setTimeout(async () => {
  await SKILLS_READY;
  try { const chips = $("#chips"); if (chips && !chips.querySelector("[data-goskills]")) chips.insertAdjacentHTML("afterbegin", `<button class="chip" data-goskills>🧠 Yetenekler</button>`); } catch {}
  applyLook(); a11yPass(); memPurge(); setupBreaks(); drawFace();
  if (META.updChk !== today()) checkUpdate(false);
  bootCheck(false);
  const pend = (META.jobs || []).filter(j => !j.fin && Date.now() - j.at < 3 * 864e5);
  if (pend.length) bubble("sys", `⏸ Yarım kalan iş: ${pend[0].arg} — Yetenekler → Kaldığı yerden devam`);
  if (SET.watchSynced !== JSON.stringify(XL("watch")) && XL("watch").length) { const r = await watchSync(); if (!r.hata) { SET.watchSynced = JSON.stringify(XL("watch")); saveSet(); } }
}, 2500);
/* test kancası: sadece ?titustest ile açılınca (otomatik testler için) */
if (/[?&]titustest/.test(location.search)) window.__T = { runSkill, allSkills, FN, findSkill, runTool, setAtt: a => { SK_ATT = a; }, get SET() { return SET; }, get S() { return S; }, get META() { return META; }, get CHAT() { return CHAT; }, systemPrompt: () => systemPrompt(), pickTools: h => pickTools(h).map(t => t.name), maskText, undoLast, accounts, SKILLS_READY };

/* ================= açılış ================= */
async function boot() {
  await loadAll();
  try { const f = JSON.parse(await kvGet("jarvis_focus") || "null"); if (f) FOCUS = f; } catch {}
  try { const m = JSON.parse(await kvGet("jarvis_meta") || "null"); if (m) META = Object.assign(META, m); } catch {}
  if (!META.v24) { META.v24 = true; SET.wakeStrict = false; if (!SET.liveIdle || SET.liveIdle <= 25) SET.liveIdle = 45; SET.live = true; saveSet(); saveMeta(); } // v2.4: sadece "Titus" yeter, sohbet daha uzun açık kalır
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
    AppP && AppP.addListener("resume", () => { warmUp(); { const h = new Date().getHours(); if (h >= 5 && h < 12) prefetchBrief().catch(() => {}); } lockCheck(); sweepPast(); pullSync(); proactive(); if (FOCUS.until && FOCUS.until < Date.now()) endFocus(true); nat(() => Jarvis.permissionsStatus()).then(p => { if (p) { PERM = p; if ($("#v-set.on")) renderSettings(); } }); });
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
  warmUp(); setTimeout(() => summarizeWeek(), 8000);
  { const h = new Date().getHours(); if (h >= 5 && h < 12) setTimeout(() => prefetchBrief().catch(() => {}), 3000); }
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
