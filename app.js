'use strict';
/* Gym Tracker – lokale PWA, Daten in IndexedDB auf dem Gerät. Keine Abhängigkeiten. */

/* ========== Helpers ========== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('de-DE', { maximumFractionDigits: d });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DAY = 864e5;
const e1rm = (w, r) => (w > 0 && r > 0) ? (r === 1 ? w : w * (1 + r / 30)) : 0;
const weekStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDate = (ts, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(ts).toLocaleDateString('de-DE', o);
const fmtTime = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDur = ms => { const m = Math.max(1, Math.round(ms / 6e4)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtKg = n => n >= 10000 ? fmt(n / 1000, 1) + ' t' : fmt(n, 0) + ' kg';
const dist = (a, b) => { const R = 6371e3, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* ========== Storage (IndexedDB, Fallback localStorage) ========== */
const DBN = 'gymtracker', STN = 'kv', KEY = 'state';
let dbp;
const openDB = () => dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open(DBN, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STN);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function idbGet() {
  try { const db = await openDB(); return await new Promise((res, rej) => { const q = db.transaction(STN).objectStore(STN).get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  catch { try { return JSON.parse(localStorage.getItem(DBN) || 'null'); } catch { return null; } }
}
async function idbPut(v) {
  try { const db = await openDB(); await new Promise((res, rej) => { const t = db.transaction(STN, 'readwrite'); t.objectStore(STN).put(v, KEY); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  catch { try { localStorage.setItem(DBN, JSON.stringify(v)); } catch {} }
}
let saveT;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => idbPut(JSON.parse(JSON.stringify(S))), 250); };

/* ========== Data ========== */
const MUSCLES = ['Brust', 'Rücken', 'Beine', 'Schultern', 'Arme', 'Bauch', 'Ganzkörper', 'Cardio'];
const DEFAULT_EX = [
  ['Bankdrücken', 'Brust'], ['Schrägbankdrücken (KH)', 'Brust'], ['Butterfly', 'Brust'], ['Dips', 'Brust'],
  ['Kreuzheben', 'Rücken'], ['Klimmzüge', 'Rücken'], ['Latziehen', 'Rücken'], ['Rudern (LH)', 'Rücken'], ['Rudern am Kabel', 'Rücken'],
  ['Kniebeuge', 'Beine'], ['Beinpresse', 'Beine'], ['Beinstrecker', 'Beine'], ['Beinbeuger', 'Beine'], ['Rumänisches Kreuzheben', 'Beine'], ['Hip Thrust', 'Beine'], ['Wadenheben', 'Beine'],
  ['Schulterdrücken', 'Schultern'], ['Seitheben', 'Schultern'], ['Face Pulls', 'Schultern'],
  ['Bizepscurls', 'Arme'], ['Hammercurls', 'Arme'], ['Trizepsdrücken am Kabel', 'Arme'], ['French Press', 'Arme'],
  ['Crunches', 'Bauch'], ['Beinheben hängend', 'Bauch'],
  ['Laufband', 'Cardio', 'cardio'], ['Crosstrainer', 'Cardio', 'cardio'], ['Rudergerät', 'Cardio', 'cardio']
];
// Geräte unterscheiden sich je Gym: Gewichte an Maschinen werden nur innerhalb desselben Gyms verglichen
const MACHINE_RX = /presse|turm|kabel|butterfly|latziehen|maschine|gerät|beinstrecker|beinbeuger|face pull|hackenschmidt|smith/i;
const fresh = () => ({
  v: 1,
  exercises: DEFAULT_EX.map(([name, muscle, kind]) => ({ id: uid(), name, muscle, kind: kind || 'weight', machine: !kind && MACHINE_RX.test(name) })),
  workouts: [], locations: [], plans: [], body: [], active: null,
  settings: { weeklyGoal: 3, rest: 0, autoLoc: true, r2: 1, step: 2.5, wake: true }
});
let S = fresh();
const ui = { view: 'home', sheet: null, histOpen: null, statEx: null, statMetric: 'e1rm', editPlan: null, rest: null };

const exById = id => S.exercises.find(e => e.id === id) || { id, name: 'Gelöschte Übung', muscle: '–', kind: 'weight' };
const locById = id => S.locations.find(l => l.id === id);
const isCardio = id => exById(id).kind === 'cardio';
const sorted = () => [...S.workouts].sort((a, b) => a.start - b.start);

const isMachine = id => !!exById(id).machine;
const ctxKey = (exId, locId) => isMachine(exId) && locId ? exId + '@' + locId : exId;
// Letzte Werte einer Übung; bei Geräten bevorzugt aus demselben Gym
function lastSets(exId, excludeId, locId) {
  const ws = sorted().reverse(); let any = null;
  for (const w of ws) {
    if (w.id === excludeId) continue;
    const it = w.items.find(i => i.exId === exId && i.sets.length); if (!it) continue;
    const r = { sets: it.sets, date: w.start, locId: w.locationId };
    if (!isMachine(exId) || !locId || w.locationId === locId) return r;
    any ||= r;
  }
  return any;
}
const setStr = (exId, s) => isCardio(exId) ? `${fmt(num(s.r), 0)} min${num(s.w) ? ' · ' + fmt(num(s.w)) + ' km' : ''}` : `${fmt(num(s.w))} × ${fmt(num(s.r), 0)}`;

/* ========== Analyse & Gamification ========== */
const xpAt = l => 75 * (l - 1) * l;
function levelOf(xp) { let l = 1; while (xp >= xpAt(l + 1)) l++; const a = xpAt(l), b = xpAt(l + 1); return { level: l, xp, into: xp - a, need: b - a, pct: Math.round((xp - a) / (b - a) * 100) }; }
const TITLES = [[1, 'Frischling'], [3, 'Rookie'], [6, 'Stammgast'], [10, 'Eisenbieger'], [15, 'Biest'], [22, 'Maschine'], [30, 'Titan'], [40, 'Legende']];
const titleOf = l => TITLES.filter(t => l >= t[0]).pop()[1];

const ACH = [
  ['first', '🏁', 'Erstes Training', a => a.count >= 1],
  ['w10', '💪', '10 Trainings', a => a.count >= 10],
  ['w50', '🏋️', '50 Trainings', a => a.count >= 50],
  ['w100', '💯', '100 Trainings', a => a.count >= 100],
  ['pr1', '⭐', 'Erster PR', a => a.prCount >= 1],
  ['pr25', '🌟', '25 PRs', a => a.prCount >= 25],
  ['t10', '🧱', '10 t bewegt', a => a.totalVol >= 1e4],
  ['t100', '🏗️', '100 t bewegt', a => a.totalVol >= 1e5],
  ['s1000', '🔁', '1.000 Sätze', a => a.totalSets >= 1000],
  ['streak4', '🔥', '4 Wochen Streak', a => a.maxStreak >= 4],
  ['streak12', '☄️', '12 Wochen Streak', a => a.maxStreak >= 12],
  ['gyms3', '🗺️', '3 Orte besucht', a => a.places >= 3],
  ['early', '🌅', 'Vor 7 Uhr trainiert', a => a.early],
  ['night', '🌙', 'Nach 21 Uhr trainiert', a => a.night],
  ['body5', '⚖️', '5× Gewicht notiert', () => S.body.length >= 5]
];

function analyze() {
  const ws = sorted(), best = {}, per = {};
  let xp = 0, totalVol = 0, totalSets = 0, prCount = 0, early = false, night = false;
  for (const w of ws) {
    let vol = 0, sets = 0; const prs = [];
    for (const it of w.items) {
      const cardio = isCardio(it.exId); let top = 0, topSet = null;
      for (const s of it.sets) {
        if (!s.done) continue; sets++;
        if (cardio) continue;
        const W = num(s.w), R = num(s.r); vol += W * R;
        const e = e1rm(W, R); if (e > top) { top = e; topSet = s; }
      }
      if (topSet) {
        const key = ctxKey(it.exId, w.locationId), b = best[key];
        if (b && top > b.e1rm + 0.01) prs.push(it.exId);
        if (!b || top > b.e1rm) best[key] = { e1rm: top, w: num(topSet.w), r: num(topSet.r), date: w.start };
      }
    }
    const h = new Date(w.start).getHours(); if (h < 7) early = true; if (h >= 21) night = true;
    const wxp = 50 + sets * 5 + prs.length * 25 + Math.min(30, Math.floor(vol / 500));
    per[w.id] = { vol, sets, prs, xp: wxp }; xp += wxp; totalVol += vol; totalSets += sets; prCount += prs.length;
  }
  // Wochen-Streak
  const goal = S.settings.weeklyGoal, weeks = {};
  ws.forEach(w => { const k = weekStart(w.start); weeks[k] = (weeks[k] || 0) + 1; });
  const cur = weekStart(Date.now()), prevWeek = k => weekStart(k - 3 * DAY);
  let streak = 0, k = cur;
  if ((weeks[cur] || 0) >= goal) streak++;
  k = prevWeek(cur);
  while ((weeks[k] || 0) >= goal) { streak++; k = prevWeek(k); }
  let maxStreak = 0, run = 0, last = null;
  Object.keys(weeks).map(Number).sort((a, b) => a - b).forEach(wk => {
    if (weeks[wk] >= goal) { run = (last !== null && prevWeek(wk) === last) ? run + 1 : 1; last = wk; maxStreak = Math.max(maxStreak, run); }
    else { run = 0; last = null; }
  });
  xp += streak * 20;
  const places = new Set(ws.map(w => w.locationId).filter(Boolean)).size;
  const a = { ws, best, per, xp, totalVol, totalSets, prCount, count: ws.length, streak, maxStreak, weeks, places, early, night, thisWeek: weeks[cur] || 0 };
  a.level = levelOf(xp);
  a.achieved = ACH.filter(x => x[3](a)).map(x => x[0]);
  return a;
}

/* ========== Charts (SVG) ========== */
// Datum fürs Diagramm, mit Jahr sobald der Zeitraum über ein Jahr hinausgeht oder nicht dieses Jahr ist
const dLbl = (t, o) => { const y = new Date(t).getFullYear(), now = new Date().getFullYear();
  return fmtDate(t, { day: 'numeric', month: 'short', ...(y !== new Date(o).getFullYear() || y !== now ? { year: '2-digit' } : {}) }); };
function lineChart(pts, unit = '') {
  if (pts.length < 2) return `<div class="muted small" style="padding:12px 0">Mindestens 2 Einträge nötig für einen Verlauf.</div>`;
  const W = 320, H = 160, L = 38, R = 8, T = 12, B = 24;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) x1 = x0 + 1;
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.15 || 5; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  const area = d + ` L${X(x1).toFixed(1)} ${H - B} L${X(x0).toFixed(1)} ${H - B} Z`;
  const ticks = [y0, (y0 + y1) / 2, y1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 4}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, y1 - y0 < 10 ? 1 : 0)}</text>`).join('')}
    <path class="ar" d="${area}"/><path class="ln" d="${d}"/>
    ${pts.length <= 40 ? pts.map(p => `<circle class="pt" r="3" cx="${X(p.x)}" cy="${Y(p.y)}"/>`).join('') : ''}
    <text x="${L}" y="${H - 6}">${dLbl(x0, x1)}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end">${dLbl(x1, x0)}</text>
    <text x="${W - R}" y="${T - 1}" text-anchor="end">${esc(unit)}</text></svg>`;
}
function barChart(vals, labels, hi = -1) {
  const W = 320, H = 140, B = 22, T = 12, n = vals.length, gw = W / n, max = Math.max(1, ...vals);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${vals.map((v, i) => {
    const h = (H - B - T) * v / max, x = i * gw + gw * 0.18, y = H - B - h;
    return `<rect class="br ${v ? '' : 'dim'}" x="${x}" y="${v ? y : H - B - 3}" width="${gw * 0.64}" height="${v ? h : 3}" rx="4" ${i === hi ? '' : 'opacity=".75"'}/>`
      + (v ? `<text x="${x + gw * 0.32}" y="${y - 3}" text-anchor="middle">${v}</text>` : '')
      + (labels[i] ? `<text x="${x + gw * 0.32}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>` : '');
  }).join('')}</svg>`;
}

/* ========== Views ========== */
const greeting = () => { const h = new Date().getHours(); return h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend'; };

function viewHome() {
  const A = analyze(), L = A.level, goal = S.settings.weeklyGoal, ws0 = weekStart(Date.now());
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d, i) => {
    const t = ws0 + i * DAY + 3 * 3600e3; const ds = dayStart(t);
    const on = S.workouts.some(w => dayStart(w.start) === ds);
    return `<div>${d}<i class="${on ? 'on' : ''} ${ds === dayStart(Date.now()) ? 'today' : ''}">${on ? '✓' : ''}</i></div>`;
  }).join('');
  const last = A.ws[A.ws.length - 1];
  const nextPlan = S.plans.find(p => p.id === nextPlanId());
  const prs = A.ws.slice(-10).reverse().flatMap(w => A.per[w.id].prs.map(id => ({ id, w }))).slice(0, 4);
  return `
  <section class="card hero">
    <div class="row between"><div><div class="muted small">${greeting()} 👋</div><h1>Level ${L.level} · ${titleOf(L.level)}</h1></div>
    ${A.streak ? `<div class="streak">🔥<b>${A.streak}</b><span>${A.streak === 1 ? 'Woche' : 'Wochen'}</span></div>`
      : `<div class="streak">🎯<b>${Math.max(0, goal - A.thisWeek)}</b><span>bis zum Streak</span></div>`}</div>
    <div class="xpbar"><i style="width:${L.pct}%"></i></div>
    <div class="muted small">${fmt(L.into, 0)} / ${fmt(L.need, 0)} XP bis Level ${L.level + 1}</div>
  </section>
  <section class="card">
    <div class="row between"><h2>Diese Woche</h2><span class="${A.thisWeek >= goal ? 'badge good' : 'muted'}">${A.thisWeek}/${goal} Trainings${A.thisWeek >= goal ? ' ✓' : ''}</span></div>
    <div class="week">${days}</div>
  </section>
  ${nextPlan ? `<button class="big primary" data-a="startPlan" data-id="${nextPlan.id}" style="margin-bottom:4px">${esc(nextPlan.name)} starten</button>
    <button class="link" style="display:block;margin:0 auto 4px" data-a="startChoice">Anderen Plan oder frei trainieren</button>`
    : `<button class="big primary" data-a="startChoice">Training starten</button>`}
  <div class="section-title">Deine Pläne</div>
  ${S.plans.length ? `<div class="card stack">${planRows()}<button class="link" data-a="newPlanHome">+ Neuen Plan erstellen</button></div>`
    : `<button class="list-item" data-a="newPlanHome"><span><b>+ Plan erstellen</b><br><small>z. B. Tag A / Tag B, dann startest du mit einem Tipp</small></span><span>›</span></button>`}
  ${last ? `<div class="section-title">Letztes Training</div>${histCard(last, A)}` : `<div class="card empty"><i>🏋️</i>Noch keine Trainings. Starte dein erstes und sammle XP!</div>`}
  ${prs.length ? `<div class="section-title">Neue Rekorde</div><div class="card stack">${prs.map(p => { const b = A.best[p.id]; return `<div class="row between"><span>⭐ ${esc(exById(p.id).name)}</span><span class="muted small">${fmtDate(p.w.start)}</span></div>`; }).join('')}</div>` : ''}`;
}

function viewWorkout() {
  const w = S.active;
  const all = w.items.flatMap(it => it.sets), done = all.filter(x => x.done).length;
  const locs = S.locations.map(l => `<option value="${l.id}" ${l.id === w.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  // Noch kein Ort: Gyms als Chips, zuletzt besuchte zuerst – ein Tipp genügt
  const recent = [...S.locations].sort((a, b) => lastVisit(b.id) - lastVisit(a.id));
  return `
  <section class="card wbar">
    <div class="row between"><div><div class="muted small">${w.plan ? esc(w.plan) + ' · ' : ''}seit ${fmtTime(w.start)}</div>
      <div class="row" style="gap:10px;align-items:baseline"><div class="timer" id="wtimer">${clock(Date.now() - w.start)}</div>${all.length ? `<span class="muted small"><b style="color:var(--text)">${done}</b>/${all.length} Sätze</span>` : ''}</div></div>
    <button class="btn primary" data-a="finishWorkout">Beenden</button></div>
    ${all.length ? `<div class="wprog"><i style="width:${done / all.length * 100}%"></i></div>` : ''}
  </section>
  <section class="card">
    ${!w.locationId && recent.length ? `<div class="muted small" style="margin-bottom:8px">Wo trainierst du heute?</div>
      <div class="chips">${recent.map(l => `<button class="chip" data-a="setLoc" data-id="${l.id}">📍 ${esc(l.name)}</button>`).join('')}<button class="chip" data-a="setLoc" data-id="__new">+ Neu</button>${S.locations.some(l => l.lat) ? `<button class="chip" data-a="detectLoc" aria-label="Ort per GPS erkennen">🛰️ GPS</button>` : ''}</div>`
    : `<div class="row">
      <select data-c="loc" class="grow"><option value="">📍 Ort wählen…</option>${locs}<option value="__new">+ Neuer Ort…</option></select>
      <button class="icon-btn" data-a="detectLoc" aria-label="Ort per GPS erkennen">🛰️</button>
    </div>`}
  </section>
  ${w.items.length ? w.items.map(itemCard).join('') : `<div class="card empty"><i>➕</i>Füge deine erste Übung hinzu.</div>`}
  <button class="big secondary" data-a="openPicker" data-target="workout">+ Übung hinzufügen</button>
  <textarea data-f="note" placeholder="Notiz zum Training (optional)">${esc(w.note || '')}</textarea>
  <button class="big primary" data-a="finishWorkout">Training beenden 🏁</button>
  <button class="link danger" style="display:block;margin:0 auto" data-a="cancelWorkout">Training verwerfen</button>`;
}
const lastVisit = locId => { const w = sorted().reverse().find(w => w.locationId === locId); return w ? w.start : 0; };
// "180 × 6, 180 × 6, 180 × 6" → "3× 180 × 6"
function setsStr(exId, sets) {
  const parts = sets.map(x => setStr(exId, x));
  return parts.every(x => x === parts[0]) && parts.length > 1 ? `${parts.length}× ${parts[0]}` : parts.join(', ');
}
const stepOf = (exId, f) => f === 'r' ? 1 : isCardio(exId) ? 0.5 : (S.settings.step || 2.5);

function itemCard(it, i) {
  const ex = exById(it.exId), cardio = ex.kind === 'cardio', loc = S.active.locationId, prev = lastSets(it.exId, S.active.id, loc);
  const otherGym = prev && ex.machine && loc && prev.locId && prev.locId !== loc;
  const prevGym = prev && ex.machine && prev.locId && prev.locId !== loc && locById(prev.locId) ? ` (${esc(locById(prev.locId).name)})` : '';
  const ph = (j, f) => { const p = it.sets[j - 1] || (prev && (prev.sets[j] || prev.sets[prev.sets.length - 1])); return p ? esc(p[f]) : ''; };
  const meta = [it.target ? 'Ziel ' + esc(it.target) : '', prev ? `Letztes Mal${prevGym}: ${setsStr(it.exId, prev.sets)}` : (it.target ? '' : ex.muscle)].filter(Boolean).join(' · ');
  const allDone = it.sets.length && it.sets.every(x => x.done);
  const field = (j, s, f, mode) => `<div class="step"><button data-a="step" data-i="${i}" data-s="${j}" data-f="${f}" data-d="-1" aria-label="weniger">−</button><input inputmode="${mode}" data-f="${f}" data-i="${i}" data-s="${j}" value="${esc(s[f])}" placeholder="${ph(j, f)}"><button data-a="step" data-i="${i}" data-s="${j}" data-f="${f}" data-d="1" aria-label="mehr">+</button></div>`;
  return `<section class="card ex ${allDone ? 'ex-done' : ''}" id="ex${i}">
    <div class="row between" style="align-items:flex-start"><div class="grow"><h3>${allDone ? '✓ ' : ''}${esc(ex.name)}</h3>
      ${it.subFor ? `<div class="target">⇄ statt ${esc(exById(it.subFor).name)}</div>` : ''}
      <div class="muted small">${meta}</div>
      ${otherGym ? `<div class="target">Anderes Gym, Gewichte evtl. nicht vergleichbar</div>` : ''}</div>
      <button class="icon-btn" data-a="itemMenu" data-i="${i}" aria-label="Optionen">⋯</button></div>
    ${it.note !== undefined ? `<input class="inote" data-f="inote" data-i="${i}" value="${esc(it.note)}" placeholder="z. B. Hackenschmidt, Gerät belegt, Sitz Stufe 4">` : ''}
    <div class="sets">
      <div class="set head"><span></span><span>${cardio ? 'km' : 'kg'}</span><span>${cardio ? 'Minuten' : 'Wdh.'}</span><span></span></div>
      ${it.sets.map((s, j) => `<div class="set ${s.done ? 'done' : ''}">
        <span class="setno">${j + 1}</span>
        ${field(j, s, 'w', 'decimal')}${field(j, s, 'r', cardio ? 'decimal' : 'numeric')}
        <button class="check" data-a="toggleSet" data-i="${i}" data-s="${j}" aria-label="Satz abhaken">✓</button></div>`).join('')}
    </div>
    <div class="row between"><button class="link" data-a="addSet" data-i="${i}">+ Satz</button>${it.sets.length ? `<button class="link" style="color:var(--muted)" data-a="removeSet" data-i="${i}">− Satz</button>` : ''}</div>
  </section>`;
}

function histCard(w, A) {
  const p = A.per[w.id] || { vol: 0, sets: 0, prs: [] }, loc = locById(w.locationId), open = ui.histOpen === w.id;
  return `<section class="card">
    <button style="width:100%;text-align:left" data-a="toggleHist" data-id="${w.id}">
      <div class="row between"><h3>${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>${p.prs.length ? `<span class="badge">⭐ ${p.prs.length} PR</span>` : ''}</div>
      <div class="muted small">${w.noTime ? 'Aus Notizen' : fmtTime(w.start) + ' · ' + fmtDur((w.end || w.start) - w.start)}${loc ? ' · 📍 ' + esc(loc.name) : ''}</div>
      <div class="muted small">${w.items.length ? `${w.items.length} Übungen · ${p.sets} Sätze · ${fmtKg(p.vol)} · ` : (w.plan ? esc(w.plan) + ' · ' : '')}+${p.xp || 0} XP</div>
    </button>
    ${open ? `<div class="hist-sets">${w.items.map(it => `<div><b>${p.prs.includes(it.exId) ? '⭐ ' : ''}${esc(exById(it.exId).name)}</b>${it.subFor ? ` <span class="muted small">⇄ statt ${esc(exById(it.subFor).name)}</span>` : ''}<br><span class="muted">${it.sets.map(s => setStr(it.exId, s)).join(' · ')}</span>${it.note ? `<br><span class="muted small">📝 ${esc(it.note)}</span>` : ''}</div>`).join('')}
      ${w.note ? `<div class="muted">📝 ${esc(w.note)}</div>` : ''}</div>
      <div class="row" style="margin-top:10px"><button class="btn" data-a="repeatWorkout" data-id="${w.id}">Wiederholen</button><button class="btn" data-a="editTime" data-id="${w.id}">Zeit ändern</button><span class="grow"></span><button class="btn danger" data-a="deleteWorkout" data-id="${w.id}">Löschen</button></div>` : ''}
  </section>`;
}

function viewHistory() {
  const A = analyze(), ws = [...A.ws].reverse();
  if (!ws.length) return `<div class="page-title">Verlauf</div><div class="card empty"><i>📅</i>Hier erscheinen deine Trainings.</div>`;
  let out = '<div class="page-title">Verlauf</div>', m = '';
  for (const w of ws) {
    const mm = fmtDate(w.start, { month: 'long', year: 'numeric' });
    if (mm !== m) { m = mm; out += `<div class="section-title">${mm}</div>`; }
    out += histCard(w, A);
  }
  return out;
}

function viewStats() {
  const A = analyze();
  if (!A.count) return `<div class="page-title">Statistik</div><div class="card empty"><i>📈</i>Nach deinem ersten Training siehst du hier Trends, Rekorde und mehr.</div>${achCard(A)}${bodyCard()}`;
      const firstWeek = weekStart(A.ws[0].start), nWeeks = Math.max(1, Math.round((weekStart(Date.now()) - firstWeek) / (7 * DAY)) + 1);
  // Wochen-Chart
  const cur = weekStart(Date.now()), wv = [], wl = [];
  if (ui.freq === 'm') {
    const now = new Date();
    for (let i = 11; i >= 0; i--) { const m0 = new Date(now.getFullYear(), now.getMonth() - i, 1).getTime(), m1 = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
      wv.push(A.ws.filter(w => w.start >= m0 && w.start < m1).length); wl.push(i % 2 === 0 ? fmtDate(m0, { month: 'short' }).replace('.', '') : ''); }
  } else for (let i = 11; i >= 0; i--) { const k = weekStart(cur - i * 7 * DAY + 3 * DAY); wv.push(A.weeks[k] || 0); wl.push(i % 3 === 0 ? fmtDate(k, { day: 'numeric', month: 'numeric' }) : ''); }
  // Übungs-Verlauf
  const used = [...new Set(A.ws.flatMap(w => w.items.map(i => i.exId)))].filter(id => !isCardio(id));
  if (!used.includes(ui.statEx)) ui.statEx = used.sort((a, b) => A.ws.filter(w => w.items.some(i => i.exId === b)).length - A.ws.filter(w => w.items.some(i => i.exId === a)).length)[0];
  // Bei Geräten: pro Gym filtern (Standard = Gym der letzten Einheit)
  const exLocs = [...new Set(A.ws.filter(w => w.items.some(i => i.exId === ui.statEx)).map(w => w.locationId || ''))];
  const gymFilter = isMachine(ui.statEx) && exLocs.length > 1;
  if (ui.statLocFor !== ui.statEx) { ui.statLocFor = ui.statEx; ui.statLoc = gymFilter ? exLocs[exLocs.length - 1] : null; }
  if (!gymFilter) ui.statLoc = null;
  const pts = []; let b = null;
  for (const w of A.ws) {
    if (ui.statLoc !== null && (w.locationId || '') !== ui.statLoc) continue;
    const it = w.items.find(i => i.exId === ui.statEx); if (!it) continue;
    it.sets.forEach(s => { const e = e1rm(num(s.w), num(s.r)); if (s.done && e && (!b || e > b.e1rm)) b = { e1rm: e, w: num(s.w), r: num(s.r) }; });
    const done = it.sets.filter(s => s.done); if (!done.length) continue;
    let y = 0;
    if (ui.statMetric === 'e1rm') y = Math.max(...done.map(s => e1rm(num(s.w), num(s.r))));
    else if (ui.statMetric === 'max') y = Math.max(...done.map(s => num(s.w)));
    else y = done.reduce((a, s) => a + num(s.w) * num(s.r), 0);
    pts.push({ x: w.start, y: Math.round(y * 10) / 10 });
  }
  const trend = pts.length >= 2 ? ((pts[pts.length - 1].y - pts[0].y) / (pts[0].y || 1) * 100) : null;
  // Muskelgruppen 30 Tage
  const mus = {}; A.ws.filter(w => w.start > Date.now() - 30 * DAY).forEach(w => w.items.forEach(it => { const m = exById(it.exId).muscle; mus[m] = (mus[m] || 0) + it.sets.filter(s => s.done).length; }));
  const musE = Object.entries(mus).sort((a, b) => b[1] - a[1]), musMax = Math.max(1, ...musE.map(e => e[1]));
  // Orte
  const lc = {}; A.ws.forEach(w => { if (w.locationId) { lc[w.locationId] ||= { n: 0, last: 0 }; lc[w.locationId].n++; lc[w.locationId].last = w.start; } });
  const lcE = Object.entries(lc).sort((a, b) => b[1].n - a[1].n);
  return `<div class="page-title">Statistik</div>
  <div class="tiles">
    <div class="tile"><b>${A.count}</b><span>Trainings</span></div>
    <div class="tile"><b>${fmt(A.count / nWeeks, 1)}</b><span>Ø pro Woche</span></div>
    <div class="tile"><b>${fmtKg(A.totalVol)}</b><span>Gesamtvolumen</span></div>
    ${A.prCount ? `<div class="tile"><b>${A.prCount}</b><span>Persönliche Rekorde</span></div>`
      : `<div class="tile"><b>${A.ws.filter(w => w.start >= new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()).length}</b><span>Trainings diesen Monat</span></div>`}
  </div>
  <section class="card"><div class="row between"><h2>Trainings</h2><div class="chips">${[['w', 'Wochen'], ['m', 'Monate']].map(([k, l]) => `<button class="chip ${(ui.freq || 'w') === k ? 'on' : ''}" data-a="freq" data-k="${k}">${l}</button>`).join('')}</div></div>
    <div class="muted small">${ui.freq === 'm' ? 'Letzte 12 Monate' : `Letzte 12 Wochen · Ziel ${S.settings.weeklyGoal}/Woche`}</div>${barChart(wv, wl, 11)}</section>
  ${used.length ? `<section class="card"><h2>Fortschritt pro Übung</h2>
    <div class="row" style="margin-top:10px"><select data-c="statEx" class="grow">${used.map(id => `<option value="${id}" ${id === ui.statEx ? 'selected' : ''}>${esc(exById(id).name)}</option>`).join('')}</select></div>
    ${gymFilter ? `<div class="chips" style="margin-top:10px">${exLocs.map(l => `<button class="chip ${ui.statLoc === l ? 'on' : ''}" data-a="statLoc" data-l="${l}">📍 ${esc(l ? (locById(l) || {}).name || 'Unbekannt' : 'Ohne Ort')}</button>`).join('')}<button class="chip ${ui.statLoc === null ? 'on' : ''}" data-a="statLoc" data-l="*">Alle</button></div>
      ${ui.statLoc === null ? '<div class="target" style="margin-top:6px">Gerät unterscheidet sich je Gym, der Vergleich pro Gym ist genauer.</div>' : ''}` : ''}
    <div class="chips" style="margin-top:10px">${[['e1rm', 'Kraft (1RM)'], ['max', 'Max. Gewicht'], ['vol', 'Volumen']].map(([k, l]) => `<button class="chip ${ui.statMetric === k ? 'on' : ''}" data-a="metric" data-m="${k}">${l}</button>`).join('')}</div>
    ${lineChart(pts, 'kg')}
    <div class="row between small" style="margin-top:6px">
      <span class="muted">${b ? `Bester Satz: <b style="color:var(--text)">${fmt(b.w)} kg × ${b.r}</b> (1RM ≈ ${fmt(b.e1rm, 1)} kg)` : ''}</span>
      ${trend !== null ? `<span class="badge ${trend >= 0 ? 'good' : ''}">${trend >= 0 ? '▲' : '▼'} ${fmt(Math.abs(trend), 0)} %</span>` : ''}</div>
  </section>` : ''}
  <section class="card"><h2>Muskelgruppen</h2><div class="muted small">Sätze in den letzten 30 Tagen</div>
    ${musE.length ? musE.map(([m, n]) => `<div class="hbar"><span>${esc(m)}</span><div class="tr"><i style="width:${n / musMax * 100}%"></i></div><b>${n}</b></div>`).join('') : '<div class="muted small" style="margin-top:8px">Keine Daten in den letzten 30 Tagen.</div>'}
  </section>
  ${lcE.length ? `<section class="card"><h2>Orte</h2>${lcE.map(([id, v]) => { const l = locById(id); return `<div class="row between" style="margin-top:10px"><span>📍 ${esc(l ? l.name : 'Unbekannt')}</span><span class="muted small">${v.n}× · zuletzt ${fmtDate(v.last, { day: 'numeric', month: 'short' })}</span></div>`; }).join('')}</section>` : ''}
  ${bodyCard()}
  ${achCard(A)}`;
}

function bodyCard() {
  const pts = [...S.body].sort((a, b) => a.date - b.date).map(b => ({ x: b.date, y: b.kg }));
  const lastB = pts[pts.length - 1];
  return `<section class="card"><div class="row between"><h2>Körpergewicht</h2>${lastB ? `<span class="muted">${fmt(lastB.y)} kg</span>` : ''}</div>
    <div class="row" style="margin-top:10px"><input id="bodyIn" inputmode="decimal" placeholder="z. B. 78,5"><button class="btn primary" data-a="addBody">Eintragen</button></div>
    ${pts.length ? lineChart(pts, 'kg') : ''}</section>`;
}
function achCard(A) {
  const list = ui.achAll ? ACH : ACH.filter(x => A.achieved.includes(x[0]));
  return `<section class="card"><div class="row between"><h2>Erfolge</h2><button class="link small" data-a="achAll">${A.achieved.length}/${ACH.length} · ${ui.achAll ? 'weniger' : 'alle zeigen'}</button></div>
    ${list.length ? '' : '<div class="muted small">Noch keine Erfolge. Dein erstes Training schaltet den ersten frei.</div>'}
    <div class="ach" style="margin-top:10px">${list.map(([id, ic, name]) => `<div class="${A.achieved.includes(id) ? '' : 'off'}"><i>${ic}</i>${name}</div>`).join('')}</div></section>`;
}

function viewPlans() {
  if (ui.editPlan) return viewPlanEdit();
  return `<div class="page-title">Trainingspläne</div>
  ${S.plans.length ? S.plans.map(p => `<section class="card">
    <div class="row between"><h3>${esc(p.name)}</h3><span class="muted small">${p.items.length} Übungen</span></div>
    <div class="muted small" style="margin-top:4px">${p.items.map(i => `${esc(exById(i.exId).name)} ${i.sets}×${esc(i.reps)}`).join(' · ')}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-a="startPlan" data-id="${p.id}">Starten</button><button class="btn" data-a="editPlan" data-id="${p.id}">Bearbeiten</button></div>
  </section>`).join('') : `<div class="card empty"><i>📋</i>Lege Pläne an, z. B. „Push“, „Pull“, „Beine“ oder „Ganzkörper A“.</div>`}
  <button class="big primary" data-a="newPlan">+ Neuer Plan</button>`;
}
function viewPlanEdit() {
  const p = ui.editPlan;
  return `<div class="row between"><button class="link" data-a="cancelPlan">‹ Zurück</button>${S.plans.some(x => x.id === p.id) ? `<button class="link danger" data-a="deletePlan">Löschen</button>` : ''}</div>
  <div class="page-title">${S.plans.some(x => x.id === p.id) ? 'Plan bearbeiten' : 'Neuer Plan'}</div>
  <section class="card"><label class="field">Name</label><input data-p="name" value="${esc(p.name)}" placeholder="z. B. Push Day"></section>
  ${p.items.map((it, i) => `<section class="card"><div class="row between"><h3 class="grow">${esc(exById(it.exId).name)}</h3>
      <button class="icon-btn" data-a="planMove" data-i="${i}">↑</button><button class="icon-btn" data-a="planRemove" data-i="${i}">✕</button></div>
    <div class="row" style="margin-top:10px"><div class="grow"><label class="field">Sätze</label><input inputmode="numeric" data-p="sets" data-i="${i}" value="${esc(it.sets)}"></div>
    <div class="grow"><label class="field">${isCardio(it.exId) ? 'Minuten' : 'Wdh. (z. B. 8–12)'}</label><input data-p="reps" data-i="${i}" value="${esc(it.reps)}"></div></div></section>`).join('')}
  <button class="big secondary" data-a="openPicker" data-target="plan">+ Übung hinzufügen</button>
  <button class="big primary" data-a="savePlan">Plan speichern</button>`;
}

function viewMore() {
  const A = analyze();
  return `<div class="page-title">Mehr</div>
  <div class="section-title">Orte</div>
  <section class="card">
    ${S.locations.length ? S.locations.map(l => `<div class="row between" style="margin-bottom:10px"><div class="grow"><b>📍 ${esc(l.name)}</b><div class="muted small">${l.lat ? 'GPS gespeichert' : 'ohne GPS'} · ${S.workouts.filter(w => w.locationId === l.id).length}× besucht</div></div>
      ${l.lat ? `<a class="icon-btn" href="https://maps.apple.com/?ll=${l.lat},${l.lng}&q=${encodeURIComponent(l.name)}" target="_blank" rel="noopener" aria-label="In Karten öffnen">🗺️</a>` : ''}
      <button class="icon-btn" data-a="renameLoc" data-id="${l.id}" aria-label="Umbenennen">✎</button><button class="icon-btn" data-a="deleteLoc" data-id="${l.id}" aria-label="Löschen">✕</button></div>`).join('') : '<div class="muted small" style="margin-bottom:10px">Noch keine Orte. Speichere dein Gym, dann wird es beim Trainingsstart automatisch erkannt.</div>'}
    <button class="btn primary" data-a="newLoc">+ Ort hinzufügen</button>
  </section>
  <div class="section-title">Übungen</div>
  <section class="card"><div class="muted small">${S.exercises.length} Übungen in deiner Liste.</div>
    <div class="row" style="margin-top:10px"><button class="btn" data-a="openPicker" data-target="manage">Übungen verwalten</button><button class="btn primary" data-a="newExercise">+ Eigene Übung</button></div></section>
  <div class="section-title">Einstellungen</div>
  <section class="card">
    <label class="field">Wochenziel (Trainings pro Woche, zählt für den Streak)</label>
    <select data-c="weeklyGoal">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option ${n === S.settings.weeklyGoal ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <label class="field">Pausentimer nach jedem Satz</label>
    <select data-c="rest">${[0, 45, 60, 90, 120, 150, 180, 240].map(n => `<option value="${n}" ${n === S.settings.rest ? 'selected' : ''}>${n ? clock(n * 1000) + ' min' : 'Aus'}</option>`).join('')}</select>
    <label class="field">Schritt für −/+ beim Gewicht</label>
    <select data-c="step">${[1, 1.25, 2.5, 5].map(n => `<option value="${n}" ${n === (S.settings.step || 2.5) ? 'selected' : ''}>${fmt(n, 2)} kg</option>`).join('')}</select>
    <label class="field">Bildschirm während des Trainings anlassen</label>
    <select data-c="wake"><option value="1" ${S.settings.wake ? 'selected' : ''}>An</option><option value="0" ${S.settings.wake ? '' : 'selected'}>Aus</option></select>
    <label class="field">Ort beim Start automatisch per GPS erkennen</label>
    <select data-c="autoLoc"><option value="1" ${S.settings.autoLoc ? 'selected' : ''}>An</option><option value="0" ${S.settings.autoLoc ? '' : 'selected'}>Aus</option></select>
  </section>
  <div class="section-title">Daten & Backup</div>
  <section class="card">
    <div class="muted small">Alle Daten liegen nur auf diesem Gerät. Exportiere ab und zu ein Backup (z. B. in iCloud Drive).</div>
    <div class="row wrap" style="margin-top:10px"><button class="btn primary" data-a="exportData">Backup exportieren</button>
      <label class="btn" style="cursor:pointer">Backup importieren<input type="file" accept="application/json,.json" id="importIn" hidden></label></div>
    <div class="muted small" style="margin-top:10px">${A.count} Trainings · ${S.body.length} Gewichtseinträge · ${S.plans.length} Pläne</div>
    <button class="link danger" data-a="resetAll" style="margin-top:6px">Alle Daten löschen</button>
  </section>
  <div class="section-title">Aufs iPhone installieren</div>
  <section class="card small muted">In Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“. Danach startet die App im Vollbild und funktioniert auch offline.</section>`;
}

const VIEWS = { home: viewHome, history: viewHistory, stats: viewStats, plans: viewPlans, more: viewMore };

/* ========== Sheets (Bottom-Modals) ========== */
// Eigener Bestätigungsdialog statt confirm(): schöner auf dem iPhone und funktioniert überall
function ask(msg, ok = 'Ja') { return new Promise(res => { ui.sheet = { type: 'confirm', msg, ok, res, prev: ui.sheet }; render(); }); }
function answer(v) { const s = ui.sheet; if (!s || s.type !== 'confirm') return; ui.sheet = s.prev || null; render(); s.res(v); }
function sheetHTML() {
  const s = ui.sheet; if (!s) return '';
  if (s.type === 'picker') return `<h2>${s.target === 'manage' ? 'Übungen verwalten' : s.target === 'swap' ? 'Ausweichen auf…' : 'Übung wählen'}</h2>
    ${s.target === 'swap' ? `<div class="muted small">Die Sätze zählen für die neue Übung, im Verlauf steht „statt ${esc(exById(S.active.items[s.idx].subFor || S.active.items[s.idx].exId).name)}“.</div>` : ''}
    ${s.target === 'manage' ? '<div class="muted small">„Gerät“: Gewichte werden nur innerhalb desselben Gyms verglichen. „Frei“: überall vergleichbar (Hanteln, Körpergewicht).</div>' : ''}
    <input id="pickQ" placeholder="Suchen…" style="margin:12px 0" autocomplete="off" value="${esc(s.q || '')}">
    <div id="pickList">${pickList(s.q || '')}</div>
    <button class="big secondary" data-a="newExercise">+ Eigene Übung anlegen</button>`;
  if (s.type === 'newEx') return `<h2>Neue Übung</h2>
    <label class="field">Name</label><input id="exName" placeholder="z. B. Kabelzug Crossover" value="${esc(s.q || '')}">
    <label class="field">Muskelgruppe</label><select id="exMuscle">${MUSCLES.map(m => `<option>${m}</option>`).join('')}</select>
    <label class="field">Ausführung</label><select id="exMachine"><option value="1">Gerät (je Gym unterschiedlich)</option><option value="0">Freie Gewichte / Körpergewicht</option></select>
    <label class="field">Art</label><select id="exKind"><option value="weight">Gewicht × Wiederholungen</option><option value="cardio">Cardio (Minuten, km)</option></select>
    <button class="big primary" data-a="saveExercise">Speichern</button>`;
  if (s.type === 'loc') return `<h2>${s.id ? 'Ort umbenennen' : 'Neuer Ort'}</h2>
    <label class="field">Name</label><input id="locName" placeholder="z. B. McFit Innenstadt" value="${esc(s.name || '')}">
    ${s.id ? '' : `<div class="muted small" style="margin-top:8px">${s.lat ? '✓ GPS-Position erkannt, der Ort wird künftig automatisch zugeordnet.' : 'Ohne GPS gespeichert. Tipp: Im Gym anlegen, dann wird er automatisch erkannt.'}</div>
    ${s.lat ? '' : `<button class="btn" style="margin-top:8px" data-a="locGps">🛰️ Aktuelle Position verwenden</button>`}`}
    <button class="big primary" data-a="saveLoc">Speichern</button>`;
  if (s.type === 'confirm') return `<h2 style="margin:4px 0 16px">${esc(s.msg)}</h2>
    <div class="row"><button class="big secondary grow" style="border-style:solid" data-a="confirmNo">Abbrechen</button><button class="big primary grow" data-a="confirmYes">${esc(s.ok)}</button></div>`;
  if (s.type === 'startChoice') return `<h2>Welcher Plan?</h2><div style="margin-top:12px">${planRows()}</div>
    <button class="list-item" data-a="startFree"><span><b>Ohne Plan</b><br><small>Übungen frei hinzufügen</small></span><span>›</span></button>
    <button class="link" data-a="newPlanHome">+ Neuen Plan erstellen</button>`;
  if (s.type === 'itemMenu') { const it = S.active.items[s.idx], n = S.active.items.length;
    return `<h2>${esc(exById(it.exId).name)}</h2><div style="margin-top:12px">
    <button class="list-item" data-a="swapItem" data-i="${s.idx}"><span>⇄ Auf andere Übung ausweichen</span><span>›</span></button>
    ${it.note === undefined ? `<button class="list-item" data-a="addNote" data-i="${s.idx}"><span>📝 Gerät / Notiz hinzufügen</span><span>›</span></button>` : ''}
    ${s.idx > 0 ? `<button class="list-item" data-a="moveItem" data-i="${s.idx}" data-d="-1"><span>↑ Nach oben</span></button>` : ''}
    ${s.idx < n - 1 ? `<button class="list-item" data-a="moveItem" data-i="${s.idx}" data-d="1"><span>↓ Nach unten</span></button>` : ''}
    <button class="list-item danger" data-a="removeItem" data-i="${s.idx}"><span>✕ Aus dem Training entfernen</span></button></div>`; }
  if (s.type === 'time') return `<h2>Zeit ändern</h2>
    <label class="field" for="tDate">Datum</label><input id="tDate" type="date" value="${s.date}">
    <div class="row"><div class="grow"><label class="field" for="tTime">Startzeit</label><input id="tTime" type="time" value="${s.time}"></div>
    <div class="grow"><label class="field" for="tDur">Dauer (Minuten)</label><input id="tDur" inputmode="numeric" value="${s.dur}" placeholder="z. B. 75"></div></div>
    <button class="big primary" data-a="saveTime">Speichern</button>`;
  if (s.type === 'summary') return `<div class="celebrate"><div class="em">${s.levelUp ? '🎉' : '💪'}</div>
    <h2>${s.levelUp ? `Level up! Jetzt Level ${s.level}` : 'Training gespeichert'}</h2>
    <div class="xp">+${s.xp} XP</div>
    <div class="muted">${s.sets} Sätze · ${fmtKg(s.vol)} · ${fmtDur(s.dur)}</div>
    ${s.dur > 3 * 3600e3 ? `<div class="target" style="margin-top:6px">Ganz schön lang. Vergessen zu beenden?</div>` : ''}
    <button class="link" data-a="editTime" data-id="${s.wid}">Zeit korrigieren</button></div>
    ${s.prs.length ? `<div class="section-title">Neue Rekorde</div><div class="card stack">${s.prs.map(id => `<div>⭐ ${esc(exById(id).name)}</div>`).join('')}</div>` : ''}
    ${s.ach.length ? `<div class="section-title">Neue Erfolge</div><div class="ach">${s.ach.map(id => { const a = ACH.find(x => x[0] === id); return `<div><i>${a[1]}</i>${a[2]}</div>`; }).join('')}</div>` : ''}
    <button class="big primary" data-a="closeSheet">Weiter</button>`;
  return '';
}
function pickList(q) {
  const qq = q.trim().toLowerCase(), manage = ui.sheet.target === 'manage';
  const first = ui.sheet.target === 'swap' ? exById(S.active.items[ui.sheet.idx].exId).muscle : null;
  const order = first ? [first, ...MUSCLES.filter(m => m !== first)] : MUSCLES;
  const list = S.exercises.filter(e => !qq || e.name.toLowerCase().includes(qq) || e.muscle.toLowerCase().includes(qq));
  if (!list.length) return `<div class="muted small" style="padding:8px 4px">Keine Treffer. Lege „${esc(q)}“ als eigene Übung an.</div>`;
  return order.map(m => { const xs = list.filter(e => e.muscle === m).sort((a, b) => a.name.localeCompare(b.name, 'de')); if (!xs.length) return '';
    return `<div class="section-title">${m}</div>` + xs.map(e => manage
      ? `<div class="list-item"><span class="grow">${esc(e.name)}</span>${e.kind === 'cardio' ? '' : `<button class="chip ${e.machine ? 'on' : ''}" data-a="toggleMachine" data-id="${e.id}">${e.machine ? 'Gerät' : 'Frei'}</button>`}<button class="icon-btn" data-a="deleteExercise" data-id="${e.id}" aria-label="Löschen">✕</button></div>`
      : `<button class="list-item" data-a="pick" data-id="${e.id}"><span>${esc(e.name)}</span><small>${e.kind === 'cardio' ? 'Cardio' : ''}</small></button>`).join('');
  }).join('');
}
function renderSheet() {
  const el = $('#sheet');
  if (!ui.sheet) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false; el.innerHTML = `<div class="panel"><div class="grab"></div>${sheetHTML()}</div>`;
}

/* ========== Render ========== */
function render() {
  const app = $('#app'), y = window.scrollY;
  const keep = app.dataset.view === ui.view + (S.active ? '1' : '0');
  app.innerHTML = (S.active && ui.view === 'home') ? viewWorkout() : VIEWS[ui.view]();
  app.dataset.view = ui.view + (S.active ? '1' : '0');
  if (keep) window.scrollTo(0, y); else window.scrollTo(0, 0);
  document.querySelectorAll('#nav button').forEach(b => { b.classList.toggle('on', b.dataset.view === ui.view); b.classList.toggle('live', b.dataset.view === 'home' && !!S.active); });
  $('#nav-home').textContent = S.active ? 'Training' : 'Heute';
  renderSheet(); renderRest(); syncWake();
}
/* Bildschirm an lassen, solange ein Training läuft (Screen Wake Lock, iOS 16.4+) */
let wakeLock = null;
async function syncWake() {
  const want = !!(S.active && S.settings.wake && document.visibilityState === 'visible' && navigator.wakeLock);
  try {
    if (want && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else if (!want && wakeLock) { const l = wakeLock; wakeLock = null; await l.release(); }
  } catch { wakeLock = null; }
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }

/* ========== Pausentimer ========== */
let audioCtx;
function beep() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach(d => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.25, audioCtx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + d + 0.2); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.21); });
    navigator.vibrate?.(300);
  } catch {}
}
function renderRest() {
  const el = $('#restbar');
  if (!ui.rest || !S.active) { el.hidden = true; return; }
  const left = ui.rest.end - Date.now();
  el.hidden = false;
  el.innerHTML = `<span>⏱️</span><span class="t">${clock(left)}</span><button data-a="restAdd" data-d="-15">−15</button><button data-a="restAdd" data-d="15">+15</button><button data-a="restSkip">Weiter</button>
    <i class="prog" style="width:${Math.max(0, left / ui.rest.total * 100)}%"></i>`;
}
setInterval(() => {
  if (S.active) { const t = $('#wtimer'); if (t) t.textContent = clock(Date.now() - S.active.start); }
  if (ui.rest) { if (Date.now() >= ui.rest.end) { ui.rest = null; beep(); toast('Pause vorbei – nächster Satz! 💪'); } renderRest(); }
}, 500);

/* ========== Ort / GPS ========== */
const geolocate = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error('nogeo'));
  navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});
function nearestLoc(pos) {
  let best = null;
  for (const l of S.locations) if (l.lat) { const d = dist(pos, l); if (d < 400 && (!best || d < best.d)) best = { l, d }; }
  return best && best.l;
}
async function detectLoc(silent) {
  try {
    const pos = await geolocate(); if (!S.active) return;
    const l = nearestLoc(pos);
    if (l) { S.active.locationId = l.id; refillForGym(); save(); render(); toast(`📍 ${l.name}`); }
    else if (!silent) { ui.sheet = { type: 'loc', lat: pos.lat, lng: pos.lng, forWorkout: true }; render(); }
  } catch { if (!silent) toast('Standort nicht verfügbar. Bitte Ort manuell wählen.'); }
}

/* ========== Pläne: zuletzt genutzt & Vorschlag ========== */
const planLast = p => { const w = sorted().reverse().find(w => w.planId === p.id || (!w.planId && w.plan === p.name)); return w ? w.start : 0; };
const nextPlanId = () => S.plans.length ? [...S.plans].sort((a, b) => planLast(a) - planLast(b))[0].id : null;
function planRows() {
  const nx = nextPlanId();
  return S.plans.map(p => { const l = planLast(p);
    return `<button class="list-item" data-a="startPlan" data-id="${p.id}"><span><b>${esc(p.name)}</b>${p.id === nx && S.plans.length > 1 ? ' <span class="badge">Als Nächstes</span>' : ''}<br><small>${p.items.length} Übungen · ${l ? 'zuletzt ' + fmtDate(l, { day: 'numeric', month: 'short', year: new Date(l).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : 'noch nie'}</small></span><span class="badge good">Start ›</span></button>`; }).join('');
}

/* ========== Aktionen ========== */
function newWorkout(items, plan) {
  S.active = { id: uid(), start: Date.now(), end: null, locationId: '', note: '', items, ...(plan ? { planId: plan.id, plan: plan.name } : {}) };
  ui.view = 'home'; save(); render();
  if (S.settings.autoLoc && S.locations.some(l => l.lat)) detectLoc(true);
}
function itemFrom(exId, n, reps, locId) {
  const prev = lastSets(exId, null, locId), sets = [];
  for (let j = 0; j < n; j++) { const p = prev && (prev.sets[j] || prev.sets[prev.sets.length - 1]); sets.push({ w: p ? p.w : '', r: reps && !/[^\d]/.test(reps) ? reps : (p && num(p.r) ? p.r : (parseInt(reps) || '')), done: false }); }
  return { exId, sets, target: reps ? `${n} × ${reps}` : '' };
}
// Gym gewechselt: offene Sätze an Geräten mit den Werten aus diesem Gym vorbelegen
function refillForGym() {
  for (const it of S.active.items) {
    if (!isMachine(it.exId)) continue;
    const prev = lastSets(it.exId, S.active.id, S.active.locationId);
    if (!prev || prev.locId !== S.active.locationId) continue;
    it.sets.forEach((s, j) => { if (!s.done) { const p = prev.sets[j] || prev.sets[prev.sets.length - 1]; s.w = p.w; } });
  }
}
async function finish() {
  const w = S.active;
  w.items = w.items.map(it => ({ exId: it.exId, ...(it.subFor ? { subFor: it.subFor } : {}), ...(it.note ? { note: it.note.trim() } : {}), sets: it.sets.filter(s => s.done).map(s => ({ w: num(s.w), r: num(s.r), done: true })) })).filter(it => it.sets.length);
  if (!w.items.length) { if (!await ask('Keine abgehakten Sätze. Training verwerfen?')) return; S.active = null; ui.rest = null; save(); render(); return; }
  w.end = Date.now();
  const before = analyze();
  S.workouts.push(w); S.active = null; ui.rest = null;
  const after = analyze(), p = after.per[w.id];
  ui.sheet = { type: 'summary', wid: w.id, xp: after.xp - before.xp, sets: p.sets, vol: p.vol, dur: w.end - w.start, prs: p.prs,
    ach: after.achieved.filter(a => !before.achieved.includes(a)), levelUp: after.level.level > before.level.level, level: after.level.level };
  save(); render();
}

const ACT = {
  go: d => { ui.view = d.view; ui.planReturn = false; ui.editPlan = d.view === 'plans' ? ui.editPlan : null; render(); },
  startFree: () => { ui.sheet = null; newWorkout([]); },
  startPlan: async d => { const p = S.plans.find(x => x.id === d.id); if (!p) return; if (S.active && !await ask('Es läuft bereits ein Training. Ersetzen?')) return; ui.sheet = null; newWorkout(p.items.map(i => itemFrom(i.exId, Math.max(1, num(i.sets) || 3), String(i.reps || ''))), p); },
  startChoice: () => { if (!S.plans.length) return newWorkout([]); ui.sheet = { type: 'startChoice' }; render(); },
  newPlanHome: () => { ui.sheet = null; ui.planReturn = true; ui.view = 'plans'; ui.editPlan = { id: uid(), name: '', items: [] }; render(); },
  editTime: d => { const w = S.workouts.find(x => x.id === d.id); if (!w) return;
    const dt = new Date(w.start), pad = n => String(n).padStart(2, '0');
    ui.sheet = { type: 'time', id: w.id, date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, time: w.noTime ? '' : `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      dur: w.end && !w.noTime ? Math.max(1, Math.round((w.end - w.start) / 6e4)) : '' }; render(); },
  saveTime: () => {
    const w = S.workouts.find(x => x.id === ui.sheet.id), date = $('#tDate').value, time = $('#tTime').value, dur = Math.round(num($('#tDur').value));
    if (!date) return toast('Bitte ein Datum wählen');
    if (dur < 0 || dur > 600) return toast('Dauer bitte in Minuten (max. 600)');
    const [y, m, dd] = date.split('-').map(Number), [hh, mi] = (time || '18:00').split(':').map(Number);
    w.start = new Date(y, m - 1, dd, hh, mi).getTime(); w.noTime = !time && !dur; w.end = dur ? w.start + dur * 6e4 : (w.noTime ? null : w.start);
    ui.sheet = null; save(); render(); toast('Zeit gespeichert');
  },
  repeatWorkout: async d => { const w = S.workouts.find(x => x.id === d.id); if (!w) return; if (S.active && !await ask('Es läuft bereits ein Training. Ersetzen?')) return; newWorkout(w.items.map(i => itemFrom(i.exId, i.sets.length))); },
  cancelWorkout: async () => { if (await ask('Training verwerfen? Eingaben gehen verloren.')) { S.active = null; ui.rest = null; save(); render(); } },
  finishWorkout: finish,
  openPicker: d => { ui.sheet = { type: 'picker', target: d.target, q: '' }; render(); },
  pick: d => {
    const target = ui.sheet.target; ui.sheet_idx = ui.sheet.idx; ui.sheet = null;
    if (target === 'swap') {
      const i = ui.sheet_idx, old = S.active.items[i], orig = old.subFor || old.exId;
      const nu = itemFrom(d.id, old.sets.length || 3, '', S.active.locationId); nu.target = old.target;
      if (d.id !== orig) nu.subFor = orig;
      S.active.items[i] = nu; save(); render(); return;
    }
    if (target === 'plan') ui.editPlan.items.push({ exId: d.id, sets: 3, reps: isCardio(d.id) ? '20' : '8–12' });
    else S.active.items.push(itemFrom(d.id, isCardio(d.id) ? 1 : 3));
    save(); render(); setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  },
  itemMenu: d => { ui.sheet = { type: 'itemMenu', idx: +d.i }; render(); },
  setLoc: d => { if (d.id === '__new') { ui.sheet = { type: 'loc', forWorkout: true }; render(); return; } S.active.locationId = d.id; refillForGym(); save(); render(); },
  step: d => { const it = S.active.items[d.i], s = it.sets[d.s], f = d.f;
    const base = s[f] !== '' && s[f] != null ? num(s[f]) : num((document.querySelector(`.set input[data-f="${f}"][data-i="${d.i}"][data-s="${d.s}"]`) || {}).placeholder);
    s[f] = String(Math.max(0, Math.round((base + +d.d * stepOf(it.exId, f)) * 100) / 100)); save(); render(); },
  swapItem: d => { ui.sheet = { type: 'picker', target: 'swap', idx: +d.i, q: '' }; render(); },
  addNote: d => { ui.sheet = null; S.active.items[d.i].note = ''; render(); const el = document.querySelector(`[data-f=inote][data-i="${d.i}"]`); el && el.focus(); },
  toggleMachine: d => { const e = S.exercises.find(x => x.id === d.id); e.machine = !e.machine; save(); $('#pickList').innerHTML = pickList(ui.sheet.q || ''); },
  freq: d => { ui.freq = d.k; render(); },
  statLoc: d => { ui.statLoc = d.l === '*' ? null : d.l; render(); },
  addSet: d => { const it = S.active.items[d.i], l = it.sets[it.sets.length - 1]; it.sets.push({ w: l ? l.w : '', r: l ? l.r : '', done: false }); save(); render(); },
  removeSet: async d => { const it = S.active.items[d.i], last = it.sets[it.sets.length - 1]; if (!last) return;
    if (last.done && !await ask(`Abgehakten Satz ${it.sets.length} löschen?`)) return; it.sets.pop(); save(); render(); },
  removeItem: async d => { ui.sheet = null; if (await ask('Übung aus dem Training entfernen?')) { S.active.items.splice(d.i, 1); save(); } render(); },
  moveItem: d => { const i = +d.i, j = i + (+d.d || -1), a = S.active.items; ui.sheet = null; if (j >= 0 && j < a.length) { [a[j], a[i]] = [a[i], a[j]]; save(); } render(); },
  toggleSet: (d, el) => {
    const s = S.active.items[d.i].sets[d.s];
    if (!s.done) {
      const row = el.closest('.set'), [wi, ri] = row.querySelectorAll('input');
      if (s.w === '' && wi.placeholder) s.w = wi.placeholder;
      if (s.r === '' && ri.placeholder) s.r = ri.placeholder;
      if (num(s.r) <= 0) { toast(isCardio(S.active.items[d.i].exId) ? 'Bitte Minuten eintragen' : 'Bitte Wiederholungen eintragen'); ri.focus(); return; }
      s.done = true;
      if (S.settings.rest > 0) ui.rest = { end: Date.now() + S.settings.rest * 1000, total: S.settings.rest * 1000 };
      try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
    } else s.done = false;
    save(); render();
    // Übung fertig → zur nächsten offenen Übung scrollen
    const items = S.active.items, i = +d.i;
    if (s.done && items[i].sets.every(x => x.done)) {
      const nx = items.findIndex((it, k) => k > i && it.sets.some(x => !x.done));
      const el = nx >= 0 && document.getElementById('ex' + nx);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    }
  },
  restAdd: d => { ui.rest.end += +d.d * 1000; ui.rest.total = Math.max(ui.rest.total, ui.rest.end - Date.now()); renderRest(); },
  restSkip: () => { ui.rest = null; renderRest(); },
  detectLoc: () => { toast('Suche Standort…'); detectLoc(false); },
  toggleHist: d => { ui.histOpen = ui.histOpen === d.id ? null : d.id; render(); },
  deleteWorkout: async d => { if (await ask('Dieses Training endgültig löschen?')) { S.workouts = S.workouts.filter(w => w.id !== d.id); save(); render(); } },
  achAll: () => { ui.achAll = !ui.achAll; render(); },
  metric: d => { ui.statMetric = d.m; render(); },
  addBody: () => { const v = num($('#bodyIn').value); if (v < 20 || v > 400) return toast('Bitte gültiges Gewicht eingeben'); S.body.push({ id: uid(), date: Date.now(), kg: v }); save(); render(); toast('Gewicht gespeichert'); },
  newPlan: () => { ui.editPlan = { id: uid(), name: '', items: [] }; render(); },
  editPlan: d => { ui.editPlan = JSON.parse(JSON.stringify(S.plans.find(p => p.id === d.id))); render(); },
  cancelPlan: () => { if (ui.planReturn) { ui.planReturn = false; ui.view = 'home'; } ui.editPlan = null; render(); },
  planMove: d => { const i = +d.i, a = ui.editPlan.items; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; render(); } },
  planRemove: d => { ui.editPlan.items.splice(d.i, 1); render(); },
  savePlan: () => {
    const p = ui.editPlan; if (!p.name.trim()) return toast('Bitte einen Namen eingeben');
    if (!p.items.length) return toast('Füge mindestens eine Übung hinzu');
    const i = S.plans.findIndex(x => x.id === p.id); if (i >= 0) S.plans[i] = p; else S.plans.push(p);
    ui.editPlan = null; if (ui.planReturn) { ui.planReturn = false; ui.view = 'home'; } save(); render(); toast('Plan gespeichert');
  },
  deletePlan: async () => { if (await ask('Plan löschen?')) { S.plans = S.plans.filter(p => p.id !== ui.editPlan.id); ui.editPlan = null; save(); render(); } },
  newExercise: () => { const q = ui.sheet && ui.sheet.q; ui.sheet = { type: 'newEx', q, back: ui.sheet && ui.sheet.target }; render(); },
  saveExercise: () => {
    const name = $('#exName').value.trim(); if (!name) return toast('Bitte einen Namen eingeben');
    if (S.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())) return toast('Diese Übung gibt es schon');
    const ex = { id: uid(), name, muscle: $('#exMuscle').value, kind: $('#exKind').value, machine: $('#exKind').value !== 'cardio' && $('#exMachine').value === '1', custom: true };
    S.exercises.push(ex); const back = ui.sheet.back; save();
    if (back === 'workout' || back === 'plan') { ui.sheet = { type: 'picker', target: back }; ACT.pick({ id: ex.id }); }
    else { ui.sheet = null; render(); }
    toast('Übung angelegt');
  },
  deleteExercise: async d => {
    const used = S.workouts.some(w => w.items.some(i => i.exId === d.id)) || S.plans.some(p => p.items.some(i => i.exId === d.id));
    if (used) return toast('Wird in Trainings oder Plänen verwendet');
    if (await ask(`„${exById(d.id).name}“ löschen?`)) { S.exercises = S.exercises.filter(e => e.id !== d.id); save(); $('#pickList').innerHTML = pickList(ui.sheet.q || ''); }
  },
  newLoc: () => { ui.sheet = { type: 'loc' }; render(); },
  locGps: async () => { toast('Suche Standort…'); try { const p = await geolocate(); ui.sheet = { ...ui.sheet, ...p, name: $('#locName').value }; render(); } catch { toast('Standort nicht verfügbar'); } },
  renameLoc: d => { const l = locById(d.id); ui.sheet = { type: 'loc', id: l.id, name: l.name }; render(); },
  saveLoc: () => {
    const name = $('#locName').value.trim(); if (!name) return toast('Bitte einen Namen eingeben');
    const s = ui.sheet;
    if (s.id) locById(s.id).name = name;
    else { const l = { id: uid(), name, lat: s.lat || null, lng: s.lng || null }; S.locations.push(l); if (S.active && (s.forWorkout || !S.active.locationId)) S.active.locationId = l.id; }
    ui.sheet = null; save(); render(); toast('Ort gespeichert');
  },
  deleteLoc: async d => { if (await ask('Ort löschen? Trainings bleiben erhalten.')) { S.locations = S.locations.filter(l => l.id !== d.id); save(); render(); } },
  confirmYes: () => answer(true),
  confirmNo: () => answer(false),
  closeSheet: () => { ui.sheet = null; render(); },
  exportData: () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gym-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  resetAll: async () => { if (await ask('Wirklich ALLE Daten löschen?') && await ask('Sicher? Das kann nicht rückgängig gemacht werden.')) { S = fresh(); ui.rest = null; save(); render(); toast('Alle Daten gelöscht'); } }
};

/* ========== Events ========== */
document.addEventListener('click', e => {
  if (e.target.id === 'sheet') { if (ui.sheet && ui.sheet.type === 'confirm') answer(false); else if (ui.sheet && ui.sheet.type !== 'summary') { ui.sheet = null; render(); } else ACT.closeSheet(); return; }
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = ACT[el.dataset.a]; if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});
document.addEventListener('input', e => {
  const t = e.target, d = t.dataset;
  if (d.f && S.active) {
    if (d.f === 'note') S.active.note = t.value;
    else if (d.f === 'inote') S.active.items[d.i].note = t.value;
    else { S.active.items[d.i].sets[d.s][d.f] = t.value.replace(',', '.'); }
    save();
  } else if (d.p && ui.editPlan) {
    if (d.p === 'name') ui.editPlan.name = t.value; else ui.editPlan.items[d.i][d.p] = t.value;
  } else if (t.id === 'pickQ') { ui.sheet.q = t.value; $('#pickList').innerHTML = pickList(t.value); }
});
document.addEventListener('change', e => {
  const t = e.target, c = t.dataset.c;
  if (t.id === 'importIn' && t.files[0]) {
    t.files[0].text().then(async txt => {
      const d = JSON.parse(txt); if (!d || !Array.isArray(d.workouts) || !Array.isArray(d.exercises)) throw new Error();
      if (!await ask(`Backup mit ${d.workouts.length} Trainings importieren? Aktuelle Daten werden ersetzt.`)) return;
      S = Object.assign(fresh(), d); S.settings = Object.assign(fresh().settings, d.settings); save(); render(); toast('Backup importiert');
    }).catch(() => toast('Datei ist kein gültiges Backup'));
    return;
  }
  if (!c) return;
  if (c === 'loc') { if (t.value === '__new') { ui.sheet = { type: 'loc', forWorkout: true }; render(); } else { S.active.locationId = t.value; refillForGym(); save(); render(); } }
  else if (c === 'statEx') { ui.statEx = t.value; render(); }
  else if (c === 'weeklyGoal') { S.settings.weeklyGoal = +t.value; save(); }
  else if (c === 'rest') { S.settings.rest = +t.value; save(); }
  else if (c === 'step') { S.settings.step = +t.value; save(); }
  else if (c === 'wake') { S.settings.wake = t.value === '1'; save(); syncWake(); }
  else if (c === 'autoLoc') { S.settings.autoLoc = t.value === '1'; save(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.set input')) { e.preventDefault(); const ins = [...document.querySelectorAll('.set input')], i = ins.indexOf(e.target); (ins[i + 1] || e.target).focus(); }
});
// iOS-Homescreen-App: Nach Tastatur, App-Wechsel oder Systemdialogen meldet iOS manchmal eine zu kleine
// Fensterhöhe (meist um die Statusleiste). Dann rutscht die untere Leiste nach oben. Wir messen die Lücke
// zum echten Bildschirmrand und gleichen sie über --vv-gap aus.
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
function isTyping() { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }
function fixViewport() {
  let gap = 0;
  if (isStandalone && !isTyping()) {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const sh = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    gap = Math.round(sh - window.innerHeight);
    if (gap < 0 || gap > 80) gap = 0;
  }
  document.documentElement.style.setProperty('--vv-gap', gap + 'px');
}
function settleViewport() {
  setTimeout(() => { if (!isTyping()) window.scrollTo(window.scrollX, window.scrollY); fixViewport(); }, 120);
  setTimeout(fixViewport, 500);
}
if (isStandalone) {
  fixViewport();
  window.addEventListener('resize', fixViewport);
  window.visualViewport?.addEventListener('resize', fixViewport);
  window.addEventListener('orientationchange', settleViewport);
  window.addEventListener('pageshow', settleViewport);
  document.addEventListener('focusout', settleViewport);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') settleViewport(); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') idbPut(JSON.parse(JSON.stringify(S))); else syncWake(); });

/* ========== Start ========== */
(async function init() {
  const d = await idbGet();
  if (d && Array.isArray(d.workouts)) { S = Object.assign(fresh(), d); S.settings = Object.assign(fresh().settings, d.settings); }
  else save();
  S.exercises.forEach(e => { if (e.machine === undefined) e.machine = e.kind !== 'cardio' && MACHINE_RX.test(e.name); });
  if (!S.settings.r2) { S.settings.rest = 0; S.settings.r2 = 1; save(); } // Pausentimer standardmäßig aus
  render();
  try { navigator.storage?.persist?.(); } catch {}
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.__NO_SW)
    navigator.serviceWorker.register('sw.js').catch(() => {});
})();
