const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// macOS: 시스템 소리(loopback) 캡처를 켜는 Chromium 기능 플래그 (macOS 13+)
const features = ['SharedArrayBuffer'];
if (process.platform === 'darwin') features.push('MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride');
app.commandLine.appendSwitch('enable-features', features.join(','));
app.commandLine.appendSwitch('enable-unsafe-webgpu');

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: '',
  whisperModel: 'Xenova/whisper-small',
  chunkSeconds: 30,
  summaryMinutes: 3,
  opacity: 0.95,
  alwaysOnTop: true,
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2));
}

let settings;
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 560,
    minWidth: 300,
    minHeight: 46,
    frame: false,
    backgroundColor: '#14161b',
    alwaysOnTop: settings.alwaysOnTop,
    title: '강의 요약 위젯',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setOpacity(settings.opacity);
  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  settings = loadSettings();

  // getDisplayMedia() → 화면 소스 + 시스템 소리(loopback)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture'].includes(permission));
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());

/* ---------- 창 제어 ---------- */
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:collapse', (_e, collapsed) => {
  const [w, h] = win.getSize();
  if (collapsed) {
    win._expandedHeight = h;
    win.setSize(w, 46);
  } else {
    win.setSize(w, win._expandedHeight || 560);
  }
});
ipcMain.handle('win:pin', (_e, on) => {
  win.setAlwaysOnTop(on, 'floating');
  settings.alwaysOnTop = on;
  saveSettings(settings);
});

/* ---------- 설정 ---------- */
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, next) => {
  settings = { ...settings, ...next };
  saveSettings(settings);
  win.setOpacity(Number(settings.opacity) || 0.95);
  return settings;
});
ipcMain.handle('platform', () => process.platform);

/* ---------- Ollama ---------- */
const base = () => (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, '');

ipcMain.handle('ollama:models', async () => {
  try {
    const res = await fetch(base() + '/api/tags');
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch {
    throw new Error('Ollama에 연결할 수 없어요. Ollama 앱이 켜져 있는지 확인해 주세요.');
  }
});

const SYSTEM_PROMPT = `너는 온라인 강의(ZEP 메타버스 강의실)를 듣는 수강생을 돕는 요약 도우미다.
입력으로 "지금까지의 요약"과 "새로 받아 적은 강사 발언"이 주어진다. 받아쓰기는 자동 음성 인식이라 오타·끊김·잡담이 섞여 있다.
두 내용을 합쳐 강의 전체를 반영한 최신 요약을 한국어 마크다운으로 다시 써라. 반드시 아래 형식만 출력한다.

## 한 줄 요약
(지금까지 강의의 핵심 한 문장)

## 주요 내용
- 주제별 불릿. 강사가 강조한 개념, 예시, 도구 이름, 명령어는 살린다.

## 공지 · 과제 · 할 일
- 마감, 제출 방법, 다음 시간 준비물, 따라 해야 할 실습 단계. 없으면 "- 없음".

## 키워드
쉼표로 구분한 핵심 용어

규칙: 받아쓰기에 없는 내용을 지어내지 않는다. 잡담·출석·음향 체크는 뺀다. 인식 오류로 보이는 단어는 문맥상 맞는 말로 고친다. 이전 요약의 중요한 내용은 유지한다. 반드시 한국어로만 쓴다.`;

let current = null;

ipcMain.handle('summary:run', async (e, { previousSummary, newTranscript }) => {
  if (!settings.ollamaModel) throw new Error('설정에서 Ollama 모델을 골라 주세요.');
  if (current) current.abort();
  const ctrl = new AbortController();
  current = ctrl;

  const userText =
    `<지금까지의_요약>\n${previousSummary || '(아직 없음)'}\n</지금까지의_요약>\n\n` +
    `<새로_받아_적은_강사_발언>\n${newTranscript}\n</새로_받아_적은_강사_발언>`;

  let res;
  try {
    res = await fetch(base() + '/api/chat', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ollamaModel,
        stream: true,
        keep_alive: '30m',
        options: { num_ctx: 8192, temperature: 0.3 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      }),
    });
  } catch {
    throw new Error('Ollama에 연결할 수 없어요. Ollama 앱이 켜져 있는지 확인해 주세요.');
  }
  if (!res.ok) throw new Error(`Ollama 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);

  let full = '';
  let buf = '';
  const decoder = new TextDecoder();
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.error) throw new Error('Ollama 오류: ' + msg.error);
        const delta = msg.message?.content || '';
        if (delta) {
          full += delta;
          if (!e.sender.isDestroyed()) e.sender.send('summary:delta', delta);
        }
      }
    }
  } finally {
    if (current === ctrl) current = null;
  }
  return full.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
});

/* ---------- 저장 ---------- */
ipcMain.handle('file:save', async (_e, { content, defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
});
