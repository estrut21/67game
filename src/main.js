import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import './style.css';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const BASELINE_SAMPLES = 6;
const MOTION_CONFIRM_FRAMES = 2;
const LOST_HAND_RESET_FRAMES = 12;
const MIN_LIFT_DISTANCE = 0.045;
const MAX_LIFT_DISTANCE = 0.08;

const video = document.querySelector('#webcam');
const canvas = document.querySelector('#landmark-canvas');
const ctx = canvas.getContext('2d');
const startButton = document.querySelector('#start-button');
const startLabel = document.querySelector('#start-button-label');
const cameraEmpty = document.querySelector('#camera-empty');
const cameraIndicator = document.querySelector('#camera-indicator');
const cameraLabel = document.querySelector('#camera-label');
const cameraOverlay = document.querySelector('#camera-overlay');
const countdownOverlay = document.querySelector('#countdown-overlay');
const gesturePrompt = document.querySelector('#gesture-prompt');
const unicornFloater = document.querySelector('#unicorn-floater');
const unicornMessage = document.querySelector('#unicorn-message');
const errorMessage = document.querySelector('#error-message');
const scoreDisplay = document.querySelector('#score');
const scoreCaption = document.querySelector('#score-caption');
const timerDisplay = document.querySelector('#timer');
const timerFill = document.querySelector('#timer-fill');
const timerCard = document.querySelector('#timer-card');
const bestDisplay = document.querySelector('#best-score');
const statusNote = document.querySelector('#status-note');
const leaderboardList = document.querySelector('#leaderboard-list');
const playerNameInput = document.querySelector('#player-name');
const LEADERBOARD_KEY = 'sixtySevenLeaderboard';
const PLAYER_NAME_KEY = 'sixtySevenPlayerName';

let handLandmarker;
let drawingUtils;
let stream;
let animationFrame = 0;
let gameActive = false;
let selectedDuration = 30;
let timeRemaining = selectedDuration;
let score = 0;
let lastFrameTime = -1;
let handMovements = new Map();
let trackingMissFrames = 0;
let lastTick = 0;
let unicornTimeout = 0;
let bestScore = Number(localStorage.getItem('sixtySevenBest') || 0);
let leaderboard = loadLeaderboard();

bestDisplay.innerHTML = `${String(bestScore).padStart(2, '0')} <span>REPS</span>`;
playerNameInput.value = localStorage.getItem(PLAYER_NAME_KEY) || '';
renderLeaderboard();
updateTimer();

playerNameInput.addEventListener('input', () => {
  localStorage.setItem(PLAYER_NAME_KEY, playerNameInput.value.trim().slice(0, 16));
});

for (const option of document.querySelectorAll('.duration-option')) {
  option.addEventListener('click', () => {
    if (gameActive) return;
    selectedDuration = Number(option.dataset.duration);
    timeRemaining = selectedDuration;
    document.querySelector('.duration-option.is-selected')?.classList.remove('is-selected');
    option.classList.add('is-selected');
    updateTimer();
  });
}

startButton.addEventListener('click', async () => {
  errorMessage.hidden = true;
  if (gameActive) {
    endGame();
    return;
  }

  if (!playerNameInput.value.trim()) {
    showError('Enter your name before starting the game.');
    playerNameInput.focus();
    return;
  }

  startButton.disabled = true;
  startLabel.textContent = 'WAKING UP THE CAMERA…';
  try {
    if (stream && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      await beginCountdown();
      return;
    }
    if (!handLandmarker) await loadHandTracker();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    await new Promise((resolve) => {
      video.addEventListener('loadeddata', resolve, { once: true });
    });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    cameraEmpty.hidden = true;
    cameraOverlay.hidden = false;
    cameraIndicator.classList.add('is-on');
    cameraLabel.textContent = 'CAMERA CONNECTED';
    await beginCountdown();
  } catch (error) {
    startButton.disabled = false;
    startLabel.textContent = 'TRY AGAIN';
    const message = error.name === 'NotAllowedError'
      ? 'Camera permission was blocked. Allow camera access in your browser settings, then try again.'
      : error.name === 'NotFoundError'
        ? 'No camera found. Connect a webcam and try again.'
        : `Could not start hand tracking. ${error.message || 'Check your connection and camera permissions.'}`;
    showError(message);
    stopCamera();
  }
});

async function loadHandTracker() {
  cameraLabel.textContent = 'LOADING HAND TRACKER…';
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.4,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  };
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, options);
  } catch {
    options.baseOptions.delegate = 'CPU';
    handLandmarker = await HandLandmarker.createFromOptions(vision, options);
  }
  drawingUtils = new DrawingUtils(ctx);
}

async function beginCountdown() {
  let count = 3;
  countdownOverlay.hidden = false;
  countdownOverlay.textContent = count;
  while (count > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    count -= 1;
    countdownOverlay.textContent = count === 0 ? 'GO!' : count;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  countdownOverlay.hidden = true;
  startGame();
}

function startGame() {
  gameActive = true;
  score = 0;
  timeRemaining = selectedDuration;
  handMovements = new Map();
  trackingMissFrames = 0;
  lastTick = performance.now();
  startButton.disabled = false;
  scoreDisplay.textContent = '00';
  window.clearTimeout(unicornTimeout);
  unicornFloater.hidden = true;
  unicornFloater.classList.remove('is-floating');
  scoreCaption.textContent = 'REPS, NOT REGRETS';
  timerCard.classList.remove('is-low');
  startLabel.textContent = 'END GAME';
  startButton.querySelector('.button-icon').textContent = '■';
  statusNote.innerHTML = '<span class="status-icon">✦</span><p>Start with hands low.<br /><strong>Lift up, then bring them down.</strong></p>';
  gesturePrompt.hidden = false;
  animationFrame = requestAnimationFrame(gameLoop);
}

function gameLoop(now) {
  if (!gameActive) return;
  const delta = Math.min((now - lastTick) / 1000, 0.12);
  lastTick = now;
  timeRemaining = Math.max(0, timeRemaining - delta);
  updateTimer();

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastFrameTime) {
    lastFrameTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, now);
    drawHands(result);
    readGesture(result);
  }

  if (timeRemaining <= 0) {
    endGame();
    return;
  }
  animationFrame = requestAnimationFrame(gameLoop);
}

function readGesture(result) {
  const hands = result.landmarks || [];
  if (hands.length === 0) {
    trackingMissFrames += 1;
    if (trackingMissFrames > LOST_HAND_RESET_FRAMES) {
      handMovements.clear();
    }
    cameraLabel.textContent = 'HAND NOT DETECTED';
    setGestureHint(
      trackingMissFrames > LOST_HAND_RESET_FRAMES ? 'PALM TO CAMERA · MOVE CLOSER' : 'SHOW A HAND IN FRAME',
      '↑',
    );
    return;
  }

  trackingMissFrames = 0;
  cameraLabel.textContent = `${hands.length} HAND${hands.length === 1 ? '' : 'S'} DETECTED`;
  let sawLift = false;
  let sawLower = false;
  let scoredRep = false;

  hands.forEach((landmarks, index) => {
    const handedness = result.handedness?.[index]?.[0]?.categoryName;
    const handId = handedness || `hand-${index}`;
    const palmY = (landmarks[0].y + landmarks[9].y) / 2;
    const palmLength = Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y);
    const liftDistance = Math.min(MAX_LIFT_DISTANCE, Math.max(MIN_LIFT_DISTANCE, palmLength * 0.55));
    const returnDistance = liftDistance * 0.4;
    let movement = handMovements.get(handId);
    if (!movement) {
      movement = { baseline: palmY, smoothedY: palmY, phase: 'calibrating', samples: [], confirmations: 0 };
      handMovements.set(handId, movement);
    }

    movement.smoothedY += (palmY - movement.smoothedY) * 0.55;
    if (movement.phase === 'calibrating') {
      movement.samples.push(movement.smoothedY);
      if (movement.samples.length > BASELINE_SAMPLES) movement.samples.shift();
      const sampleRange = Math.max(...movement.samples) - Math.min(...movement.samples);
      if (movement.samples.length === BASELINE_SAMPLES && sampleRange < 0.035) {
        movement.baseline = movement.samples.reduce((sum, sample) => sum + sample, 0) / movement.samples.length;
        movement.phase = 'down';
      }
      return;
    }

    if (movement.phase === 'down') {
      if (movement.smoothedY <= movement.baseline - liftDistance) {
        movement.confirmations += 1;
        if (movement.confirmations >= MOTION_CONFIRM_FRAMES) {
          movement.phase = 'up';
          movement.confirmations = 0;
          sawLift = true;
        }
      } else {
        movement.confirmations = 0;
        movement.baseline = movement.baseline * 0.99 + movement.smoothedY * 0.01;
      }
      return;
    }

    if (movement.smoothedY >= movement.baseline - returnDistance) {
      movement.confirmations += 1;
      if (movement.confirmations < MOTION_CONFIRM_FRAMES) return;
      movement.phase = 'down';
      movement.confirmations = 0;
      movement.baseline = movement.baseline * 0.7 + movement.smoothedY * 0.3;
      sawLower = true;
      scoredRep = true;
    } else {
      movement.confirmations = 0;
    }
  });

  if (scoredRep) {
    score += 1;
    scoreDisplay.textContent = String(score).padStart(2, '0');
    scoreDisplay.classList.remove('score-pop');
    requestAnimationFrame(() => scoreDisplay.classList.add('score-pop'));
    setGestureHint('NICE! LIFT AGAIN', '↑');
    statusNote.innerHTML = '<span class="status-icon">✦</span><p>ONE CLEAN 67.<br /><strong>Do it again.</strong></p>';
    if (score === 6 || score === 7) celebrateMilestone(score);
  } else if (sawLift) {
    setGestureHint('GOOD — NOW LOWER', '↓');
  } else if ([...handMovements.values()].some((movement) => movement.phase === 'calibrating')) {
    setGestureHint('HOLD STILL FOR A MOMENT', '•');
  } else if (sawLower || [...handMovements.values()].some((movement) => movement.phase === 'down')) {
    setGestureHint('LIFT YOUR HAND', '↑');
  }
}

function celebrateMilestone(milestone) {
  window.clearTimeout(unicornTimeout);
  unicornMessage.textContent = `${milestone}!`;
  unicornFloater.hidden = false;
  unicornFloater.classList.remove('is-floating');
  void unicornFloater.offsetWidth;
  unicornFloater.classList.add('is-floating');
  unicornTimeout = window.setTimeout(() => {
    unicornFloater.classList.remove('is-floating');
    unicornFloater.hidden = true;
  }, 4600);
}

function drawHands(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const landmarks of result.landmarks || []) {
    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: '#8ab3e4', lineWidth: 4,
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: '#f5f8fc', fillColor: '#244978', lineWidth: 1, radius: 3,
    });
  }
}

function setGestureHint(message, icon) {
  gesturePrompt.innerHTML = `${message} <span>${icon}</span>`;
}

function updateTimer() {
  const whole = Math.floor(timeRemaining);
  const tenth = Math.floor((timeRemaining % 1) * 10);
  timerDisplay.innerHTML = `${String(whole).padStart(2, '0')}<span>.${tenth}</span>`;
  timerFill.style.transform = `scaleX(${Math.max(0, timeRemaining / selectedDuration)})`;
  if (timeRemaining <= 5) timerCard.classList.add('is-low');
}

function endGame() {
  gameActive = false;
  cancelAnimationFrame(animationFrame);
  gesturePrompt.hidden = true;
  timerCard.classList.remove('is-low');
  saveLeaderboardScore();
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('sixtySevenBest', String(bestScore));
    bestDisplay.innerHTML = `${String(bestScore).padStart(2, '0')} <span>REPS</span>`;
  }
  scoreCaption.textContent = score === 1 ? 'ICONIC. A WHOLE REP.' : score > 1 ? 'ABSOLUTE LEGEND BEHAVIOR' : 'THE WARM-UP DOESN’T COUNT';
  statusNote.innerHTML = `<span class="status-icon">✦</span><p>TIME’S UP.<br /><strong>${score} 67${score === 1 ? '' : 's'} in the books.</strong></p>`;
  startLabel.textContent = 'PLAY AGAIN';
  startButton.querySelector('.button-icon').textContent = '↻';
  cameraLabel.textContent = 'ROUND COMPLETE';
  updateTimer();
}

function loadLeaderboard() {
  try {
    const saved = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((entry) => Number.isFinite(entry.score) && typeof entry.name === 'string')
      .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function saveLeaderboardScore() {
  const name = playerNameInput.value.trim().slice(0, 16) || 'YOU';
  leaderboard.push({ name, score, duration: selectedDuration, createdAt: Date.now() });
  leaderboard.sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  leaderboard = leaderboard.slice(0, 5);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard));
  renderLeaderboard();
}

function renderLeaderboard() {
  leaderboardList.replaceChildren();
  if (leaderboard.length === 0) {
    const emptyRow = document.createElement('li');
    emptyRow.className = 'leaderboard-empty';
    emptyRow.textContent = 'No scores yet — play a round to claim the first spot.';
    leaderboardList.append(emptyRow);
    return;
  }

  leaderboard.forEach((entry, index) => {
    const row = document.createElement('li');
    row.className = 'leaderboard-row';
    const rank = document.createElement('span');
    rank.className = 'leaderboard-rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'leaderboard-player';
    name.textContent = entry.name;
    const detail = document.createElement('span');
    detail.className = 'leaderboard-duration';
    detail.textContent = `${entry.duration}s round`;
    const result = document.createElement('strong');
    result.className = 'leaderboard-score';
    result.textContent = String(entry.score).padStart(2, '0');
    row.append(rank, name, detail, result);
    leaderboardList.append(row);
  });
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }
  video.srcObject = null;
  cameraEmpty.hidden = false;
  cameraOverlay.hidden = true;
  countdownOverlay.hidden = true;
  cameraIndicator.classList.remove('is-on');
  cameraLabel.textContent = 'CAMERA STANDING BY';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}
