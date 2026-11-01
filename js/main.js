const STORAGE_KEY = "little-arcade-lanna-progress-v2";
const LEGACY_STORAGE_KEY = "little-arcade-lanna-progress-v1";

const screen = document.getElementById("screen");
const menuButton = document.getElementById("menu-button");
const secretButton = document.getElementById("secret-button");
const secretOverlay = document.getElementById("secret-overlay");
const soundToggle = document.getElementById("sound-toggle");
const volumeControl = document.getElementById("volume-control");

const state = {
  mode: "menu",
  best: loadProgress(),
  audio: {
    ctx: null,
    masterGain: null,
    musicGain: null,
    musicInterval: null,
    musicOscillators: new Set(),
    activeTrack: null,
    enabled: true,
    gainValue: 1,
  },
  games: {
    reaction: {
      started: false,
      paused: false,
      maxRounds: 5,
      currentRound: 1,
      scores: { A: 0, B: 0 },
      reactionTimes: { A: "—", B: "—" },
      signalShown: false,
      statusText: "Listo para empezar.",
      resultText: "",
      roundTimer: null,
      signalWindowTimer: null,
      remainingDelay: 0,
      signalSetAt: 0,
      startedAt: 0,
      roundsPlayed: 0,
    },
    memory: {
      started: false,
      paused: false,
      level: 0,
      score: 0,
      best: 0,
      sequence: [],
      playerIndex: 0,
      statusText: "Pulsa empezar para iniciar.",
      resultText: "",
      isShowingSequence: false,
      seqTimer: null,
    },
    survival: {
      started: false,
      paused: false,
      lives: 3,
      score: 0,
      best: 0,
      statusText: "Listo para sobrevivir.",
      resultText: "",
      loopId: null,
      player: { x: 40, y: 0, w: 28, h: 28, speed: 3.1 },
      keys: { left: false, right: false, up: false, down: false },
      enemies: [],
      spawnTimer: 0,
      lastTime: 0,
      worldWidth: 620,
      worldHeight: 320,
      flashTimer: 0,
    },
  },
  secret: {
    activeTime: { reaction: 0, memory: 0, survival: 0 },
    trigger: { reaction: 0, memory: 0, survival: 0 },
    visible: { reaction: false, memory: false, survival: false },
    lastTs: performance.now(),
    rafId: null,
    overlayOpen: false,
  },
};

function loadProgress() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "{}";
    const parsed = JSON.parse(stored);
    const hasCurrentProgress = Boolean(localStorage.getItem(STORAGE_KEY));
    return {
      reaction: Number(parsed.reaction || 0),
      memory: Number(parsed.memory || 0),
      survival: Number(parsed.survival || 0),
      proposalUnlocked: hasCurrentProgress && Boolean(parsed.proposalUnlocked),
      completed: {
        reaction: hasCurrentProgress && Boolean(parsed.completed && parsed.completed.reaction),
        memory: hasCurrentProgress && Boolean(parsed.completed && parsed.completed.memory),
        survival: hasCurrentProgress && Boolean(parsed.completed && parsed.completed.survival),
      },
    };
  } catch (error) {
    return {
      reaction: 0,
      memory: 0,
      survival: 0,
      proposalUnlocked: false,
      completed: { reaction: false, memory: false, survival: false },
    };
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.best));
}

function checkProposalUnlock() {
  const completedAll = state.best.completed.reaction && state.best.completed.memory && state.best.completed.survival;
  state.best.proposalUnlocked = completedAll;
  saveProgress();
  return completedAll;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;

  if (!state.audio.ctx) {
    state.audio.ctx = new AudioCtor();
    state.audio.masterGain = state.audio.ctx.createGain();
    state.audio.musicGain = state.audio.ctx.createGain();
    state.audio.masterGain.gain.value = state.audio.gainValue;
    state.audio.musicGain.gain.value = state.audio.enabled ? 1 : 0;
    state.audio.masterGain.connect(state.audio.ctx.destination);
    state.audio.musicGain.connect(state.audio.masterGain);
  }

  if (state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume();
  }
}

function setMasterVolume(value) {
  state.audio.gainValue = clamp(Number(value) / 100, 0, 1);
  if (state.audio.masterGain && state.audio.ctx) {
    state.audio.masterGain.gain.setTargetAtTime(state.audio.gainValue, state.audio.ctx.currentTime, 0.08);
  }
}

function setMusicVolume(value) {
  if (state.audio.musicGain && state.audio.ctx) {
    state.audio.musicGain.gain.setTargetAtTime(value, state.audio.ctx.currentTime, 0.1);
  }
}

function playTone(frequency, duration, type = "sine", volume = 0.05, delay = 0, isMusic = false) {
  if (!state.audio.ctx || !state.audio.enabled) return;

  const oscillator = state.audio.ctx.createOscillator();
  const gainNode = state.audio.ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, state.audio.ctx.currentTime + delay);
  gainNode.gain.setValueAtTime(0.0001, state.audio.ctx.currentTime + delay);
  gainNode.gain.exponentialRampToValueAtTime(volume, state.audio.ctx.currentTime + delay + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, state.audio.ctx.currentTime + delay + duration);
  oscillator.connect(gainNode);
  gainNode.connect(state.audio.musicGain || state.audio.masterGain);
  if (isMusic) {
    state.audio.musicOscillators.add(oscillator);
    oscillator.addEventListener("ended", () => state.audio.musicOscillators.delete(oscillator), { once: true });
  }
  oscillator.start(state.audio.ctx.currentTime + delay);
  oscillator.stop(state.audio.ctx.currentTime + delay + duration + 0.05);
}

function stopMusic() {
  if (state.audio.musicInterval !== null) {
    clearInterval(state.audio.musicInterval);
    state.audio.musicInterval = null;
  }
  state.audio.activeTrack = null;
  for (const oscillator of state.audio.musicOscillators) {
    try {
      oscillator.stop();
    } catch (error) {
      state.audio.musicOscillators.delete(oscillator);
    }
  }
  state.audio.musicOscillators.clear();
  if (state.audio.musicGain && state.audio.ctx) {
    state.audio.musicGain.gain.cancelScheduledValues(state.audio.ctx.currentTime);
    state.audio.musicGain.gain.setTargetAtTime(0, state.audio.ctx.currentTime, 0.1);
  }
}

function playMusic(track) {
  stopMusic();
  if (!state.audio.enabled) return;
  ensureAudio();
  state.audio.activeTrack = track;
  const patterns = {
    reaction: [440, 660, 523, 660, 587, 440],
    memory: [294, 392, 440, 392, 330, 440],
    survival: [220, 330, 247, 330, 294, 392],
    proposal: [392, 523, 659, 523, 783, 659],
  };

  const melody = patterns[track] || patterns.memory;
  let noteIndex = 0;

  if (state.audio.musicGain && state.audio.ctx) {
    state.audio.musicGain.gain.cancelScheduledValues(state.audio.ctx.currentTime);
    state.audio.musicGain.gain.setTargetAtTime(1, state.audio.ctx.currentTime, 0.2);
  }

  state.audio.musicInterval = setInterval(() => {
    if (!state.audio.enabled || state.audio.activeTrack !== track) return;
    const note = melody[noteIndex % melody.length];
    playTone(note, 0.2, "triangle", 0.12, 0, true);
    if (track === "proposal") {
      playTone(note / 2, 0.32, "sine", 0.07, 0.04, true);
    }
    noteIndex += 1;
  }, track === "proposal" ? 440 : 300);
}

function fadeOutMusic() {
  if (!state.audio.ctx || !state.audio.musicGain) return;
  state.audio.musicGain.gain.cancelScheduledValues(state.audio.ctx.currentTime);
  state.audio.musicGain.gain.setTargetAtTime(0.02, state.audio.ctx.currentTime, 0.7);
  window.setTimeout(() => stopMusic(), 850);
}

function playClickSound() {
  if (!state.audio.enabled) return;
  playTone(760, 0.07, "square", 0.03);
}

function playSuccessSound() {
  if (!state.audio.enabled) return;
  playTone(520, 0.12, "triangle", 0.04);
  playTone(680, 0.12, "triangle", 0.04, 0.06);
}

function playErrorSound() {
  if (!state.audio.enabled) return;
  playTone(180, 0.18, "sawtooth", 0.05);
}

function playStartSound() {
  if (!state.audio.enabled) return;
  playTone(440, 0.1, "triangle", 0.04);
  playTone(660, 0.14, "triangle", 0.05, 0.08);
}

function resetModeSecret(mode) {
  state.secret.activeTime[mode] = 0;
  state.secret.visible[mode] = false;
  state.secret.trigger[mode] = 135000 + Math.random() * 60000;
  secretButton.classList.add("hidden");
}

function checkSecretButtonForActiveMode() {
  const mode = state.mode;
  if (mode === "menu" || !state.games[mode] || !state.games[mode].started || state.games[mode].paused) return;
  if (!state.secret.visible[mode] && state.secret.activeTime[mode] >= state.secret.trigger[mode]) {
    state.secret.visible[mode] = true;
    secretButton.classList.remove("hidden");
  }
}

function monitorActiveTime() {
  if (state.secret.overlayOpen) {
    state.secret.lastTs = performance.now();
    state.secret.rafId = requestAnimationFrame(monitorActiveTime);
    return;
  }

  if (state.mode === "menu") {
    state.secret.lastTs = performance.now();
    return;
  }

  const mode = state.mode;
  const game = state.games[mode];
  const now = performance.now();
  if (game && game.started && !game.paused) {
    state.secret.activeTime[mode] += now - state.secret.lastTs;
    checkSecretButtonForActiveMode();
  }
  state.secret.lastTs = now;
  state.secret.rafId = requestAnimationFrame(monitorActiveTime);
}

function startSecretTracking() {
  cancelAnimationFrame(state.secret.rafId);
  state.secret.lastTs = performance.now();
  state.secret.rafId = requestAnimationFrame(monitorActiveTime);
}

function stopSecretTracking() {
  cancelAnimationFrame(state.secret.rafId);
}

function showMenu() {
  const previousMode = state.mode;
  if (previousMode !== "menu" && state.games[previousMode]) {
    if (state.games[previousMode].roundTimer) clearTimeout(state.games[previousMode].roundTimer);
    if (state.games[previousMode].signalWindowTimer) clearTimeout(state.games[previousMode].signalWindowTimer);
    if (state.games[previousMode].seqTimer) clearTimeout(state.games[previousMode].seqTimer);
    if (state.games[previousMode].loopId) cancelAnimationFrame(state.games[previousMode].loopId);
    state.games[previousMode].started = false;
    state.games[previousMode].paused = false;
  }

  state.mode = "menu";
  menuButton.classList.add("hidden");
  secretButton.classList.add("hidden");
  stopMusic();
  stopSecretTracking();
  screen.innerHTML = buildMenuHtml();
}

function openMode(mode) {
  if (mode === "proposal") {
    state.mode = "proposal";
    menuButton.classList.remove("hidden");
    secretButton.classList.add("hidden");
    startSecretReveal();
    return;
  }

  stopMusic();
  ensureAudio();
  state.mode = mode;
  resetModeSecret(mode);
  state.best.completed[mode] = true;
  checkProposalUnlock();
  state.games[mode].started = false;
  state.games[mode].paused = false;
  state.games[mode].resultText = "";
  state.games[mode].statusText = mode === "reaction" ? "Listo para empezar." : mode === "memory" ? "Pulsa empezar para iniciar." : "Listo para sobrevivir.";
  menuButton.classList.remove("hidden");
  secretButton.classList.add("hidden");
  if (mode === "reaction") {
    state.games.reaction = {
      ...state.games.reaction,
      started: false,
      paused: false,
      currentRound: 1,
      scores: { A: 0, B: 0 },
      reactionTimes: { A: "—", B: "—" },
      statusText: "Listo para empezar.",
      resultText: "",
      roundTimer: null,
      signalWindowTimer: null,
      remainingDelay: 0,
      signalSetAt: 0,
      startedAt: 0,
      roundsPlayed: 0,
    };
  }

  if (mode === "memory") {
    state.games.memory = {
      ...state.games.memory,
      started: false,
      paused: false,
      level: 0,
      score: 0,
      best: state.best.memory,
      sequence: [],
      playerIndex: 0,
      statusText: "Pulsa empezar para iniciar.",
      resultText: "",
      isShowingSequence: false,
      seqTimer: null,
    };
  }

  if (mode === "survival") {
    state.games.survival = {
      ...state.games.survival,
      started: false,
      paused: false,
      lives: 3,
      score: 0,
      best: state.best.survival,
      statusText: "Listo para sobrevivir.",
      resultText: "",
      loopId: null,
      player: { x: 40, y: 0, w: 28, h: 28, speed: 3.1 },
      keys: { left: false, right: false, up: false, down: false },
      enemies: [],
      spawnTimer: 0,
      lastTime: 0,
      flashTimer: 0,
    };
  }

  if (mode === "reaction") startReactionGame();
  if (mode === "memory") renderMemoryScreen();
  if (mode === "survival") renderSurvivalScreen();
  startSecretTracking();
  playMusic(mode);
}

function buildMenuHtml() {
  const proposalCard = state.best.proposalUnlocked
    ? `
      <article class="game-card">
        <div class="card-art reaction">${iconSvg("gamepad", "card-art-icon")}</div>
        <div>
          <h2>Modo extra</h2>
          <p>Un modo extra para probar.</p>
        </div>
        <button class="primary-button" type="button" data-mode="proposal">Descubrir</button>
      </article>
    `
    : "";

  return `
    <div class="menu-shell">
      <div class="title-wrap">
        <h1>EL PEQUEÑO ARCADE</h1>
        <p>¡Elige tu juego y diviértete!</p>
      </div>

      <div class="menu-grid">
        <article class="game-card">
          <div class="card-art reaction">${iconSvg("brain", "card-art-icon")}</div>
          <div>
            <h2>Reto psicológico</h2>
            <p>Lee la emoción, elige la respuesta correcta y supera el desafío.</p>
          </div>
          <button class="primary-button" type="button" data-mode="reaction">Jugar</button>
        </article>

        <article class="game-card">
          <div class="card-art memory">${iconSvg("cards", "card-art-icon")}</div>
          <div>
            <h2>Memoria</h2>
            <p>Observa la secuencia, repítela y sube de nivel.</p>
          </div>
          <button class="primary-button" type="button" data-mode="memory">Jugar</button>
        </article>

        <article class="game-card">
          <div class="card-art survival">${iconSvg("shield", "card-art-icon")}</div>
          <div>
            <h2>Supervivencia</h2>
            <p>Sobrevive, esquiva a los obstáculos y apunta a tu mejor marca.</p>
          </div>
          <button class="primary-button" type="button" data-mode="survival">Jugar</button>
        </article>

        ${proposalCard}
      </div>
    </div>
  `;
}

function iconSvg(name, className = "") {
  const paths = {
    brain: `<path d="M12 5.5a3.5 3.5 0 0 0-6.7-1.2A3.5 3.5 0 0 0 4 11a3.5 3.5 0 0 0 1.3 6.7A3.5 3.5 0 0 0 12 18.5"/><path d="M12 5.5a3.5 3.5 0 0 1 6.7-1.2A3.5 3.5 0 0 1 20 11a3.5 3.5 0 0 1-1.3 6.7A3.5 3.5 0 0 1 12 18.5M12 5v14M8 8.5c1.8 0 2.7 1.2 2.7 2.5M16 8.5c-1.8 0-2.7 1.2-2.7 2.5M8 15c1.7 0 2.6-.8 2.8-2M16 15c-1.7 0-2.6-.8-2.8-2"/>`,
    cards: `<rect x="6" y="5" width="13" height="16" rx="2"/><path d="M9 3h9a2 2 0 0 1 2 2v12M10 10h5M10 14h5"/>`,
    rocket: `<path d="M12 19c4.5-2.5 6.5-7.5 7-14-6.5.5-11.5 2.5-14 7l7 7Z"/><path d="M8 14l-3 1-2 4 5-1M13 18l-1 3-4 2 1-5"/><circle cx="15" cy="9" r="1.5"/>`,
    gamepad: `<path d="M6 10h12a4 4 0 0 1 3.8 5.2l-.8 2.6a2 2 0 0 1-3.3.8L15 16h-6l-2.7 2.6a2 2 0 0 1-3.3-.8l-.8-2.6A4 4 0 0 1 6 10Z"/><path d="M8 12v4M6 14h4M16.5 13.5h.01M18.5 15.5h.01"/>`,
    shield: `<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>`,
    mail: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>`,
    heart: `<path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10a4.6 4.6 0 0 1 8.8-1.7 4.6 4.6 0 0 1 8.8 1.7Z"/>`,
    sparkle: `<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1 2.5 2 1-2 1L19 21l-1-2.5-2-1 2-1 1-2.5ZM5 3l.8 2.2L8 6l-2.2.8L5 9l-.8-2.2L2 6l2.2-.8L5 3Z"/>`,
    volume: `<path d="M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18 5.5a9 9 0 0 1 0 13"/>`,
    mute: `<path d="M11 5 6 9H3v6h3l5 4V5ZM16 9l5 6M21 9l-5 6"/>`,
  };

  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function buildStartPanel(title, instructions) {
  return `
    <div class="start-screen">
      <h3>${title}</h3>
      <p>${instructions}</p>
      <ul>
        <li>Usa los controles que aparecen en la pantalla.</li>
        <li>Haz caso al patrón, al ritmo o a la emoción.</li>
        <li>Puedes pausar cuando lo necesites.</li>
      </ul>
      <button class="start-button" data-action="start-game" type="button">Empezar</button>
    </div>
  `;
}

const psychologyQuestions = [
  {
    prompt: "Marta dice: «Siento que siempre decepciono a todo el mundo». ¿Qué respuesta abre mejor la conversación?",
    options: ["¿Qué ha pasado hoy para que te sientas así?", "No es verdad, todo el mundo te quiere.", "Deberías dejar de preocuparte tanto.", "A mí también me pasa, pero se me acaba pasando."],
    correct: "¿Qué ha pasado hoy para que te sientas así?",
    explanation: "Pregunta por su experiencia sin invalidar ni apresurarte a resolverla.",
  },
  {
    prompt: "Leo está nervioso por una entrevista y dice: «No me va a salir bien». ¿Qué ayuda más?",
    options: ["¿Quieres que pensemos juntos qué te preocupa más?", "Seguro que te irá genial, no le des vueltas.", "Practica más; así se te quitarán los nervios.", "Yo estaría tranquilo, es solo una entrevista."],
    correct: "¿Quieres que pensemos juntos qué te preocupa más?",
    explanation: "Ofreces apoyo y le dejas elegir si quiere hablar o preparar algo.",
  },
  {
    prompt: "Tu amiga cancela un plan por tercera vez. ¿Cómo expresas tu molestia sin asumir sus motivos?",
    options: ["Me da pena no vernos; ¿está pasando algo o prefieres dejarlo para otro día?", "Siempre haces lo mismo, ya no cuento contigo.", "Veo que no te interesa pasar tiempo conmigo.", "No pasa nada, aunque me hayas dejado esperando."],
    correct: "Me da pena no vernos; ¿está pasando algo o prefieres dejarlo para otro día?",
    explanation: "Expresas cómo te afecta y preguntas antes de atribuirle una intención.",
  },
  {
    prompt: "Sam cuenta que está agotado, pero se ríe mientras lo dice. ¿Qué conviene hacer primero?",
    options: ["No dar por hecho que está bien y preguntarle cómo lo está llevando.", "Seguirle la broma para que no se sienta incómodo.", "Decirle que debería descansar más.", "Cambiar de tema para no hacerlo más grande."],
    correct: "No dar por hecho que está bien y preguntarle cómo lo está llevando.",
    explanation: "Una sonrisa no siempre refleja cómo se siente; preguntar evita interpretar por la otra persona.",
  },
  {
    prompt: "Nora pide consejo sobre un problema y luego responde: «Eso no me serviría». ¿Cuál es la mejor reacción?",
    options: ["Entiendo. ¿Qué tipo de ayuda te vendría mejor ahora?", "Entonces no sé para qué me preguntas.", "Bueno, prueba igualmente; quizá te sorprenda.", "Tienes razón, no debería haberte dicho nada."],
    correct: "Entiendo. ¿Qué tipo de ayuda te vendría mejor ahora?",
    explanation: "Aclaras qué necesita en lugar de defender tu consejo o retirarte de golpe.",
  },
  {
    prompt: "Después de un desacuerdo, Alex se queda callado. ¿Qué opción respeta mejor la situación?",
    options: ["Darle un momento y decirle que estás disponible cuando quiera retomarlo.", "Insistir hasta que te diga exactamente qué piensa.", "Concluir que ya no quiere hablar contigo.", "Actuar como si el desacuerdo nunca hubiera ocurrido."],
    correct: "Darle un momento y decirle que estás disponible cuando quiera retomarlo.",
    explanation: "Respetas su espacio sin cortar la comunicación ni interpretar su silencio.",
  },
];

function renderReactionScreen() {
  const game = state.games.reaction;
  const resultMarkup = game.resultText
    ? `<div id="result-panel"><h3>Resultado</h3><p>${game.resultText}</p><div class="game-actions"><button class="primary-button" data-action="restart-reaction" type="button">Jugar otra vez</button></div></div>`
    : "";

  const currentQuestion = psychologyQuestions[game.questionIndex] || {
    prompt: "Fin del reto",
    options: [],
    correct: "",
    explanation: "",
  };

  const answersMarkup = currentQuestion.options.length
    ? currentQuestion.options
        .map(
          (option) => `
            <button class="primary-button psychology-answer${game.answered && option === game.correctAnswer ? " is-correct" : ""}${game.answered && option === game.selectedAnswer && option !== game.correctAnswer ? " is-wrong" : ""}" type="button" data-action="answer-psychology" data-answer="${option}" ${game.answered || game.paused ? "disabled" : ""}>${option}</button>
          `
        )
        .join("")
    : "";

  screen.innerHTML = `
    <div class="mode-shell">
      <div class="panel">
        <div class="duel-header">
          <div class="duel-title">Reto psicológico</div>
          <div class="game-actions">
            <button class="secondary-button" data-action="toggle-reaction-pause" type="button">${game.paused ? "Reanudar" : "Pausar"}</button>
            <button class="option-button" data-action="reset-reaction" type="button">Reiniciar</button>
          </div>
        </div>

        <div class="scoreboard">
          <div class="stat-pill">Puntuación <strong>${game.score}</strong></div>
          <div class="stat-pill">Ronda <strong>${game.questionIndex + 1}</strong></div>
          <div class="stat-pill">Mejor <strong>${game.best}</strong></div>
        </div>

        <div class="psychology-question" style="margin-top:16px;">
          <p class="psychology-prompt">${currentQuestion.prompt}</p>
          <div class="game-actions" style="justify-content:center; flex-wrap:wrap;">
            ${answersMarkup}
          </div>
          ${game.answered ? `<p class="psychology-feedback" role="status">${game.statusText} ${currentQuestion.explanation}</p>` : ""}
          ${game.answered ? `<button class="primary-button" type="button" data-action="continue-psychology">${game.questionIndex + 1 === psychologyQuestions.length ? "Ver resultado" : "Siguiente pregunta"}</button>` : ""}
        </div>

        ${!game.answered ? `<div class="arena-status">${game.statusText}</div>` : ""}
        ${resultMarkup}
      </div>
    </div>
  `;
}

function nextPsychologyQuestion() {
  const game = state.games.reaction;
  const total = psychologyQuestions.length;
  if (game.questionIndex >= total) {
    game.started = false;
    game.resultText = `Completaste el reto con ${game.score} puntos. ¡Muy bien!`;
    game.best = Math.max(game.best, game.score);
    state.best.reaction = Math.max(state.best.reaction, game.score);
    checkProposalUnlock();
    saveProgress();
    game.statusText = "Reto completado";
    renderReactionScreen();
    playSuccessSound();
    return;
  }

  const question = psychologyQuestions[game.questionIndex];
  game.prompt = question.prompt;
  game.options = question.options;
  game.correctAnswer = question.correct;
  game.answered = false;
  game.selectedAnswer = null;
  game.statusText = "Elige la opción correcta.";
  renderReactionScreen();
}

function answerPsychologyChoice(selected) {
  const game = state.games.reaction;
  if (!game.started || game.paused || game.answered) return;

  const isCorrect = selected === game.correctAnswer;
  game.answered = true;
  game.selectedAnswer = selected;
  if (isCorrect) {
    game.score += 20;
    game.statusText = "¡Buena lectura!";
    playSuccessSound();
  } else {
    game.score = Math.max(0, game.score - 8);
    game.statusText = `La respuesta más empática era: ${game.correctAnswer}.`;
    playErrorSound();
  }

  game.best = Math.max(game.best, game.score);
  state.best.reaction = Math.max(state.best.reaction, game.score);
  saveProgress();
  renderReactionScreen();
}

function continuePsychologyGame() {
  const game = state.games.reaction;
  if (!game.started || !game.answered) return;
  game.questionIndex += 1;
  nextPsychologyQuestion();
}

function startReactionGame() {
  const game = state.games.reaction;
  game.started = true;
  game.paused = false;
  game.score = 0;
  game.best = state.best.reaction;
  game.questionIndex = 0;
  game.resultText = "";
  game.statusText = "Elige la respuesta correcta.";
  nextPsychologyQuestion();
}

function toggleReactionPause() {
  const game = state.games.reaction;
  if (!game.started) return;
  game.paused = !game.paused;
  game.statusText = game.paused ? "Juego pausado" : "Sigue con el reto";
  renderReactionScreen();
}

function renderMemoryScreen() {
  const game = state.games.memory;
  const resultMarkup = game.resultText
    ? `<div id="result-panel"><h3>Fin del juego</h3><p>${game.resultText}</p><div class="game-actions"><button class="primary-button" data-action="restart-memory" type="button">Jugar otra vez</button></div></div>`
    : "";

  screen.innerHTML = `
    <div class="mode-shell">
      <div class="panel">
        <div class="memory-header">
          <div class="memory-title">Memoria</div>
          <div class="game-actions">
            <button class="secondary-button" data-action="toggle-memory-pause" type="button">${game.paused ? "Reanudar" : "Pausar"}</button>
            <button class="option-button" data-action="reset-memory" type="button">Reiniciar</button>
          </div>
        </div>

        <div class="scoreboard">
          <div class="stat-pill">Nivel <strong>${game.level}</strong></div>
          <div class="stat-pill">Puntuación <strong>${game.score}</strong></div>
          <div class="stat-pill">Mejor <strong>${game.best}</strong></div>
        </div>

        <div class="arena-status">${game.statusText}</div>

        <div class="memory-board" aria-label="Memory pattern buttons">
          <button class="memory-btn" data-action="memory-button" data-color="red" type="button"><span class="memory-label">Rojo</span></button>
          <button class="memory-btn" data-action="memory-button" data-color="blue" type="button"><span class="memory-label">Azul</span></button>
          <button class="memory-btn" data-action="memory-button" data-color="green" type="button"><span class="memory-label">Verde</span></button>
          <button class="memory-btn" data-action="memory-button" data-color="yellow" type="button"><span class="memory-label">Amarillo</span></button>
        </div>

        ${!game.started ? buildStartPanel("Memoria", "Observa la secuencia, repítela en el mismo orden y avanza de nivel.") : ""}
        ${resultMarkup}
      </div>
    </div>
  `;
}

const memoryColors = ["red", "blue", "green", "yellow"];

function memoryFrequency(color) {
  const map = { red: 440, blue: 512, green: 660, yellow: 780 };
  return map[color] || 440;
}

async function playMemorySequence() {
  const game = state.games.memory;
  if (!game.started || game.paused) return;
  game.isShowingSequence = true;
  game.statusText = "Mira bien...";
  renderMemoryScreen();
  for (const color of game.sequence) {
    if (!game.started || game.paused) return;
    const button = document.querySelector(`.memory-btn[data-color="${color}"]`);
    if (button) {
      button.classList.add("active");
      playTone(memoryFrequency(color), 0.18, "triangle", 0.05);
      await wait(420);
      button.classList.remove("active");
      await wait(180);
    }
  }

  if (!game.started || game.paused) return;
  game.isShowingSequence = false;
  game.statusText = "¡Tu turno!";
  renderMemoryScreen();
}

function startMemoryGame() {
  const game = state.games.memory;
  game.started = true;
  game.paused = false;
  game.level = 0;
  game.score = 0;
  game.sequence = [];
  game.playerIndex = 0;
  game.resultText = "";
  game.statusText = "Mira bien...";
  nextMemoryRound();
}

function nextMemoryRound() {
  const game = state.games.memory;
  game.sequence.push(memoryColors[Math.floor(Math.random() * memoryColors.length)]);
  game.playerIndex = 0;
  game.level = game.sequence.length;
  game.statusText = "Mira bien...";
  renderMemoryScreen();
  playMemorySequence();
}

function handleMemoryInput(color) {
  const game = state.games.memory;
  if (!game.started || game.paused || game.isShowingSequence) return;
  const expected = game.sequence[game.playerIndex];
  if (color === expected) {
    playSuccessSound();
    game.playerIndex += 1;
    game.score += 12 + game.level * 5;
    game.best = Math.max(game.best, game.score);
    state.best.memory = Math.max(state.best.memory, game.best);
    if (game.playerIndex >= game.sequence.length) {
      game.statusText = "¡Perfecto! Siguiente nivel...";
      saveProgress();
      renderMemoryScreen();
      setTimeout(() => {
        if (state.mode === "memory" && state.games.memory.started && !state.games.memory.paused) {
          nextMemoryRound();
        }
      }, 500);
      return;
    }
  } else {
    game.started = false;
    game.resultText = `Fallaste la secuencia. Alcanzaste el nivel ${game.level} con ${game.score} puntos.`;
    game.best = Math.max(game.best, game.score);
    state.best.memory = Math.max(state.best.memory, game.best);
    saveProgress();
    playErrorSound();
    renderMemoryScreen();
    return;
  }
  renderMemoryScreen();
}

function toggleMemoryPause() {
  const game = state.games.memory;
  if (!game.started) return;
  game.paused = !game.paused;
  if (game.paused) {
    game.statusText = "Pausado";
  } else {
    game.statusText = "¡Sigue así!";
    if (state.mode === "memory") {
      playMemorySequence();
    }
  }
  renderMemoryScreen();
}

function renderSurvivalScreen() {
  const game = state.games.survival;
  const resultMarkup = game.resultText
    ? `<div id="result-panel"><h3>Fin de la partida</h3><p>${game.resultText}</p><div class="game-actions"><button class="primary-button" data-action="restart-survival" type="button">Jugar otra vez</button></div></div>`
    : "";

  screen.innerHTML = `
    <div class="mode-shell">
      <div class="panel">
        <div class="survival-header">
          <div class="survival-title">Supervivencia</div>
          <div class="game-actions">
            <button class="secondary-button" data-action="toggle-survival-pause" type="button">${game.paused ? "Reanudar" : "Pausar"}</button>
            <button class="option-button" data-action="reset-survival" type="button">Reiniciar</button>
          </div>
        </div>

        <div class="scoreboard">
          <div class="stat-pill">Tiempo <strong>${Math.round(game.score / 1000)}s</strong></div>
          <div class="stat-pill">Puntos <strong>${Math.round(game.score)}</strong></div>
          <div class="stat-pill">Vidas <strong>${game.lives}</strong></div>
          <div class="stat-pill">Mejor <strong>${game.best}</strong></div>
        </div>

        <div class="canvas-wrap">
          <canvas id="survival-canvas" width="620" height="320"></canvas>
        </div>

        <div class="arena-status">${game.statusText}</div>
        ${!game.started ? buildStartPanel("Supervivencia", "Esquiva los enemigos, aguanta el mayor tiempo posible y protege tus vidas.") : ""}
        ${resultMarkup}
      </div>
    </div>
  `;

  if (game.started) {
    const canvas = document.getElementById("survival-canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      drawSurvivalFrame(ctx, game);
    }
  }
}

function startSurvivalGame() {
  const game = state.games.survival;
  game.started = true;
  game.paused = false;
  game.lives = 3;
  game.score = 0;
  game.resultText = "";
  game.statusText = "¡Sobrevive al caos!";
  game.player.x = 40;
  game.player.y = 160;
  game.enemies = [];
  game.spawnTimer = 0;
  game.lastTime = performance.now();
  game.flashTimer = 0;
  renderSurvivalScreen();
  game.loopId = requestAnimationFrame(updateSurvivalGame);
}

function toggleSurvivalPause() {
  const game = state.games.survival;
  if (!game.started) return;
  game.paused = !game.paused;
  if (game.paused) {
    game.statusText = "Pausado";
    renderSurvivalScreen();
  } else {
    game.statusText = "¡Sobrevive al caos!";
    game.lastTime = performance.now();
    game.loopId = requestAnimationFrame(updateSurvivalGame);
    renderSurvivalScreen();
  }
}

function updateSurvivalGame(timestamp) {
  const game = state.games.survival;
  if (state.mode !== "survival" || !game.started || game.paused) return;

  const delta = Math.min(32, timestamp - (game.lastTime || timestamp));
  game.lastTime = timestamp;
  const canvas = document.getElementById("survival-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const player = game.player;
  const movedX = (game.keys.right ? 1 : 0) - (game.keys.left ? 1 : 0);
  const movedY = (game.keys.down ? 1 : 0) - (game.keys.up ? 1 : 0);
  player.x += movedX * player.speed * (delta / 16.67);
  player.y += movedY * player.speed * (delta / 16.67);
  player.x = clamp(player.x, 0, game.worldWidth - player.w);
  player.y = clamp(player.y, 0, game.worldHeight - player.h);

  game.score += delta * 0.08;
  game.spawnTimer -= delta;
  if (game.spawnTimer <= 0) {
    game.enemies.push({
      x: Math.random() * (game.worldWidth - 14),
      y: -18,
      r: 10 + Math.random() * 18,
      speed: 1.6 + Math.random() * 1.7 + Math.min(game.score / 600, 4),
      hue: Math.random() * 60 + 180,
      drift: randomBetween(-1.5, 1.5),
    });
    game.spawnTimer = 1100 - Math.min(game.score * 0.4, 500);
  }

  for (let i = game.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = game.enemies[i];
    enemy.y += enemy.speed * (delta / 16.67);
    enemy.x += enemy.drift * (delta / 16.67);
    if (enemy.x < 0 || enemy.x > game.worldWidth) {
      enemy.drift *= -1;
    }

    const collision =
      player.x < enemy.x + enemy.r &&
      player.x + player.w > enemy.x &&
      player.y < enemy.y + enemy.r &&
      player.y + player.h > enemy.y;

    if (collision) {
      game.enemies.splice(i, 1);
      game.lives -= 1;
      game.flashTimer = 14;
      playErrorSound();
      if (game.lives <= 0) {
        game.started = false;
        game.score = Math.round(game.score);
        state.best.survival = Math.max(state.best.survival, game.score);
        game.best = state.best.survival;
        game.resultText = `Sobreviviste ${Math.round(game.score / 1000)} segundos y anotaste ${Math.round(game.score)} puntos.`;
        game.statusText = "Misión fallida.";
        saveProgress();
        renderSurvivalScreen();
        return;
      }
    }
  }

  drawSurvivalFrame(ctx, game);
  game.statusText = game.lives > 0 ? "¡Sobrevive al caos!" : "Misión fallida.";
  game.best = Math.max(game.best, Math.round(game.score));
  game.loopId = requestAnimationFrame(updateSurvivalGame);
}

function drawSurvivalFrame(ctx, game) {
  ctx.clearRect(0, 0, game.worldWidth, game.worldHeight);

  const bg = ctx.createRadialGradient(300, 160, 30, 300, 160, 420);
  bg.addColorStop(0, "rgba(86, 102, 180, 0.75)");
  bg.addColorStop(1, "rgba(12, 15, 32, 0.92)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, game.worldWidth, game.worldHeight);

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  for (let x = 0; x < game.worldWidth; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, game.worldHeight);
    ctx.stroke();
  }

  const player = game.player;
  ctx.fillStyle = game.flashTimer > 0 ? "#ffb6c1" : "#a6f4ff";
  ctx.fillRect(player.x, player.y, player.w, player.h);
  ctx.fillStyle = "#1d1d1d";
  ctx.fillRect(player.x + 6, player.y + 8, 5, 5);
  ctx.fillRect(player.x + 17, player.y + 8, 5, 5);

  for (const enemy of game.enemies) {
    ctx.fillStyle = `hsla(${enemy.hue}, 80%, 70%, 0.9)`;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (game.flashTimer > 0) {
    game.flashTimer -= 1;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(0, 0, game.worldWidth, game.worldHeight);
  }
}

function buildSecretRevealHtml() {
  return `
    <div class="secret-screen">
      <div class="secret-terminal"></div>
    </div>
  `;
}

function renderTerminalStages() {
  const terminal = secretOverlay.querySelector(".secret-terminal");
  if (!terminal) return;

  const lines = [
    { text: "INITIALIZING SECRET CONNECTION...", className: "green" },
    { text: "ACCESSING PRIVATE CHANNEL...", className: "white" },
    { text: "BYPASSING SECURITY...", className: "blue" },
    { text: "SEARCHING FOR SOMEONE SPECIAL...", className: "green" },
    { text: "IDENTITY CONFIRMED.", className: "white" },
  ];

  terminal.innerHTML = "";
  lines.forEach((line, index) => {
    const span = document.createElement("span");
    span.className = `terminal-line ${line.className}`;
    span.style.animationDelay = `${index * 320}ms`;
    span.textContent = line.text;
    terminal.appendChild(span);
  });

  const bar = document.createElement("div");
  bar.className = "load-bar";
  const fill = document.createElement("span");
  bar.appendChild(fill);
  terminal.appendChild(bar);
}

function startSecretReveal() {
  if (state.secret.overlayOpen) return;
  state.secret.overlayOpen = true;
  secretButton.classList.add("hidden");
  const game = state.games[state.mode];
  if (game && game.started && !game.paused) {
    if (state.mode === "reaction") game.paused = true;
    if (state.mode === "memory") game.paused = true;
    if (state.mode === "survival") game.paused = true;
  }
  fadeOutMusic();
  secretOverlay.classList.remove("hidden");
  secretOverlay.innerHTML = buildSecretRevealHtml();
  renderTerminalStages();

  setTimeout(() => {
    secretOverlay.innerHTML = `
      <div class="secret-screen proposal-screen">
        <div class="heart" style="left:10%; top:20%;">${iconSvg("heart")}</div>
        <div class="heart" style="left:70%; top:14%; animation-delay:0.9s;">${iconSvg("heart")}</div>
        <div class="heart" style="right:14%; top:30%; animation-delay:1.8s;">${iconSvg("heart")}</div>
        <div class="star" style="left:18%; top:40%;">${iconSvg("sparkle")}</div>
        <div class="star" style="right:22%; top:18%; animation-delay:0.8s;">${iconSvg("sparkle")}</div>
        <div class="star" style="left:75%; bottom:28%; animation-delay:1.5s;">${iconSvg("sparkle")}</div>
        <h1 class="proposal-title">Lanna, ¿quieres ser mi novia?</h1>
        <p class="proposal-note">Nuestro momento más bonito empezó con un juego y ahora llega este pequeño detalle.</p>
        <div class="proposal-actions">
          <button class="choice-button accept" type="button" data-action="proposal-yes">Sí, quiero</button>
          <button class="choice-button delay" type="button" data-action="proposal-no">Necesito pensarlo</button>
        </div>
      </div>
    `;
    playMusic("proposal");
  }, 4200);
}

function showProposalOutcome(kind) {
  secretOverlay.innerHTML = `
    <div class="secret-screen proposal-screen" style="justify-content:center;">
      <div class="heart" style="left:12%; top:22%;">${iconSvg("heart")}</div>
      <div class="heart" style="right:18%; top:12%; animation-delay:0.9s;">${iconSvg("heart")}</div>
      <div class="star" style="left:24%; bottom:18%;">${iconSvg("sparkle")}</div>
      <div class="star" style="right:26%; bottom:24%; animation-delay:1.1s;">${iconSvg("sparkle")}</div>
      <h1 class="proposal-title" style="font-size:clamp(2rem,4vw,3.6rem);">${kind === "yes" ? "Sabía que este momento sería especial." : "Está bien, Lanna. Lo importante es que puedas responder con el corazón y a tu propio tiempo."}</h1>
    </div>
  `;
  setTimeout(() => {
    secretOverlay.classList.add("hidden");
    secretOverlay.innerHTML = "";
    state.secret.overlayOpen = false;
    showMenu();
  }, 3200);
}

function attachEvents() {
  secretOverlay.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "proposal-yes") {
      showProposalOutcome("yes");
    } else if (action === "proposal-no") {
      showProposalOutcome("no");
    }
  });

  screen.addEventListener("change", (event) => {
    if (event.target.id === "reaction-round-select") {
      state.games.reaction.maxRounds = Number(event.target.value);
      renderReactionScreen();
    }
  });

  screen.addEventListener("click", (event) => {
    const clicked = event.target.closest("[data-mode]");
    if (clicked) {
      playClickSound();
      openMode(clicked.dataset.mode);
      return;
    }

    const actionElement = event.target.closest("[data-action]");
    const action = actionElement?.dataset.action;
    if (action === "start-game") {
      if (state.mode === "reaction") startReactionGame();
      if (state.mode === "memory") startMemoryGame();
      if (state.mode === "survival") startSurvivalGame();
      return;
    }

    if (action === "toggle-reaction-pause") toggleReactionPause();
    if (action === "reset-reaction") {
      openMode("reaction");
      return;
    }
    if (action === "restart-reaction") {
      startReactionGame();
      return;
    }
    if (action === "answer-psychology") {
      answerPsychologyChoice(actionElement.dataset.answer);
      return;
    }
    if (action === "continue-psychology") {
      continuePsychologyGame();
      return;
    }

    if (action === "toggle-memory-pause") toggleMemoryPause();
    if (action === "reset-memory") {
      openMode("memory");
      return;
    }
    if (action === "restart-memory") {
      startMemoryGame();
      return;
    }

    if (action === "toggle-survival-pause") toggleSurvivalPause();
    if (action === "reset-survival") {
      openMode("survival");
      return;
    }
    if (action === "restart-survival") {
      startSurvivalGame();
      return;
    }

    if (action === "memory-button") {
      handleMemoryInput(event.target.closest("[data-color]").dataset.color);
      return;
    }

  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (state.mode === "reaction" && state.games.reaction.started && !state.games.reaction.paused) {
      const game = state.games.reaction;
      if (key === "a" || key === "l") {
        if (!game.signalShown && !game.roundTimer) return;
        if (!game.signalShown) {
          if (game.roundTimer) clearTimeout(game.roundTimer);
          const roundWinner = key === "a" ? "B" : "A";
          const roundLoser = roundWinner === "A" ? "B" : "A";
          game.statusText = `${roundWinner} wins!`;
          game.reactionTimes[roundLoser] = "too early";
          finishReactionRound(roundWinner, roundLoser);
          event.preventDefault();
          return;
        }

        if (game.signalShown) {
          const winner = key === "a" ? "A" : "B";
          const loser = winner === "A" ? "B" : "A";
          game.reactionTimes[winner] = `${(performance.now() - game.startedAt).toFixed(0)} ms`;
          game.statusText = `${winner} wins the round!`;
          finishReactionRound(winner, loser);
          event.preventDefault();
          return;
        }
      }
    }

    if (state.mode === "survival") {
      const game = state.games.survival;
      const pressed = event.key.toLowerCase();
      if (pressed === "arrowleft" || pressed === "a") game.keys.left = true;
      if (pressed === "arrowright" || pressed === "d") game.keys.right = true;
      if (pressed === "arrowup" || pressed === "w") game.keys.up = true;
      if (pressed === "arrowdown" || pressed === "s") game.keys.down = true;
    }

    if (state.mode === "reaction") {
      if (key === "a") playClickSound();
      if (key === "l") playClickSound();
    }
  });

  document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (state.mode === "survival") {
      const game = state.games.survival;
      if (key === "arrowleft" || key === "a") game.keys.left = false;
      if (key === "arrowright" || key === "d") game.keys.right = false;
      if (key === "arrowup" || key === "w") game.keys.up = false;
      if (key === "arrowdown" || key === "s") game.keys.down = false;
    }
  });

  menuButton.addEventListener("click", () => {
    playClickSound();
    showMenu();
  });

  soundToggle.addEventListener("click", () => {
    ensureAudio();
    state.audio.enabled = !state.audio.enabled;
    soundToggle.innerHTML = iconSvg(state.audio.enabled ? "volume" : "mute", "ui-icon");
    soundToggle.setAttribute("aria-label", state.audio.enabled ? "Silenciar música" : "Activar música");
    if (state.audio.enabled) {
      const activeTrack = state.audio.activeTrack || state.mode;
      if (activeTrack && activeTrack !== "menu") playMusic(activeTrack);
      if (state.audio.musicGain && state.audio.ctx) {
        state.audio.musicGain.gain.setTargetAtTime(1, state.audio.ctx.currentTime, 0.16);
      }
    } else if (state.audio.musicGain && state.audio.ctx) {
      state.audio.musicGain.gain.setTargetAtTime(0, state.audio.ctx.currentTime, 0.16);
    }
  });

  volumeControl.addEventListener("input", (event) => {
    const nextVolume = Number(event.target.value);
    ensureAudio();
    setMasterVolume(nextVolume);
  });

  secretButton.addEventListener("click", () => {
    playClickSound();
    startSecretReveal();
  });
}

function init() {
  attachEvents();
  showMenu();
  setMasterVolume(Number(volumeControl.value));
  soundToggle.innerHTML = iconSvg(state.audio.enabled ? "volume" : "mute", "ui-icon");
  soundToggle.setAttribute("aria-label", state.audio.enabled ? "Silenciar música" : "Activar música");
}

init();
