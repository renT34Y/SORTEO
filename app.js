import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  onDisconnect,
  remove,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyGUuvTdjZY1TfyXdk9JGbc5X71tAjblM",
  authDomain: "renty1-b46cf.firebaseapp.com",
  databaseURL: "https://renty1-b46cf-default-rtdb.firebaseio.com",
  projectId: "renty1-b46cf",
  storageBucket: "renty1-b46cf.firebasestorage.app",
  messagingSenderId: "542236323481",
  appId: "1:542236323481:web:3842c967294b827fb69208"
};

const ADMIN_PASSWORD = "ADMIN2026";
const ROOM_ID = "sala-amigo-secreto";
const MIN_PLAYERS = 3;
const SPIN_MS = 5500;

const LS_SESSION = "amigoSecreto.session";
const LS_HOST = "amigoSecreto.host";
const LS_MUTE = "amigoSecreto.mute";

const REEL_SYMBOLS = ["🎁", "🧦", "🍷", "🎄", "🧸", "🔔", "💸", "🍫", "🎲", "⭐", "🎅", "🧣"];

const JOKES = [
  "Analizando quién dio calcetines el año pasado...",
  "Evitando que te toque tu ex...",
  "Calculando presupuestos ajustados...",
  "Sobornando al algoritmo...",
  "Verificando que nadie se regale a sí mismo...",
  "Descartando regalos tipo «un detalle simbólico»...",
  "Revisando quién siempre llega tarde al intercambio...",
  "Negociando con el que nunca aporta a la vaquita...",
  "Calibrando tu cara de sorpresa fingida...",
  "Escondiendo pistas del chat grupal...",
  "Mezclando nombres con un sombrero mágico...",
  "Consultando al oráculo del regalo barato...",
  "Cruzando los dedos para que no te toque el más exigente..."
];

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const roomRef = ref(db, `rooms/${ROOM_ID}`);
const path = (p) => ref(db, `rooms/${ROOM_ID}/${p}`);
const $ = (id) => document.getElementById(id);

let me = loadSession();
let isHost = localStorage.getItem(LS_HOST) === "1";
let participants = {};
let presence = {};
let roomState = { phase: "lobby" };
let offset = 0;
let currentRound = null;
let drawTimers = [];
let renderedIds = new Set();
let leaving = false;
let showingRoom = false;
let pendingNotice = "";
const ready = { state: false, participants: false };

function loadSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SESSION));
    if (raw && typeof raw.id === "string" && typeof raw.name === "string") return raw;
  } catch (e) {
    return null;
  }
  return null;
}

function saveSession() {
  localStorage.setItem(LS_SESSION, JSON.stringify(me));
}

function clearSession() {
  me = null;
  localStorage.removeItem(LS_SESSION);
}

function randInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

function makeId() {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("");
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function derange(ids) {
  let result;
  do {
    result = shuffle(ids.slice());
  } while (result.some((v, i) => v === ids[i]));
  return result;
}

function cleanName(s) {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeName(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s) {
  return s
    .toLocaleLowerCase("es")
    .replace(/(^|[\s\-'’])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase("es"));
}

function hashString(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function vibrate(pattern) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      return;
    }
  }
}

let audioCtx = null;
let muted = localStorage.getItem(LS_MUTE) === "1";

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function tone(freq, dur, type = "square", vol = 0.07, delay = 0, slideTo = null) {
  if (muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function noise(dur, vol = 0.06, freq = 2000, delay = 0) {
  if (muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}

function sfxJoin() {
  tone(523, 0.12, "triangle", 0.09);
  tone(784, 0.18, "triangle", 0.09, 0.1);
}

function sfxError() {
  tone(190, 0.25, "sawtooth", 0.08, 0, 90);
}

function sfxTick(step) {
  tone(260 + (step % 12) * 26, 0.05, "square", 0.045);
}

function sfxStop() {
  tone(150, 0.28, "sawtooth", 0.13, 0, 55);
  noise(0.12, 0.12, 700);
}

function sfxStart() {
  [330, 392, 494, 659].forEach((f, i) => tone(f, 0.14, "square", 0.07, i * 0.09));
}

function sfxJackpot() {
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.2, "triangle", 0.1, i * 0.08));
}

function sfxFanfare() {
  const notes = [523, 659, 784, 659, 784, 1047, 1319];
  notes.forEach((f, i) => tone(f, 0.22, "triangle", 0.11, i * 0.11));
  tone(262, 0.9, "sawtooth", 0.05, 0.1);
  tone(392, 0.9, "sawtooth", 0.05, 0.1);
  noise(0.5, 0.05, 6000, 0.7);
}

function sfxScratch() {
  noise(0.06, 0.035, 2500 + randInt(2500));
}

function updateSoundButton() {
  $("soundBtn").textContent = muted ? "🔇" : "🔊";
}

$("soundBtn").addEventListener("click", () => {
  muted = !muted;
  localStorage.setItem(LS_MUTE, muted ? "1" : "0");
  updateSoundButton();
  if (!muted) {
    ensureAudio();
    tone(660, 0.1, "triangle", 0.08);
  }
});

document.addEventListener(
  "pointerdown",
  () => {
    if (!muted) ensureAudio();
  },
  { passive: true }
);

updateSoundButton();

const confettiCanvas = $("confetti");
const cctx = confettiCanvas.getContext("2d");
let particles = [];
let confettiRunning = false;

function resizeConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}

window.addEventListener("resize", resizeConfetti);
resizeConfetti();

function burst(count = 160, originY = 0.35) {
  const colors = ["#ff2bd6", "#27f3ff", "#ffe14d", "#46ff9a", "#ffffff", "#ff7b3d"];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * window.innerWidth * 0.3,
      y: window.innerHeight * originY,
      vx: (Math.random() - 0.5) * 15,
      vy: -Math.random() * 15 - 4,
      g: 0.28 + Math.random() * 0.15,
      size: 6 + Math.random() * 7,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[randInt(colors.length)],
      life: 0,
      max: 140 + Math.random() * 90,
      rect: Math.random() < 0.6
    });
  }
  if (!confettiRunning) {
    confettiRunning = true;
    requestAnimationFrame(stepConfetti);
  }
}

function stepConfetti() {
  cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  particles = particles.filter((p) => p.life < p.max && p.y < window.innerHeight + 40);
  for (const p of particles) {
    p.life++;
    p.vy += p.g;
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    cctx.save();
    cctx.translate(p.x, p.y);
    cctx.rotate(p.rot);
    cctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    cctx.fillStyle = p.color;
    if (p.rect) {
      cctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else {
      cctx.beginPath();
      cctx.arc(0, 0, p.size / 3, 0, 6.28);
      cctx.fill();
    }
    cctx.restore();
  }
  if (particles.length) {
    requestAnimationFrame(stepConfetti);
  } else {
    confettiRunning = false;
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

function quake() {
  const el = $("app");
  el.classList.add("quake");
  setTimeout(() => el.classList.remove("quake"), 700);
}

document.querySelectorAll(".bulbs").forEach((bar) => {
  for (let i = 0; i < 14; i++) {
    const bulb = document.createElement("i");
    bulb.style.setProperty("--d", i);
    bar.appendChild(bulb);
  }
});

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.body.dataset.view = name;
}

function later(fn, ms) {
  drawTimers.push(setTimeout(fn, Math.max(0, ms)));
}

function every(fn, ms) {
  drawTimers.push(setInterval(fn, ms));
}

function clearDrawTimers() {
  drawTimers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
  drawTimers = [];
}

function resetRoundState() {
  clearDrawTimers();
  currentRound = null;
  showingRoom = false;
  scratch.done = true;
  $("app").classList.remove("shaking", "quake");
  $("slot").classList.remove("running", "jackpot");
}

function playDraw(elapsed) {
  clearDrawTimers();
  showView("draw");
  const t0 = Date.now();
  const reels = Array.from(document.querySelectorAll(".reel"));
  const symbols = reels.map((r) => r.firstElementChild);
  reels.forEach((r) => {
    r.classList.remove("stopped");
    r.classList.add("spinning");
  });
  $("slot").classList.remove("jackpot");
  $("slot").classList.add("running");
  $("app").classList.add("shaking");
  const names = Object.values(participants).map((p) => p.name);
  const jokeEl = $("jokeText");
  let jokeIndex = randInt(JOKES.length);
  let step = 0;
  jokeEl.textContent = JOKES[jokeIndex];
  if (elapsed < 400) sfxStart();

  every(() => {
    symbols.forEach((s, i) => {
      if (reels[i].classList.contains("spinning")) s.textContent = REEL_SYMBOLS[randInt(REEL_SYMBOLS.length)];
    });
  }, 85);

  every(() => {
    step++;
    sfxTick(step);
  }, 120);

  every(() => {
    jokeIndex = (jokeIndex + 1) % JOKES.length;
    jokeEl.textContent = JOKES[jokeIndex];
    jokeEl.classList.remove("pop");
    void jokeEl.offsetWidth;
    jokeEl.classList.add("pop");
  }, 900);

  every(() => {
    $("tickerName").textContent = names.length ? `🔎 ${names[randInt(names.length)]}` : "🔎 ???";
  }, 90);

  every(() => {
    const pct = Math.min(100, ((Date.now() - t0 + elapsed) / SPIN_MS) * 100);
    $("progressBar").style.width = `${pct}%`;
  }, 60);

  later(() => every(() => noise(0.05, 0.05, 280), 70), 3500 - elapsed);

  [3300, 4200, 5000].forEach((ms, i) => {
    later(() => {
      reels[i].classList.remove("spinning");
      reels[i].classList.add("stopped");
      symbols[i].textContent = "🎁";
      if (ms >= elapsed) sfxStop();
      vibrate(60);
    }, ms - elapsed);
  });

  later(() => {
    $("app").classList.remove("shaking");
    $("slot").classList.add("jackpot");
    $("tickerName").textContent = "🎉 ¡JACKPOT DEL DESTINO! 🎉";
    $("jokeText").textContent = "¡Ya tenemos a tu víctima... digo, a tu amigo secreto!";
    $("progressBar").style.width = "100%";
    if (elapsed < SPIN_MS + 400) sfxJackpot();
    burst(110, 0.4);
    quake();
    vibrate([120, 60, 120]);
  }, SPIN_MS + 100 - elapsed);

  later(finishDraw, SPIN_MS + 1500 - elapsed);
}

function finishDraw() {
  clearDrawTimers();
  $("slot").classList.remove("running", "jackpot");
  $("app").classList.remove("shaking");
  enterReveal();
}

async function fetchAssignment() {
  const snap = await get(path(`assignments/${me.id}`));
  return snap.exists() ? snap.val().to : null;
}

async function enterReveal() {
  const round = currentRound;
  let target = null;
  if (me && participants[me.id]) {
    try {
      target = await fetchAssignment();
    } catch (e) {
      target = null;
    }
  }
  if (round !== currentRound) return;
  showView("reveal");
  setupScratch(target);
}

const scratch = { ctx: null, canvas: null, dpr: 1, down: false, last: null, done: true, lastCheck: 0, lastSound: 0 };

function setupScratch(target) {
  const canvas = $("scratchCanvas");
  const box = $("scratch");
  const noTarget = !target;
  const hostOnly = isHost && !(me && participants[me.id]);
  $("prizeLabel").textContent = noTarget ? "Atención" : "Tu Amigo Secreto es";
  $("prizeName").textContent = target || (hostOnly ? "Eres el anfitrión y no participas" : "No encontramos tu asignación");
  $("prizeSub").textContent = noTarget ? "" : "Shhh... ¡no se lo digas a nadie!";
  $("scratchHint").textContent = noTarget ? "" : "Rasca la tarjeta con el dedo o el mouse";
  $("revealBtn").classList.toggle("hidden", noTarget);
  canvas.classList.remove("gone");
  scratch.done = true;
  requestAnimationFrame(() => {
    const rect = box.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#dfe3ee");
    grad.addColorStop(0.5, "#9aa3b8");
    grad.addColorStop(1, "#eceff6");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2 * dpr;
    for (let x = -canvas.height; x < canvas.width; x += 18 * dpr) {
      ctx.beginPath();
      ctx.moveTo(x, canvas.height);
      ctx.lineTo(x + canvas.height, 0);
      ctx.stroke();
    }
    ctx.fillStyle = "#3b2a66";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.round(canvas.width * 0.09)}px "Trebuchet MS", sans-serif`;
    ctx.fillText("RASPA AQUÍ", canvas.width / 2, canvas.height * 0.45);
    ctx.font = `700 ${Math.round(canvas.width * 0.045)}px "Trebuchet MS", sans-serif`;
    ctx.fillText("🔒 sobre clasificado", canvas.width / 2, canvas.height * 0.65);
    scratch.ctx = ctx;
    scratch.canvas = canvas;
    scratch.dpr = dpr;
    scratch.down = false;
    scratch.done = noTarget;
    if (noTarget) canvas.classList.add("gone");
  });
}

function scratchPoint(e) {
  const r = scratch.canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * scratch.dpr, y: (e.clientY - r.top) * scratch.dpr };
}

function scratchDraw(from, to) {
  const c = scratch.ctx;
  c.globalCompositeOperation = "destination-out";
  c.lineWidth = 46 * scratch.dpr;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(from.x, from.y);
  c.lineTo(to.x, to.y);
  c.stroke();
}

function checkScratch() {
  if (scratch.done || !scratch.ctx) return;
  const { width, height } = scratch.canvas;
  const data = scratch.ctx.getImageData(0, 0, width, height).data;
  let cleared = 0;
  let total = 0;
  for (let i = 3; i < data.length; i += 64) {
    total++;
    if (data[i] < 40) cleared++;
  }
  if (total && cleared / total > 0.45) completeReveal();
}

function completeReveal() {
  if (scratch.done) return;
  scratch.done = true;
  scratch.down = false;
  $("scratchCanvas").classList.add("gone");
  $("scratchHint").textContent = "¡Misión aceptada! Guarda el secreto 🤫";
  $("revealBtn").classList.add("hidden");
  sfxFanfare();
  burst(230, 0.45);
  quake();
  vibrate([80, 40, 80, 40, 220]);
}

const scratchCanvasEl = $("scratchCanvas");

scratchCanvasEl.addEventListener("pointerdown", (e) => {
  if (scratch.done || !scratch.ctx) return;
  ensureAudio();
  scratch.down = true;
  scratchCanvasEl.setPointerCapture(e.pointerId);
  const p = scratchPoint(e);
  scratch.last = p;
  scratchDraw(p, { x: p.x + 0.1, y: p.y });
  sfxScratch();
});

scratchCanvasEl.addEventListener("pointermove", (e) => {
  if (!scratch.down || scratch.done) return;
  const p = scratchPoint(e);
  scratchDraw(scratch.last, p);
  scratch.last = p;
  const now = Date.now();
  if (now - scratch.lastSound > 70) {
    scratch.lastSound = now;
    sfxScratch();
  }
  if (now - scratch.lastCheck > 220) {
    scratch.lastCheck = now;
    checkScratch();
  }
});

["pointerup", "pointercancel"].forEach((ev) =>
  scratchCanvasEl.addEventListener(ev, () => {
    if (!scratch.down) return;
    scratch.down = false;
    checkScratch();
  })
);

$("revealBtn").addEventListener("click", completeReveal);

function startRound() {
  const round = roomState.round || "ronda";
  if (currentRound === round) return;
  currentRound = round;
  showingRoom = false;
  const startedAt = Number(roomState.startedAt) || Date.now() + offset;
  const elapsed = Date.now() + offset - startedAt;
  if (elapsed >= SPIN_MS + 1600) {
    enterReveal();
  } else {
    playDraw(Math.max(0, elapsed));
  }
}

function route() {
  if (!ready.state || !ready.participants) return;
  if (me && !participants[me.id]) {
    if (!leaving) pendingNotice = "Ya no estás en la sala. Si quieres participar, vuelve a ingresar tus datos.";
    clearSession();
  }
  const inRoom = !!(me && participants[me.id]);
  $("hostBtn").classList.toggle("hidden", isHost);

  if (roomState.phase === "draw") {
    if (inRoom || isHost) {
      if (showingRoom && currentRound === (roomState.round || "ronda")) {
        showView("room");
        renderRoom();
        return;
      }
      startRound();
      return;
    }
    $("loginNotice").textContent = "El sorteo ya comenzó. Pídele al anfitrión que reinicie la sala para poder entrar.";
    showView("login");
    return;
  }

  if (currentRound) resetRoundState();
  $("loginNotice").textContent = pendingNotice;

  if (inRoom || isHost) {
    showView("room");
    renderRoom();
  } else {
    showView("login");
  }
}

function renderRoom() {
  const list = $("participantList");
  const entries = Object.entries(participants).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const n = entries.length;
  const online = entries.filter(([id]) => presence[id]).length;
  const nextIds = new Set(entries.map(([id]) => id));
  list.textContent = "";
  entries.forEach(([id, p]) => {
    const li = document.createElement("li");
    if (!renderedIds.has(id)) li.className = "enter";
    const av = document.createElement("span");
    av.className = "avatar";
    av.style.background = `hsl(${hashString(p.name) % 360} 80% 60%)`;
    av.textContent = p.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    const name = document.createElement("span");
    name.className = "pname";
    name.textContent = p.name;
    li.append(av, name);
    if (me && me.id === id) {
      const you = document.createElement("span");
      you.className = "you";
      you.textContent = "tú";
      li.appendChild(you);
    }
    const dot = document.createElement("span");
    dot.className = presence[id] ? "dot on" : "dot";
    dot.title = presence[id] ? "Conectado" : "Desconectado";
    li.appendChild(dot);
    if (isHost && roomState.phase !== "draw") {
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "kick-btn";
      kick.textContent = "✕";
      kick.title = `Eliminar a ${p.name}`;
      kick.setAttribute("aria-label", `Eliminar a ${p.name}`);
      kick.addEventListener("click", () => removeParticipant(id, p.name));
      li.appendChild(kick);
    }
    list.appendChild(li);
  });
  renderedIds = nextIds;

  $("countBadge").textContent = `${n} · ${online} en línea`;
  const drawn = roomState.phase === "draw";
  $("roomHint").textContent = drawn
    ? "El sorteo ya se realizó. Puedes ver tu resultado cuando quieras."
    : n < MIN_PLAYERS
      ? `Faltan ${MIN_PLAYERS - n} participante${MIN_PLAYERS - n === 1 ? "" : "s"} para poder iniciar.`
      : "¡Todo listo! Esperando que el anfitrión inicie el sorteo...";
  $("hostPanel").classList.toggle("hidden", !isHost);
  $("startBtn").disabled = n < MIN_PLAYERS;
  $("startBtn").textContent = drawn ? "🎲 Sortear de nuevo" : "¡Iniciar Sorteo!";
  $("endDrawBtn").classList.toggle("hidden", !drawn);
  $("seeBtn").classList.toggle("hidden", !(drawn && me && participants[me.id]));
  $("startHint").textContent = n < MIN_PLAYERS ? `Se necesitan al menos ${MIN_PLAYERS} participantes.` : "";
  $("leaveBtn").classList.toggle("hidden", drawn || !(me && participants[me.id]));
}

async function removeParticipant(id, name) {
  if (!isHost || roomState.phase === "draw") return;
  if (!window.confirm(`¿Eliminar a ${name} de la sala?`)) return;
  try {
    await update(roomRef, {
      [`participants/${id}`]: null,
      [`presence/${id}`]: null,
      [`assignments/${id}`]: null
    });
    sfxStop();
  } catch (err) {
    $("startHint").textContent = "No se pudo eliminar al participante.";
    sfxError();
  }
}

function ensurePresence() {
  if (!me || !participants[me.id] || presence[me.id]) return;
  const r = path(`presence/${me.id}`);
  onDisconnect(r).remove();
  set(r, true);
}

onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
  offset = snap.val() || 0;
});

onValue(path("state"), (snap) => {
  roomState = snap.val() || { phase: "lobby" };
  ready.state = true;
  route();
});

onValue(path("participants"), (snap) => {
  const raw = snap.val() || {};
  participants = {};
  Object.keys(raw).forEach((k) => {
    if (raw[k] && typeof raw[k].name === "string") participants[k] = raw[k];
  });
  ready.participants = true;
  ensurePresence();
  route();
});

onValue(path("presence"), (snap) => {
  presence = snap.val() || {};
  ensurePresence();
  if (document.body.dataset.view === "room") renderRoom();
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  ensureAudio();
  const errorEl = $("loginError");
  errorEl.textContent = "";
  const first = cleanName($("firstName").value);
  const last = cleanName($("lastName").value);
  const valid = /^\p{L}[\p{L}\p{M}'’\- ]*$/u;
  if (!first || !last) {
    errorEl.textContent = "Escribe tu nombre y tu apellido.";
    sfxError();
    return;
  }
  if (!valid.test(first) || !valid.test(last)) {
    errorEl.textContent = "Usa solo letras, espacios, guiones o apóstrofes.";
    sfxError();
    return;
  }
  if (roomState.phase === "draw") {
    errorEl.textContent = "El sorteo ya comenzó, no se puede entrar ahora.";
    sfxError();
    return;
  }
  const full = `${titleCase(first)} ${titleCase(last)}`;
  const norm = normalizeName(full);
  const id = makeId();
  const btn = $("joinBtn");
  btn.disabled = true;
  try {
    const res = await runTransaction(path("participants"), (current) => {
      const data = current && typeof current === "object" ? current : {};
      for (const k in data) {
        if (data[k] && typeof data[k].name === "string" && normalizeName(data[k].name) === norm) return;
      }
      data[id] = { name: full, joinedAt: Date.now() };
      return data;
    });
    if (!res.committed) {
      errorEl.textContent = "Ya hay alguien con ese nombre y apellido en la sala.";
      sfxError();
    } else {
      me = { id, name: full };
      pendingNotice = "";
      saveSession();
      sfxJoin();
      route();
    }
  } catch (err) {
    errorEl.textContent = "No se pudo conectar con la sala. Revisa tu conexión e inténtalo de nuevo.";
    sfxError();
  } finally {
    btn.disabled = false;
  }
});

$("leaveBtn").addEventListener("click", async () => {
  if (!me) return;
  const id = me.id;
  leaving = true;
  try {
    await remove(path(`participants/${id}`));
    await remove(path(`presence/${id}`));
  } catch (err) {
    clearSession();
  }
  clearSession();
  leaving = false;
  route();
});

function openModal() {
  $("hostError").textContent = "";
  $("hostPass").value = "";
  $("modal").classList.remove("hidden");
  setTimeout(() => $("hostPass").focus(), 50);
}

function closeModal() {
  $("modal").classList.add("hidden");
}

$("hostBtn").addEventListener("click", () => {
  ensureAudio();
  openModal();
});

$("hostCancel").addEventListener("click", closeModal);

$("modal").addEventListener("pointerdown", (e) => {
  if (e.target === $("modal")) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

$("hostForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if ($("hostPass").value === ADMIN_PASSWORD) {
    isHost = true;
    localStorage.setItem(LS_HOST, "1");
    closeModal();
    sfxJoin();
    route();
  } else {
    $("hostError").textContent = "Contraseña incorrecta.";
    sfxError();
    const card = $("hostForm");
    card.classList.remove("wrong");
    void card.offsetWidth;
    card.classList.add("wrong");
  }
});

$("exitHostBtn").addEventListener("click", () => {
  isHost = false;
  localStorage.removeItem(LS_HOST);
  route();
});

$("startBtn").addEventListener("click", async () => {
  if (!isHost) return;
  if (roomState.phase === "draw" && !window.confirm("¿Sortear de nuevo? Se reemplazarán los resultados actuales.")) return;
  ensureAudio();
  const btn = $("startBtn");
  btn.disabled = true;
  try {
    const snap = await get(path("participants"));
    const raw = snap.val() || {};
    const ids = Object.keys(raw).filter((k) => raw[k] && typeof raw[k].name === "string");
    if (ids.length < MIN_PLAYERS) {
      $("startHint").textContent = `Se necesitan al menos ${MIN_PLAYERS} participantes.`;
      return;
    }
    const targets = derange(ids);
    const assignments = {};
    ids.forEach((id, i) => {
      assignments[id] = { to: raw[targets[i]].name };
    });
    await update(roomRef, {
      assignments,
      state: { phase: "draw", round: makeId(), startedAt: serverTimestamp() }
    });
  } catch (err) {
    $("startHint").textContent = "No se pudo iniciar el sorteo. Inténtalo otra vez.";
    sfxError();
  } finally {
    btn.disabled = false;
    if (document.body.dataset.view === "room") renderRoom();
  }
});

$("resetBtn").addEventListener("click", async () => {
  if (!isHost) return;
  if (!window.confirm("¿Reiniciar la sala? Se borrarán los participantes y el sorteo actual.")) return;
  try {
    await set(roomRef, null);
  } catch (err) {
    $("startHint").textContent = "No se pudo reiniciar la sala.";
  }
});

$("backBtn").addEventListener("click", () => {
  showingRoom = true;
  route();
});

$("seeBtn").addEventListener("click", () => {
  showingRoom = false;
  enterReveal();
});

$("endDrawBtn").addEventListener("click", async () => {
  if (!isHost) return;
  if (!window.confirm("¿Cerrar el sorteo? Se borrarán los resultados y todos volverán a la sala de espera.")) return;
  try {
    await update(roomRef, { state: null, assignments: null });
  } catch (err) {
    $("startHint").textContent = "No se pudo cerrar el sorteo.";
    sfxError();
  }
});