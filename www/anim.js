/* TITUS ANİMASYON MOTORU (v4.3)
   Gemini sahneyi çizmez; "senaryo" JSON'u yazar. Bu motor karakter kitiyle her kareyi kesin olarak çizer:
   pozlar, yürüme, ifadeler, göz kırpma, sese göre ağız (dudak senkronu), eşyalar, arka planlar, yazılar, kamera, geçişler.
   window.TitusAnim = { render, layout, size, music, envelope, CAT } */
(function () {
  "use strict";
  const TAU = Math.PI * 2, INK = "#1E1A17";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const back = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const N = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
  const SKIN = { acik: "#F6D2B0", orta: "#EBBB92", esmer: "#C98E62", koyu: "#8C5B3D" };
  const shade = (hex, k) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex; const n = parseInt(m[1], 16); const f = c => clamp(Math.round(c * k), 0, 255); return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => f(c).toString(16).padStart(2, "0")).join(""); };
  const CAT = {
    sac: ["kisa", "kel", "uzun", "topuz", "kivircik", "kase", "dalgali"],
    sapka: ["yok", "gece", "doktor", "bone", "silindir", "kasket", "tac", "bere", "kovboy"],
    kiyafet: ["cubbe", "elbise", "ceket", "gomlek", "gecelik", "tisort"],
    yaka: ["yok", "firfir", "onluk", "kravat", "papyon", "atki"],
    vucut: ["ince", "normal", "tombul"],
    ifade: ["notr", "mutlu", "uzgun", "korkmus", "kizgin", "sinsi", "saskin", "goz_kirp", "uykulu"],
    poz: ["dur", "el_salla", "isaret", "bel", "titre", "kollar_yukari", "tut", "dusun", "omuz", "yat", "yatakta", "otur"],
    eylem: ["yuru", "kos", "gir", "cik", "zipla", "el_salla", "isaret", "titre", "bas_salla", "hayir", "ifade", "poz", "don", "bayil", "goz_ac"],
    esya: ["yatak", "masa", "sandalye", "kapi", "pencere", "bitki", "sise", "siseler", "fatura", "kalp", "kitap", "mum", "kese", "siringa", "cicek", "kahve", "telefon", "tablo", "sandik", "agac", "sokak_lambasi", "kamera", "mikrofon"],
    arka: ["sahne", "oda", "sokak", "park", "ofis", "gece", "duz", "tiyatro"],
    yazi: ["baslik", "cip", "balon", "alt", "kart"],
    gecis: ["kesme", "solma", "perde", "silme"]
  };
  function size(format) { return format === "9:16" ? [720, 1280] : format === "1:1" ? [1080, 1080] : format === "4:5" ? [1080, 1350] : [1280, 720]; }

  /* ---------------- zaman çizelgesi ---------------- */
  function layout(spec, durs) {
    const sc = spec.sahneler || []; let t = 0; const out = [];
    sc.forEach((s, i) => { const d = Math.max(1.5, N(durs && durs[i], N(s.sure, 4))); out.push({ i, start: t, dur: d }); t += d; });
    return { scenes: out, total: t };
  }
  function actorState(a, t, scene, W, H, opt, si) {
    const st = { x: N(a.x, 0.5), y: N(a.y, 0), s: N(a.olcek, 1), dir: a.yon === -1 || a.yon === "sol" ? -1 : 1, poz: CAT.poz.includes(a.poz) ? a.poz : "dur", ifade: CAT.ifade.includes(a.ifade) ? a.ifade : "notr", walk: 0, ph: 0, jump: 0, shiver: 0, nod: 0, shake: 0, faint: 0, tmpPoz: null, eyeOpen: false, vis: 1 };
    const acts = (a.eylemler || []).slice().sort((p, q) => N(p.t, 0) - N(q.t, 0));
    for (const e of acts) {
      const t0 = N(e.t, 0); if (t < t0) continue;
      const tur = e.tur; let d = N(e.sure, 0);
      if (tur === "ifade" && CAT.ifade.includes(e.ifade)) st.ifade = e.ifade;
      else if (tur === "poz" && CAT.poz.includes(e.poz)) st.poz = e.poz;
      else if (tur === "don") st.dir *= -1;
      else if (tur === "yuru" || tur === "kos" || tur === "gir" || tur === "cik") {
        let x0 = st.x, x1 = N(e.x, st.x);
        if (tur === "gir") { x0 = N(e.from, x1 < 0.5 ? -0.18 : 1.18); }
        if (tur === "cik") { x1 = N(e.x, st.x < 0.5 ? -0.25 : 1.25); }
        const speed = tur === "kos" ? 0.55 : 0.26; if (!d) d = Math.max(0.4, Math.abs(x1 - x0) / speed);
        const p = clamp((t - t0) / d, 0, 1);
        st.x = lerp(x0, x1, tur === "gir" ? 1 - Math.pow(1 - p, 2) : p);
        if (p < 1) { st.walk = tur === "kos" ? 1.6 : 1; st.ph = (t - t0) * (tur === "kos" ? 14 : 9); if (Math.abs(x1 - x0) > 0.01) st.dir = x1 > x0 ? 1 : -1; }
        else if (e.yon != null) st.dir = e.yon === -1 || e.yon === "sol" ? -1 : 1;
      } else {
        if (!d) d = tur === "bayil" ? 1.2 : tur === "zipla" ? 0.7 : 1.5;
        const p = (t - t0) / d; if (tur === "bayil") { st.faint = clamp(p, 0, 1); continue; }
        if (tur === "goz_ac") { if (p <= 1) st.eyeOpen = true; continue; }
        if (p > 1) continue;
        if (tur === "zipla") st.jump = Math.sin(clamp(p, 0, 1) * Math.PI);
        else if (tur === "titre") st.shiver = 1;
        else if (tur === "bas_salla") st.nod = Math.sin(p * TAU * 2);
        else if (tur === "hayir") st.shake = Math.sin(p * TAU * 2.5);
        else if (tur === "el_salla") st.tmpPoz = "el_salla";
        else if (tur === "isaret") st.tmpPoz = "isaret";
      }
    }
    if (st.poz === "titre") st.shiver = 1;
    // konuşma: gerçek ses zarfı ya da önizlemede tahmini
    let talk = 0; const spk = scene.konusan;
    if (spk && spk === a.id) {
      const env = opt.env && opt.env[si]; const vs = N(opt.voStart, 0.3);
      if (env) { const k = Math.floor((t - vs) * 60); talk = k >= 0 && k < env.length ? env[k] : 0; }
      else if (scene.ses) { const est = String(scene.ses).split(/\s+/).length / 2.4; if (t > vs && t < vs + est) talk = 0.35 + 0.35 * Math.abs(Math.sin(t * 17)) * Math.abs(Math.sin(t * 5.3)); }
    }
    for (const b of scene.yazilar || []) if (b.stil === "balon" && b.kim === a.id) { const t0 = N(b.t, 0), d = N(b.sure, 2); if (t > t0 && t < t0 + d * 0.8 && !opt.env) talk = Math.max(talk, 0.3 + 0.3 * Math.abs(Math.sin(t * 15))); }
    st.talk = clamp(talk, 0, 1);
    return st;
  }

  /* ---------------- karakter kiti ---------------- */
  function look(c) {
    const g = (c && c.gorunum) || {};
    const pick = (v, list, d) => (list.includes(v) ? v : d);
    return {
      ten: SKIN[g.ten] || (/^#/.test(g.ten || "") ? g.ten : SKIN.acik), sac: pick(g.sac, CAT.sac, "kisa"), sacR: g.sac_renk || "#4A3426", sapka: pick(g.sapka, CAT.sapka, "yok"), sapkaR: g.sapka_renk,
      kiyafet: pick(g.kiyafet, CAT.kiyafet, "gomlek"), kR: g.kiyafet_renk || "#3E6FB0", yaka: pick(g.yaka, CAT.yaka, "yok"), vucut: pick(g.vucut, CAT.vucut, "normal"), boy: clamp(N(g.boy, 1), 0.75, 1.2),
      gozluk: !!g.gozluk, biyik: !!g.biyik, sakal: !!g.sakal, yanak: g.yanak !== false, pantolon: g.pantolon_renk || "#2E2A33", elinde: CAT.esya.includes(g.elinde) ? g.elinde : null, seed: (c && c.id) || "x"
    };
  }
  function stroke(g, w = 5) { g.lineWidth = w; g.strokeStyle = INK; g.lineJoin = "round"; g.lineCap = "round"; g.stroke(); }
  function fillS(g, col, w = 5) { g.fillStyle = col; g.fill(); stroke(g, w); }
  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
  function armAngles(poz, t, st) {
    // [üst, alt] açıları; 0 = aşağı, + = dışarı
    switch (poz) {
      case "el_salla": return { R: [2.55, -0.35 + 0.5 * Math.sin(t * 9)], L: [0.18, 0.1] };
      case "isaret": return { R: [-1.45, 0.05], L: [0.18, 0.1] };
      case "bel": return { R: [0.75, -2.3], L: [0.75, -2.3] };
      case "titre": return { R: [-0.35, -2.5], L: [-0.35, -2.5] };
      case "kollar_yukari": return { R: [2.6, -0.15], L: [2.6, -0.15] };
      case "tut": return { R: [-0.75, -0.8], L: [0.18, 0.1] };
      case "dusun": return { R: [-0.25, -2.75], L: [0.4, -1.6] };
      case "omuz": return { R: [0.95, -1.9], L: [0.95, -1.9] };
      default: { const sw = st.walk ? 0.35 * Math.sin(st.ph) : 0.05 * Math.sin(t * 1.7); return { R: [0.16 + sw, 0.12], L: [0.16 - sw, 0.12] }; }
    }
  }
  function drawArm(g, L, side, a, col, skin, holdProp, t) {
    const sx = side * L.sw, sy = -L.sh + 12, l1 = 50 * L.k, l2 = 46 * L.k;
    const ex = sx + side * Math.sin(a[0]) * l1, ey = sy + Math.cos(a[0]) * l1;
    const a2 = a[0] + a[1], hx = ex + side * Math.sin(a2) * l2, hy = ey + Math.cos(a2) * l2;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.lineTo(hx, hy);
    g.lineWidth = 24; g.strokeStyle = INK; g.lineCap = "round"; g.lineJoin = "round"; g.stroke(); g.lineWidth = 15; g.strokeStyle = col; g.stroke();
    if (holdProp) { g.save(); g.translate(hx + side * 6, hy + 34); drawProp(g, holdProp, 0, 0, 0.4, t, null, true); g.restore(); }
    circle(g, hx, hy, 11); fillS(g, skin, 4);
  }
  function drawHair(g, L, back) {
    const r = L.hr, cy = L.hy, c = L.sacR;
    if (back) {
      if (L.sac === "uzun") { g.beginPath(); g.moveTo(-r * 1.05, cy - 10); g.quadraticCurveTo(-r * 1.25, cy + r * 1.6, -r * 0.7, cy + r * 1.55); g.lineTo(r * 0.7, cy + r * 1.55); g.quadraticCurveTo(r * 1.25, cy + r * 1.6, r * 1.05, cy - 10); g.closePath(); fillS(g, c); }
      if (L.sac === "topuz") { circle(g, 0, cy - r * 1.05, r * 0.45); fillS(g, c); }
      if (L.sac === "kivircik") for (let i = 0; i < 9; i++) { const a = Math.PI + (i / 8) * Math.PI; circle(g, Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 0.98, r * 0.3); fillS(g, c, 4); }
      return;
    }
    g.beginPath();
    switch (L.sac) {
      case "kel": g.moveTo(-r * 0.98, cy - 2); g.quadraticCurveTo(-r * 1.08, cy - r * 0.45, -r * 0.7, cy - r * 0.5); g.lineTo(-r * 0.75, cy - 2); g.closePath(); g.moveTo(r * 0.98, cy - 2); g.quadraticCurveTo(r * 1.08, cy - r * 0.45, r * 0.7, cy - r * 0.5); g.lineTo(r * 0.75, cy - 2); g.closePath(); break;
      case "kase": g.moveTo(-r * 1.04, cy - 2); g.arc(0, cy, r * 1.04, Math.PI, 0); g.lineTo(r * 1.04, cy - r * 0.22); g.lineTo(-r * 1.04, cy - r * 0.22); g.closePath(); break;
      case "dalgali": g.moveTo(-r * 1.02, cy + 6); g.quadraticCurveTo(-r * 1.1, cy - r * 1.1, 0, cy - r * 1.05); g.quadraticCurveTo(r * 1.1, cy - r * 1.1, r * 1.02, cy + 6); g.quadraticCurveTo(r * 0.55, cy - r * 0.55, 0, cy - r * 0.6); g.quadraticCurveTo(-r * 0.45, cy - r * 0.35, -r * 1.02, cy + 6); break;
      default: g.moveTo(-r * 1.0, cy - 2); g.quadraticCurveTo(-r * 1.02, cy - r * 1.12, 0, cy - r * 1.06); g.quadraticCurveTo(r * 1.02, cy - r * 1.12, r * 1.0, cy - 2); g.quadraticCurveTo(r * 0.7, cy - r * 0.62, 0, cy - r * 0.62); g.quadraticCurveTo(-r * 0.7, cy - r * 0.62, -r * 1.0, cy - 2);
    }
    fillS(g, c, 4.5);
  }
  function drawHat(g, L, t) {
    const r = L.hr, cy = L.hy, top = cy - r * 0.78;
    switch (L.sapka) {
      case "gece": { const c = L.sapkaR || "#C0392B"; const sw = Math.sin(t * 2) * 4; g.beginPath(); g.moveTo(-r * 1.05, top + 18); g.quadraticCurveTo(-r * 0.9, top - r * 1.2, r * 0.35, top - r * 1.05); g.quadraticCurveTo(r * 1.35 + sw, top - r * 0.75, r * 1.45 + sw, top + r * 0.2); g.quadraticCurveTo(r * 1.0, top - r * 0.1, r * 1.02, top + 18); g.closePath(); fillS(g, c);
        g.save(); g.clip(); g.strokeStyle = "rgba(244,234,213,.85)"; g.lineWidth = 9; for (let i = -3; i < 6; i++) { g.beginPath(); g.moveTo(-r * 1.4 + i * 26, top + 30); g.lineTo(-r * 0.4 + i * 26, top - r * 1.4); g.stroke(); } g.restore();
        g.beginPath(); g.moveTo(-r * 1.08, top + 18); g.quadraticCurveTo(0, top + 4, r * 1.08, top + 18); g.lineTo(r * 1.08, top + 30); g.quadraticCurveTo(0, top + 16, -r * 1.08, top + 30); g.closePath(); fillS(g, "#F4EAD5", 4); circle(g, r * 1.48 + sw, top + r * 0.28, 12); fillS(g, "#F4EAD5", 4); break; }
      case "doktor": { const c = L.sapkaR || "#1E1A17"; g.beginPath(); g.moveTo(-r * 0.62, top + 10); g.lineTo(-r * 0.46, top - r * 1.75); g.lineTo(r * 0.46, top - r * 1.75); g.lineTo(r * 0.62, top + 10); g.closePath(); fillS(g, c); g.beginPath(); g.roundRect(-r * 0.95, top + 2, r * 1.9, 14, 7); fillS(g, c, 4); break; }
      case "silindir": { const c = L.sapkaR || "#232026"; g.beginPath(); g.rect(-r * 0.62, top - r * 1.2, r * 1.24, r * 1.25); fillS(g, c); g.beginPath(); g.rect(-r * 0.62, top - r * 0.2, r * 1.24, 12); g.fillStyle = "#C0392B"; g.fill(); g.beginPath(); g.ellipse(0, top + 6, r * 1.05, 10, 0, 0, TAU); fillS(g, c, 4); break; }
      case "bone": { g.beginPath(); g.moveTo(-r * 0.95, top + 22); g.quadraticCurveTo(-r * 0.85, top - r * 0.75, 0, top - r * 0.8); g.quadraticCurveTo(r * 0.85, top - r * 0.75, r * 0.95, top + 22); g.quadraticCurveTo(0, top + 6, -r * 0.95, top + 22); fillS(g, L.sapkaR || "#FFFFFF");
        for (let i = 0; i < 7; i++) { const a = Math.PI + 0.2 + (i / 6) * (Math.PI - 0.4); circle(g, Math.cos(a) * r * 0.98, cy - 4 + Math.sin(a) * r * 0.98, 9); fillS(g, L.sapkaR || "#FFFFFF", 3); } break; }
      case "kasket": { const c = L.sapkaR || "#5B4A3A"; g.beginPath(); g.moveTo(-r * 1.0, top + 18); g.quadraticCurveTo(-r * 0.9, top - r * 0.55, r * 0.2, top - r * 0.5); g.quadraticCurveTo(r * 1.05, top - r * 0.35, r * 1.0, top + 18); g.closePath(); fillS(g, c); g.beginPath(); g.ellipse(r * 0.75, top + 18, r * 0.62, 9, 0, 0, TAU); fillS(g, shade(c, 0.8), 4); break; }
      case "bere": { const c = L.sapkaR || "#7A1F2B"; g.beginPath(); g.ellipse(-r * 0.15, top - 2, r * 1.15, r * 0.42, -0.12, 0, TAU); fillS(g, c); circle(g, -r * 0.1, top - r * 0.42, 6); fillS(g, c, 3); break; }
      case "kovboy": { const c = L.sapkaR || "#8B5A2B"; g.beginPath(); g.moveTo(-r * 0.6, top + 8); g.quadraticCurveTo(-r * 0.7, top - r * 0.95, 0, top - r * 0.8); g.quadraticCurveTo(r * 0.7, top - r * 0.95, r * 0.6, top + 8); g.closePath(); fillS(g, c); g.beginPath(); g.ellipse(0, top + 10, r * 1.45, 13, 0, 0, TAU); fillS(g, shade(c, 0.85), 4); break; }
      case "tac": { g.beginPath(); g.moveTo(-r * 0.7, top + 10); g.lineTo(-r * 0.75, top - r * 0.6); g.lineTo(-r * 0.35, top - r * 0.25); g.lineTo(0, top - r * 0.75); g.lineTo(r * 0.35, top - r * 0.25); g.lineTo(r * 0.75, top - r * 0.6); g.lineTo(r * 0.7, top + 10); g.closePath(); fillS(g, L.sapkaR || "#E0A526"); circle(g, 0, top - 8, 6); fillS(g, "#C0392B", 3); break; }
    }
  }
  function drawFace(g, L, st, t) {
    const r = L.hr, cy = L.hy, ex = r * 0.36, ey = cy - r * 0.05; const ifd = st.ifade;
    const blink = (((t + (L.seedN * 3)) % 3.7) < 0.12 && ifd !== "uykulu") || ifd === "uykulu";
    const big = ifd === "korkmus" || ifd === "saskin" ? 1.25 : 1;
    const closed = st.closedEyes && !st.eyeOpen;
    for (const s of [-1, 1]) {
      const x = s * ex; const wink = ifd === "goz_kirp" && s === 1;
      if (closed || wink || blink || (st.closedEyes && st.eyeOpen && s === -1)) { g.beginPath(); g.moveTo(x - 10, ey + (wink ? 0 : 2)); g.quadraticCurveTo(x, ey + (wink ? -8 : 7), x + 10, ey + (wink ? 0 : 2)); stroke(g, 4.5); continue; }
      circle(g, x, ey, 11.5 * big); fillS(g, "#FFFFFF", 4); const lx = (st.lookX || 0) * 3; circle(g, x + lx, ey + 1.5, 5); g.fillStyle = INK; g.fill();
      if (ifd === "sinsi" || ifd === "uykulu") { g.beginPath(); g.arc(x, ey, 12.5, Math.PI, 0); g.closePath(); g.fillStyle = L.ten; g.fill(); g.beginPath(); g.moveTo(x - 12.5, ey); g.lineTo(x + 12.5, ey); stroke(g, 4); }
    }
    // kaşlar
    const bt = { notr: [0, 0], mutlu: [-3, 0.15], uzgun: [-2, -0.45], korkmus: [-9, -0.35], kizgin: [2, 0.55], sinsi: [-1, 0.35], saskin: [-11, 0], goz_kirp: [-3, 0.15], uykulu: [2, 0] }[ifd] || [0, 0];
    for (const s of [-1, 1]) { const x = s * ex, y = ey - 20 + bt[0]; const tilt = (ifd === "sinsi" && s === 1 ? -0.35 : bt[1]) * s; g.beginPath(); g.moveTo(x - 11, y - tilt * 11); g.lineTo(x + 11, y + tilt * 11); stroke(g, 5); }
    // burun, yanak
    g.beginPath(); g.ellipse(0, cy + r * 0.2, 9, 8, 0, 0, TAU); fillS(g, shade(L.ten, 0.88), 4);
    if (L.yanak) { g.fillStyle = "rgba(238,130,130,.45)"; circle(g, -r * 0.62, cy + r * 0.28, 9); g.fill(); circle(g, r * 0.62, cy + r * 0.28, 9); g.fill(); }
    if (L.gozluk) { for (const s of [-1, 1]) { circle(g, s * ex, ey, 15); stroke(g, 4); } g.beginPath(); g.moveTo(-ex + 15, ey); g.lineTo(ex - 15, ey); stroke(g, 4); }
    // ağız
    const my = cy + r * 0.52;
    if (st.talk > 0.05) { const h = 3 + st.talk * 17, w = 13 + st.talk * 4; g.beginPath(); g.ellipse(0, my, w, h, 0, 0, TAU); fillS(g, "#5A1E1E", 4); if (h > 8) { g.beginPath(); g.ellipse(0, my + h * 0.45, w * 0.55, h * 0.35, 0, 0, TAU); g.fillStyle = "#D9706E"; g.fill(); } }
    else {
      g.beginPath();
      if (ifd === "mutlu" || ifd === "goz_kirp") { g.moveTo(-15, my - 4); g.quadraticCurveTo(0, my + 16, 15, my - 4); g.closePath(); fillS(g, "#5A1E1E", 4); }
      else if (ifd === "uzgun") { g.moveTo(-13, my + 6); g.quadraticCurveTo(0, my - 6, 13, my + 6); stroke(g, 4.5); }
      else if (ifd === "korkmus" || ifd === "saskin") { g.ellipse(0, my + 2, 7, ifd === "saskin" ? 11 : 7, 0, 0, TAU); fillS(g, "#5A1E1E", 4); }
      else if (ifd === "kizgin") { g.moveTo(-13, my + 3); g.lineTo(13, my + 1); stroke(g, 5); }
      else if (ifd === "sinsi") { g.moveTo(-12, my + 1); g.quadraticCurveTo(4, my + 8, 15, my - 6); stroke(g, 4.5); }
      else { g.moveTo(-11, my); g.quadraticCurveTo(0, my + 6, 11, my); stroke(g, 4.5); }
    }
    if (L.biyik) { g.beginPath(); g.moveTo(0, my - 9); g.quadraticCurveTo(-14, my - 16, -26, my - 4); g.quadraticCurveTo(-12, my - 6, 0, my - 4); g.quadraticCurveTo(12, my - 6, 26, my - 4); g.quadraticCurveTo(14, my - 16, 0, my - 9); fillS(g, L.sacR, 3); }
    if (L.sakal) { g.beginPath(); g.moveTo(-r * 0.85, cy + r * 0.2); g.quadraticCurveTo(-r * 0.7, cy + r * 1.35, 0, cy + r * 1.4); g.quadraticCurveTo(r * 0.7, cy + r * 1.35, r * 0.85, cy + r * 0.2); g.quadraticCurveTo(r * 0.5, cy + r * 0.85, 0, cy + r * 0.78); g.quadraticCurveTo(-r * 0.5, cy + r * 0.85, -r * 0.85, cy + r * 0.2); fillS(g, L.sacR, 4); if (st.talk > 0.05) { g.beginPath(); g.ellipse(0, my, 10 + st.talk * 3, 3 + st.talk * 12, 0, 0, TAU); fillS(g, "#5A1E1E", 3); } }
    if (ifd === "korkmus") { g.beginPath(); g.moveTo(r * 0.95, cy - r * 0.5); g.quadraticCurveTo(r * 0.85, cy - r * 0.25, r * 0.95, cy - r * 0.18); g.quadraticCurveTo(r * 1.05, cy - r * 0.25, r * 0.95, cy - r * 0.5); fillS(g, "#9FD0F0", 2.5); }
  }
  function drawCharacter(g, c, st, t) {
    const L = look(c); L.seedN = (String(L.seed).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) % 97) / 97;
    const bw = { ince: 66, normal: 82, tombul: 108 }[L.vucut]; L.k = L.boy; L.sw = bw / 2 - 4; L.sh = 210 * L.boy; L.hr = L.vucut === "tombul" ? 55 : 51; L.hy = -L.sh - L.hr + 6;
    const robe = L.kiyafet === "cubbe" || L.kiyafet === "gecelik" || L.kiyafet === "elbise";
    g.save();
    if (st.shiver) g.translate(Math.sin(t * 60) * 2.2, 0);
    // bacaklar
    const hipY = -95 * L.boy;
    if (!robe) {
      for (const s of [-1, 1]) { const a = st.walk ? s * 0.42 * Math.sin(st.ph) : 0; const hx = s * 18, fx = hx + Math.sin(a) * 92 * L.boy, fy = st.walk ? -Math.max(0, Math.sin(st.ph + (s > 0 ? 0 : Math.PI))) * 8 : 0;
        g.beginPath(); g.moveTo(hx, hipY); g.lineTo(fx, fy - 8); g.lineWidth = 27; g.strokeStyle = INK; g.lineCap = "round"; g.stroke(); g.lineWidth = 18; g.strokeStyle = L.pantolon; g.stroke();
        g.beginPath(); g.ellipse(fx + 8, fy - 4, 17, 9, 0, 0, TAU); fillS(g, "#2B2420", 4); }
    } else {
      for (const s of [-1, 1]) { const off = st.walk ? s * 10 * Math.sin(st.ph) : 0; g.beginPath(); g.ellipse(s * 20 + off + 6, -6 - (st.walk ? Math.max(0, Math.sin(st.ph + (s > 0 ? 0 : Math.PI))) * 6 : 0), 17, 9, 0, 0, TAU); fillS(g, "#2B2420", 4); }
    }
    const P = armAngles(st.tmpPoz || st.poz, t, st);
    // arka kol + arka saç
    drawArm(g, L, -1, P.L, L.kR, L.ten, null, t);
    // gövde
    const top = -L.sh;
    g.beginPath();
    if (L.kiyafet === "cubbe" || L.kiyafet === "gecelik") { g.moveTo(-bw * 0.46, top + 4); g.lineTo(bw * 0.46, top + 4); g.lineTo(bw * 0.78, -12); g.quadraticCurveTo(0, -2, -bw * 0.78, -12); g.closePath(); }
    else if (L.kiyafet === "elbise") { g.moveTo(-bw * 0.42, top + 4); g.lineTo(bw * 0.42, top + 4); g.lineTo(bw * 0.36, hipY - 10); g.quadraticCurveTo(bw * 1.05, -30, bw * 0.95, -12); g.quadraticCurveTo(0, 0, -bw * 0.95, -12); g.quadraticCurveTo(-bw * 1.05, -30, -bw * 0.36, hipY - 10); g.closePath(); }
    else if (L.vucut === "tombul") { g.ellipse(0, (top + hipY) / 2 + 6, bw / 2, (hipY - top) / 2 + 14, 0, 0, TAU); }
    else { g.moveTo(-bw * 0.47, top + 8); g.quadraticCurveTo(-bw * 0.5, top, -bw * 0.36, top); g.lineTo(bw * 0.36, top); g.quadraticCurveTo(bw * 0.5, top, bw * 0.47, top + 8); g.lineTo(bw * 0.45, hipY + 6); g.lineTo(-bw * 0.45, hipY + 6); g.closePath(); }
    fillS(g, L.kR, 5.5);
    if (L.kiyafet === "ceket") { g.beginPath(); g.moveTo(-14, top + 2); g.lineTo(0, top + 42); g.lineTo(14, top + 2); stroke(g, 4); for (let i = 0; i < 3; i++) { circle(g, 0, top + 58 + i * 24, 3.5); g.fillStyle = INK; g.fill(); } }
    if (L.kiyafet === "gomlek" || L.kiyafet === "tisort") { g.beginPath(); g.moveTo(-bw * 0.45, hipY - 4); g.lineTo(bw * 0.45, hipY - 4); g.lineWidth = 9; g.strokeStyle = shade(L.kR, 0.6); g.stroke(); }
    if (L.yaka === "onluk") { g.beginPath(); g.roundRect(-bw * 0.32, hipY - 22, bw * 0.64, (robe ? -26 : hipY + 40) - (hipY - 22), 10); fillS(g, "#FFFFFF", 4); g.beginPath(); g.moveTo(-bw * 0.22, hipY - 22); g.lineTo(-bw * 0.16, top + 6); g.moveTo(bw * 0.22, hipY - 22); g.lineTo(bw * 0.16, top + 6); stroke(g, 6); }
    if (L.yaka === "kravat") { g.beginPath(); g.moveTo(-7, top + 4); g.lineTo(7, top + 4); g.lineTo(10, top + 70); g.lineTo(0, top + 84); g.lineTo(-10, top + 70); g.closePath(); fillS(g, "#C0392B", 3.5); }
    if (L.yaka === "papyon") { g.beginPath(); g.moveTo(0, top + 8); g.lineTo(-18, top - 2); g.lineTo(-18, top + 18); g.closePath(); g.moveTo(0, top + 8); g.lineTo(18, top - 2); g.lineTo(18, top + 18); g.closePath(); fillS(g, "#C0392B", 3.5); }
    if (L.yaka === "atki") { g.beginPath(); g.roundRect(-bw * 0.42, top - 4, bw * 0.84, 22, 10); fillS(g, "#E0A526", 4); g.beginPath(); g.roundRect(bw * 0.12, top + 10, 18, 60, 6); fillS(g, "#E0A526", 4); }
    // kafa (sallanma, onay)
    g.save(); const nodY = st.nod * 6, shakeX = st.shake * 7; g.translate(shakeX, nodY + Math.sin(t * 2.1) * 1.5 * (st.walk ? 0 : 1));
    g.beginPath(); g.rect(-12, top - 18, 24, 22); fillS(g, L.ten, 4);
    if (L.yaka === "firfir") { g.beginPath(); for (let i = 0; i <= 12; i++) { const x = -bw * 0.52 + (i / 12) * bw * 1.04, y = top - 2 + (i % 2 ? 14 : -2); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.lineTo(bw * 0.4, top + 8); g.lineTo(-bw * 0.4, top + 8); g.closePath(); fillS(g, "#FFFFFF", 3.5); }
    drawHair(g, L, true);
    for (const s of [-1, 1]) { circle(g, s * L.hr * 0.98, L.hy + 4, 10); fillS(g, L.ten, 4); }
    circle(g, 0, L.hy, L.hr); fillS(g, L.ten, 6);
    drawFace(g, L, st, t);
    if (L.sapka === "yok" || L.sapka === "bone" || L.sapka === "bere") drawHair(g, L, false);
    else if (L.sac !== "kel") { g.beginPath(); g.moveTo(-L.hr, L.hy + 2); g.quadraticCurveTo(-L.hr * 1.02, L.hy - L.hr * 0.55, -L.hr * 0.6, L.hy - L.hr * 0.72); g.lineTo(-L.hr * 0.55, L.hy - L.hr * 0.3); g.closePath(); g.moveTo(L.hr, L.hy + 2); g.quadraticCurveTo(L.hr * 1.02, L.hy - L.hr * 0.55, L.hr * 0.6, L.hy - L.hr * 0.72); g.lineTo(L.hr * 0.55, L.hy - L.hr * 0.3); g.closePath(); fillS(g, L.sacR, 4); }
    drawHat(g, L, t);
    g.restore();
    drawArm(g, L, 1, P.R, L.kR, L.ten, (st.tmpPoz || st.poz) === "tut" ? L.elinde : null, t);
    g.restore();
  }

  /* ---------------- eşyalar ---------------- */
  function drawProp(g, ad, x, y, s, t, col, inHand) {
    g.save(); g.translate(x, y); g.scale(s, s);
    const C = col || null;
    switch (ad) {
      case "yatak": g.beginPath(); g.roundRect(-190, -250, 380, 200, 36); fillS(g, C ? shade(C, 0.7) : "#8B5A2B", 6); for (const sx of [-170, 170]) { circle(g, sx, -250, 18); fillS(g, "#E0A526", 5); } g.beginPath(); g.roundRect(-175, -130, 350, 70, 20); fillS(g, "#FFFFFF", 5); g.beginPath(); g.ellipse(-110, -132, 64, 26, 0, 0, TAU); fillS(g, "#FFFFFF", 5); g.beginPath(); g.rect(-200, -60, 30, 60); g.rect(170, -60, 30, 60); fillS(g, "#6B4320", 5); break;
      case "yatak_on": g.beginPath(); g.moveTo(-200, -120); g.quadraticCurveTo(0, -160, 200, -120); g.lineTo(210, -40); g.lineTo(-210, -40); g.closePath(); fillS(g, C || "#3E6FB0", 6); g.save(); g.clip(); g.strokeStyle = "rgba(244,234,213,.8)"; g.lineWidth = 7; g.setLineDash([16, 12]); g.beginPath(); g.moveTo(-200, -95); g.quadraticCurveTo(0, -130, 200, -95); g.moveTo(-200, -65); g.quadraticCurveTo(0, -95, 200, -65); g.stroke(); g.setLineDash([]); g.restore(); break;
      case "masa": g.beginPath(); g.roundRect(-150, -150, 300, 26, 8); fillS(g, C || "#8B5A2B", 5); g.beginPath(); g.rect(-135, -126, 22, 126); g.rect(113, -126, 22, 126); fillS(g, shade(C || "#8B5A2B", 0.8), 5); break;
      case "sandalye": g.beginPath(); g.rect(-50, -230, 18, 230); g.rect(32, -110, 18, 110); fillS(g, C || "#7A4A26", 5); g.beginPath(); g.roundRect(-55, -120, 110, 20, 6); fillS(g, C || "#7A4A26", 5); g.beginPath(); g.roundRect(-55, -232, 26, 110, 8); fillS(g, shade(C || "#7A4A26", 1.1), 5); break;
      case "kapi": g.beginPath(); g.roundRect(-85, -380, 170, 380, [80, 80, 0, 0]); fillS(g, C || "#6B4320", 6); g.beginPath(); g.roundRect(-60, -330, 120, 130, [50, 50, 6, 6]); g.roundRect(-60, -180, 120, 150, 6); stroke(g, 4); circle(g, 55, -170, 9); fillS(g, "#E0A526", 4); break;
      case "pencere": g.beginPath(); g.roundRect(-110, -340, 220, 200, 10); fillS(g, C || "#9CC9E8", 6); g.beginPath(); g.moveTo(0, -340); g.lineTo(0, -140); g.moveTo(-110, -240); g.lineTo(110, -240); stroke(g, 6); g.beginPath(); g.moveTo(-130, -140); g.lineTo(130, -140); stroke(g, 10); break;
      case "bitki": g.beginPath(); g.moveTo(-40, -90); g.lineTo(40, -90); g.lineTo(30, 0); g.lineTo(-30, 0); g.closePath(); fillS(g, C || "#C0392B", 5); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.45 + Math.sin(t * 1.5 + i) * 0.04; g.beginPath(); g.ellipse(Math.cos(a) * 55, -90 + Math.sin(a) * 75, 22, 48, a + Math.PI / 2, 0, TAU); fillS(g, "#5A9E6F", 4.5); } break;
      case "sise": g.beginPath(); g.roundRect(-20, -80, 40, 80, 9); fillS(g, C || "#5A9E6F", 4.5); g.beginPath(); g.roundRect(-11, -100, 22, 22, 4); fillS(g, "#F4EAD5", 4); break;
      case "siseler": [["#5A9E6F", -55, 1], ["#C0392B", 0, 0.8], ["#E0A526", 55, 1.1]].forEach(([c, dx, k], i) => { g.save(); g.translate(dx, Math.sin(t * 6 + i * 2) > 0.7 ? -6 : 0); g.scale(k, k); g.beginPath(); g.roundRect(-20, -80, 40, 80, 9); fillS(g, c, 4.5); g.beginPath(); g.roundRect(-11, -100, 22, 22, 4); fillS(g, "#F4EAD5", 4); g.restore(); }); break;
      case "fatura": g.beginPath(); g.moveTo(-70, -180); g.lineTo(70, -180); g.lineTo(70, -10); g.quadraticCurveTo(0, 15, -70, -10); g.closePath(); fillS(g, "#FFFFFF", 5); for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(-48, -150 + i * 22); g.lineTo(i % 2 ? 30 : 48, -150 + i * 22); stroke(g, 3); } break;
      case "kalp": { const k = 1 + 0.12 * Math.max(0, Math.sin(t * 7)); g.scale(k, k); g.beginPath(); g.moveTo(0, -20); g.bezierCurveTo(-60, -70, -50, -130, 0, -100); g.bezierCurveTo(50, -130, 60, -70, 0, -20); fillS(g, C || "#D64045", 5); break; }
      case "kitap": g.beginPath(); g.roundRect(-55, -140, 110, 140, 6); fillS(g, C || "#C0392B", 5); g.beginPath(); g.rect(-45, -140, 10, 140); g.fillStyle = shade(C || "#C0392B", 0.65); g.fill(); break;
      case "mum": g.beginPath(); g.roundRect(-16, -90, 32, 90, 4); fillS(g, "#F4EAD5", 4); { const fl = 1 + Math.sin(t * 13) * 0.12; g.beginPath(); g.ellipse(0, -108, 9 * fl, 18 * fl, 0, 0, TAU); g.fillStyle = "#F7B733"; g.fill(); g.beginPath(); g.ellipse(0, -104, 4, 9, 0, 0, TAU); g.fillStyle = "#FFF3C4"; g.fill(); } break;
      case "kese": g.beginPath(); g.moveTo(-20, -110); g.quadraticCurveTo(-75, -60, -55, -10); g.quadraticCurveTo(0, 10, 55, -10); g.quadraticCurveTo(75, -60, 20, -110); g.closePath(); fillS(g, C || "#C49A5A", 5); g.font = "900 44px Georgia,serif"; g.fillStyle = INK; g.textAlign = "center"; g.fillText("₺", 0, -35); break;
      case "siringa": g.save(); g.rotate(-0.5); g.beginPath(); g.roundRect(-70, -18, 120, 36, 8); fillS(g, "#DDE7F0", 5); g.beginPath(); g.rect(-60, -12, 60, 24); g.fillStyle = "#5A9E6F"; g.fill(); g.beginPath(); g.moveTo(50, 0); g.lineTo(95, 0); stroke(g, 5); g.beginPath(); g.rect(-95, -12, 25, 24); fillS(g, "#9AA3AD", 4); g.restore(); break;
      case "cicek": g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -110); g.lineWidth = 6; g.strokeStyle = "#5A9E6F"; g.stroke(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.beginPath(); g.ellipse(Math.cos(a) * 20, -120 + Math.sin(a) * 20, 16, 10, a, 0, TAU); fillS(g, C || "#FFFFFF", 3); } circle(g, 0, -120, 10); fillS(g, "#E0A526", 3); break;
      case "kahve": g.beginPath(); g.roundRect(-34, -70, 68, 70, 10); fillS(g, C || "#FFFFFF", 5); g.beginPath(); g.arc(40, -38, 16, -1.2, 1.2); stroke(g, 6); for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(-10 + i * 20, -85); g.quadraticCurveTo(-20 + i * 20, -105 - Math.sin(t * 3 + i) * 6, -6 + i * 20, -125); g.lineWidth = 4; g.strokeStyle = "rgba(30,26,23,.4)"; g.stroke(); } break;
      case "telefon": g.beginPath(); g.roundRect(-30, -110, 60, 110, 10); fillS(g, "#232026", 5); g.beginPath(); g.roundRect(-22, -100, 44, 86, 4); g.fillStyle = "#7FB7E6"; g.fill(); break;
      case "tablo": g.beginPath(); g.rect(-110, -420, 220, 160); fillS(g, "#E0A526", 7); g.beginPath(); g.rect(-92, -402, 184, 124); g.fillStyle = C || "#5A9E6F"; g.fill(); g.beginPath(); g.moveTo(-92, -300); g.lineTo(-30, -360); g.lineTo(20, -310); g.lineTo(60, -340); g.lineTo(92, -300); g.lineTo(92, -278); g.lineTo(-92, -278); g.closePath(); g.fillStyle = "#3E6FB0"; g.fill(); break;
      case "sandik": g.beginPath(); g.roundRect(-90, -110, 180, 110, 10); fillS(g, C || "#8B5A2B", 5); g.beginPath(); g.rect(-90, -80, 180, 14); g.fillStyle = "#E0A526"; g.fill(); stroke(g, 3); break;
      case "agac": g.beginPath(); g.rect(-22, -200, 44, 200); fillS(g, "#7A4A26", 5); for (const [dx, dy, r] of [[0, -300, 110], [-80, -240, 80], [80, -240, 80]]) { circle(g, dx, dy + Math.sin(t + dx) * 2, r); fillS(g, C || "#5A9E6F", 5); } break;
      case "sokak_lambasi": g.beginPath(); g.rect(-9, -420, 18, 420); fillS(g, "#2B2F36", 4); g.beginPath(); g.roundRect(-30, -470, 60, 60, 10); fillS(g, "#2B2F36", 4); g.fillStyle = "rgba(255,214,120,.95)"; g.fillRect(-20, -460, 40, 40); g.globalAlpha = 0.18; circle(g, 0, -440, 120); g.fillStyle = "#FFD678"; g.fill(); g.globalAlpha = 1; break;
      case "kamera": g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, -170); g.lineTo(6, 0); g.moveTo(-60, 0); g.lineTo(0, -170); g.lineTo(60, 0); stroke(g, 5); g.beginPath(); g.roundRect(-70, -240, 120, 80, 10); fillS(g, "#232026", 5); g.beginPath(); g.roundRect(50, -225, 45, 50, 6); fillS(g, "#3A3F47", 4); circle(g, 22, -200, 6); g.fillStyle = Math.sin(t * 4) > 0 ? "#E5484D" : "#5A1E1E"; g.fill(); break;
      case "mikrofon": g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -230); stroke(g, 7); g.beginPath(); g.roundRect(-20, -290, 40, 64, 20); fillS(g, "#9AA3AD", 5); break;
      default: break;
    }
    g.restore();
  }

  /* ---------------- arka planlar ---------------- */
  function drawBg(g, W, H, bg, t, accent) {
    const tip = CAT.arka.includes(bg && bg.tip) ? bg.tip : "oda", col = bg && bg.renk; const gy = H * 0.86;
    const sky = (a, b) => { g.fillStyle = a; g.fillRect(0, 0, W, gy); };
    switch (tip) {
      case "duz": g.fillStyle = col || "#F4EAD5"; g.fillRect(0, 0, W, H); return;
      case "sokak": case "gece": {
        sky(tip === "gece" ? "#1B2340" : "#9CC9E8"); g.fillStyle = tip === "gece" ? "#F4EAD5" : "#FFFFFF";
        if (tip === "gece") { circle(g, W * 0.82, H * 0.16, 34); g.fill(); for (let i = 0; i < 26; i++) { const x = (i * 197) % W, y = (i * 89) % (gy * 0.6); g.globalAlpha = 0.4 + 0.4 * Math.sin(t * 2 + i); g.fillRect(x, y, 3, 3); } g.globalAlpha = 1; }
        const cols = tip === "gece" ? ["#2B3456", "#323C63", "#283050"] : [col || "#D9B48F", "#C98E62", "#E9DCC4"];
        for (let i = 0; i < 7; i++) { const w = W / 6.2, x = i * W / 6.5 - 20, h = gy * (0.45 + ((i * 37) % 30) / 100); g.beginPath(); g.rect(x, gy - h, w, h); fillS(g, cols[i % 3], 5); g.fillStyle = tip === "gece" ? "rgba(255,214,120,.85)" : "rgba(60,80,110,.55)"; for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) if ((i + r + c) % 3) g.fillRect(x + 22 + c * (w / 2 - 6), gy - h + 26 + r * 60, w / 4, 32); }
        g.fillStyle = "#6E6A66"; g.fillRect(0, gy, W, H - gy); g.fillStyle = "#5E5A56"; for (let x = 0; x < W; x += 60) g.fillRect(x, gy + 22, 40, 6); break; }
      case "park": sky("#A8D8F0"); g.fillStyle = "#FFFFFF"; for (const [x, y] of [[0.2, 0.18], [0.6, 0.12], [0.85, 0.22]]) { const dx = ((t * 8) % W); for (const [ox, r] of [[0, 30], [35, 40], [72, 28]]) { circle(g, ((x * W + dx + ox) % (W + 120)) - 60, y * H, r); g.fill(); } }
        g.fillStyle = col || "#7BB661"; g.fillRect(0, gy - 40, W, H - gy + 40); g.beginPath(); g.moveTo(0, gy - 40); g.lineTo(W, gy - 40); stroke(g, 5); break;
      case "ofis": g.fillStyle = col || "#DDE3EA"; g.fillRect(0, 0, W, gy); g.fillStyle = "#B9C2CC"; g.fillRect(0, gy - 120, W, 10); g.fillStyle = "#8C939C"; g.fillRect(0, gy, W, H - gy); break;
      case "sahne": case "tiyatro": {
        g.fillStyle = col || "#F4EAD5"; g.fillRect(0, 0, W, gy); g.fillStyle = "#8B5A2B"; g.fillRect(0, gy, W, H - gy); g.fillStyle = "#6B4320"; g.fillRect(0, gy, W, 14); g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); stroke(g, 6);
        for (const s of [0, 1]) { g.fillStyle = "#7A1F2B"; const x = s ? W - W * 0.1 : 0; g.fillRect(x, 0, W * 0.1, gy + 4); g.fillStyle = "#651823"; for (let i = 0; i < 3; i++) g.fillRect(x + i * W * 0.033 + 6, 0, 10, gy); }
        g.fillStyle = "#7A1F2B"; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, 40); for (let x = W; x >= 0; x -= 64) g.quadraticCurveTo(x - 32, 80, x - 64, 40); g.closePath(); g.fill(); stroke(g, 5); g.fillStyle = accent || "#E0A526"; g.fillRect(0, 20, W, 6);
        if (tip === "tiyatro") { g.fillStyle = "rgba(30,26,23,.85)"; for (let i = 0; i < 14; i++) { circle(g, (i + 0.5) * W / 14, H - 18, 34); g.fill(); } }
        break; }
      default: { // oda
        g.fillStyle = col || "#E9DCC4"; g.fillRect(0, 0, W, gy); g.fillStyle = shade(col || "#E9DCC4", 0.9);
        for (let x = 0; x < W; x += 90) g.fillRect(x, 0, 45, gy - 130); g.fillStyle = shade(col || "#E9DCC4", 0.78); g.fillRect(0, gy - 130, W, 130); g.beginPath(); g.moveTo(0, gy - 130); g.lineTo(W, gy - 130); stroke(g, 5);
        g.fillStyle = (bg && bg.zemin) || "#8B5A2B"; g.fillRect(0, gy, W, H - gy); g.fillStyle = "rgba(0,0,0,.12)"; for (let x = 0; x < W; x += 140) g.fillRect(x, gy, 4, H - gy); g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); stroke(g, 6);
      }
    }
  }

  /* ---------------- yazılar ---------------- */
  const FONT_T = '"Fraunces","Georgia",serif', FONT_B = '"Nunito","Segoe UI",system-ui,sans-serif';
  function wrap(g, text, maxW) { const words = String(text).split(/\s+/); const lines = []; let cur = ""; for (const w of words) { const tst = cur ? cur + " " + w : w; if (g.measureText(tst).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tst; } if (cur) lines.push(cur); return lines; }
  function drawText(g, W, H, b, t, actorPos, accent) {
    const t0 = N(b.t, 0), d = N(b.sure, 2.5), p = (t - t0) / d; if (p < 0 || p > 1) return;
    const inP = clamp((t - t0) / 0.35, 0, 1), outP = clamp((t0 + d - t) / 0.3, 0, 1), a = Math.min(inP, outP); const pop = back(inP);
    const stil = CAT.yazi.includes(b.stil) ? b.stil : "baslik"; const txt = String(b.metin || ""); if (!txt) return;
    g.save(); g.globalAlpha = a;
    const kon = b.konum || (stil === "alt" ? "alt" : stil === "baslik" ? "ust" : "orta");
    const yPos = kon === "ust" ? H * 0.2 : kon === "alt" ? H * 0.8 : H * 0.48;
    if (stil === "kart") { g.globalAlpha = a * 0.92; g.fillStyle = b.renk || "#1E1A17"; g.fillRect(0, 0, W, H); g.globalAlpha = a; g.font = `900 ${Math.round(Math.min(W, H) * 0.13)}px ${FONT_T}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#F4EAD5"; const ls = wrap(g, txt.toLocaleUpperCase("tr"), W * 0.86); g.translate(W / 2, H / 2); g.scale(lerp(1.8, 1, pop), lerp(1.8, 1, pop)); ls.forEach((l, i) => g.fillText(l, 0, (i - (ls.length - 1) / 2) * Math.min(W, H) * 0.14)); if (b.alt) { g.font = `800 ${Math.round(Math.min(W, H) * 0.04)}px ${FONT_B}`; g.fillStyle = accent; g.fillText(String(b.alt).toLocaleUpperCase("tr"), 0, (ls.length / 2) * Math.min(W, H) * 0.14 + 30); } g.restore(); return; }
    if (stil === "balon" && actorPos) {
      g.font = `800 ${Math.round(Math.min(W, H) * 0.042)}px ${FONT_B}`; const ls = wrap(g, txt, W * 0.32); const lh = Math.min(W, H) * 0.052; const w = Math.max(...ls.map(l => g.measureText(l).width)) + 40, h = ls.length * lh + 26;
      let x = clamp(actorPos.x + actorPos.dir * 40, w / 2 + 10, W - w / 2 - 10), y = Math.max(h / 2 + 90, actorPos.headY - 60 - h / 2);
      g.translate(x, y); g.scale(pop, pop); g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 22); g.moveTo(clamp(actorPos.x - x, -w / 2 + 20, w / 2 - 40), h / 2 - 2); g.lineTo(clamp(actorPos.x - x, -w / 2 + 20, w / 2 - 40) + 10, h / 2 + 30); g.lineTo(clamp(actorPos.x - x, -w / 2 + 20, w / 2 - 40) + 30, h / 2 - 2); fillS(g, "#FFFFFF", 5);
      g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle"; ls.forEach((l, i) => g.fillText(l, 0, (i - (ls.length - 1) / 2) * lh)); g.restore(); return;
    }
    if (stil === "cip") { g.font = `800 ${Math.round(Math.min(W, H) * 0.058)}px ${FONT_B}`; const ls = wrap(g, txt, W * 0.7); const lh = Math.min(W, H) * 0.07; const w = Math.max(...ls.map(l => g.measureText(l).width)) + 50, h = ls.length * lh + 26; g.translate(b.x != null ? N(b.x, 0.5) * W : W / 2, yPos); g.rotate(-0.04); g.scale(lerp(1.6, 1, pop), lerp(1.6, 1, pop)); g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 16); fillS(g, b.renk || accent, 6); g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle"; ls.forEach((l, i) => g.fillText(l, 0, (i - (ls.length - 1) / 2) * lh + 2)); g.restore(); return; }
    // baslik / alt
    const fs = stil === "alt" ? Math.min(W, H) * 0.05 : Math.min(W, H) * 0.095; g.font = `${stil === "alt" ? 800 : 900} ${Math.round(fs)}px ${stil === "alt" ? FONT_B : FONT_T}`; const ls = wrap(g, txt, W * 0.84); const lh = fs * 1.08;
    g.textAlign = "center"; g.textBaseline = "middle"; g.translate(b.x != null ? N(b.x, 0.5) * W : W / 2, yPos + (1 - inP) * 24);
    if (stil === "alt") { const w = Math.max(...ls.map(l => g.measureText(l).width)) + 40, h = ls.length * lh + 18; g.fillStyle = "rgba(30,26,23,.75)"; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 12); g.fill(); g.fillStyle = "#FFFFFF"; }
    else { g.lineWidth = fs * 0.14; g.strokeStyle = "rgba(244,234,213,.9)"; g.lineJoin = "round"; ls.forEach((l, i) => g.strokeText(l, 0, (i - (ls.length - 1) / 2) * lh)); g.fillStyle = b.renk || INK; }
    ls.forEach((l, i) => g.fillText(l, 0, (i - (ls.length - 1) / 2) * lh)); g.restore();
  }

  /* ---------------- kare çizimi ---------------- */
  function camAt(cams, t) {
    const ks = (cams || []).map(k => ({ t: N(k.t, 0), z: clamp(N(k.zoom, 1), 0.6, 2.6), x: clamp(N(k.x, 0.5), 0, 1), y: clamp(N(k.y, 0.5), 0, 1) })).sort((a, b) => a.t - b.t);
    if (!ks.length) return { z: 1, x: 0.5, y: 0.5 }; if (t <= ks[0].t) return ks[0];
    for (let i = 0; i < ks.length - 1; i++) { const a = ks[i], b = ks[i + 1]; if (t <= b.t) { const p = ease((t - a.t) / Math.max(0.01, b.t - a.t)); return { z: lerp(a.z, b.z, p), x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) }; } }
    return ks[ks.length - 1];
  }
  function drawScene(g, W, H, spec, si, t, opt) {
    const sc = spec.sahneler[si] || {}; const accent = (spec.renk && spec.renk.vurgu) || "#E0A526"; const chars = {}; (spec.karakterler || []).forEach(c => (chars[c.id] = c));
    const gy = H * 0.86, U = Math.min(W, H) / 720, CU = U * 1.18;
    const cam = camAt(sc.kamera, t);
    g.save(); g.translate(W / 2, H / 2); g.scale(cam.z, cam.z); g.translate(-cam.x * W, -cam.y * H);
    drawBg(g, W, H, sc.arka, t, accent);
    const props = (sc.esyalar || []).filter(p => CAT.esya.includes(p.ad));
    const pPos = p => [N(p.x, 0.5) * W, gy - N(p.y, 0) * H, N(p.olcek, 1) * U];
    props.filter(p => p.ad !== "kalp" || p.on !== true).forEach(p => { const [x, y, s] = pPos(p); drawProp(g, p.ad, x, y, s, t, p.renk); });
    const positions = {};
    const actors = (sc.oyuncular || []).filter(a => chars[a.id]);
    const sts = actors.map(a => actorState(a, t, sc, W, H, opt, si));
    actors.forEach((a, k) => { const st = sts[k]; const other = sts.find((o, j) => j !== k); st.lookX = other ? Math.sign(other.x - st.x) * st.dir : 0; });
    const order = actors.map((a, k) => k).sort((p, q) => N(actors[p].z, 0) - N(actors[q].z, 0));
    for (const k of order) {
      const a = actors[k], st = sts[k], c = chars[a.id]; const s = st.s * CU * (W > H ? 1 : 1.1);
      let x = st.x * W, y = gy - st.y * H - st.jump * 70 * U;
      g.save();
      if (st.poz === "yat" || st.faint > 0) {
        const r = st.poz === "yat" ? 1 : ease(st.faint);
        const bed = props.find(p => p.ad === "yatak" && Math.abs(N(p.x, 0.5) - st.x) < 0.2); const bs = bed ? N(bed.olcek, 1) * U : U;
        if (st.poz === "yat") { x = bed ? N(bed.x, 0.5) * W : x; y = bed ? gy - 158 * bs : y - 40 * U; }
        g.translate(x + (st.poz === "yat" ? 150 * s * st.dir : 0), y); g.rotate(-Math.PI / 2 * r * st.dir); g.translate(0, r * 34 * s); g.scale(s * st.dir, s);
        st.closedEyes = st.poz === "yat" || st.faint >= 1; if (st.ifade === "notr" && st.closedEyes) st.ifade = "notr";
        drawCharacter(g, c, st, t + k);
        positions[a.id] = { x, headY: y - 120 * U, dir: st.dir };
      } else {
        const dy = st.poz === "yatakta" ? 60 * U * st.s : st.poz === "otur" ? 55 * U * st.s : 0;
        if (st.poz === "yatakta") { const bed = props.find(p => p.ad === "yatak" && Math.abs(N(p.x, 0.5) - st.x) < 0.25); const cut = bed ? gy - 112 * N(bed.olcek, 1) * U : gy - 60 * U; g.beginPath(); g.rect(-W, -H, W * 3, cut + H); g.clip(); }
        g.translate(x, y + dy); g.scale(s * st.dir, s);
        drawCharacter(g, c, st, t + k);
        positions[a.id] = { x, headY: y + dy - (210 * look(c).boy + 110) * s, dir: st.dir };
      }
      g.restore();
    }
    // ön katman: yorgan
    props.filter(p => p.ad === "yatak").forEach(p => { const [x, y, s] = pPos(p); drawProp(g, "yatak_on", x, y, s, t, p.renk); });
    props.filter(p => p.ad === "kalp" && p.on === true).forEach(p => { const [x, y, s] = pPos(p); drawProp(g, p.ad, x, y, s, t, p.renk); });
    g.restore();
    (sc.yazilar || []).forEach(b => drawText(g, W, H, b, t, b.kim && positions[b.kim] ? Object.assign({}, positions[b.kim], { x: (positions[b.kim].x - cam.x * W) * cam.z + W / 2, headY: (positions[b.kim].headY - cam.y * H) * cam.z + H / 2 }) : null, accent));
  }
  function render(g, spec, T, opt = {}) {
    const [W, H] = size(spec.format); const L = opt.layout || layout(spec, opt.durs);
    g.save(); g.setTransform(opt.scale || 1, 0, 0, opt.scale || 1, 0, 0); g.clearRect(0, 0, W, H); g.fillStyle = "#1E1A17"; g.fillRect(0, 0, W, H);
    let si = L.scenes.findIndex(s => T < s.start + s.dur); if (si < 0) si = L.scenes.length - 1; if (si < 0) { g.restore(); return; }
    const S0 = L.scenes[si], t = T - S0.start; drawScene(g, W, H, spec, si, t, opt);
    const gc = (spec.sahneler[si] || {}).gecis; const d = 0.55;
    if (t < d && si > 0 || (t < d && si === 0 && gc && gc !== "kesme")) {
      const p = ease(t / d);
      if (gc === "perde") { g.fillStyle = "#7A1F2B"; const w = (W / 2) * (1 - p); g.fillRect(0, 0, w, H); g.fillRect(W - w, 0, w, H); g.fillStyle = "#651823"; for (let i = 0; i < 6; i++) { g.fillRect(w - (i + 1) * 30, 0, 10, H); g.fillRect(W - w + i * 30 + 20, 0, 10, H); } }
      else if (gc === "silme") { g.fillStyle = "#1E1A17"; g.fillRect(W * p, 0, W, H); }
      else if (gc !== "kesme") { g.globalAlpha = 1 - p; g.fillStyle = "#1E1A17"; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    }
    const endFade = L.total - T; if (endFade < 0.6) { g.globalAlpha = clamp(1 - endFade / 0.6, 0, 1); g.fillStyle = "#1E1A17"; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    g.restore();
  }

  /* ---------------- ses zarfı (dudak senkronu) ---------------- */
  function envelope(buf, fps = 60) {
    const d = buf.getChannelData(0), sr = buf.sampleRate, n = Math.ceil(buf.duration * fps), out = new Float32Array(n), win = Math.floor(sr / fps); let mx = 0;
    for (let i = 0; i < n; i++) { let s = 0; const o = i * win; for (let j = 0; j < win && o + j < d.length; j += 2) s += d[o + j] * d[o + j]; const r = Math.sqrt(s / (win / 2)); out[i] = r; if (r > mx) mx = r; }
    for (let i = 0; i < n; i++) { const v = mx ? out[i] / mx : 0; out[i] = v < 0.12 ? 0 : Math.min(1, v * 1.3); }
    for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] * 0.55);
    return out;
  }

  /* ---------------- telifsiz müzik üretici ---------------- */
  const STY = {
    barok: { bpm: 120, key: 62, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [4, 7, 11], [5, 9, 12], [0, 4, 7], [5, 9, 12], [7, 11, 14]], harm: [0, 1, 0.75, 0.55, 0.45, 0.32, 0.25, 0.18, 0.12, 0.08], dec: 1.1, bassH: [0, 1, 0.45, 0.2], pat: [0, 2, 1, 2, 3, 2, 1, 2] },
    neseli: { bpm: 128, key: 60, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], harm: [0, 1, 0.1, 0.35, 0.05, 0.12], dec: 0.45, bassH: [0, 1, 0.5, 0.25], pat: [0, 1, 2, 3, 2, 1, 2, 1] },
    gerilim: { bpm: 92, key: 57, prog: [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [-1, 2, 7]], harm: [0, 1, 0.5, 0.33, 0.25, 0.2, 0.14], dec: 0.35, bassH: [0, 1, 0.6, 0.4, 0.3], pat: [0, 0, 1, 0, 0, 2, 0, 1] },
    duygusal: { bpm: 72, key: 65, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], harm: [0, 1, 0.4, 0.2, 0.1, 0.05], dec: 1.8, bassH: [0, 1, 0.3, 0.1], pat: [0, 1, 2, 3, 2, 1, 2, 3] }
  };
  async function music(style, dur, seed = 7) {
    const S = STY[style] || STY.barok; const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * (dur + 1)), sr);
    const wave = h => ctx.createPeriodicWave(new Float32Array(h.length), Float32Array.from(h));
    const wM = wave(S.harm), wB = wave(S.bassH); const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.connect(master);
    master.gain.setValueAtTime(0.9, Math.max(0, dur - 1.6)); master.gain.linearRampToValueAtTime(0.0001, dur + 0.2);
    let rs = seed; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    const note = (m, t, len, vel, w, dec) => { if (t > dur) return; const o = ctx.createOscillator(); o.setPeriodicWave(w); o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vel, t + 0.006); gn.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(len, 0.05) * 0.9 + dec); o.connect(gn); gn.connect(comp); o.start(t); o.stop(t + len + dec + 0.05); };
    const beat = 60 / S.bpm, bar = beat * 4; const bars = Math.ceil(dur / bar);
    for (let b = 0; b < bars; b++) {
      const ch = S.prog[b % S.prog.length], t0 = b * bar, last = b === bars - 1; const root = S.key + ch[0] - 12;
      if (last) { [0, 4, 7, 12].forEach((iv, k) => note(S.key + iv + (k ? 0 : -12), t0 + k * 0.03, bar, 0.12, wM, 2)); note(root - 12, t0, bar, 0.2, wB, 1.5); break; }
      for (let k = 0; k < 4; k++) note(k % 2 ? root + 7 - 12 : root - 12, t0 + k * beat, beat * 0.5, 0.18, wB, 0.25);
      ch.forEach((iv, k) => note(S.key + iv - 12, t0 + k * 0.015, beat * 2, 0.045, wM, S.dec));
      const tones = [...ch, ch[0] + 12, ch[1] + 12].map(x => S.key + x);
      for (let e = 0; e < 8; e++) { let m = tones[S.pat[e] % tones.length]; if (rnd() < 0.18) m += rnd() < 0.5 ? 2 : -1; if (b % 4 === 3 && e > 5) m = tones[4]; note(m, t0 + e * beat / 2, beat * 0.32, 0.075 + (e % 2 ? 0 : 0.02), wM, S.dec * 0.6); }
    }
    return ctx.startRendering();
  }

  window.TitusAnim = { render, layout, size, music, envelope, drawCharacter, CAT, look };
})();
