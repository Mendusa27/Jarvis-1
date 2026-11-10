/**
 * Titus — Google arka ucu (ücretsiz)
 * Görevleri: cihazlar arası veri senkronu (Drive'da tek JSON dosyası), Google Takvim, Gmail özeti.
 * Kurulum: README.md → "Google bağlantısı".
 */

// ⚠️ Bunu kendine özel uzun bir şifreyle değiştir ve aynısını Titus → Ayarlar → Google → Gizli anahtar'a yaz.
const TOKEN = "BURAYA-UZUN-GIZLI-BIR-SIFRE-YAZ";
const FILE_NAME = "jarvis-veri.json";

function doGet() {
  return ContentService.createTextOutput("Titus arka ucu çalışıyor ✓");
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out({ ok: false, error: "Geçersiz istek" }); }
  if (!req || req.token !== TOKEN) return out({ ok: false, error: "Yetkisiz: gizli anahtar uyuşmuyor" });
  try {
    switch (req.action) {
      case "ping":         try { kurulumBrifing(); } catch (e) {} return out({ ok: true, email: Session.getActiveUser().getEmail() });
      case "load":         return out({ ok: true, data: loadState() });
      case "save":         saveState(req.data); return out({ ok: true });
      case "calendarList": return out({ ok: true, etkinlikler: calendarList(Number(req.days) || 2) });
      case "calendarAdd":  return out(Object.assign({ ok: true }, calendarAdd(req)));
      case "gmail":        return out({ ok: true, mailler: gmail(req.query, Number(req.max) || 8) });
      case "gmailDraft":   return out(Object.assign({ ok: true }, gmailDraft(req)));
      case "sheetQuery":   return out(Object.assign({ ok: true }, sheetQuery(req)));
      case "radarSet":     radarSet(req); return out({ ok: true });
      case "radarGet":     return out({ ok: true, items: radarGet() });
      case "pcPush":       return out({ ok: true, id: pcPush(req.cmd) });
      case "pcPull":       return out({ ok: true, cmds: pcPull() });
      case "pcDone":       pcDone(req.id, req.result); return out({ ok: true });
      case "pcResult":     return out({ ok: true, result: pcResultGet(req.id) });
      case "briefData":    return out(Object.assign({ ok: true }, briefData(false)));
      case "roster":       return out(Object.assign({ ok: true }, roster(req)));
      case "briefMails":   return out({ ok: true, mailler: briefMails(req) });
      case "audInfo":      return out(Object.assign({ ok: true }, audInfo(req)));
      case "audRead":      return out(Object.assign({ ok: true }, audRead(req)));
      case "audUpdate":    return out(Object.assign({ ok: true }, audUpdate(req)));
      case "audAdd":       return out(Object.assign({ ok: true }, audAdd(req)));
      case "phPush":       return out({ ok: true, id: phPush(req) });
      case "phPull":       return out({ ok: true, cmds: phPull() });
      case "saveFile":     return out(Object.assign({ ok: true }, saveFile(req)));
      case "getBackup":    return out(Object.assign({ ok: true }, getBackup(req)));
      case "setGeminiKey": props_().setProperty("GEMINI_KEY", String(req.key || "")); kurulumGece(); return out({ ok: true });
      case "mailDraftFile": return out(Object.assign({ ok: true }, gmailDraft(req)));
      default:             return out({ ok: false, error: "Bilinmeyen işlem: " + req.action });
    }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- senkron ---------- */
function dataFile_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("fileId");
  if (id) { try { return DriveApp.getFileById(id); } catch (e) {} }
  const it = DriveApp.getFilesByName(FILE_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFile(FILE_NAME, "{}", MimeType.PLAIN_TEXT);
  props.setProperty("fileId", f.getId());
  return f;
}
function loadState() {
  try { return JSON.parse(dataFile_().getBlob().getDataAsString("UTF-8") || "{}"); } catch (e) { return {}; }
}
function saveState(data) {
  if (!data || typeof data !== "object") throw new Error("Veri yok");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cur = loadState();
    // Eski bir cihaz yeni veriyi ezmesin
    if ((cur.updatedAt || 0) > (data.updatedAt || 0)) return;
    dataFile_().setContent(JSON.stringify(data));
  } finally { lock.releaseLock(); }
}

/* ---------- takvim ---------- */
function fmt_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm"); }
function parse_(s) {
  // "YYYY-MM-DDTHH:mm" → betiğin saat diliminde (Europe/Istanbul)
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) throw new Error("Tarih anlaşılmadı: " + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 9), Number(m[5] || 0));
}
function calendarList(days) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + Math.min(days, 31) * 864e5);
  const list = [];
  CalendarApp.getAllCalendars().forEach(cal => {
    if (cal.isHidden && cal.isHidden()) return;
    cal.getEvents(start, end).forEach(ev => list.push({
      baslik: ev.getTitle(),
      baslangic: ev.isAllDayEvent() ? fmt_(ev.getAllDayStartDate()).slice(0, 10) + " (tüm gün)" : fmt_(ev.getStartTime()),
      bitis: ev.isAllDayEvent() ? "" : fmt_(ev.getEndTime()),
      yer: ev.getLocation() || "",
      takvim: cal.getName()
    }));
  });
  list.sort((a, b) => a.baslangic.localeCompare(b.baslangic));
  return list.slice(0, 40);
}
function calendarAdd(req) {
  const start = parse_(req.start);
  const end = req.end ? parse_(req.end) : new Date(start.getTime() + 60 * 60000);
  const ev = CalendarApp.getDefaultCalendar().createEvent(req.title, start, end, { location: req.location || "" });
  ev.removeAllReminders();
  ev.addPopupReminder(60);
  ev.addPopupReminder(15);
  return { eklendi: req.title, baslangic: fmt_(start) };
}

/* ---------- gmail ---------- */
function gmail(query, max) {
  const threads = GmailApp.search(query || "is:unread in:inbox", 0, Math.min(max, 20));
  return threads.map(t => {
    const msgs = t.getMessages(); const m = msgs[msgs.length - 1];
    return {
      kimden: m.getFrom(),
      konu: m.getSubject(),
      tarih: fmt_(m.getDate()),
      okunmadi: m.isUnread(),
      ozet: m.getPlainBody().replace(/\s+/g, " ").slice(0, 220)
    };
  });
}

/* =====================================================================
   FAZ 1 + FAZ 2
   ===================================================================== */

/* ---------- Gmail taslağı (göndermez) ---------- */
function gmailDraft(req) {
  const opts = {};
  if (req.fileB64 && req.fileName) {
    opts.attachments = [Utilities.newBlob(Utilities.base64Decode(req.fileB64), req.fileMime || "application/octet-stream", req.fileName)];
  }
  if (req.bcc) opts.bcc = req.bcc;
  const d = GmailApp.createDraft(req.to || "", req.subject || "(konu yok)", req.body || "", opts);
  return { taslak: true, id: d.getId(), not: "Taslak Gmail'de hazır; kontrol edip gönder." };
}

/* ---------- KADRO / herhangi bir Google E-Tablo ---------- */
function sheetQuery(req) {
  const ss = SpreadsheetApp.openById(req.sheetId);
  const sh = req.sheet ? ss.getSheetByName(req.sheet) : ss.getSheets()[0];
  const values = sh.getDataRange().getValues();
  if (!values.length) return { toplam: 0, satirlar: [] };
  const head = values[0].map(String);
  const q = String(req.query || "").toLocaleLowerCase("tr-TR").trim();
  const since = req.since ? new Date(req.since + "T00:00:00") : null;
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (q && !r.some(c => String(c).toLocaleLowerCase("tr-TR").indexOf(q) >= 0)) continue;
    if (since && !r.some(c => c instanceof Date && c >= since)) continue;
    const o = {};
    head.forEach((h, k) => { const v = r[k]; if (v !== "" && v !== null) o[h || ("Sütun" + (k + 1))] = v instanceof Date ? fmt_(v) : String(v).slice(0, 200); });
    rows.push(o);
  }
  return { sayfa: sh.getName(), basliklar: head, toplam: rows.length, satirlar: rows.slice(0, Math.min(Number(req.limit) || 20, 50)) };
}

/* ---------- Radar: casting ilanları / kiralık ev (her saat) ---------- */
function props_() { return PropertiesService.getScriptProperties(); }
// Script Properties değer başına ~9 KB ile sınırlı; büyük listeler Drive'daki küçük JSON dosyalarında tutulur
function jget_(name, def) {
  const id = props_().getProperty("f_" + name);
  try { if (id) return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString("UTF-8") || "null") ?? def; } catch (e) {}
  return def;
}
function jset_(name, val) {
  const txt = JSON.stringify(val); const id = props_().getProperty("f_" + name);
  if (id) { try { DriveApp.getFileById(id).setContent(txt); return; } catch (e) {} }
  const f = DriveApp.createFile("jarvis-" + name + ".json", txt, MimeType.PLAIN_TEXT);
  props_().setProperty("f_" + name, f.getId());
}
function radarSet(req) {
  props_().setProperty("radars", JSON.stringify(req.radars || []));
  props_().setProperty("ntfy", req.ntfy || "");
  kurulum();
}
function radarGet() {
  const items = jget_("radarItems", []);
  // bir sonraki sorguda "yeni" görünmesinler
  jset_("radarItems", items.map(x => Object.assign({}, x, { seen: true })));
  return items;
}
function radarRun() {
  const radars = JSON.parse(props_().getProperty("radars") || "[]");
  if (!radars.length) return;
  const seen = jget_("radarSeen", []);
  const seenSet = new Set(seen);
  let items = jget_("radarItems", []);
  const fresh = [];
  radars.forEach(r => {
    try {
      if (r.type === "gmail") {
        GmailApp.search("(" + r.query + ") newer_than:2d", 0, 15).forEach(t => {
          const key = "g:" + t.getId(); if (seenSet.has(key)) return; seenSet.add(key);
          fresh.push({ radar: r.name, title: t.getFirstMessageSubject(), link: "https://mail.google.com/mail/u/0/#inbox/" + t.getId(), found: fmt_(new Date()), seen: false });
        });
      } else if (r.url) {
        const html = UrlFetchApp.fetch(r.url, { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": "Mozilla/5.0 (Titus kişisel radar)" } }).getContentText();
        const kws = String(r.keywords || "").split(",").map(k => k.trim().toLocaleLowerCase("tr-TR")).filter(Boolean);
        const re = /<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi; let m, n = 0;
        while ((m = re.exec(html)) && n < 300) {
          n++;
          const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (text.length < 12) continue;
          const low = text.toLocaleLowerCase("tr-TR");
          if (kws.length && !kws.some(k => low.indexOf(k) >= 0)) continue;
          let link = m[1]; try { if (!/^https?:/i.test(link)) link = r.url.replace(/(https?:\/\/[^/]+).*/, "$1") + (link.startsWith("/") ? "" : "/") + link; } catch (e) {}
          const key = "w:" + link; if (seenSet.has(key)) continue; seenSet.add(key);
          fresh.push({ radar: r.name, title: text.slice(0, 140), link: link, found: fmt_(new Date()), seen: false });
        }
      }
    } catch (e) { console.warn("radar " + r.name + ": " + e); }
  });
  if (!fresh.length) return;
  items = fresh.concat(items).slice(0, 200);
  jset_("radarItems", items);
  jset_("radarSeen", Array.from(seenSet).slice(-1500));
  const topic = props_().getProperty("ntfy");
  if (topic) {
    const body = fresh.slice(0, 5).map(x => "• " + x.title).join("\n") + (fresh.length > 5 ? "\n+" + (fresh.length - 5) + " yeni" : "");
    try { UrlFetchApp.fetch("https://ntfy.sh/" + encodeURIComponent(topic), { method: "post", payload: body, headers: { Title: "Titus radar: " + fresh.length + " yeni bulgu", Tags: "satellite" }, muteHttpExceptions: true }); } catch (e) {}
  }
}
/** Bir kez çalıştır (ya da radarı uygulamadan kaydet): saatlik taramayı kurar. */
function kurulum() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "radarRun");
  if (!has) ScriptApp.newTrigger("radarRun").timeBased().everyHours(1).create();
  kurulumBrifing();
}

/* ---------- Bilgisayar ajanı kuyruğu ---------- */
function pcQueue_() { return jget_("pcQueue", []); }
function pcSave_(q) { jset_("pcQueue", q.slice(-40)); }
function pcPush(cmd) {
  const lock = LockService.getScriptLock(); lock.waitLock(8000);
  try {
    const q = pcQueue_(); const id = Utilities.getUuid().slice(0, 8);
    q.push({ id: id, cmd: cmd, at: Date.now(), taken: false, result: null }); pcSave_(q); return id;
  } finally { lock.releaseLock(); }
}
function pcPull() {
  const lock = LockService.getScriptLock(); lock.waitLock(8000);
  try {
    const q = pcQueue_(); const now = Date.now();
    const out = q.filter(x => !x.taken && now - x.at < 120000);
    out.forEach(x => x.taken = true); pcSave_(q);
    props_().setProperty("pcSeen", String(now));
    return out.map(x => ({ id: x.id, cmd: x.cmd }));
  } finally { lock.releaseLock(); }
}
function pcDone(id, result) {
  const lock = LockService.getScriptLock(); lock.waitLock(8000);
  try { const q = pcQueue_(); const x = q.find(x => x.id === id); if (x) { x.result = result || { ok: true }; pcSave_(q); } }
  finally { lock.releaseLock(); }
}
function pcResultGet(id) { const x = pcQueue_().find(x => x.id === id); return x ? x.result : null; }

/* ---------- v1.5: önceden hazırlanmış brifing verisi ---------- */
function briefData(force) {
  const cache = CacheService.getScriptCache();
  if (!force) { const c = cache.get("brief"); if (c) return JSON.parse(c); }
  const d = { etkinlikler: calendarList(2), mailler: gmail("is:unread in:inbox newer_than:2d", 8), hazirlandi: fmt_(new Date()), geceRaporu: jget_("nightReport", null) };
  try { cache.put("brief", JSON.stringify(d).slice(0, 95000), 45 * 60); } catch (e) {}
  return d;
}
/** Saatlik tetikleyici: brifing verisini sıcak tutar (sabah "Günaydın" deyince beklemeden gelir). */
function briefWarm() { const h = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "H")); if (h >= 5 && h <= 23) briefData(true); }
function kurulumBrifing() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "briefWarm");
  if (!has) ScriptApp.newTrigger("briefWarm").timeBased().everyHours(1).create();
}


/* ---------- v2.0: Drive'a dosya kaydı ve şifreli yedek ---------- */
function folder_(name) { const it = DriveApp.getFoldersByName(name); return it.hasNext() ? it.next() : DriveApp.createFolder(name); }
function saveFile(req) {
  const f = folder_(req.folder || "Titus");
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || "application/octet-stream", req.name || "dosya");
  const file = f.createFile(blob);
  if (req.keep) { // eski yedekleri temizle
    const files = []; const it = f.getFiles(); while (it.hasNext()) files.push(it.next());
    files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(Number(req.keep)).forEach(x => x.setTrashed(true));
  }
  return { id: file.getId(), url: file.getUrl(), name: file.getName() };
}
function getBackup(req) {
  const f = folder_(req.folder || "Titus Yedek"); const files = []; const it = f.getFiles(); while (it.hasNext()) files.push(it.next());
  if (!files.length) return { data: null };
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  return { name: files[0].getName(), data: Utilities.base64Encode(files[0].getBlob().getBytes()) };
}

/* ---------- v2.0: gece mesaisi (sen uyurken Titus hazırlık yapar) ---------- */
/** Uygulamada "Gece mesaisi" açılınca Gemini anahtarı buraya kaydedilir ve her gece 05:00'te çalışır. */
function nightJob() {
  const key = props_().getProperty("GEMINI_KEY"); if (!key) return;
  let ctx = "";
  try { ctx += "TAKVİM (2 gün):\n" + calendarList(2).map(e => `${e.baslangic} ${e.baslik}`).join("\n") + "\n"; } catch (e) {}
  try { ctx += "OKUNMAMIŞ MAİLLER:\n" + gmail("is:unread in:inbox newer_than:1d", 12).map(m => `${m.kimden}: ${m.konu} — ${m.ozet}`).join("\n") + "\n"; } catch (e) {}
  try { radarRun(); } catch (e) {}
  try { ctx += "YENİ CASTING/İLANLAR:\n" + radarGet().filter(x => !x.seen).slice(0, 10).map(x => x.title || x.baslik || JSON.stringify(x).slice(0, 120)).join("\n") + "\n"; } catch (e) {}
  const prompt = "Sen Titus'sun. Burak uyurken gece mesaisi yaptın. Aşağıdaki verilerden sabah ona okunacak, Türkçe, en fazla 8 cümlelik bir 'gece raporu' yaz: önemli mailler (cevap gerekenler), bugünkü işler, dikkat çeken casting ilanları ve öneriler. Gereksiz detay verme.\n\n" + ctx;
  const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
  for (const m of models) {
    try {
      const r = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, { method: "post", contentType: "application/json", muteHttpExceptions: true, payload: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 900 } }) });
      if (r.getResponseCode() !== 200) continue;
      const j = JSON.parse(r.getContentText());
      const t = ((j.candidates && j.candidates[0].content.parts) || []).filter(p => p.text && !p.thought).map(p => p.text).join("").trim();
      if (t) { jset_("nightReport", { at: fmt_(new Date()), text: t }); CacheService.getScriptCache().remove("brief"); return; }
    } catch (e) {}
  }
}
function kurulumGece() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "nightJob");
  if (!has) ScriptApp.newTrigger("nightJob").timeBased().atHour(5).everyDays(1).create();
}


/* ---------- v2.1: Recast brief akışı ---------- */
/** KADRO'nun tamamını kısa satırlar halinde döndürür (oyuncu seçimi için). */
function roster(req) {
  const ss = SpreadsheetApp.openById(req.sheetId);
  const sh = req.sheet ? ss.getSheetByName(req.sheet) : ss.getSheets()[0];
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { basliklar: [], satirlar: [] };
  const head = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length && rows.length < 600; i++) {
    const r = values[i]; if (!r.some(c => c !== "")) continue;
    rows.push({ n: i + 1, t: r.map((c, k) => c === "" ? "" : head[k] + ": " + (c instanceof Date ? fmt_(c).slice(0, 10) : String(c).replace(/\s+/g, " ").slice(0, 160))).filter(Boolean).join(" | ").slice(0, 420) });
  }
  return { sayfa: sh.getName(), basliklar: head, toplam: rows.length, satirlar: rows };
}
/** Son günlerde gelen casting brief'i olabilecek mailleri tam metinle döndürür. */
function briefMails(req) {
  const q = req.query || 'in:inbox newer_than:' + (Number(req.days) || 4) + 'd (casting OR cast OR brief OR oyuncu OR rol OR seçme OR "self tape" OR "self-tape" OR reklam OR dizi OR film)' + (req.unread ? " is:unread" : "");
  return GmailApp.search(q, 0, Math.min(Number(req.max) || 6, 15)).map(t => {
    const m = t.getMessages()[t.getMessages().length - 1];
    return { id: t.getId(), kimden: m.getFrom(), yanitla: m.getReplyTo() || m.getFrom(), konu: m.getSubject(), tarih: fmt_(m.getDate()), okunmadi: t.isUnread(),
             metin: m.getPlainBody().replace(/\n{3,}/g, "\n\n").slice(0, 6000), ekler: m.getAttachments().map(a => a.getName()).slice(0, 8) };
  });
}


/* ---------- v2.2: Recast Audition veri tablosuna erişim ---------- */
// Audition uygulamasının "RECAST AUDITION — Veriler" E-Tablosu. Kimlik telefondan gelir; yoksa adla bulunur.
function audSS_(req) {
  if (req.sheetId) return SpreadsheetApp.openById(req.sheetId);
  const it = DriveApp.getFilesByName("RECAST AUDITION — Veriler");
  if (!it.hasNext()) throw new Error("RECAST AUDITION — Veriler tablosu bulunamadı. Titus Ayarlar → Recast Audition'a tablo kimliğini yaz.");
  return SpreadsheetApp.open(it.next());
}
const AUD_LOCKED_ = ["AYARLAR", "OTURUMLAR", "KODLAR", "EKIP"]; // gizli/hassas sayfalar
function audVal_(v) { return v instanceof Date ? fmt_(v) : v; }
function audInfo(req) {
  const ss = audSS_(req);
  return { tablo: ss.getName(), id: ss.getId(), sayfalar: ss.getSheets().filter(sh => AUD_LOCKED_.indexOf(sh.getName()) < 0).map(sh => {
    const lr = sh.getLastRow(), lc = sh.getLastColumn();
    const head = lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(String) : [];
    const ornek = lr > 1 ? sh.getRange(Math.max(2, lr - 1), 1, Math.min(2, lr - 1), lc).getValues().map(r => { const o = {}; head.forEach((h, k) => { if (r[k] !== "") o[h] = String(audVal_(r[k])).slice(0, 80); }); return o; }) : [];
    return { ad: sh.getName(), basliklar: head, satir: Math.max(0, lr - 1), ornek: ornek };
  }) };
}
function audRead(req) {
  const sh = audSS_(req).getSheetByName(req.sayfa); if (!sh) throw new Error("Sayfa yok: " + req.sayfa);
  if (AUD_LOCKED_.indexOf(sh.getName()) > -1) throw new Error("Bu sayfa korumalı");
  const v = sh.getDataRange().getValues(); if (v.length < 2) return { satirlar: [] };
  const head = v[0].map(String), q = String(req.ara || "").toLocaleLowerCase("tr-TR");
  const out = [];
  for (let i = v.length - 1; i >= 1 && out.length < Math.min(Number(req.limit) || 25, 60); i--) {
    const r = v[i]; if (q && !r.some(c => String(c).toLocaleLowerCase("tr-TR").indexOf(q) > -1)) continue;
    const o = {}; head.forEach((h, k) => { if (r[k] !== "") o[h] = String(audVal_(r[k])).slice(0, 300); }); out.push(o);
  }
  return { sayfa: sh.getName(), basliklar: head, satirlar: out };
}
function audUpdate(req) {
  const sh = audSS_(req).getSheetByName(req.sayfa); if (!sh) throw new Error("Sayfa yok: " + req.sayfa);
  if (AUD_LOCKED_.indexOf(sh.getName()) > -1) throw new Error("Bu sayfa korumalı");
  const v = sh.getDataRange().getValues(); const head = v[0].map(String); const idc = head.indexOf("id");
  if (idc < 0) throw new Error("Sayfada id sütunu yok");
  const row = v.findIndex((r, i) => i > 0 && String(r[idc]) === String(req.id)); if (row < 0) throw new Error("Kayıt bulunamadı: " + req.id);
  const ch = req.degisiklikler || {}, eski = {};
  Object.keys(ch).forEach(k => { const c = head.indexOf(k); if (c < 0 || k === "id") throw new Error("Geçersiz sütun: " + k); eski[k] = audVal_(v[row][c]); sh.getRange(row + 1, c + 1).setValue(ch[k]); });
  return { guncellendi: true, eski: eski };
}
function audAdd(req) {
  const sh = audSS_(req).getSheetByName(req.sayfa); if (!sh) throw new Error("Sayfa yok: " + req.sayfa);
  if (AUD_LOCKED_.indexOf(sh.getName()) > -1) throw new Error("Bu sayfa korumalı");
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const k = req.kayit || {}; if (head.indexOf("id") > -1 && !k.id) k.id = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  if (head.indexOf("olusturma") > -1 && !k.olusturma) k.olusturma = Date.now();
  sh.appendRow(head.map(h => k[h] !== undefined ? k[h] : ""));
  return { eklendi: true, id: k.id || "" };
}


/* ---------- v2.6: bilgisayardan telefona istek kuyruğu ---------- */
function phPush(req) {
  const lock = LockService.getScriptLock(); lock.waitLock(8000);
  try {
    const q = jget_("phQueue", []).filter(x => Date.now() - x.at < 6 * 3600000).slice(-30);
    const id = Utilities.getUuid().slice(0, 8);
    q.push({ id: id, kind: req.kind === "note" ? "note" : "ask", text: String(req.text || "").slice(0, 2000), at: Date.now() });
    jset_("phQueue", q); return id;
  } finally { lock.releaseLock(); }
}
function phPull() {
  const lock = LockService.getScriptLock(); lock.waitLock(8000);
  try {
    const q = jget_("phQueue", []); if (!q.length) return [];
    jset_("phQueue", []);
    return q.filter(x => Date.now() - x.at < 6 * 3600000).map(x => ({ id: x.id, kind: x.kind, text: x.text }));
  } finally { lock.releaseLock(); }
}
