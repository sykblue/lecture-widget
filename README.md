# 강의 요약 위젯 (LectureWidget)

## ▶ 바로 써 보기 — 웹 버전 (추천)
**https://sykblue.github.io/lecture-widget/**
설치 없이 Chrome · Edge 에서 바로 실행됩니다. Windows 스마트 앱 컨트롤 · 백신 경고와 상관없이 동작해요.

**앱으로 설치하기 (PWA, 추천)**: 페이지 위쪽 **⬇ 앱 설치** 버튼, 또는 주소창 오른쪽의 설치 아이콘을 누르세요.
시작 메뉴 · 작업 표시줄에 "강의 요약 위젯"이 생기고 자기 창으로 열립니다. 브라우저가 실행하는 앱이라 **스마트 앱 컨트롤이 켜진 PC에서도 막히지 않습니다.** 지우기: 앱 창 ⋯ → 제거.

### 데스크톱 앱 (선택 · 서명 없음)
https://github.com/sykblue/lecture-widget/releases/latest
- Windows 설치형 `LectureWidget-*-win-x64.exe` / 무설치 `LectureWidget-*-portable.exe` / Mac `*.dmg`
- 코드 서명 인증서가 없는 개인 프로젝트라 경고가 뜰 수 있습니다.
  - "PC 보호"(SmartScreen) 창 → **추가 정보 → 실행**
  - **스마트 앱 컨트롤**이 켜진 Windows 11 에서는 실행이 막힙니다 → **웹 버전을 쓰세요** (스마트 앱 컨트롤을 끄는 것은 권하지 않습니다)
  - Mac → **우클릭 → 열기**

## 🌐 웹 버전 (설치 없음) — `index.html`
파일 하나짜리 웹페이지입니다. **Chrome 또는 Edge (PC, Windows·Mac 모두)** 에서 열면 됩니다.

1. `index.html`을 더블클릭해서 열거나, GitHub Pages 같은 곳에 올려 주소로 엽니다.
2. 다른 탭에 ZEP 강의실을 열어 둡니다.
3. **▶ 시작** → 공유 창에서 **Chrome 탭** → ZEP 탭 선택 → **탭 오디오도 공유** 켜기 → 공유.
4. **⧉ 띄우기**를 누르면 항상 위에 뜨는 작은 창(Picture-in-Picture)이 됩니다.

- 받아쓰기: Whisper가 브라우저 안에서 실행 (처음에만 모델 다운로드, 이후 브라우저에 저장)
- 요약: **브라우저 안 LLM(WebLLM, 기본 Qwen2.5 3B ≈ 2GB, WebGPU 필요)** 또는 **Ollama**
- Ollama를 쓸 때: `http://localhost`로 연 페이지는 바로 되고, 파일로 열거나 다른 주소에 올린 경우엔 한 번만
  `setx OLLAMA_ORIGINS "*"` (Windows) / `launchctl setenv OLLAMA_ORIGINS "*"` (Mac) 후 Ollama 재시작.
- 받아쓰기가 느리다는 안내가 뜨면 ⚙에서 Whisper를 base로 낮추세요.

---

## 🖥 데스크톱 앱 버전 — 완전 로컬

ZEP 강의실(예: https://zep.us/@aicamp2)에서 나오는 강사님 목소리를 받아 적고, 몇 분마다 자동으로 요약해 주는 작은 데스크톱 위젯입니다. **API 키 없이, 모든 처리가 내 컴퓨터에서** 이루어져요.

## 동작 방식
1. **시스템 소리 캡처**: 브라우저에서 나오는 ZEP 소리를 그대로 가져옵니다 (마이크로 바꿀 수 있음).
2. **받아쓰기 — Whisper (앱 안에서 실행)**: 30초 단위로 한국어 받아쓰기. GPU(WebGPU)가 있으면 GPU, 없으면 CPU로 돌아요. 모델은 처음 한 번만 내려받습니다.
3. **요약 — Ollama**: 3분마다 "지금까지 요약 + 새 발언"을 합쳐 요약을 새로 씁니다.
   - 한 줄 요약 / 주요 내용 / 공지·과제·할 일 / 키워드
4. **저장**: 요약 + 받아쓰기 원문을 `.md` 파일 하나로.

## 준비물
1. **Ollama** 설치: https://ollama.com
2. 한국어 잘하는 모델 하나 받기 (택1)
   ```bash
   ollama pull qwen2.5:7b        # 균형 (RAM 8GB+)
   ollama pull qwen2.5:14b       # 더 정확 (RAM 16GB+)
   ollama pull exaone3.5:7.8b    # 한국어 특화 (LG)
   ```
   3B 같은 작은 모델은 빠르지만 요약 형식이 자주 흐트러져요.
3. 위젯 ⚙ 설정에서 요약 모델과 Whisper 모델을 고릅니다.

| Whisper 모델 | 크기 | 특징 |
|---|---|---|
| base | ~80MB | 빠름, 정확도 낮음 |
| small (기본) | ~250MB | 균형 |
| large-v3-turbo | ~1GB | 가장 정확, GPU 있을 때 추천 |

## 설치 파일
| OS | 파일 |
|---|---|
| Windows | `LectureWidget-1.0.0-win-x64.zip` (압축 풀고 `LectureWidget.exe`), 설치형 `.exe` |
| Mac (Apple Silicon M1~) | `LectureWidget-1.0.0-mac-arm64.dmg` |
| Mac (Intel) | `LectureWidget-1.0.0-mac-x64.dmg` |

### 세 버전 한 번에 빌드하기 (GitHub Actions)
mac 앱은 mac에서만 빌드됩니다. 이 폴더를 GitHub 저장소에 올린 뒤 **Actions → build → Run workflow** → Artifacts에서 받으세요.

### 직접 빌드하기
```bash
npm install
npm start              # 개발 모드 실행
npm run dist:win       # Windows (Windows PC에서)
npm run dist:mac-arm   # Mac Apple Silicon (Mac에서)
npm run dist:mac-intel # Mac Intel (Mac에서)
```

## 처음 실행할 때 (서명 안 된 앱)
- **Windows**: "Windows의 PC 보호" → **추가 정보 → 실행**.
- **Mac**: 앱 우클릭 → **열기**. 막히면 `xattr -cr /Applications/LectureWidget.app`
- **Mac 시스템 소리**: **시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음**에서 LectureWidget 허용 후 재실행 (macOS 13+). 안 되면 🎙 마이크 또는 BlackHole 가상 오디오 사용.

## 사용법
1. 브라우저로 ZEP 강의실 입장, 소리 켜 두기. Ollama 앱도 켜 두기.
2. 위젯에서 **🔊 시스템 소리** → **▶ 시작** (처음엔 Whisper 모델 내려받는 시간이 있어요).
3. **요약** 탭 / **받아쓰기** 탭 확인. **요약** 버튼 = 즉시 요약.
4. 끝나면 **■ 정지** → **저장**.

## 사양 팁
- 받아쓰기 30초 분량을 30초 안에 못 끝내면 점점 밀립니다. 느리면 Whisper를 base로 낮추거나, 요약 간격을 늘리세요.
- Ollama 요약과 Whisper가 같은 GPU/CPU를 나눠 써요. 사양이 낮으면 요약 간격을 5분 이상으로.

## 주의
- 강의 녹음·받아쓰기는 강사님/운영진 허락 범위 안에서 개인 학습용으로만 쓰세요.
