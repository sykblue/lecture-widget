const $ = (id) => document.getElementById(id);
const api = window.api;
const SAMPLE_RATE = 16000; // Whisper 입력 형식

const state = {
  settings: null,
  running: false,
  stream: null,
  audioCtx: null,
  processor: null,
  pcm: [], // Float32Array 조각들
  pcmLen: 0,
  transcript: load('transcript', []), // [{t:'12:03', text:'...'}]
  summary: load('summary', ''),
  summarizedUpTo: load('summarizedUpTo', 0),
  summarizing: false,
  sttQueue: Promise.resolve(),
  startedAt: 0,
  chunkStartedAt: '',
  timers: [],
};

function load(k, d) { try { const v = localStorage.getItem('lw:' + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function persist() {
  try {
    localStorage.setItem('lw:transcript', JSON.stringify(state.transcript));
    localStorage.setItem('lw:summary', JSON.stringify(state.summary));
    localStorage.setItem('lw:summarizedUpTo', JSON.stringify(state.summarizedUpTo));
  } catch {}
}

/* ---------- 화면 ---------- */
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
function renderMd(md) {
  const out = [];
  let inList = false;
  for (const raw of md.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (/^##\s+/.test(line)) out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`);
    else if (/^#\s+|^###\s+/.test(line)) out.push(`<h3>${inline(line.replace(/^#+\s+/, ''))}</h3>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
function showSummary(md) { if (md) $('summaryView').innerHTML = renderMd(md); }
function addTranscriptLine(item) {
  const pane = $('transcript');
  const nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
  const div = document.createElement('div');
  div.className = 'line';
  div.innerHTML = `<span class="t">${item.t}</span>${esc(item.text)}`;
  $('transcriptView').appendChild(div);
  if (nearBottom) pane.scrollTop = pane.scrollHeight;
}
function setStatus(msg, isErr = false) {
  $('status').textContent = msg || '';
  $('status').classList.toggle('err', isErr);
}
function setDot() { $('dot').className = 'dot' + (state.summarizing ? ' busy' : state.running ? ' rec' : ''); }
function now() { return new Date().toTimeString().slice(0, 5); }

/* ---------- 로컬 음성 인식 (Web Worker) ---------- */
const worker = new Worker('stt-worker.js', { type: 'module' });
let reqId = 0;
const pending = new Map();
let sttDevice = '';
worker.onmessage = ({ data }) => {
  if (data.type === 'loading') setStatus(`받아쓰기 모델 내려받는 중… ${data.pct}% (처음 한 번만)`);
  else if (data.type === 'ready') { sttDevice = data.device; setStatus(`받아쓰기 준비 완료 (${data.device})`); }
  else if (data.type === 'result') { pending.get(data.id)?.resolve(data.text); pending.delete(data.id); }
  else if (data.type === 'error') {
    if (pending.has(data.id)) { pending.get(data.id).reject(new Error(data.message)); pending.delete(data.id); }
    else setStatus('받아쓰기 모델 오류: ' + data.message, true);
  }
};
function transcribe(audio) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: 'transcribe', id, audio, model: state.settings.whisperModel }, [audio.buffer]);
  });
}

/* ---------- 녹음 ---------- */
async function getAudioStream(source) {
  if (source === 'mic') {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
  }
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  s.getVideoTracks().forEach((t) => t.stop());
  if (s.getAudioTracks().length === 0) {
    throw new Error('시스템 소리를 가져오지 못했어요. macOS라면 "화면 및 시스템 오디오 녹음" 권한을 허용하고 다시 켜 보세요. 안 되면 🎙 마이크로 바꿔 주세요.');
  }
  return new MediaStream(s.getAudioTracks());
}

function flushChunk() {
  if (state.pcmLen === 0) return;
  const audio = new Float32Array(state.pcmLen);
  let off = 0;
  for (const part of state.pcm) { audio.set(part, off); off += part.length; }
  const t = state.chunkStartedAt || now();
  state.pcm = [];
  state.pcmLen = 0;
  state.chunkStartedAt = now();

  // 거의 무음이면 건너뜀
  let sum = 0;
  for (let i = 0; i < audio.length; i += 4) sum += audio[i] * audio[i];
  const rms = Math.sqrt(sum / (audio.length / 4));
  if (rms < 0.005 || audio.length < SAMPLE_RATE * 2) return;

  state.sttQueue = state.sttQueue.then(async () => {
    try {
      setStatus('받아쓰는 중…');
      const text = await transcribe(audio);
      if (text) {
        const item = { t, text };
        state.transcript.push(item);
        addTranscriptLine(item);
        persist();
      }
      setStatus(state.running ? `듣는 중${sttDevice ? ' · ' + sttDevice : ''} · 받아쓴 조각 ${state.transcript.length}개` : '');
    } catch (err) {
      setStatus('받아쓰기 실패: ' + (err.message || err), true);
    }
  });
}

async function start() {
  if (!state.settings.ollamaModel) {
    openSettings();
    setStatus('먼저 요약에 쓸 Ollama 모델을 골라 주세요.', true);
    return;
  }
  try {
    state.stream = await getAudioStream($('source').value);
  } catch (err) {
    setStatus(err.message || '소리를 가져올 수 없어요.', true);
    return;
  }
  state.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const src = state.audioCtx.createMediaStreamSource(state.stream);
  const proc = state.audioCtx.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => {
    if (!state.running) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    state.pcm.push(data);
    state.pcmLen += data.length;
  };
  const mute = state.audioCtx.createGain();
  mute.gain.value = 0; // 위젯에서 소리가 다시 나오지 않게
  src.connect(proc);
  proc.connect(mute);
  mute.connect(state.audioCtx.destination);
  state.processor = proc;

  state.running = true;
  state.startedAt = Date.now();
  state.chunkStartedAt = now();
  $('btnStart').textContent = '■ 정지';
  $('btnStart').classList.add('stop');
  $('source').disabled = true;
  setDot();
  setStatus('듣는 중…');
  worker.postMessage({ type: 'load', model: state.settings.whisperModel });

  state.timers.push(setInterval(tick, 1000));
  state.timers.push(setInterval(flushChunk, (Number(state.settings.chunkSeconds) || 30) * 1000));
  state.timers.push(setInterval(() => summarize(false), (Number(state.settings.summaryMinutes) || 3) * 60 * 1000));
}

async function stop() {
  state.running = false;
  state.timers.forEach(clearInterval);
  state.timers = [];
  flushChunk();
  state.processor?.disconnect();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.audioCtx?.close();
  $('btnStart').textContent = '▶ 시작';
  $('btnStart').classList.remove('stop');
  $('source').disabled = false;
  setDot();
  setStatus('정지됨 · 마지막 내용 정리 중…');
  await state.sttQueue;
  await summarize(false);
  setStatus('정지됨');
}

function tick() {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  $('timer').textContent = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ---------- 요약 (Ollama) ---------- */
let deltaHandler = null;
api.onSummaryDelta((d) => deltaHandler && deltaHandler(d));

async function summarize(force) {
  if (state.summarizing) return;
  const fresh = state.transcript.slice(state.summarizedUpTo);
  if (fresh.length === 0) {
    if (force) setStatus('새로 받아 적은 내용이 아직 없어요.');
    return;
  }
  const upTo = state.transcript.length;
  state.summarizing = true;
  setDot();
  setStatus('요약하는 중… (Ollama)');
  let live = '';
  deltaHandler = (d) => { live += d; showSummary(live); };
  try {
    const result = await api.summarize({
      previousSummary: state.summary,
      newTranscript: fresh.map((x) => `[${x.t}] ${x.text}`).join('\n'),
    });
    if (result) {
      state.summary = result;
      state.summarizedUpTo = upTo;
      persist();
    }
    showSummary(state.summary);
    setStatus(`요약 업데이트 ${now()}`);
  } catch (err) {
    showSummary(state.summary);
    setStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
  } finally {
    deltaHandler = null;
    state.summarizing = false;
    setDot();
  }
}

/* ---------- 설정 ---------- */
async function fillModels() {
  const sel = $('sModel');
  try {
    const models = await api.ollamaModels();
    sel.innerHTML = models.length
      ? models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
      : '<option value="">설치된 모델 없음 — 터미널에서 ollama pull qwen2.5:7b</option>';
    let pick = state.settings.ollamaModel;
    if (!models.includes(pick)) pick = models.find((m) => !/vl|vision|embed|llava/i.test(m)) || models[0] || '';
    sel.value = pick;
  } catch (err) {
    sel.innerHTML = '<option value="">Ollama 연결 안 됨 — Ollama를 켜고 새로고침</option>';
  }
}
async function openSettings() {
  const s = state.settings;
  $('sOllamaUrl').value = s.ollamaUrl;
  $('sWhisper').value = s.whisperModel;
  $('sChunk').value = s.chunkSeconds;
  $('sEvery').value = s.summaryMinutes;
  $('sOpacity').value = s.opacity;
  $('opVal').textContent = Math.round(s.opacity * 100) + '%';
  $('settingsPanel').classList.remove('hidden');
  await fillModels();
}
$('sRefresh').onclick = async (e) => {
  e.preventDefault();
  await api.setSettings({ ollamaUrl: $('sOllamaUrl').value.trim() || 'http://127.0.0.1:11434' });
  fillModels();
};
$('sOpacity').oninput = (e) => { $('opVal').textContent = Math.round(e.target.value * 100) + '%'; };
$('sCancel').onclick = () => $('settingsPanel').classList.add('hidden');
$('sSave').onclick = async () => {
  state.settings = await api.setSettings({
    ollamaUrl: $('sOllamaUrl').value.trim() || 'http://127.0.0.1:11434',
    ollamaModel: $('sModel').value,
    whisperModel: $('sWhisper').value,
    chunkSeconds: Math.min(120, Math.max(10, Number($('sChunk').value) || 30)),
    summaryMinutes: Math.min(30, Math.max(1, Number($('sEvery').value) || 3)),
    opacity: Number($('sOpacity').value) || 0.95,
  });
  $('settingsPanel').classList.add('hidden');
  setStatus(state.running ? '설정 저장됨 · 간격·모델 변경은 다시 시작하면 적용돼요.' : '설정 저장됨');
};

/* ---------- 버튼 ---------- */
$('btnStart').onclick = () => (state.running ? stop() : start());
$('btnNow').onclick = () => summarize(true);
$('btnSettings').onclick = () => ($('settingsPanel').classList.contains('hidden') ? openSettings() : $('settingsPanel').classList.add('hidden'));
$('btnClose').onclick = () => api.close();
let collapsed = false;
$('btnCollapse').onclick = () => {
  collapsed = !collapsed;
  document.body.classList.toggle('collapsed', collapsed);
  api.collapse(collapsed);
};
$('btnPin').onclick = () => {
  const on = !$('btnPin').classList.contains('on');
  $('btnPin').classList.toggle('on', on);
  api.pin(on);
};
$('btnSave').onclick = async () => {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const content = `# 강의 요약 (${stamp})\n\n${state.summary || '(요약 없음)'}\n\n---\n\n# 받아쓰기 원문\n\n` +
    state.transcript.map((x) => `- [${x.t}] ${x.text}`).join('\n') + '\n';
  const p = await api.saveFile({ content, defaultName: `강의요약_${stamp}.md` });
  if (p) setStatus('저장됨: ' + p);
};
$('btnClear').onclick = () => {
  if (state.running) return setStatus('정지한 뒤에 지울 수 있어요.', true);
  if (!confirm('요약과 받아쓰기를 모두 지울까요?')) return;
  state.transcript = [];
  state.summary = '';
  state.summarizedUpTo = 0;
  persist();
  $('transcriptView').innerHTML = '';
  $('summaryView').innerHTML = '<p class="hint">지웠어요. ▶ 시작을 눌러 새로 들어 보세요.</p>';
  $('timer').textContent = '00:00';
  setStatus('');
};
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === tab.dataset.tab));
  };
});

/* ---------- 시작 ---------- */
(async () => {
  state.settings = await api.getSettings();
  $('btnPin').classList.toggle('on', !!state.settings.alwaysOnTop);
  if ((await api.platform()) === 'darwin') $('macHint').classList.remove('hidden');
  state.transcript.forEach(addTranscriptLine);
  showSummary(state.summary);
  if (!state.settings.ollamaModel) openSettings();
  else setStatus('▶ 시작을 누르면 받아쓰기 모델을 준비해요.');
})();
