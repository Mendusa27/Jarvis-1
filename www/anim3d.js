/* TITUS 3D ANİMASYON MOTORU (v4.7)
   Aynı senaryo JSON'unu three.js ile 3D çizer: kodla kurulan karakter iskeleti (bacak, diz, kol, dirsek, baş),
   yüz ifadeleri, göz kırpma, dudak senkronu, 3D dekorlar, eşyalar, ışık ve gölge.
   2D motor (anim.js) karakter durumlarını (yürüme, poz, ifade, konuşma) hesaplar; bu dosya onları 3D sahneye uygular.
   window.TitusAnim3D = { draw, ready } */
import * as THREE from "./vendor/three.module.min.js";

const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), N = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
let R = null, CV = null, CUR = null;

/* ---------------- yardımcılar ---------------- */
function hex(c, d) { return /^#[0-9a-f]{6}$/i.test(c || "") ? c : d; }
function shadeHex(h, k) { const c = new THREE.Color(h); c.multiplyScalar(k); return "#" + c.getHexString(); }
class Bag { // sahneye ait geometri/malzeme/doku; sahne değişince serbest bırakılır
  constructor() { this.items = []; this.mats = {}; }
  add(x) { this.items.push(x); return x; }
  mat(col, o = {}) { const k = col + JSON.stringify(o); if (!this.mats[k]) this.mats[k] = this.add(new THREE.MeshStandardMaterial(Object.assign({ color: new THREE.Color(col), roughness: 0.62, metalness: 0 }, o))); return this.mats[k]; }
  dispose() { for (const x of this.items) try { x.dispose(); } catch {} this.items = []; this.mats = {}; }
}
function mesh(bag, geo, mat, cast = true, recv = true) { bag.add(geo); const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; return m; }
function canvasTex(bag, w, h, draw, rep) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = bag.add(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; }
// köşeli yüz için süper-elips küre
function squircle(geo, p = 4) { const a = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i); const r = v.length(); const n = Math.pow(Math.pow(Math.abs(v.x), p) + Math.pow(Math.abs(v.y), p) + Math.pow(Math.abs(v.z), p), 1 / p) || 1; v.multiplyScalar(r / n); a.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); return geo; }

/* ---------------- karakter iskeleti ---------------- */
function buildChar(bag, c, L) {
  const u = L.boy, kid = L.kid, M = (col, o) => bag.mat(col, o);
  const skin = M(L.ten, { roughness: 0.55 }), cloth = M(hex(L.kR, "#3E6FB0"), { roughness: 0.82 }), pants = M(hex(L.pantolon, "#2E2A33"), { roughness: 0.85 }), hair = M(hex(L.sacR, "#4A3426"), { roughness: 0.7 }), shoe = M(hex(L.ayakkabi, "#2B2420"), { roughness: 0.5 }), inner = M(hex(L.ic, "#F2EFE8"), { roughness: 0.8 });
  const W = ({ ince: 0.32, normal: 0.38, tombul: 0.5 }[L.vucut] || 0.38) * (kid ? 0.82 : L.fem ? 0.92 : 1);
  const legLen = 0.62 * u, torsoLen = 0.5 * u, legR = (L.vucut === "tombul" ? 0.085 : 0.07) * (kid ? 0.85 : 1);
  const robe = ["cubbe", "gecelik", "elbise"].includes(L.kiyafet);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const rig = { root, body, legs: [], arms: [], L, legLen, torsoLen, W };
  // bacaklar (kalça → diz → ayak)
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * W * 0.24, legLen, 0); body.add(hip);
    const thigh = mesh(bag, new THREE.CapsuleGeometry(legR, legLen * 0.5 - legR, 4, 10), pants); thigh.position.y = -legLen * 0.25; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -legLen * 0.5; hip.add(knee);
    const shin = mesh(bag, new THREE.CapsuleGeometry(legR * 0.92, legLen * 0.5 - legR, 4, 10), pants); shin.position.y = -legLen * 0.25; knee.add(shin);
    const foot = mesh(bag, new THREE.SphereGeometry(0.085, 16, 10), shoe); foot.scale.set(kid ? 0.85 : 1, 0.55, 1.65); foot.position.set(0, -legLen * 0.5 + 0.04, 0.06); knee.add(foot);
    if (robe) thigh.visible = shin.visible = false;
    rig.legs.push({ hip, knee, foot, s });
  }
  // gövde
  const torso = new THREE.Group(); torso.position.y = legLen; body.add(torso); rig.torso = torso;
  const top = torsoLen;
  if (robe) {
    const len = legLen + torsoLen, pts = [];
    const flare = L.kiyafet === "elbise" ? 1.55 : 1.35;
    for (let i = 0; i <= 12; i++) { const k = i / 12; const r = k < 0.35 ? W * 0.5 * (0.92 + k * 0.25) : W * 0.5 * (1.0 + Math.pow((k - 0.35) / 0.65, 1.4) * (flare - 1)); pts.push(new THREE.Vector2(r, top - k * len)); }
    pts.unshift(new THREE.Vector2(0.001, top + 0.02)); pts.push(new THREE.Vector2(0.001, top - len));
    const dress = mesh(bag, new THREE.LatheGeometry(pts, 28), cloth); dress.scale.z = 0.78; dress.position.y = 0; torso.add(dress);
  } else if (L.vucut === "tombul") {
    const b = mesh(bag, new THREE.SphereGeometry(W * 0.62, 24, 18), L.kiyafet === "yelek" ? inner : cloth); b.scale.set(1, (torsoLen * 0.62) / (W * 0.62) * 1.05, 0.82); b.position.y = top * 0.47; torso.add(b);
  } else {
    const b = mesh(bag, new THREE.CapsuleGeometry(W * 0.5, torsoLen - W * 0.75, 6, 18), L.kiyafet === "yelek" ? inner : cloth); b.scale.z = 0.62; b.position.y = top * 0.5 + W * 0.08; torso.add(b);
    const pel = mesh(bag, new THREE.CylinderGeometry(W * 0.47, W * 0.44, 0.16, 20), pants); pel.scale.z = 0.62; pel.position.y = 0.03; torso.add(pel);
    if (L.kiyafet === "gomlek" || L.kiyafet === "tisort" || L.kiyafet === "kazak") { const belt = mesh(bag, new THREE.TorusGeometry(W * 0.47, 0.022, 8, 28), M(shadeHex(hex(L.kR, "#3E6FB0"), 0.6))); belt.rotation.x = Math.PI / 2; belt.scale.y = 0.62; belt.position.y = 0.05; torso.add(belt); }
  }
  const front = z => (W * 0.5) * 0.62 + z;
  if (L.kiyafet === "yelek" && L.vucut !== "tombul") { const v = mesh(bag, new THREE.CapsuleGeometry(W * 0.53, torsoLen * 0.78 - W * 0.6, 6, 18), cloth); v.scale.z = 0.64; v.position.y = top * 0.46; torso.add(v); const op = mesh(bag, new THREE.BoxGeometry(W * 0.2, torsoLen * 0.75, 0.02), inner); op.position.set(0, top * 0.52, front(0.025)); torso.add(op); }
  if (L.kiyafet === "ceket") { for (const s of [-1, 1]) { const lp = mesh(bag, new THREE.BoxGeometry(0.06, torsoLen * 0.45, 0.02), M(shadeHex(hex(L.kR, "#3E6FB0"), 0.75))); lp.position.set(s * 0.05, top * 0.75, front(0.01)); lp.rotation.z = s * 0.35; torso.add(lp); } for (let i = 0; i < 3; i++) { const bt = mesh(bag, new THREE.SphereGeometry(0.016, 8, 6), M("#1E1A17")); bt.position.set(0, top * (0.45 - i * 0.15), front(0.012)); torso.add(bt); } }
  if (L.kiyafet === "gomlek") { const col = mesh(bag, new THREE.ConeGeometry(0.09, 0.07, 3), M(shadeHex(hex(L.kR, "#3E6FB0"), 1.2))); col.rotation.x = Math.PI; col.position.set(0, top - 0.04, front(-0.01)); col.scale.z = 0.3; torso.add(col); }
  if (L.yaka === "kravat") { const tie = mesh(bag, new THREE.BoxGeometry(0.05, torsoLen * 0.55, 0.015), M("#C0392B")); tie.position.set(0, top * 0.68, front(0.015)); torso.add(tie); }
  if (L.yaka === "papyon") for (const s of [-1, 1]) { const p = mesh(bag, new THREE.ConeGeometry(0.035, 0.07, 4), M("#C0392B")); p.rotation.z = s * Math.PI / 2; p.position.set(s * 0.035, top - 0.03, front(0.02)); torso.add(p); }
  if (L.yaka === "onluk") { const ap = mesh(bag, new THREE.BoxGeometry(W * 0.62, robe ? torsoLen * 1.4 : torsoLen * 0.9, 0.012), M("#FFFFFF")); ap.position.set(0, robe ? top * 0.2 : top * 0.35, front(robe ? 0.05 : 0.012)); torso.add(ap); }
  if (L.yaka === "firfir") { const f = mesh(bag, new THREE.TorusGeometry(0.1, 0.035, 8, 20), M("#FFFFFF")); f.rotation.x = Math.PI / 2; f.position.y = top + 0.01; torso.add(f); }
  if (L.yaka === "atki") { const f = mesh(bag, new THREE.TorusGeometry(0.1, 0.04, 8, 20), M("#E0A526")); f.rotation.x = Math.PI / 2; f.position.y = top - 0.01; torso.add(f); const e = mesh(bag, new THREE.BoxGeometry(0.06, 0.24, 0.03), M("#E0A526")); e.position.set(0.06, top - 0.14, front(0.02)); torso.add(e); }
  // kollar (omuz → dirsek → el)
  const armR = (kid ? 0.045 : L.vucut === "tombul" ? 0.062 : 0.052), upLen = 0.27 * u, loLen = 0.25 * u, sleeve = L.kiyafet === "yelek" ? inner : cloth;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * (W * 0.5 + armR * 0.4), legLen + top - 0.07, 0); body.add(sh);
    const up = mesh(bag, new THREE.CapsuleGeometry(armR, upLen - armR, 4, 10), sleeve); up.position.y = -upLen / 2; sh.add(up);
    const el = new THREE.Group(); el.position.y = -upLen; sh.add(el);
    const lo = mesh(bag, new THREE.CapsuleGeometry(armR * 0.92, loLen - armR, 4, 10), L.kiyafet === "tisort" ? skin : sleeve); lo.position.y = -loLen / 2; el.add(lo);
    const hand = mesh(bag, new THREE.SphereGeometry(armR * 1.35, 14, 10), skin); hand.position.y = -loLen; el.add(hand);
    rig.arms.push({ sh, el, hand, s, base: sh.position.y });
  }
  // baş
  const neckY = legLen + top, hr = 0.25 * L.hK, YZ = { yuvarlak: [1, 1, 0.95], oval: [0.9, 1.08, 0.92], uzun: [0.82, 1.2, 0.9], kare: [1, 1.02, 0.92], genis: [1.12, 0.93, 0.95] }[L.yuz] || [1, 1, 0.95];
  const neck = mesh(bag, new THREE.CylinderGeometry(0.055, 0.06, 0.09, 12), skin); neck.position.y = neckY + 0.03; body.add(neck);
  const head = new THREE.Group(); const hy = neckY + 0.06 + hr * YZ[1] * 0.95; head.position.y = hy; body.add(head); rig.head = head;
  const rx = hr * YZ[0], ry = hr * YZ[1], rz = hr * YZ[2]; rig.hr = { rx, ry, rz, hy };
  const sk = new THREE.SphereGeometry(1, 40, 28); if (L.yuz === "kare") squircle(sk, 3.2); const skull = mesh(bag, sk, skin); skull.scale.set(rx, ry, rz); head.add(skull);
  const surf = (x, y) => rz * Math.sqrt(Math.max(0.02, 1 - (x / rx) ** 2 - (y / ry) ** 2)); // yüz yüzeyinin z'si
  for (const s of [-1, 1]) { const ear = mesh(bag, new THREE.SphereGeometry(0.055 * L.earK, 12, 10), skin); ear.scale.set(0.5, 1, 0.8); ear.position.set(s * rx * 0.98, -ry * 0.02, -rz * 0.05); head.add(ear); }
  // gözler
  const face = new THREE.Group(); head.add(face); rig.face = face;
  const ex = rx * L.eyeSp * 1.08, ey = ry * (kid ? 0.02 : 0.08), er = L.goz === "iri" ? 0.064 : L.goz === "badem" ? 0.056 : 0.05;
  rig.eyes = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * ex, ey, surf(s * ex, ey) - er * 0.35); face.add(g);
    let white = null; if (L.goz !== "nokta") { white = mesh(bag, new THREE.SphereGeometry(er, 20, 14), M("#FFFFFF", { roughness: 0.2 })); white.scale.set(1, L.goz === "badem" ? 0.62 : 1, 0.55); g.add(white); }
    const pr = L.goz === "nokta" ? 0.03 : L.goz === "iri" ? 0.032 : 0.024; const pup = mesh(bag, new THREE.SphereGeometry(pr, 14, 10), M("#15110E", { roughness: 0.15 })); pup.scale.z = 0.5; pup.position.z = L.goz === "nokta" ? 0.005 : er * 0.52; g.add(pup);
    const shine = mesh(bag, new THREE.SphereGeometry(pr * 0.33, 8, 6), M("#FFFFFF", { emissive: 0xffffff, emissiveIntensity: 0.6 }), false, false); shine.position.set(pr * 0.4, pr * 0.4, pup.position.z + pr * 0.35); g.add(shine);
    const lid = mesh(bag, new THREE.SphereGeometry(er * 1.08, 20, 10, 0, TAU, 0, Math.PI / 2), skin, false); lid.scale.set(1, L.goz === "badem" ? 0.66 : 1.02, 0.6); lid.visible = false; g.add(lid);
    if (L.kirpik) for (let k = 0; k < 3; k++) { const l = mesh(bag, new THREE.BoxGeometry(0.006, 0.03, 0.006), M("#15110E"), false); l.position.set(s * (er * 0.35 + k * er * 0.3), er * (L.goz === "badem" ? 0.62 : 0.98), er * 0.2); l.rotation.z = -s * (0.4 + k * 0.25); g.add(l); }
    rig.eyes.push({ g, white, pup, lid, s });
  }
  // kaşlar
  const bw = { ince: 0.009, normal: 0.014, kalin: 0.024, catik: 0.02 }[L.kas] || 0.014, browC = M(L.old ? "#A9A9A4" : shadeHex(hex(L.sacR, "#4A3426"), 0.75));
  rig.brows = []; const by = ey + er * 1.55 + L.browY * 0.002;
  for (const s of [-1, 1]) { const b = mesh(bag, new THREE.CapsuleGeometry(bw, 0.07, 3, 6), browC, false); b.rotation.z = Math.PI / 2; const gB = new THREE.Group(); gB.position.set(s * ex, by, surf(s * ex, by) + 0.004); gB.add(b); face.add(gB); rig.brows.push({ g: gB, s, y: by }); }
  // burun
  const ny = -ry * 0.12, nC = M(shadeHex(L.ten, 0.94), { roughness: 0.55 });
  let nose;
  if (L.burun === "sivri") { nose = mesh(bag, new THREE.ConeGeometry(0.035, 0.12, 12), nC); nose.rotation.x = Math.PI / 2; nose.position.set(0, ny, surf(0, ny) + 0.05); }
  else if (L.burun === "kanca") { nose = mesh(bag, new THREE.SphereGeometry(0.05, 14, 10), nC); nose.scale.set(0.8, 1.25, 1.3); nose.rotation.x = 0.5; nose.position.set(0, ny, surf(0, ny) + 0.03); }
  else { const r = { kucuk: 0.03, buyuk: 0.072, yuvarlak: 0.045 }[L.burun] || 0.045; nose = mesh(bag, new THREE.SphereGeometry(r, 14, 10), nC); nose.position.set(0, ny, surf(0, ny) + r * 0.45); }
  face.add(nose);
  if (L.yanak) for (const s of [-1, 1]) { const ck = mesh(bag, new THREE.SphereGeometry(0.045, 12, 8), M("#EE8282", { transparent: true, opacity: 0.45 }), false, false); ck.scale.z = 0.3; const cx = rx * 0.58, cy = -ry * 0.22; ck.position.set(s * cx, cy, surf(cx, cy) - 0.004); face.add(ck); }
  if (L.cil) for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const f = mesh(bag, new THREE.SphereGeometry(0.006, 6, 4), M(shadeHex(L.ten, 0.65)), false, false); const fx = rx * (0.42 + (i % 2) * 0.1), fy = -ry * (0.08 + Math.floor(i / 2) * 0.08); f.position.set(s * fx, fy, surf(fx, fy)); face.add(f); }
  // ağız
  const my = -ry * 0.42, mz = surf(0, my), mw = L.mouthW, mouthC = M("#5A1E1E", { roughness: 0.4 }), lipC = M(L.ruj ? "#B83A4B" : "#7A3A30", { roughness: 0.4 });
  const mouth = new THREE.Group(); mouth.position.set(0, my, mz - 0.004); face.add(mouth); rig.mouth = mouth;
  const mo = { O: mesh(bag, new THREE.SphereGeometry(0.05 * mw, 16, 12), mouthC, false), smile: mesh(bag, new THREE.TorusGeometry(0.055 * mw, 0.012, 8, 20, Math.PI), lipC, false), frown: mesh(bag, new THREE.TorusGeometry(0.045 * mw, 0.011, 8, 20, Math.PI), lipC, false), flat: mesh(bag, new THREE.CapsuleGeometry(0.011, 0.07 * mw, 3, 6), lipC, false), grin: mesh(bag, new THREE.SphereGeometry(0.06 * mw, 18, 12, 0, TAU, Math.PI / 2, Math.PI / 2), mouthC, false) };
  mo.O.scale.z = 0.35; mo.smile.rotation.z = Math.PI; mo.smile.position.y = 0.035; mo.frown.position.y = -0.03; mo.flat.rotation.z = Math.PI / 2; mo.grin.scale.set(1, 0.75, 0.3); mo.grin.position.y = 0.012;
  if (L.sakal || L.biyik) mo.flat.material = mouthC;
  for (const k in mo) { mo[k].visible = false; mouth.add(mo[k]); } rig.mo = mo;
  if (L.biyik) for (const s of [-1, 1]) { const b = mesh(bag, new THREE.CapsuleGeometry(0.022, 0.07, 4, 8), hair, false); b.rotation.z = s * 1.2; b.position.set(s * 0.045, my + 0.05, surf(0.045, my + 0.05) + 0.01); face.add(b); }
  if (L.sakal) { const b = mesh(bag, new THREE.SphereGeometry(1, 24, 16, Math.PI / 2 - 1.45, 2.9, Math.PI * 0.6, Math.PI * 0.4), hair); b.scale.set(rx * 1.04, ry * 1.12, rz * 1.08); b.position.y = -0.015; head.add(b); mouth.position.z += 0.035; }
  if (L.gozluk) { const fr = M("#1E1A17", { roughness: 0.3 }); for (const s of [-1, 1]) { const r = mesh(bag, new THREE.TorusGeometry(er * 1.35, 0.008, 6, 24), fr, false); r.position.set(s * ex, ey, surf(s * ex, ey) + 0.012); face.add(r); } const br = mesh(bag, new THREE.CylinderGeometry(0.006, 0.006, ex * 2 - er * 2.7, 6), fr, false); br.rotation.z = Math.PI / 2; br.position.set(0, ey, surf(0, ey) + 0.012); face.add(br); }
  // saç
  const hairG = new THREE.Group(); head.add(hairG);
  const cap = (thetaLen = Math.PI * 0.46, tilt = -0.32, k = 1.07) => { const m = mesh(bag, new THREE.SphereGeometry(1, 32, 16, 0, TAU, 0, thetaLen), hair); m.scale.set(rx * k, ry * k, rz * k); m.rotation.x = tilt; hairG.add(m); return m; };
  const hat = L.sapka !== "yok";
  switch (L.sac) {
    case "kel": for (const s of [-1, 1]) { const t = mesh(bag, new THREE.SphereGeometry(0.07, 12, 10), hair); t.scale.set(0.6, 1, 1.2); t.position.set(s * rx * 0.92, ry * 0.08, -rz * 0.2); hairG.add(t); } break;
    case "kase": cap(Math.PI * 0.5, -0.05, 1.08); break;
    case "uzun": { cap(Math.PI * 0.5, -0.2); const b = mesh(bag, new THREE.CapsuleGeometry(rx * 0.9, ry * 0.45, 6, 14), hair); b.scale.z = 0.5; b.position.set(0, -ry * 0.2, -rz * 0.5); hairG.add(b); for (const s of [-1, 1]) { const f = mesh(bag, new THREE.CapsuleGeometry(0.06, ry * 0.9, 4, 8), hair); f.position.set(s * rx * 0.88, -ry * 0.35, -rz * 0.05); hairG.add(f); } break; }
    case "topuz": { cap(); const b = mesh(bag, new THREE.SphereGeometry(rx * 0.42, 16, 12), hair); b.position.set(0, ry * 0.95, -rz * 0.35); hairG.add(b); break; }
    case "at_kuyrugu": { cap(); const b = mesh(bag, new THREE.CapsuleGeometry(0.07, ry * 0.9, 4, 10), hair); b.position.set(0, -ry * 0.05, -rz * 1.05); b.rotation.x = 0.35; hairG.add(b); break; }
    case "orgu": { cap(); for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const b = mesh(bag, new THREE.SphereGeometry(0.05 - i * 0.004, 10, 8), hair); b.position.set(s * rx * 0.9, -ry * (0.25 + i * 0.2), -rz * 0.2); hairG.add(b); } break; }
    case "dik": { cap(Math.PI * 0.42); for (let i = 0; i < 11; i++) { const a = (i / 10 - 0.5) * 2.2; const sp = mesh(bag, new THREE.ConeGeometry(0.05, 0.15, 8), hair); sp.position.set(Math.sin(a) * rx * 0.75, ry * 0.82 + Math.cos(a) * 0.05, -rz * 0.1 + (i % 2) * 0.06); sp.rotation.z = -a * 0.6; sp.rotation.x = -0.2; hairG.add(sp); } break; }
    case "kakul": case "yana": { cap(); const f = mesh(bag, new THREE.SphereGeometry(1, 24, 10, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.22, Math.PI * 0.18), hair); f.scale.set(rx * 1.1, ry * 1.1, rz * 1.12); f.rotation.y = L.sac === "yana" ? 0.35 : 0; hairG.add(f); break; }
    case "kivircik": { cap(Math.PI * 0.45); for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU, el = 0.25 + (i % 3) * 0.22; const b = mesh(bag, new THREE.SphereGeometry(0.07, 10, 8), hair); b.position.set(Math.cos(a) * rx * Math.cos(el) * 1.0, ry * Math.sin(el) * 1.0 + 0.05, Math.sin(a) * rz * Math.cos(el) * 0.95 - 0.03); if (b.position.z > rz * 0.5 && b.position.y < ry * 0.5) continue; hairG.add(b); } break; }
    case "dalgali": { cap(Math.PI * 0.48); for (let i = 0; i < 5; i++) { const b = mesh(bag, new THREE.TorusGeometry(0.06, 0.03, 8, 12), hair); b.position.set((i - 2) * rx * 0.35, ry * 0.75, rz * 0.35); b.rotation.y = 0.3; hairG.add(b); } break; }
    default: cap();
  }
  if (hat) {
    const hc = (d) => M(hex(L.sapkaR, d), { roughness: 0.75 }); const ty = ry * 0.72; const hg = new THREE.Group(); hg.position.y = ty; head.add(hg);
    if (["silindir", "doktor", "kovboy", "tac", "kasket", "gece"].includes(L.sapka)) hairG.scale.set(0.98, 0.92, 0.98);
    switch (L.sapka) {
      case "silindir": case "doktor": { const c = hc(L.sapka === "doktor" ? "#1E1A17" : "#232026"); const h = L.sapka === "doktor" ? 0.42 : 0.3; const cy = mesh(bag, new THREE.CylinderGeometry(rx * 0.68, rx * 0.72, h, 24), c); cy.position.y = h / 2 + 0.02; hg.add(cy); const br = mesh(bag, new THREE.CylinderGeometry(rx * 1.12, rx * 1.12, 0.025, 28), c); br.position.y = 0.02; hg.add(br); if (L.sapka === "silindir") { const band = mesh(bag, new THREE.CylinderGeometry(rx * 0.73, rx * 0.73, 0.05, 24), M("#C0392B")); band.position.y = 0.07; hg.add(band); } break; }
      case "kasket": { const c = hc("#5B4A3A"); const cp = mesh(bag, new THREE.SphereGeometry(1, 24, 10, 0, TAU, 0, Math.PI * 0.5), c); cp.scale.set(rx * 1.08, ry * 0.45, rz * 1.1); cp.position.y = -0.04; hg.add(cp); const v = mesh(bag, new THREE.CylinderGeometry(rx * 0.55, rx * 0.55, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), M(shadeHex(hex(L.sapkaR, "#5B4A3A"), 0.8))); v.position.set(0, -0.03, rz * 0.75); hg.add(v); break; }
      case "bere": { const b = mesh(bag, new THREE.SphereGeometry(rx * 1.1, 20, 12), hc("#7A1F2B")); b.scale.set(1.05, 0.35, 1.05); b.rotation.z = -0.2; b.position.y = 0.02; hg.add(b); break; }
      case "kovboy": { const c = hc("#8B5A2B"); const cr = mesh(bag, new THREE.CylinderGeometry(rx * 0.6, rx * 0.72, 0.2, 20), c); cr.position.y = 0.1; hg.add(cr); const br = mesh(bag, new THREE.CylinderGeometry(rx * 1.6, rx * 1.6, 0.025, 28), M(shadeHex(hex(L.sapkaR, "#8B5A2B"), 0.85))); br.position.y = 0.01; hg.add(br); break; }
      case "tac": { const c = M(hex(L.sapkaR, "#E0A526"), { metalness: 0.6, roughness: 0.3 }); const b = mesh(bag, new THREE.CylinderGeometry(rx * 0.62, rx * 0.66, 0.08, 20, 1, true), c); b.position.y = 0.05; hg.add(b); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; const sp = mesh(bag, new THREE.ConeGeometry(0.03, 0.09, 6), c); sp.position.set(Math.cos(a) * rx * 0.62, 0.13, Math.sin(a) * rx * 0.62); hg.add(sp); } break; }
      case "bone": { const b = mesh(bag, new THREE.SphereGeometry(1, 24, 12, 0, TAU, 0, Math.PI * 0.55), hc("#FFFFFF")); b.scale.set(rx * 1.15, ry * 0.8, rz * 1.15); b.position.y = -ty + ry * 0.05; hg.add(b); break; }
      case "gece": { const c = hc("#C0392B"); const cn = mesh(bag, new THREE.ConeGeometry(rx * 0.95, 0.42, 20), c); cn.position.y = 0.17; cn.rotation.z = -0.45; cn.position.x = 0.06; hg.add(cn); const band = mesh(bag, new THREE.TorusGeometry(rx * 0.92, 0.035, 8, 24), M("#F4EAD5")); band.rotation.x = Math.PI / 2; band.position.y = -0.02; hg.add(band); const pom = mesh(bag, new THREE.SphereGeometry(0.045, 10, 8), M("#F4EAD5")); pom.position.set(0.26, 0.28, 0); hg.add(pom); break; }
    }
  }
  if (L.old) { head.position.z = 0.05; head.position.y -= 0.02; }
  rig.hold = null; if (L.elinde) { const p = buildProp(bag, L.elinde, null); if (p) { p.scale.multiplyScalar(0.45); p.position.y = -0.05; rig.arms[1].hand.add(p); p.visible = false; rig.hold = p; } }
  rig.seedN = L.seedN || 0;
  return rig;
}

const POSE = { // [omuz-yana, omuz-öne, dirsek-öne, dirsek-yana]
  dur: [[0.12, 0, 0.15, 0], [0.12, 0, 0.15, 0]], el_salla: [[2.55, 0.25, 0.35, 0], [0.12, 0, 0.15, 0]], isaret: [[0.1, 1.5, 0.05, 0], [0.12, 0, 0.15, 0]],
  bel: [[0.75, -0.15, 0.2, -1.95], [0.75, -0.15, 0.2, -1.95]], titre: [[0.3, 0.75, 1.7, -0.6], [0.3, 0.75, 1.7, -0.6]], kollar_yukari: [[2.7, 0.2, 0.1, 0], [2.7, 0.2, 0.1, 0]],
  tut: [[0.12, 0.85, 0.75, 0], [0.12, 0, 0.15, 0]], dusun: [[0.25, 0.55, 2.3, -0.4], [0.35, 0.9, 1.45, -0.6]], omuz: [[0.55, 0.35, 1.5, 0.35], [0.55, 0.35, 1.5, 0.35]]
};
function applyState(rig, st, t, world) {
  const { root, body, L } = rig;
  const poz = st.tmpPoz || st.poz; const P = POSE[poz] || POSE.dur;
  root.position.set(world.x, 0, world.z); root.rotation.set(0, 0, 0); body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
  const turn = st.walk ? 1.15 : 0.42; root.rotation.y = st.dir * turn;
  if (st.shiver) root.position.x += Math.sin(t * 60) * 0.008;
  let bob = 0;
  for (const lg of rig.legs) { lg.hip.rotation.set(0, 0, 0); lg.knee.rotation.set(0, 0, 0); if (st.walk) { const a = Math.sin(st.ph + (lg.s > 0 ? 0 : Math.PI)); lg.hip.rotation.x = -a * 0.55 * Math.min(1.2, st.walk); lg.knee.rotation.x = Math.max(0, a) * 0.6; } }
  if (st.walk) bob = Math.abs(Math.sin(st.ph)) * 0.035;
  for (const ar of rig.arms) {
    const p = ar.s > 0 ? P[0] : P[1]; let abd = p[0], fwd = p[1];
    if (poz === "dur" || !POSE[poz]) { if (st.walk) fwd = -Math.sin(st.ph + (ar.s > 0 ? 0 : Math.PI)) * 0.5; else abd += Math.sin(t * 1.7 + ar.s) * 0.03; }
    ar.sh.rotation.set(-fwd, 0, ar.s * abd); ar.el.rotation.set(-p[2], 0, ar.s * p[3]); ar.sh.position.y = ar.base + (poz === "omuz" ? 0.04 : 0);
    if (poz === "el_salla" && ar.s > 0) ar.el.rotation.z = ar.s * (-0.35 + 0.55 * Math.sin(t * 9));
  }
  if (rig.hold) rig.hold.visible = poz === "tut";
  for (const lg of rig.legs) lg.foot.visible = poz !== "yatakta";
  body.position.y = bob + st.jump * 0.38;
  if (poz === "otur" || poz === "yatakta") { const sitY = rig.legLen * 0.5; for (const lg of rig.legs) { lg.hip.rotation.x = -1.5; lg.knee.rotation.x = poz === "otur" ? 1.5 : 0; } body.position.y = -sitY + (world.seatY || 0) + (poz === "yatakta" ? 0.0 : 0.02); }
  // yatma / bayılma
  let lie = 0; if (st.poz === "yat") lie = 1; else if (st.faint > 0) lie = ease(st.faint);
  if (lie) { root.rotation.y = 0; body.rotation.z = st.dir * Math.PI / 2 * lie; body.position.y += (world.bedY || 0) * lie + 0.12 * lie; body.position.x = -st.dir * 0.05 * lie; }
  // baş
  const lookY = (st.lookX || 0) * 0.25 * (st.dir || 1);
  rig.head.rotation.set(st.nod * 0.18 + (L.old ? 0.12 : 0), st.shake * 0.35 + lookY, Math.sin(t * 1.3 + rig.seedN * 9) * 0.03);
  rig.torso.scale.set(1, 1 + Math.sin(t * 2.2 + rig.seedN * 5) * 0.012, 1);
  // ifade
  const ifd = st.ifade, closed = (st.closedEyes || lie >= 1) && !st.eyeOpen;
  const blink = ((t + rig.seedN * 3) % 3.7) < 0.12 && ifd !== "uykulu";
  const big = ifd === "korkmus" || ifd === "saskin" ? 1.25 : 1;
  for (const e of rig.eyes) {
    const shut = closed || blink || ifd === "uykulu" || (ifd === "goz_kirp" && e.s > 0);
    e.g.scale.set(big, shut ? 0.12 : big, big);
    e.lid.visible = !shut && (ifd === "sinsi" || L.goz === "yarim"); e.lid.rotation.x = ifd === "sinsi" ? 0.25 : 0.05;
    e.pup.position.x = (st.lookX || 0) * 0.008;
  }
  const BT = { notr: [0, 0], mutlu: [0.01, 0.15], uzgun: [0.005, -0.45], korkmus: [0.03, -0.35], kizgin: [-0.012, 0.55], sinsi: [0, 0.35], saskin: [0.04, 0], goz_kirp: [0.01, 0.15], uykulu: [-0.01, 0] }[ifd] || [0, 0];
  for (const b of rig.brows) { b.g.position.y = b.y + BT[0]; b.g.rotation.z = -b.s * (ifd === "sinsi" && b.s > 0 ? -0.35 : BT[1]); }
  const mo = rig.mo; for (const k in mo) mo[k].visible = false;
  if (st.talk > 0.05) { mo.O.visible = true; mo.O.scale.set(1 + st.talk * 0.2, 0.22 + st.talk * 0.9, 0.35); }
  else if (ifd === "mutlu" || ifd === "goz_kirp") mo.grin.visible = true;
  else if (ifd === "uzgun") mo.frown.visible = true;
  else if (ifd === "korkmus" || ifd === "saskin") { mo.O.visible = true; mo.O.scale.set(0.6, ifd === "saskin" ? 0.95 : 0.6, 0.35); }
  else if (ifd === "kizgin") { mo.flat.visible = true; mo.flat.rotation.z = Math.PI / 2 + 0.08; }
  else if (ifd === "sinsi") { mo.smile.visible = true; mo.smile.rotation.z = Math.PI + 0.35; }
  else { mo.smile.visible = true; mo.smile.rotation.z = Math.PI; mo.smile.scale.set(0.75, 0.45, 1); }
  if (mo.smile.visible && ifd !== "notr") mo.smile.scale.set(1, 1, 1);
}

/* ---------------- eşyalar ---------------- */
function buildProp(bag, ad, col) {
  const g = new THREE.Group(), M = (c, o) => bag.mat(c, o), wood = M(hex(col, "#8B5A2B"), { roughness: 0.8 }), add = (geo, m, x = 0, y = 0, z = 0) => { const o = mesh(bag, geo, m); o.position.set(x, y, z); g.add(o); return o; };
  switch (ad) {
    case "masa": add(new THREE.BoxGeometry(1.1, 0.06, 0.6), wood, 0, 0.74); for (const x of [-0.5, 0.5]) for (const z of [-0.24, 0.24]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8), wood, x, 0.36, z); break;
    case "sandalye": add(new THREE.BoxGeometry(0.45, 0.05, 0.45), wood, 0, 0.46); add(new THREE.BoxGeometry(0.45, 0.5, 0.05), wood, 0, 0.72, -0.2); for (const x of [-0.19, 0.19]) for (const z of [-0.19, 0.19]) add(new THREE.CylinderGeometry(0.022, 0.022, 0.46, 8), wood, x, 0.23, z); break;
    case "yatak": { add(new THREE.BoxGeometry(2.0, 0.3, 1.0), wood, 0, 0.2); add(new THREE.BoxGeometry(1.95, 0.16, 0.95), M("#F4EFE6"), 0, 0.42); add(new THREE.BoxGeometry(0.08, 0.8, 1.0), wood, -1.0, 0.4); add(new THREE.BoxGeometry(0.45, 0.12, 0.6), M("#FFFFFF"), -0.7, 0.55); break; }
    case "yatak_on": { add(new THREE.BoxGeometry(1.3, 0.3, 1.04), M(hex(col, "#3E6FB0"), { roughness: 0.9 }), 0.33, 0.6); break; }
    case "kapi": add(new THREE.BoxGeometry(0.95, 2.05, 0.06), wood, 0, 1.03); add(new THREE.SphereGeometry(0.04, 10, 8), M("#E0A526", { metalness: 0.7, roughness: 0.3 }), 0.36, 1.0, 0.05); break;
    case "pencere": { add(new THREE.BoxGeometry(1.1, 0.95, 0.05), M("#F4EFE6"), 0, 1.6); add(new THREE.BoxGeometry(0.98, 0.83, 0.06), M("#9CC9E8", { emissive: 0x6fa6cc, emissiveIntensity: 0.35, roughness: 0.1 }), 0, 1.6, 0.01); add(new THREE.BoxGeometry(0.05, 0.85, 0.08), M("#F4EFE6"), 0, 1.6, 0.02); add(new THREE.BoxGeometry(1.0, 0.05, 0.08), M("#F4EFE6"), 0, 1.6, 0.02); break; }
    case "tablo": add(new THREE.BoxGeometry(0.8, 0.6, 0.04), M("#8B5A2B"), 0, 1.65); add(new THREE.BoxGeometry(0.68, 0.48, 0.05), M(hex(col, "#C9A66B")), 0, 1.65, 0.005); break;
    case "bitki": case "cicek": { add(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 14), M("#B5603B"), 0, 0.15); const lc = M(ad === "cicek" ? "#E84C8B" : "#4F9A4A"); for (let i = 0; i < 6; i++) { const a = i * 1.05; add(new THREE.SphereGeometry(ad === "cicek" ? 0.09 : 0.15, 12, 10), lc, Math.cos(a) * 0.12, 0.45 + (i % 2) * 0.12, Math.sin(a) * 0.12); } break; }
    case "agac": add(new THREE.CylinderGeometry(0.12, 0.16, 1.6, 10), M("#7A5230"), 0, 0.8); for (const [x, y, r] of [[0, 2.0, 0.65], [-0.4, 1.7, 0.45], [0.45, 1.75, 0.5]]) add(new THREE.SphereGeometry(r, 16, 12), M(hex(col, "#4F9A4A"), { roughness: 0.9 }), x, y, 0); break;
    case "sokak_lambasi": add(new THREE.CylinderGeometry(0.04, 0.06, 2.6, 10), M("#2B2B30", { metalness: 0.4 }), 0, 1.3); add(new THREE.SphereGeometry(0.16, 14, 10), M("#FFE7A8", { emissive: 0xffd27a, emissiveIntensity: 1.2 }), 0, 2.65); break;
    case "sise": case "siseler": for (const [i, x] of (ad === "siseler" ? [[0, -0.12], [1, 0], [2, 0.12]] : [[0, 0]])) { const m = M(["#2E8B57", "#8E44AD", "#C0392B"][i], { roughness: 0.15, transparent: true, opacity: 0.85 }); add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12), m, x, 0.1); add(new THREE.CylinderGeometry(0.018, 0.03, 0.08, 10), m, x, 0.24); } break;
    case "kitap": add(new THREE.BoxGeometry(0.28, 0.06, 0.2), M(hex(col, "#7A1F2B")), 0, 0.03); break;
    case "fatura": add(new THREE.BoxGeometry(0.22, 0.3, 0.008), M("#FFFFFF"), 0, 0.15); break;
    case "kalp": { const m = M(hex(col, "#E74C3C"), { roughness: 0.4 }); for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.1, 14, 10), m, s * 0.07, 0.25); const c = add(new THREE.ConeGeometry(0.15, 0.22, 16), m, 0, 0.12); c.rotation.z = Math.PI; break; }
    case "mum": add(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 12), M("#F4EFE6"), 0, 0.11); add(new THREE.SphereGeometry(0.025, 8, 6), M("#FFB347", { emissive: 0xffa040, emissiveIntensity: 1.5 }), 0, 0.26); break;
    case "kese": add(new THREE.SphereGeometry(0.13, 14, 10), M("#8B6A3E"), 0, 0.13); break;
    case "siringa": { const s = add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), M("#DDEEFF", { transparent: true, opacity: 0.8 }), 0, 0.15); s.rotation.z = 0.3; break; }
    case "kahve": add(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 14), M("#FFFFFF"), 0, 0.05); add(new THREE.TorusGeometry(0.03, 0.01, 6, 12), M("#FFFFFF"), 0.065, 0.05); break;
    case "telefon": add(new THREE.BoxGeometry(0.08, 0.16, 0.012), M("#1E1A17", { roughness: 0.2 }), 0, 0.08); break;
    case "sandik": add(new THREE.BoxGeometry(0.8, 0.5, 0.5), wood, 0, 0.25); add(new THREE.BoxGeometry(0.82, 0.06, 0.52), M("#5A3A20"), 0, 0.42); break;
    case "kamera": add(new THREE.BoxGeometry(0.3, 0.2, 0.2), M("#2B2B30"), 0, 1.45); add(new THREE.CylinderGeometry(0.07, 0.08, 0.15, 14), M("#111"), 0, 1.45, 0.17).rotation.x = Math.PI / 2; for (let i = 0; i < 3; i++) { const l = add(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6), M("#444"), Math.cos(i * 2.1) * 0.15, 0.68, Math.sin(i * 2.1) * 0.15); l.rotation.z = Math.cos(i * 2.1) * 0.2; } break;
    case "mikrofon": add(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 8), M("#333"), 0, 0.7); add(new THREE.SphereGeometry(0.06, 12, 10), M("#555", { metalness: 0.5 }), 0, 1.45); add(new THREE.CylinderGeometry(0.15, 0.18, 0.03, 16), M("#333"), 0, 0.015); break;
    default: return null;
  }
  return g;
}
const WALL_PROPS = ["kapi", "pencere", "tablo"];

/* ---------------- dekor ---------------- */
function buildSet(bag, scene, arka, accent, VW) {
  const tip = (arka && arka.tip) || "oda", col = arka && arka.renk, M = (c, o) => bag.mat(c, o);
  const span = VW * 3, wallZ = -2.4;
  const floor = (c, tex) => { const m = mesh(bag, new THREE.PlaneGeometry(span, 12), tex ? bag.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })) : M(c, { roughness: 0.9 }), false, true); m.rotation.x = -Math.PI / 2; m.position.z = wallZ + 6; scene.add(m); return m; };
  const wall = (c, tex, h = 6) => { const m = mesh(bag, new THREE.PlaneGeometry(span, h), tex ? bag.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })) : M(c, { roughness: 0.95 }), false, true); m.position.set(0, h / 2, wallZ); scene.add(m); return m; };
  const planks = (c) => canvasTex(bag, 512, 512, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 64) { g.fillStyle = `rgba(0,0,0,${0.05 + ((y / 64) % 3) * 0.03})`; g.fillRect(0, y, w, 64); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, y, w, 3); for (let x = (y / 64) % 2 ? 0 : 128; x < w; x += 256) g.fillRect(x, y, 3, 64); } for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 40, 1); } }, [span / 2, 6]);
  const sky = c => { scene.background = new THREE.Color(c); };
  switch (tip) {
    case "duz": { const c = hex(col, "#F4EAD5"); sky(c); floor(shadeHex(c, 0.92)); break; }
    case "park": {
      sky("#A8D8F0"); floor(hex(col, "#7BB661"));
      for (let i = 0; i < 9; i++) { const t = buildProp(bag, "agac", ["#4F9A4A", "#5FAE55", "#3F8A40"][i % 3]); t.position.set(-VW * 1.2 + i * VW * 0.32, 0, wallZ - 0.5 - (i % 3) * 1.2); t.scale.setScalar(1 + (i % 2) * 0.35); scene.add(t); }
      for (let i = 0; i < 5; i++) { const b = mesh(bag, new THREE.SphereGeometry(0.4, 14, 10), M("#5FAE55")); b.scale.y = 0.6; b.position.set(-VW + i * VW * 0.5, 0.15, wallZ + 0.6); scene.add(b); }
      break; }
    case "sokak": case "gece": {
      const night = tip === "gece"; sky(night ? "#141B33" : "#9CC9E8"); floor(night ? "#2A2C33" : "#6E6A66");
      const side = mesh(bag, new THREE.BoxGeometry(span, 0.12, 1.4), M(night ? "#3A3C44" : "#A9A49C")); side.position.set(0, 0.06, wallZ + 0.4); scene.add(side);
      const cols = night ? ["#2B3456", "#323C63", "#283050"] : [hex(col, "#D9B48F"), "#C98E62", "#E9DCC4", "#B7C4CF"];
      for (let i = 0; i < 10; i++) {
        const h = 2.6 + ((i * 37) % 30) / 10, w = VW * 0.3, c = cols[i % cols.length];
        const tex = canvasTex(bag, 128, 256, (g, cw, ch) => { g.fillStyle = c; g.fillRect(0, 0, cw, ch); for (let y = 20; y < ch - 30; y += 44) for (let x = 14; x < cw - 20; x += 38) { g.fillStyle = night ? (Math.random() < 0.6 ? "#FFD678" : "#1A2138") : "#5B7A99"; g.fillRect(x, y, 22, 28); } });
        const b = mesh(bag, new THREE.BoxGeometry(w, h, 1.2), bag.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: night ? 0xffffff : 0, emissiveMap: night ? tex : null, emissiveIntensity: night ? 0.35 : 0 })), true, true);
        b.position.set(-VW * 1.4 + i * w * 1.02, h / 2, wallZ - 0.6); scene.add(b);
      }
      if (night) { const moon = mesh(bag, new THREE.SphereGeometry(0.35, 20, 14), M("#F4EAD5", { emissive: 0xf4ead5, emissiveIntensity: 1 }), false, false); moon.position.set(VW * 0.35, 4.2, wallZ - 3); scene.add(moon); const pts = []; for (let i = 0; i < 160; i++) pts.push((Math.random() - 0.5) * VW * 3, 3 + Math.random() * 4, wallZ - 4); const sg = bag.add(new THREE.BufferGeometry()); sg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); scene.add(new THREE.Points(sg, bag.add(new THREE.PointsMaterial({ color: 0xffffff, size: 0.04 })))); }
      break; }
    case "sahne": case "tiyatro": case "perde": {
      sky("#1E1A17"); const fl = floor(null, planks("#8B5A2B")); const back = wall(hex(col, "#F4EAD5"));
      const red = M("#7A1F2B", { roughness: 0.75 });
      for (const s of [-1, 1]) for (let i = 0; i < 7; i++) { const f = mesh(bag, new THREE.CylinderGeometry(0.14, 0.14, 4.5, 12), red); f.position.set(s * (VW * 0.5 - i * 0.2), 2.25, wallZ + 0.6 + (i % 2) * 0.1); scene.add(f); }
      for (let i = 0; i < 30; i++) { const f = mesh(bag, new THREE.SphereGeometry(0.22, 12, 8), red); f.scale.set(1, 0.7, 0.5); f.position.set(-VW * 0.75 + i * VW * 0.05, 3.9 + Math.sin(i * 1.7) * 0.05, wallZ + 0.7); scene.add(f); }
      const valance = mesh(bag, new THREE.BoxGeometry(span, 0.6, 0.2), red); valance.position.set(0, 4.3, wallZ + 0.7); scene.add(valance);
      const edge = mesh(bag, new THREE.BoxGeometry(span, 0.12, 0.2), M(accent || "#E0A526", { metalness: 0.4, roughness: 0.4 })); edge.position.set(0, 0.06, 1.8); scene.add(edge);
      if (tip === "tiyatro") for (let i = 0; i < 16; i++) { const h = mesh(bag, new THREE.SphereGeometry(0.28, 12, 10), M("#1E1A17")); h.position.set(-VW * 0.6 + i * VW * 0.08, 0.15, 2.8); scene.add(h); }
      break; }
    case "ofis": { sky("#DDE3EA"); floor("#8C939C"); wall(hex(col, "#DDE3EA")); const strip = mesh(bag, new THREE.BoxGeometry(span, 0.08, 0.05), M("#B9C2CC")); strip.position.set(0, 1.0, wallZ + 0.03); scene.add(strip); break; }
    case "studyo": { sky("#0E1B3D"); floor("#2B3A63"); const w = wall("#14285A"); for (let i = 0; i < 12; i++) { const p = mesh(bag, new THREE.BoxGeometry(0.03, 6, 0.03), M("#3C5BA8", { emissive: 0x2a4a9a, emissiveIntensity: 0.6 }), false, false); p.position.set(-VW + i * VW * 0.18, 3, wallZ + 0.05); scene.add(p); } const desk = mesh(bag, new THREE.BoxGeometry(VW * 0.45, 0.85, 0.7), M("#3C4F84", { roughness: 0.4, metalness: 0.2 })); desk.position.set(0, 0.42, 0.55); scene.add(desk); break; }
    case "neon": { sky("#0B0820"); floor("#120E2A"); for (let i = 0; i < 10; i++) { const h = 2 + (i * 37 % 30) / 10; const b = mesh(bag, new THREE.BoxGeometry(VW * 0.25, h, 0.8), M("#130F2B")); b.position.set(-VW * 1.2 + i * VW * 0.27, h / 2, wallZ - 0.5); scene.add(b); const e = mesh(bag, new THREE.BoxGeometry(VW * 0.25, 0.04, 0.82), M(i % 2 ? "#FF2BD6" : "#22E5FF", { emissive: i % 2 ? 0xff2bd6 : 0x22e5ff, emissiveIntensity: 1.5 }), false, false); e.position.set(b.position.x, h, wallZ - 0.5); scene.add(e); } break; }
    default: { // oda (tahta/parsomen de oda gibi)
      const c = hex(col, tip === "parsomen" ? "#EAD9AE" : tip === "tahta" ? "#FBFBF8" : "#E9DCC4"); sky(c);
      floor(null, planks(hex(arka && arka.zemin, "#8B5A2B")));
      const tex = canvasTex(bag, 256, 256, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); if (tip === "oda") { g.fillStyle = shadeHex(c, 0.93); for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 32, h); } }, [span / 1.4, 3]);
      wall(c, tex);
      const wain = mesh(bag, new THREE.BoxGeometry(span, 0.9, 0.04), M(shadeHex(c, 0.8))); wain.position.set(0, 0.45, wallZ + 0.02); scene.add(wain);
      const rail = mesh(bag, new THREE.BoxGeometry(span, 0.05, 0.07), M(shadeHex(c, 0.62))); rail.position.set(0, 0.92, wallZ + 0.04); scene.add(rail);
    }
  }
  return { wallZ };
}

/* ---------------- sahne kurulumu ---------------- */
function frame(W, H) { const A = W / H, fov = 30, Vh = Math.max(2.95, 2.6 / A), VW = Vh * A, d = (Vh / 2) / Math.tan((fov / 2) * Math.PI / 180); return { A, fov, Vh, VW, d, yc: Vh * (0.5 - 0.14) }; }
function buildScene(o) {
  const bag = new Bag(), scene = new THREE.Scene(), F = frame(o.W, o.H), sc = o.sc;
  const set = buildSet(bag, scene, sc.arka, o.accent, F.VW);
  const night = sc.arka && (sc.arka.tip === "gece" || sc.arka.tip === "neon");
  scene.add(new THREE.HemisphereLight(night ? 0x8090c0 : 0xfff4e6, night ? 0x202030 : 0x8a7560, night ? 1.35 : 1.25));
  const key = new THREE.DirectionalLight(night ? 0xb8c8ff : 0xfff0dc, night ? 1.4 : 2.4); key.position.set(-3.5, 6, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; const sh = key.shadow.camera; sh.left = -F.VW * 0.8; sh.right = F.VW * 0.8; sh.top = 5; sh.bottom = -1; sh.near = 0.5; sh.far = 25; key.shadow.radius = 4; scene.add(key);
  const rim = new THREE.DirectionalLight(night ? 0xff60d0 : 0xcfe2ff, night ? 1.2 : 0.9); rim.position.set(4, 3, -4); scene.add(rim);
  if (sc.arka && (sc.arka.tip === "sahne" || sc.arka.tip === "tiyatro")) { const sp = new THREE.SpotLight(0xfff2cc, 30, 14, 0.5, 0.6, 1.2); sp.position.set(0, 6.5, 4); sp.target.position.set(0, 0.8, 0); scene.add(sp, sp.target); }
  const mapX = x => (N(x, 0.5) - 0.5) * F.VW * 0.94;
  const props = [], wallZ = set.wallZ;
  for (const p of sc.esyalar || []) {
    const m = buildProp(bag, p.ad, p.renk); if (!m) continue; const s = N(p.olcek, 1); m.scale.setScalar(s);
    const wallP = WALL_PROPS.includes(p.ad); m.position.set(mapX(p.x), N(p.y, 0) * F.Vh, wallP ? wallZ + 0.04 : p.ad === "yatak" ? -0.25 : -0.55);
    if (wallP && p.ad === "kapi") m.position.y = 0;
    scene.add(m); props.push({ p, m });
    if (p.ad === "yatak") { const b = buildProp(bag, "yatak_on", p.renk); b.scale.setScalar(s); b.position.copy(m.position); scene.add(b); }
  }
  const rigs = {}; for (const c of o.chars) { const L = window.TitusAnim.look(c); L.seedN = (Array.from(String(L.seed)).reduce((a, ch) => a + ch.charCodeAt(0), 0) % 97) / 97; const rig = buildChar(bag, c, L); scene.add(rig.root); rigs[c.id] = rig; rig.root.visible = false; }
  const camera = new THREE.PerspectiveCamera(F.fov, F.A, 0.1, 60);
  return { bag, scene, camera, F, rigs, props, mapX };
}
function ensureRenderer(w, h) {
  if (!R) {
    CV = document.createElement("canvas");
    R = new THREE.WebGLRenderer({ canvas: CV, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    R.setPixelRatio(1); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
  }
  if (CV.width !== w || CV.height !== h) R.setSize(w, h, false);
}
const V = new THREE.Vector3();
function draw(o) {
  const w = Math.max(2, Math.round(o.cw)), h = Math.max(2, Math.round(o.ch));
  ensureRenderer(w, h);
  const key = o.specRef; if (!CUR || CUR.key !== key || CUR.si !== o.si || CUR.W !== o.W || CUR.H !== o.H) { if (CUR) CUR.S.bag.dispose(); CUR = { key, si: o.si, W: o.W, H: o.H, S: buildScene(o) }; }
  const S = CUR.S, F = S.F;
  for (const id in S.rigs) S.rigs[id].root.visible = false;
  const positions = {};
  o.actors.forEach(({ a, st }, k) => {
    const rig = S.rigs[a.id]; if (!rig) return; rig.root.visible = true;
    const bed = S.props.find(q => q.p.ad === "yatak" && Math.abs(N(q.p.x, 0.5) - st.x) < 0.25), chair = S.props.find(q => q.p.ad === "sandalye" && Math.abs(N(q.p.x, 0.5) - st.x) < 0.15);
    let x = S.mapX(st.x), z = -k * 0.04 + N(a.z, 0) * 0.3;
    const world = { x, z, seatY: 0, bedY: 0 };
    if (st.poz === "otur") world.seatY = chair ? 0.48 * chair.m.scale.x : 0.0;
    if (st.poz === "otur" && chair) { world.z = chair.m.position.z + 0.05; }
    if ((st.poz === "yatakta" || st.poz === "yat") && bed) { world.x = st.poz === "yat" ? bed.m.position.x : bed.m.position.x + 0.15; world.z = bed.m.position.z; world.seatY = 0.4 * bed.m.scale.x; world.bedY = 0.36 * bed.m.scale.x; }
    if (st.poz === "yatakta" && !bed) world.seatY = 0.3;
    rig.root.scale.setScalar(N(a.olcek, 1));
    applyState(rig, st, o.t + k, world);
    rig.root.updateMatrixWorld(true);
    rig.head.getWorldPosition(V); V.y += rig.hr.ry * 1.25 * rig.root.scale.y; positions[a.id] = { v: V.clone(), dir: st.dir };
  });
  // kamera
  const cam = o.cam || { z: 1, x: 0.5, y: 0.5 }, tx = (cam.x - 0.5) * F.VW, ty = F.yc + (0.5 - cam.y) * F.Vh, dist = F.d / Math.max(0.5, cam.z || 1);
  S.camera.position.set(tx, ty + 0.55, dist); S.camera.lookAt(tx, ty, 0); S.camera.aspect = F.A; S.camera.updateProjectionMatrix();
  R.render(S.scene, S.camera);
  const out = {}; for (const id in positions) { const p = positions[id].v.project(S.camera); out[id] = { sx: (p.x * 0.5 + 0.5) * o.W, sy: (-p.y * 0.5 + 0.5) * o.H, dir: positions[id].dir }; }
  return { canvas: CV, positions: out };
}
window.TitusAnim3D = { draw, ready: () => Promise.resolve(true), THREE };
