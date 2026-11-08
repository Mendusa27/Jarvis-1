/**
 * JARVIS — Google arka ucu (ücretsiz)
 * Görevleri: cihazlar arası veri senkronu (Drive'da tek JSON dosyası), Google Takvim, Gmail özeti.
 * Kurulum: README.md → "Google bağlantısı".
 */

// ⚠️ Bunu kendine özel uzun bir şifreyle değiştir ve aynısını JARVIS → Ayarlar → Google → Gizli anahtar'a yaz.
const TOKEN = "BURAYA-UZUN-GIZLI-BIR-SIFRE-YAZ";
const FILE_NAME = "jarvis-veri.json";

function doGet() {
  return ContentService.createTextOutput("JARVIS arka ucu çalışıyor ✓");
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out({ ok: false, error: "Geçersiz istek" }); }
  if (!req || req.token !== TOKEN) return out({ ok: false, error: "Yetkisiz: gizli anahtar uyuşmuyor" });
  try {
    switch (req.action) {
      case "ping":         return out({ ok: true, email: Session.getActiveUser().getEmail() });
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
        const html = UrlFetchApp.fetch(r.url, { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": "Mozilla/5.0 (JARVIS kişisel radar)" } }).getContentText();
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
    try { UrlFetchApp.fetch("https://ntfy.sh/" + encodeURIComponent(topic), { method: "post", payload: body, headers: { Title: "JARVIS radar: " + fresh.length + " yeni bulgu", Tags: "satellite" }, muteHttpExceptions: true }); } catch (e) {}
  }
}
/** Bir kez çalıştır (ya da radarı uygulamadan kaydet): saatlik taramayı kurar. */
function kurulum() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "radarRun");
  if (!has) ScriptApp.newTrigger("radarRun").timeBased().everyHours(1).create();
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
