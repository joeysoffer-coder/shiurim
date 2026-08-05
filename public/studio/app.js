const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const studioToken = () => sessionStorage.getItem('rjsAdminToken') || '';
function studioFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = studioToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`/api/admin/studio${path}`, { ...options, headers });
}

const ui = {
  studioView: $('#studioView'), libraryView: $('#libraryView'), newEpisode: $('#newEpisode'), recorder: $('#recorder'),
  episodeForm: $('#episodeForm'), episodeTitle: $('#episodeTitle'), titleSuggestion: $('#titleSuggestion'), activeTitle: $('#activeTitle'), saveStatus: $('#saveStatus'),
  recordButton: $('#recordButton'), pauseButton: $('#pauseButton'), stopButton: $('#stopButton'), discardButton: $('#discardButton'),
  recordingState: $('#recordingState'), timer: $('#timer'), recordHint: $('#recordHint'), micSelect: $('#micSelect'), testMic: $('#testMic'),
  inputMeter: $('#inputMeter'), liveCanvas: $('#liveCanvas'), liveWave: $('#liveWave'), editorWave: $('#editorWave'), waveCanvas: $('#waveCanvas'),
  playhead: $('#playhead'), trimShadeLeft: $('#trimShadeLeft'), trimShadeRight: $('#trimShadeRight'), inputBar: $('#inputBar'),
  editorPanel: $('#editorPanel'), publishPanel: $('#publishPanel'), playButton: $('#playButton'), currentTime: $('#currentTime'), totalTime: $('#totalTime'),
  trimStart: $('#trimStart'), trimEnd: $('#trimEnd'), trimStartValue: $('#trimStartValue'), trimEndValue: $('#trimEndValue'),
  undoEdit: $('#undoEdit'), resetEdit: $('#resetEdit'), saveEditButton: $('#saveEditButton'), editSaveHint: $('#editSaveHint'), downloadButton: $('#downloadButton'), publishButton: $('#publishButton'), publishNote: $('#publishNote'),
  trimSelectionButton: $('#trimSelectionButton'), cutSelectionButton: $('#cutSelectionButton'), recordReplacementButton: $('#recordReplacementButton'),
  insertAudioButton: $('#insertAudioButton'), insertAudioInput: $('#insertAudioInput'), continueRecordingButton: $('#continueRecordingButton'),
  sharing: $('#sharing'), dropboxDestination: $('#dropboxDestination'), soundcloudDestination: $('#soundcloudDestination'),
  dropboxStatus: $('#dropboxStatus'), soundcloudStatus: $('#soundcloudStatus'), episodeList: $('#episodeList'), emptyLibrary: $('#emptyLibrary'), episodeCount: $('#episodeCount'),
  settingsDialog: $('#settingsDialog'), settingsButton: $('#settingsButton'), newRecordingHeaderButton: $('#newRecordingHeaderButton'), confirmDialog: $('#confirmDialog'), confirmDiscard: $('#confirmDiscard'), toastRegion: $('#toastRegion'),
  clipRecorderDialog: $('#clipRecorderDialog'), clipRecorderEyebrow: $('#clipRecorderEyebrow'), clipRecorderTitle: $('#clipRecorderTitle'), clipRecorderTimer: $('#clipRecorderTimer'), clipRecorderHelp: $('#clipRecorderHelp'),
  clipPauseButton: $('#clipPauseButton'), clipStopButton: $('#clipStopButton'), clipCancelButton: $('#clipCancelButton'),
  draftCard: $('#draftCard'), draftText: $('#draftText'), openDraft: $('#openDraft'),
  loginDialog: $('#loginDialog'), loginForm: $('#loginForm'), loginPassword: $('#loginPassword'), loginError: $('#loginError'),
  installButton: $('#installButton'), offlineBanner: $('#offlineBanner')
};

const state = {
  current: null,
  mediaRecorder: null,
  stream: null,
  chunks: [],
  audioContext: null,
  analyser: null,
  source: null,
  meterFrame: null,
  buffer: null,
  player: null,
  playerUrl: null,
  timerInterval: null,
  elapsedMs: 0,
  segmentStarted: 0,
  editHistory: [],
  edits: { start: 0, end: 1, normalize: false, fade: false },
  connectionStatus: null,
  db: null,
  installPrompt: null,
  additionalMode: null
};

const metadataKey = 'podcast-studio-episodes-v1';
const getEpisodes = () => {
  try { return JSON.parse(localStorage.getItem(metadataKey) || '[]'); } catch { return []; }
};
const setEpisodes = episodes => localStorage.setItem(metadataKey, JSON.stringify(episodes));

function updateHomeDateTime() {
  const element = $('#homeDateTime');
  if (!element) return;
  const now = new Date();
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(now);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now);
  element.dateTime = now.toISOString();
  element.textContent = `${date} · ${time}`;
}

function parseNumberedEpisodeTitle(title) {
  const value = String(title || '').trim();
  let match = value.match(/^(.+?)\s+((?:episode|ep\.?)\s*#?\s*)(\d+)$/i);
  if (match) {
    const stem = match[1].trim();
    const descriptor = match[2].trim();
    return {
      stem,
      prefix: `${stem} ${descriptor}`,
      number: Number(match[3]),
      format: number => descriptor.endsWith('#') ? `${stem} ${descriptor}${number}` : `${stem} ${descriptor} ${number}`
    };
  }
  match = value.match(/^(.+?)\s*#(\d+)$/);
  if (match) {
    const stem = match[1].trim();
    return { stem, prefix: `${stem} #`, number: Number(match[2]), format: number => `${stem} #${number}` };
  }
  match = value.match(/^(.+?)\s+(\d+)$/);
  if (match) {
    const stem = match[1].trim();
    return { stem, prefix: stem, number: Number(match[2]), format: number => `${stem} ${number}` };
  }
  return null;
}

function nextEpisodeTitle(query) {
  const typed = String(query || '').trim();
  if (typed.length < 2 || /\d+\s*$/.test(typed)) return '';
  const series = new Map();
  for (const episode of getEpisodes()) {
    const parsed = parseNumberedEpisodeTitle(episode.title);
    if (!parsed) continue;
    const key = parsed.stem.toLocaleLowerCase();
    const updated = new Date(episode.updatedAt || episode.createdAt || 0).getTime();
    const current = series.get(key);
    if (!current || parsed.number > current.number || (parsed.number === current.number && updated > current.updated)) {
      series.set(key, { ...parsed, updated });
    }
  }
  const needle = typed.toLocaleLowerCase();
  const matches = [...series.values()].filter(item => {
    const stem = item.stem.toLocaleLowerCase();
    const prefix = item.prefix.toLocaleLowerCase();
    return stem.startsWith(needle) || prefix.startsWith(needle) || needle.startsWith(stem);
  });
  matches.sort((a, b) => {
    const aExact = a.stem.localeCompare(typed, undefined, { sensitivity: 'accent' }) === 0 ? 1 : 0;
    const bExact = b.stem.localeCompare(typed, undefined, { sensitivity: 'accent' }) === 0 ? 1 : 0;
    return bExact - aExact || b.updated - a.updated || b.number - a.number;
  });
  return matches[0] ? matches[0].format(matches[0].number + 1) : '';
}

function refreshTitleSuggestion() {
  const suggestion = nextEpisodeTitle(ui.episodeTitle.value);
  ui.titleSuggestion.dataset.title = suggestion;
  ui.titleSuggestion.textContent = suggestion ? `Use next episode: ${suggestion}` : '';
  ui.titleSuggestion.classList.toggle('hidden', !suggestion);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('podcast-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('audio');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(key, blob) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('audio', 'readwrite');
    tx.objectStore('audio').put(blob, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function dbGet(key) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction('audio').objectStore('audio').get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('audio', 'readwrite');
    tx.objectStore('audio').delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function saveMetadata(patch = {}) {
  if (!state.current) return;
  Object.assign(state.current, patch, { updatedAt: new Date().toISOString(), edits: { ...state.edits } });
  const episodes = getEpisodes();
  const index = episodes.findIndex(item => item.id === state.current.id);
  if (index >= 0) episodes[index] = state.current; else episodes.unshift(state.current);
  setEpisodes(episodes);
  updateEpisodeCount();
  ui.saveStatus.innerHTML = '<i></i> Saved locally';
}

function removeMetadata(id) {
  setEpisodes(getEpisodes().filter(item => item.id !== id));
  updateEpisodeCount();
}

function updateEpisodeCount() {
  ui.episodeCount.textContent = getEpisodes().length;
}

function formatClock(seconds, hours = false) {
  const value = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  return hours || h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function slugify(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 90) || 'episode';
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  ui.toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 4500);
}

function setView(name) {
  $$('.nav-tab').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  ui.studioView.classList.toggle('active', name === 'studio');
  ui.libraryView.classList.toggle('active', name === 'library');
  if (name === 'library') renderLibrary();
}

function showLanding() {
  stopPlayback();
  ui.recorder.classList.add('hidden');
  ui.newEpisode.classList.remove('hidden');
  ui.episodeTitle.value = '';
  refreshTitleSuggestion();
  state.current = null;
  state.buffer = null;
  state.editHistory = [];
  setView('studio');
  refreshDraftCard();
}

function setupEpisode(title) {
  state.current = {
    id: crypto.randomUUID(), title: title.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    duration: 0, status: 'ready', sharing: 'public', dropbox: null, soundcloud: null, edits: { start: 0, end: 1, normalize: false, fade: false }
  };
  state.buffer = null;
  state.elapsedMs = 0;
  state.editHistory = [];
  state.edits = { start: 0, end: 1, normalize: false, fade: false };
  saveMetadata();
  openStudio();
}

function openStudio() {
  ui.newEpisode.classList.add('hidden');
  ui.recorder.classList.remove('hidden');
  ui.activeTitle.value = state.current.title;
  ui.timer.textContent = formatClock(state.current.duration || 0, true);
  ui.sharing.value = state.current.sharing || 'public';
  const hasAudio = Boolean(state.buffer);
  ui.liveWave.classList.toggle('hidden', hasAudio);
  ui.editorWave.classList.toggle('hidden', !hasAudio);
  ui.editorPanel.classList.toggle('hidden', !hasAudio);
  ui.publishPanel.classList.toggle('hidden', !hasAudio);
  ui.discardButton.classList.toggle('hidden', !hasAudio);
  ui.recordButton.classList.toggle('hidden', hasAudio);
  ui.pauseButton.classList.add('hidden');
  ui.stopButton.classList.add('hidden');
  ui.inputBar.classList.toggle('hidden', hasAudio);
  if (hasAudio) {
    ui.recordingState.className = 'state-pill complete';
    ui.recordingState.innerHTML = '<i></i> Edit ready';
    ui.recordHint.textContent = 'Recording complete';
    ui.recordHint.classList.add('hidden');
    renderWaveform();
    updateEditUi();
    updateReplacementNote();
    updateSaveEditUi();
  } else {
    ui.recordingState.className = 'state-pill ready';
    ui.recordingState.innerHTML = '<i></i> Ready';
    ui.recordHint.textContent = 'Press the red button to begin';
    ui.recordHint.classList.remove('hidden');
    drawIdleWave();
  }
  updateConnectionUi();
}

async function loadEpisode(id) {
  const episode = getEpisodes().find(item => item.id === id);
  if (!episode) return;
  stopPlayback();
  state.current = episode;
  state.editHistory = [];
  state.edits = { start: 0, end: 1, normalize: false, fade: false, ...(episode.edits || {}) };
  const blob = await dbGet(`${id}:working`) || await dbGet(`${id}:source`) || await dbGet(id);
  state.buffer = blob ? await decodeBlob(blob) : null;
  if (!state.buffer && episode.duration) toast('The episode details were found, but its local audio is missing.', 'error');
  setView('studio');
  openStudio();
}

async function prepareMic(keepAlive = true) {
  if (state.stream?.active) return state.stream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording is not supported in this browser.');
  const deviceId = ui.micSelect.value;
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false
  });
  state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioContext.state === 'suspended') await state.audioContext.resume();
  state.source?.disconnect();
  state.source = state.audioContext.createMediaStreamSource(state.stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  state.analyser.smoothingTimeConstant = .72;
  state.source.connect(state.analyser);
  startMeter();
  await enumerateMics();
  if (!keepAlive) setTimeout(stopMic, 5000);
  return state.stream;
}

function stopMic() {
  cancelAnimationFrame(state.meterFrame);
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
  state.source = null;
  ui.inputMeter.style.width = '0%';
}

async function enumerateMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const selected = ui.micSelect.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'audioinput');
  ui.micSelect.innerHTML = '<option value="">Default microphone</option>' + devices.map((item, index) => `<option value="${item.deviceId}">${escapeHtml(item.label || `Microphone ${index + 1}`)}</option>`).join('');
  if ([...ui.micSelect.options].some(option => option.value === selected)) ui.micSelect.value = selected;
}

function startMeter() {
  const data = new Uint8Array(state.analyser.fftSize);
  const canvas = ui.liveCanvas;
  const ctx = canvas.getContext('2d');
  const history = Array(110).fill(.015);
  const draw = () => {
    if (!state.analyser) return;
    state.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
    const rms = Math.sqrt(sum / data.length);
    ui.inputMeter.style.width = `${Math.min(100, rms * 320)}%`;
    history.push(Math.max(.012, Math.min(.95, rms * 4.4)));
    history.shift();
    sizeCanvas(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const mid = canvas.height / 2;
    const gap = canvas.width / history.length;
    ctx.strokeStyle = state.mediaRecorder?.state === 'paused' ? '#c9aa55' : '#e4513f';
    ctx.lineWidth = Math.max(1.2, gap * .42);
    ctx.lineCap = 'round';
    history.forEach((level, index) => {
      const height = Math.max(2, level * canvas.height * .78);
      ctx.beginPath(); ctx.moveTo(index * gap, mid - height / 2); ctx.lineTo(index * gap, mid + height / 2); ctx.stroke();
    });
    state.meterFrame = requestAnimationFrame(draw);
  };
  draw();
}

function drawIdleWave() {
  const canvas = ui.liveCanvas;
  sizeCanvas(canvas);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d8d5cd';
  ctx.lineWidth = 2;
  ctx.setLineDash([2, 9]);
  ctx.beginPath(); ctx.moveTo(0, canvas.height / 2); ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
  ctx.setLineDash([]);
}

function sizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
}

function supportedMime() {
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type)) || '';
}

async function startRecording() {
  try {
    await prepareMic();
    state.chunks = [];
    state.elapsedMs = 0;
    const mimeType = supportedMime();
    state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined);
    state.mediaRecorder.ondataavailable = event => { if (event.data.size) state.chunks.push(event.data); };
    state.mediaRecorder.onstop = finishRecording;
    state.mediaRecorder.start(500);
    state.segmentStarted = performance.now();
    state.timerInterval = setInterval(updateRecordTimer, 200);
    ui.recordButton.classList.add('hidden');
    ui.pauseButton.classList.remove('hidden');
    ui.stopButton.classList.remove('hidden');
    ui.discardButton.classList.remove('hidden');
    ui.recordingState.className = 'state-pill recording';
    ui.recordingState.innerHTML = '<i></i> Recording';
    ui.recordHint.textContent = 'Pause whenever you need a break';
    saveMetadata({ status: 'recording' });
  } catch (error) {
    toast(error.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser, then try again.' : error.message, 'error');
  }
}

function updateRecordTimer() {
  const running = state.mediaRecorder?.state === 'recording' ? performance.now() - state.segmentStarted : 0;
  ui.timer.textContent = formatClock((state.elapsedMs + running) / 1000, true);
}

function togglePause() {
  if (!state.mediaRecorder) return;
  const pauseIcon = $('.pause-icon', ui.pauseButton);
  const resumeIcon = $('.resume-icon', ui.pauseButton);
  if (state.mediaRecorder.state === 'recording') {
    state.elapsedMs += performance.now() - state.segmentStarted;
    state.mediaRecorder.pause();
    pauseIcon.classList.add('hidden'); resumeIcon.classList.remove('hidden');
    ui.pauseButton.setAttribute('aria-label', 'Resume recording');
    ui.recordingState.className = 'state-pill paused'; ui.recordingState.innerHTML = '<i></i> Paused';
    ui.recordHint.textContent = 'Recording is paused — press play to continue';
  } else if (state.mediaRecorder.state === 'paused') {
    state.mediaRecorder.resume();
    state.segmentStarted = performance.now();
    pauseIcon.classList.remove('hidden'); resumeIcon.classList.add('hidden');
    ui.pauseButton.setAttribute('aria-label', 'Pause recording');
    ui.recordingState.className = 'state-pill recording'; ui.recordingState.innerHTML = '<i></i> Recording';
    ui.recordHint.textContent = 'Pause whenever you need a break';
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
  if (state.mediaRecorder.state === 'recording') state.elapsedMs += performance.now() - state.segmentStarted;
  clearInterval(state.timerInterval);
  state.mediaRecorder.stop();
  ui.stopButton.disabled = true;
  ui.recordHint.textContent = 'Preparing your audio…';
}

async function finishRecording() {
  try {
    const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
    state.buffer = await decodeBlob(blob);
    state.editHistory = [];
    state.edits = { start: 0, end: 1, normalize: false, fade: false };
    const wav = exportWav();
    await dbPut(`${state.current.id}:original`, wav);
    await dbPut(`${state.current.id}:source`, wav);
    await dbPut(`${state.current.id}:working`, wav);
    await dbPut(`${state.current.id}:master`, wav);
    saveMetadata({ status: 'draft', duration: state.buffer.duration });
    ui.timer.textContent = formatClock(state.buffer.duration, true);
    openStudio();
    toast('Recording saved. Your original-quality WAV is ready to edit.', 'success');
    state.mediaRecorder = null;
    stopMic();
    if ($('#autoPublish').checked && state.connectionStatus?.dropbox?.connected && state.connectionStatus?.soundcloud?.connected) {
      ui.dropboxDestination.checked = true;
      ui.soundcloudDestination.checked = true;
      ui.sharing.value = state.current.sharing || 'public';
      await publishEpisode();
    }
  } catch (error) {
    toast(`The recording stopped, but the audio could not be prepared: ${error.message}`, 'error');
  } finally {
    ui.stopButton.disabled = false;
    state.mediaRecorder = null;
    stopMic();
  }
}

async function startAdditionalRecording(mode) {
  if (!state.buffer || state.mediaRecorder) return;
  try {
    await prepareMic();
    state.additionalMode = mode;
    state.chunks = [];
    state.elapsedMs = 0;
    const mimeType = supportedMime();
    state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined);
    state.mediaRecorder.ondataavailable = event => { if (event.data.size) state.chunks.push(event.data); };
    state.mediaRecorder.onstop = finishAdditionalRecording;
    const replacing = mode === 'replace';
    ui.clipRecorderEyebrow.textContent = replacing ? 'RECORD REPLACEMENT' : 'CONTINUE RECORDING';
    ui.clipRecorderTitle.textContent = replacing ? 'Record the new section' : 'Record more audio';
    ui.clipRecorderHelp.textContent = replacing ? 'This recording will replace the selected section.' : 'This recording will be added to the end of this episode.';
    ui.clipRecorderTimer.textContent = '00:00';
    ui.clipPauseButton.textContent = 'Pause';
    ui.clipStopButton.disabled = false;
    ui.clipStopButton.textContent = 'Stop & use clip';
    ui.clipRecorderDialog.showModal();
    state.mediaRecorder.start(500);
    state.segmentStarted = performance.now();
    state.timerInterval = setInterval(() => {
      const running = state.mediaRecorder?.state === 'recording' ? performance.now() - state.segmentStarted : 0;
      ui.clipRecorderTimer.textContent = formatClock((state.elapsedMs + running) / 1000);
    }, 200);
  } catch (error) {
    state.mediaRecorder = null;
    stopMic();
    toast(error.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it, then try again.' : error.message, 'error');
  }
}

function toggleAdditionalPause() {
  if (!state.mediaRecorder) return;
  if (state.mediaRecorder.state === 'recording') {
    state.elapsedMs += performance.now() - state.segmentStarted;
    state.mediaRecorder.pause();
    ui.clipPauseButton.textContent = 'Resume';
  } else if (state.mediaRecorder.state === 'paused') {
    state.mediaRecorder.resume();
    state.segmentStarted = performance.now();
    ui.clipPauseButton.textContent = 'Pause';
  }
}

function stopAdditionalRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
  if (state.mediaRecorder.state === 'recording') state.elapsedMs += performance.now() - state.segmentStarted;
  clearInterval(state.timerInterval);
  ui.clipStopButton.disabled = true;
  ui.clipStopButton.textContent = 'Preparing audio…';
  state.mediaRecorder.stop();
}

function cancelAdditionalRecording() {
  if (!state.mediaRecorder) return;
  state.mediaRecorder.onstop = null;
  if (state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();
  clearInterval(state.timerInterval);
  state.mediaRecorder = null;
  state.additionalMode = null;
  ui.clipRecorderDialog.close();
  stopMic();
  toast('Extra recording canceled. Your episode was not changed.');
}

async function finishAdditionalRecording() {
  const mode = state.additionalMode;
  try {
    const blob = new Blob(state.chunks, { type: state.mediaRecorder?.mimeType || 'audio/webm' });
    const clip = await decodeBlob(blob);
    if (mode === 'append') await appendAudio(clip);
    else await replaceSelectedAudio(clip, 'replace');
    toast(mode === 'append' ? 'The new recording was added to the end.' : 'The selected section was replaced.', 'success');
  } catch (error) {
    toast(`The extra recording could not be used: ${error.message}`, 'error');
  } finally {
    clearInterval(state.timerInterval);
    state.mediaRecorder = null;
    state.additionalMode = null;
    if (ui.clipRecorderDialog.open) ui.clipRecorderDialog.close();
    stopMic();
  }
}

async function decodeBlob(blob) {
  state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  return state.audioContext.decodeAudioData(await blob.arrayBuffer());
}

async function resampleBuffer(buffer, sampleRate) {
  if (buffer.sampleRate === sampleRate) return buffer;
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const frames = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const context = new OfflineContext(buffer.numberOfChannels, frames, sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return context.startRendering();
}

function copyFrames(target, targetOffset, source, sourceStart, sourceEnd) {
  for (let channel = 0; channel < target.numberOfChannels; channel++) {
    const input = source.getChannelData(Math.min(channel, source.numberOfChannels - 1));
    target.getChannelData(channel).set(input.subarray(sourceStart, sourceEnd), targetOffset);
  }
}

async function replaceSelectedAudio(replacement = null, mode = 'replace') {
  if (!state.buffer) return;
  stopPlayback();
  pushEditHistory();
  const effects = { normalize: state.edits.normalize, fade: state.edits.fade };
  const original = state.buffer;
  const startFrame = Math.floor(state.edits.start * original.length);
  const endFrame = Math.max(startFrame + 1, Math.floor(state.edits.end * original.length));
  const clip = replacement ? await resampleBuffer(replacement, original.sampleRate) : null;
  let output;
  if (mode === 'keep') {
    output = state.audioContext.createBuffer(original.numberOfChannels, endFrame - startFrame, original.sampleRate);
    copyFrames(output, 0, original, startFrame, endFrame);
  } else {
    const clipFrames = clip?.length || 0;
    const channels = Math.min(2, Math.max(original.numberOfChannels, clip?.numberOfChannels || 0));
    const frames = Math.max(1, startFrame + clipFrames + original.length - endFrame);
    output = state.audioContext.createBuffer(channels, frames, original.sampleRate);
    copyFrames(output, 0, original, 0, startFrame);
    if (clip) copyFrames(output, startFrame, clip, 0, clip.length);
    copyFrames(output, startFrame + clipFrames, original, endFrame, original.length);
  }
  state.buffer = output;
  state.edits = { start: 0, end: 1, ...effects };
  await persistWorkingAudio();
  renderWaveform();
  updateEditUi();
  updateSaveEditUi();
}

async function appendAudio(clip) {
  if (!state.buffer) return;
  stopPlayback();
  pushEditHistory();
  const effects = { normalize: state.edits.normalize, fade: state.edits.fade };
  const original = state.buffer;
  const addition = await resampleBuffer(clip, original.sampleRate);
  const channels = Math.min(2, Math.max(original.numberOfChannels, addition.numberOfChannels));
  const output = state.audioContext.createBuffer(channels, original.length + addition.length, original.sampleRate);
  copyFrames(output, 0, original, 0, original.length);
  copyFrames(output, original.length, addition, 0, addition.length);
  state.buffer = output;
  state.edits = { start: 0, end: 1, ...effects };
  await persistWorkingAudio();
  renderWaveform();
  updateEditUi();
  updateSaveEditUi();
}

function renderWaveform() {
  if (!state.buffer) return;
  const canvas = ui.waveCanvas;
  sizeCanvas(canvas);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const channel = state.buffer.getChannelData(0);
  const columns = Math.max(100, Math.floor(canvas.width / 5));
  const step = Math.max(1, Math.floor(channel.length / columns));
  const mid = canvas.height / 2;
  ctx.strokeStyle = '#315f54'; ctx.lineWidth = Math.max(1, canvas.width / columns * .52); ctx.lineCap = 'round';
  for (let column = 0; column < columns; column++) {
    let peak = 0;
    const start = column * step;
    for (let i = start; i < Math.min(channel.length, start + step); i += Math.max(1, Math.floor(step / 70))) peak = Math.max(peak, Math.abs(channel[i]));
    const h = Math.max(3, peak * canvas.height * .88);
    const x = column / columns * canvas.width;
    ctx.beginPath(); ctx.moveTo(x, mid - h / 2); ctx.lineTo(x, mid + h / 2); ctx.stroke();
  }
}

function pushEditHistory() {
  state.editHistory.push({ edits: { ...state.edits }, buffer: state.buffer });
  if (state.editHistory.length > 12) state.editHistory.shift();
  ui.undoEdit.disabled = false;
}

function updateEditUi() {
  if (!state.buffer) return;
  const duration = state.buffer.duration;
  ui.trimStart.value = state.edits.start * 100;
  ui.trimEnd.value = state.edits.end * 100;
  ui.trimStartValue.value = formatClock(state.edits.start * duration);
  ui.trimEndValue.value = formatClock(state.edits.end * duration);
  ui.totalTime.textContent = formatClock((state.edits.end - state.edits.start) * duration);
  ui.trimShadeLeft.style.width = `${state.edits.start * 100}%`;
  ui.trimShadeRight.style.width = `${(1 - state.edits.end) * 100}%`;
  $$('.tool-toggle').forEach(button => button.classList.toggle('active', Boolean(state.edits[button.dataset.edit])));
}

function hasPublishedCopies() {
  return Boolean(state.current?.dropbox || state.current?.soundcloud);
}

function markEdited() {
  if (!state.current) return;
  const status = hasPublishedCopies() ? 'edited' : state.current.status === 'ready' ? 'draft' : state.current.status;
  saveMetadata({ status });
  updateReplacementNote();
  updateSaveEditUi();
}

function exportWav() {
  if (!state.buffer) throw new Error('No audio is ready.');
  const sampleRate = state.buffer.sampleRate;
  const startFrame = Math.floor(state.edits.start * state.buffer.length);
  const endFrame = Math.max(startFrame + 1, Math.floor(state.edits.end * state.buffer.length));
  const frames = endFrame - startFrame;
  const channels = Math.min(2, state.buffer.numberOfChannels);
  const output = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(output);
  const write = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  let peak = 0;
  if (state.edits.normalize) {
    for (let c = 0; c < channels; c++) {
      const samples = state.buffer.getChannelData(c);
      for (let i = startFrame; i < endFrame; i++) peak = Math.max(peak, Math.abs(samples[i]));
    }
  }
  const gain = state.edits.normalize && peak > .001 ? Math.min(4, .94 / peak) : 1;
  const fadeFrames = Math.min(Math.floor(sampleRate), Math.floor(frames / 2));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    let fade = 1;
    if (state.edits.fade && fadeFrames) {
      if (i < fadeFrames) fade = i / fadeFrames;
      if (i > frames - fadeFrames) fade = Math.min(fade, (frames - i) / fadeFrames);
    }
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, state.buffer.getChannelData(c)[startFrame + i] * gain * fade));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2;
    }
  }
  return new Blob([output], { type: 'audio/wav' });
}

function exportFullBufferWav() {
  const edits = state.edits;
  state.edits = { start: 0, end: 1, normalize: false, fade: false };
  try { return exportWav(); } finally { state.edits = edits; }
}

function stopPlayback() {
  if (!state.player) return;
  state.player.pause();
  state.player = null;
  if (state.playerUrl) URL.revokeObjectURL(state.playerUrl);
  state.playerUrl = null;
  ui.playButton?.classList.remove('playing');
  if (ui.playButton) ui.playButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
}

function ensurePlayer() {
  if (state.player) return state.player;
  state.playerUrl = URL.createObjectURL(exportWav());
  state.player = new Audio(state.playerUrl);
  state.player.ontimeupdate = () => {
    ui.currentTime.textContent = formatClock(state.player.currentTime);
    const pct = state.player.duration ? state.player.currentTime / state.player.duration * 100 : 0;
    ui.playhead.style.left = `${state.edits.start * 100 + pct * (state.edits.end - state.edits.start)}%`;
  };
  state.player.onended = () => { stopPlayback(); ui.currentTime.textContent = '00:00'; ui.playhead.style.left = `${state.edits.start * 100}%`; };
  return state.player;
}

function togglePlayback() {
  const player = ensurePlayer();
  if (player.paused) {
    player.play();
    ui.playButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  } else {
    player.pause();
    ui.playButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
  }
}

async function persistEditedAudio() {
  if (!state.current || !state.buffer) return;
  await dbPut(`${state.current.id}:master`, exportWav());
  markEdited();
  ui.editSaveHint.textContent = hasPublishedCopies() ? 'Edited master saved on this phone and ready to replace the uploaded copies.' : 'Edited master saved on this phone.';
}

async function persistWorkingAudio() {
  if (!state.current || !state.buffer) return;
  await dbPut(`${state.current.id}:working`, exportFullBufferWav());
  await dbPut(`${state.current.id}:master`, exportWav());
  saveMetadata({ status: hasPublishedCopies() ? 'edited' : 'draft', duration: state.buffer.duration });
  ui.timer.textContent = formatClock(state.buffer.duration, true);
  updateReplacementNote();
}

function updateSaveEditUi() {
  if (!ui.saveEditButton || !state.current) return;
  ui.saveEditButton.textContent = hasPublishedCopies() ? 'Save & replace uploads' : 'Save edited version';
  ui.editSaveHint.textContent = hasPublishedCopies() ? 'This removes the previous uploads, then publishes the edited master with the same name.' : 'Edits are created and stored on this phone.';
}

async function saveEditedVersion() {
  if (!state.current || !state.buffer) return;
  const originalLabel = ui.saveEditButton.textContent;
  ui.saveEditButton.disabled = true;
  ui.saveEditButton.textContent = 'Saving edit…';
  try {
    await persistEditedAudio();
    const replaceDropbox = Boolean(state.current.dropbox);
    const replaceSoundCloud = Boolean(state.current.soundcloud);
    if (!replaceDropbox && !replaceSoundCloud) {
      toast('Edited version saved on this phone.', 'success');
      return;
    }
    ui.dropboxDestination.checked = replaceDropbox;
    ui.soundcloudDestination.checked = replaceSoundCloud;
    await publishEpisode();
  } catch (error) {
    toast(error.message || 'The edit could not be saved. Your original recording is still safe.', 'error');
  } finally {
    ui.saveEditButton.disabled = false;
    ui.saveEditButton.textContent = originalLabel;
    updateSaveEditUi();
  }
}

function downloadEpisode() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(exportWav());
  link.download = `${slugify(state.current.title)}.wav`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

async function publishEpisode() {
  const destinations = [];
  if (ui.dropboxDestination.checked) destinations.push('dropbox');
  if (ui.soundcloudDestination.checked) destinations.push('soundcloud');
  if (!destinations.length) { toast('Choose at least one publishing destination.', 'error'); return false; }
  const missing = destinations.filter(name => !state.connectionStatus?.[name]?.connected);
  if (missing.length) {
    toast(`Connect ${missing.map(name => name === 'dropbox' ? 'Dropbox' : 'SoundCloud').join(' and ')} first.`, 'error');
    ui.settingsDialog.showModal();
    return false;
  }
  const buttonText = $('span', ui.publishButton); const spinner = $('.spinner', ui.publishButton);
  ui.publishButton.disabled = true; buttonText.textContent = 'Publishing…'; spinner.classList.remove('hidden');
  try {
    const replacing = hasPublishedCopies() && state.current.status !== 'published';
    await persistEditedAudio();
    const priorDropboxName = state.current.dropbox?.path?.split('/').pop()?.replace(/\.wav$/i, '');
    const publishTitle = state.current.remoteTitle || state.current.soundcloud?.title || state.current.title;
    const publishSlug = state.current.remoteSlug || priorDropboxName || slugify(publishTitle);
    const response = await studioFetch('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/wav',
        'X-Episode-Title': encodeURIComponent(publishTitle),
        'X-Episode-Slug': encodeURIComponent(publishSlug),
        'X-Destinations': destinations.join(','),
        'X-SoundCloud-Sharing': ui.sharing.value,
        'X-SoundCloud-Track-Id': state.current.soundcloud?.id || ''
      },
      body: exportWav()
    });
    const result = await response.json();
    if (!response.ok && !result.dropbox && !result.soundcloud) throw new Error(result.error || 'Publishing failed.');
    if (result.dropbox?.ok) state.current.dropbox = result.dropbox;
    if (result.soundcloud?.ok) state.current.soundcloud = result.soundcloud;
    if (result.dropbox?.ok || result.soundcloud?.ok) {
      state.current.remoteTitle = publishTitle;
      state.current.remoteSlug = publishSlug;
    }
    state.current.sharing = ui.sharing.value;
    const failures = Object.entries(result).filter(([, value]) => !value.ok).map(([name, value]) => `${name}: ${value.error}`);
    saveMetadata({ status: failures.length ? 'partial' : 'published', duration: (state.edits.end - state.edits.start) * state.buffer.duration });
    await dbPut(`${state.current.id}:master`, exportWav());
    if (failures.length) toast(`Some publishing failed — ${failures.join('; ')}`, 'error');
    else toast(replacing ? 'Edited version replaced the previous uploads.' : 'Episode published successfully.', 'success');
    if (result.soundcloud?.warning) toast(result.soundcloud.warning, 'error');
    updateReplacementNote();
    updateSaveEditUi();
    return !failures.length;
  } catch (error) {
    toast(error.message || 'Publishing failed. Your local recording is safe.', 'error');
    return false;
  } finally {
    ui.publishButton.disabled = false; buttonText.textContent = 'Publish episode'; spinner.classList.add('hidden');
  }
}

function updateReplacementNote() {
  const replacing = Boolean(hasPublishedCopies() && state.current.status !== 'published');
  ui.publishNote.classList.toggle('hidden', !replacing);
  if (replacing) ui.publishNote.textContent = 'Saving this edit removes the previous Dropbox and SoundCloud copies, then uploads the edited master with the same episode name. SoundCloud will provide a new track link.';
}

function renderLibrary() {
  const episodes = getEpisodes();
  ui.episodeCount.textContent = episodes.length;
  ui.emptyLibrary.classList.toggle('hidden', episodes.length > 0);
  ui.episodeList.classList.toggle('hidden', episodes.length === 0);
  ui.episodeList.innerHTML = episodes.map(episode => {
    const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(episode.updatedAt));
    const badges = [episode.dropbox ? '<span class="badge live">Dropbox</span>' : '', episode.soundcloud ? '<span class="badge live">SoundCloud</span>' : '', `<span class="badge">${escapeHtml(episode.status || 'draft')}</span>`].join('');
    return `<article class="episode-card" data-id="${episode.id}">
      <button class="episode-play" data-action="preview" aria-label="Preview episode">▶</button>
      <div><h3>${escapeHtml(episode.title)}</h3><p>${date} · ${formatClock(episode.duration || 0)} · saved locally</p><div class="episode-badges">${badges}</div></div>
      <div class="episode-actions">${episode.soundcloud?.permalinkUrl ? `<a href="${escapeHtml(episode.soundcloud.permalinkUrl)}" target="_blank" rel="noopener">SoundCloud ↗</a>` : ''}<button data-action="edit">Open</button><button data-action="download">WAV</button><button data-action="delete">Remove</button></div>
    </article>`;
  }).join('');
}

async function libraryAction(event) {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const card = event.target.closest('.episode-card');
  if (!action || !card) return;
  const id = card.dataset.id;
  if (action === 'edit') return loadEpisode(id);
  if (action === 'delete') {
    if (!confirm('Remove this local episode and its audio? Published copies will stay online.')) return;
    await Promise.all([dbDelete(id), dbDelete(`${id}:original`), dbDelete(`${id}:source`), dbDelete(`${id}:working`), dbDelete(`${id}:master`)]); removeMetadata(id); renderLibrary(); toast('Local episode removed.'); return;
  }
  const episode = getEpisodes().find(item => item.id === id);
  const blob = await dbGet(`${id}:master`) || await dbGet(`${id}:source`) || await dbGet(id);
  if (!blob) return toast('This episode’s local audio is missing.', 'error');
  if (action === 'download') {
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${slugify(episode.title)}.wav`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }
  if (action === 'preview') {
    if (state.player) stopPlayback();
    state.playerUrl = URL.createObjectURL(blob); state.player = new Audio(state.playerUrl); state.player.play(); event.target.textContent = '■';
    state.player.onended = () => { event.target.textContent = '▶'; stopPlayback(); };
  }
}

function refreshDraftCard() {
  const draft = getEpisodes().find(item => item.status !== 'published');
  ui.draftCard.classList.toggle('hidden', !draft);
  if (draft) {
    ui.draftCard.dataset.id = draft.id;
    ui.draftText.textContent = `${draft.title} · ${formatClock(draft.duration || 0)}`;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function refreshConnections() {
  try {
    const response = await studioFetch('/status');
    if (response.status === 401) {
      showLogin();
      return false;
    }
    state.connectionStatus = await response.json();
    updateConnectionUi();
    return true;
  } catch { toast('The publishing service is unavailable. Recording and editing still work offline.', 'error'); }
}

function showLogin() {
  if (!ui.loginDialog.open) ui.loginDialog.showModal();
  setTimeout(() => ui.loginPassword.focus(), 100);
}

async function signIn(event) {
  event.preventDefault();
  ui.loginError.classList.add('hidden');
  const response = await fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ui.loginPassword.value })
  });
  const result = await response.json();
  if (!response.ok) {
    ui.loginError.textContent = result.error || 'The password was not accepted.';
    ui.loginError.classList.remove('hidden');
    return;
  }
  if (result.token) sessionStorage.setItem('rjsAdminToken', result.token);
  ui.loginPassword.value = '';
  ui.loginDialog.close();
  await refreshConnections();
  toast('Podcast Studio unlocked.', 'success');
}

async function installApp() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  ui.installButton.classList.add('hidden');
}

function updateOnlineState() {
  ui.offlineBanner.classList.toggle('hidden', navigator.onLine);
}

function updateConnectionUi() {
  if (!state.connectionStatus) return;
  for (const provider of ['dropbox', 'soundcloud']) {
    const status = state.connectionStatus[provider];
    const label = provider === 'dropbox' ? 'Dropbox' : 'SoundCloud';
    $(`#${provider}Status`).textContent = status.connected ? 'Connected' : status.configured ? 'Ready to connect' : 'Set up in Settings';
    $(`#${provider}ConnectionText`).textContent = status.connected ? 'Connected to your account' : status.configured ? 'Credentials saved' : 'App credentials required';
    const button = $(`#${provider}Connect`);
    button.textContent = status.connected ? 'Disconnect' : status.configured ? 'Connect' : 'Set up';
    button.dataset.mode = status.connected ? 'disconnect' : status.configured ? 'connect' : 'setup';
    const callback = $(`#${provider}Callback`); if (callback) callback.textContent = state.connectionStatus.callbacks[provider];
  }
}

async function connectionAction(provider) {
  const button = $(`#${provider}Connect`);
  if (button.dataset.mode === 'setup') return $(`#${provider}Setup`).classList.toggle('hidden');
  if (button.dataset.mode === 'connect') { window.top.location.href = `/auth/studio/${provider}/start`; return; }
  if (button.dataset.mode === 'disconnect') {
    await studioFetch('/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
    await refreshConnections(); toast(`${provider === 'dropbox' ? 'Dropbox' : 'SoundCloud'} disconnected.`);
  }
}

async function saveConnections() {
  const payload = {};
  for (const id of ['dropboxClientId', 'dropboxClientSecret', 'soundcloudClientId', 'soundcloudClientSecret']) {
    const value = $(`#${id}`).value.trim(); if (value) payload[id] = value;
  }
  if (!Object.keys(payload).length) return toast('Enter at least one set of app credentials.', 'error');
  const response = await studioFetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  state.connectionStatus = await response.json(); updateConnectionUi(); toast('Credentials saved. Use Connect to authorize each account.', 'success');
}

function discardCurrent() { ui.confirmDialog.showModal(); }

async function startNewRecordingFlow() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    toast('Finish or cancel the recording in progress before starting a new one.', 'error');
    return;
  }
  if (state.current && state.buffer) await persistEditedAudio();
  if (state.current && !state.buffer && state.current.status === 'ready') removeMetadata(state.current.id);
  showLanding();
  toast('Ready for a new episode. Your previous episode remains saved.', 'success');
}

async function insertAudioFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const clip = await decodeBlob(file);
    await replaceSelectedAudio(clip, 'replace');
    toast('The selected section was replaced with the audio file.', 'success');
  } catch (error) {
    toast(`That audio file could not be inserted: ${error.message}`, 'error');
  }
}

async function confirmDiscard() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.onstop = null; state.mediaRecorder.stop(); clearInterval(state.timerInterval); stopMic(); state.mediaRecorder = null;
  }
  if (state.current) {
    await Promise.all([dbDelete(state.current.id), dbDelete(`${state.current.id}:original`), dbDelete(`${state.current.id}:source`), dbDelete(`${state.current.id}:working`), dbDelete(`${state.current.id}:master`)]);
    removeMetadata(state.current.id);
  }
  showLanding(); toast('Recording discarded.');
}

function bindEvents() {
  $$('.nav-tab').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  ui.episodeTitle.addEventListener('input', refreshTitleSuggestion);
  ui.titleSuggestion.addEventListener('click', () => { ui.episodeTitle.value = ui.titleSuggestion.dataset.title || ui.episodeTitle.value; refreshTitleSuggestion(); ui.episodeTitle.focus(); });
  ui.episodeForm.addEventListener('submit', event => {
    event.preventDefault();
    const suggested = ui.titleSuggestion.classList.contains('hidden') ? '' : ui.titleSuggestion.dataset.title;
    setupEpisode(suggested || ui.episodeTitle.value);
  });
  ui.activeTitle.addEventListener('input', () => { ui.saveStatus.textContent = 'Saving…'; clearTimeout(ui.activeTitle._timer); ui.activeTitle._timer = setTimeout(() => { state.current.title = ui.activeTitle.value.trim() || 'Untitled episode'; if (state.buffer) markEdited(); else saveMetadata(); }, 350); });
  ui.recordButton.addEventListener('click', startRecording); ui.pauseButton.addEventListener('click', togglePause); ui.stopButton.addEventListener('click', stopRecording);
  ui.discardButton.addEventListener('click', discardCurrent); ui.confirmDiscard.addEventListener('click', confirmDiscard);
  ui.testMic.addEventListener('click', async () => { try { await prepareMic(false); toast('Microphone is live. Watch the level meter as you speak.', 'success'); } catch (error) { toast(error.message, 'error'); } });
  ui.micSelect.addEventListener('change', () => { stopMic(); });
  ui.playButton.addEventListener('click', togglePlayback);
  $('#skipBack').addEventListener('click', () => { const player = ensurePlayer(); player.currentTime = Math.max(0, player.currentTime - 5); });
  $('#skipForward').addEventListener('click', () => { const player = ensurePlayer(); player.currentTime = Math.min(player.duration || Infinity, player.currentTime + 5); });
  ui.editorWave.addEventListener('click', event => { const player = ensurePlayer(); const rect = ui.editorWave.getBoundingClientRect(); const absolute = (event.clientX - rect.left) / rect.width; const within = (absolute - state.edits.start) / (state.edits.end - state.edits.start); player.currentTime = Math.max(0, Math.min(player.duration || 0, within * (player.duration || 0))); });
  ui.trimStart.addEventListener('input', () => { stopPlayback(); const next = Number(ui.trimStart.value) / 100; state.edits.start = Math.min(next, state.edits.end - .002); updateEditUi(); markEdited(); });
  ui.trimEnd.addEventListener('input', () => { stopPlayback(); const next = Number(ui.trimEnd.value) / 100; state.edits.end = Math.max(next, state.edits.start + .002); updateEditUi(); markEdited(); });
  ui.trimStart.addEventListener('pointerdown', pushEditHistory); ui.trimEnd.addEventListener('pointerdown', pushEditHistory);
  ui.trimStart.addEventListener('change', () => persistEditedAudio().catch(error => toast(error.message, 'error'))); ui.trimEnd.addEventListener('change', () => persistEditedAudio().catch(error => toast(error.message, 'error')));
  $$('.tool-toggle').forEach(button => button.addEventListener('click', async () => { pushEditHistory(); stopPlayback(); state.edits[button.dataset.edit] = !state.edits[button.dataset.edit]; updateEditUi(); await persistEditedAudio(); }));
  ui.undoEdit.addEventListener('click', async () => {
    const previous = state.editHistory.pop(); if (!previous) return;
    stopPlayback();
    const bufferChanged = previous.buffer !== state.buffer;
    state.buffer = previous.buffer || state.buffer;
    state.edits = previous.edits || previous;
    ui.undoEdit.disabled = !state.editHistory.length;
    renderWaveform(); updateEditUi();
    if (bufferChanged) await persistWorkingAudio(); else await persistEditedAudio();
  });
  ui.resetEdit.addEventListener('click', async () => { pushEditHistory(); stopPlayback(); state.edits = { start: 0, end: 1, normalize: false, fade: false }; updateEditUi(); await persistEditedAudio(); });
  ui.trimSelectionButton.addEventListener('click', async () => { await replaceSelectedAudio(null, 'keep'); toast('Only the selected audio was kept.', 'success'); });
  ui.cutSelectionButton.addEventListener('click', async () => { await replaceSelectedAudio(null, 'replace'); toast('The selected audio was cut out.', 'success'); });
  ui.recordReplacementButton.addEventListener('click', () => startAdditionalRecording('replace'));
  ui.continueRecordingButton.addEventListener('click', () => startAdditionalRecording('append'));
  ui.insertAudioButton.addEventListener('click', () => ui.insertAudioInput.click());
  ui.insertAudioInput.addEventListener('change', insertAudioFile);
  ui.clipPauseButton.addEventListener('click', toggleAdditionalPause);
  ui.clipStopButton.addEventListener('click', stopAdditionalRecording);
  ui.clipCancelButton.addEventListener('click', cancelAdditionalRecording);
  ui.clipRecorderDialog.addEventListener('cancel', event => { event.preventDefault(); cancelAdditionalRecording(); });
  ui.saveEditButton.addEventListener('click', saveEditedVersion);
  ui.downloadButton.addEventListener('click', downloadEpisode); ui.publishButton.addEventListener('click', publishEpisode);
  ui.episodeList.addEventListener('click', libraryAction);
  $('#newRecordingButton').addEventListener('click', startNewRecordingFlow); $('#emptyRecordButton').addEventListener('click', startNewRecordingFlow);
  ui.newRecordingHeaderButton.addEventListener('click', startNewRecordingFlow);
  ui.openDraft.addEventListener('click', () => loadEpisode(ui.draftCard.dataset.id));
  ui.settingsButton.addEventListener('click', () => ui.settingsDialog.showModal());
  $('#dropboxConnect').addEventListener('click', () => connectionAction('dropbox')); $('#soundcloudConnect').addEventListener('click', () => connectionAction('soundcloud'));
  $('#saveConnections').addEventListener('click', saveConnections);
  $('#autoPublish').addEventListener('change', event => localStorage.setItem('podcast-studio-auto-publish', String(event.target.checked)));
  ui.loginForm.addEventListener('submit', signIn);
  ui.loginDialog.addEventListener('cancel', event => event.preventDefault());
  ui.installButton.addEventListener('click', installApp);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; ui.installButton.classList.remove('hidden'); });
  window.addEventListener('appinstalled', () => { state.installPrompt = null; ui.installButton.classList.add('hidden'); toast('Podcast Studio installed.', 'success'); });
  window.addEventListener('online', updateOnlineState); window.addEventListener('offline', updateOnlineState);
  window.addEventListener('resize', () => { if (state.buffer) renderWaveform(); else drawIdleWave(); });
  window.addEventListener('beforeunload', event => { if (state.mediaRecorder && state.mediaRecorder.state === 'recording') { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('keydown', event => {
    if (event.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName) && state.buffer) { event.preventDefault(); togglePlayback(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.buffer) { event.preventDefault(); downloadEpisode(); }
  });
}

async function init() {
  state.db = await openDb();
  bindEvents();
  updateHomeDateTime();
  setInterval(updateHomeDateTime, 1000);
  updateOnlineState();
  await studioFetch('/session', { method: 'POST' }).catch(() => undefined);
  $('#autoPublish').checked = localStorage.getItem('podcast-studio-auto-publish') !== 'false';
  updateEpisodeCount();
  refreshDraftCard();
  enumerateMics();
  await refreshConnections();
  const params = new URLSearchParams(location.search);
  if (params.get('connected')) { toast(`${params.get('connected') === 'dropbox' ? 'Dropbox' : 'SoundCloud'} connected successfully.`, 'success'); history.replaceState({}, '', '/studio/'); }
  if (params.get('auth')) { toast(`Connection failed: ${params.get('auth')}`, 'error'); history.replaceState({}, '', '/studio/'); }
  if (params.get('setup')) { ui.settingsDialog.showModal(); $(`#${params.get('setup')}Setup`)?.classList.remove('hidden'); history.replaceState({}, '', '/studio/'); }
  if (params.get('login')) { showLogin(); history.replaceState({}, '', '/studio/'); }
  drawIdleWave();
}

init().catch(error => toast(`Podcast Studio could not start: ${error.message}`, 'error'));
