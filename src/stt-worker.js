// 로컬 음성 인식 (Whisper, transformers.js) — 인터넷은 모델을 처음 받을 때만 필요
import { pipeline, env } from '../node_modules/@huggingface/transformers/dist/transformers.js';

const ORT = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: ORT + 'ort-wasm-simd-threaded.asyncify.mjs',
    wasm: ORT + 'ort-wasm-simd-threaded.asyncify.wasm',
  };
}
env.allowLocalModels = false;
env.useBrowserCache = true; // 한 번 받은 모델은 앱 캐시에 저장

let asr = null;
let loadedModel = '';
let device = '';

// Whisper가 무음/잡음에서 자주 지어내는 문장
const HALLUCINATIONS = [/시청해\s*주셔서\s*감사/, /구독과\s*좋아요/, /MBC\s*뉴스/, /다음\s*영상에서/, /자막\s*(제공|by)/i, /^\s*(감사합니다|네|아)\.?\s*$/];

async function load(model) {
  if (asr && loadedModel === model) return;
  asr = null;
  const progress = (p) => {
    if (p.status === 'progress' && p.total) {
      self.postMessage({ type: 'loading', file: p.file, pct: Math.round((p.loaded / p.total) * 100) });
    }
  };
  let useGpu = false;
  try { useGpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch {}
  try {
    if (!useGpu) throw new Error('no webgpu');
    asr = await pipeline('automatic-speech-recognition', model, {
      device: 'webgpu',
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      progress_callback: progress,
    });
    device = 'GPU';
  } catch {
    asr = await pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: progress,
    });
    device = 'CPU';
  }
  loadedModel = model;
  self.postMessage({ type: 'ready', device });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data.model);
    } else if (data.type === 'transcribe') {
      await load(data.model);
      const out = await asr(data.audio, {
        language: 'korean',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      let text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text || '').trim();
      if (HALLUCINATIONS.some((re) => re.test(text))) text = '';
      self.postMessage({ type: 'result', id: data.id, text });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message || err) });
  }
};
