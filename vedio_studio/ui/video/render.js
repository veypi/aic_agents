/*
 * render.js — browser video export pipeline for the video/1 engine.
 * Zero backend, zero native binaries: deterministic per-frame DOM → canvas →
 * WebCodecs VideoEncoder (H.264) + mp4-muxer; audio via OfflineAudioContext
 * mix → AudioEncoder (AAC) → same muxer. Output: standard MP4 Blob.
 *
 *   import {exportVideo} from './render.js'
 *   const blob = await exportVideo({ engine, fps, width, height, totalFrames,
 *                                    onProgress, signal })
 *
 * Requires Chromium (WebCodecs). Falls back to an error message otherwise.
 */

import { Muxer, ArrayBufferTarget } from "./vendor/mp4-muxer.js";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmArrayBufferTarget } from "./vendor/webm-muxer.js";
import { prepareMedia, waitMediaSeek } from "./engine.js";

const SR = 48000;

/* -------------------------------------------------------- 导出格式与质量 */

/** 支持的导出格式（浏览器 WebCodecs 能力内） */
export const EXPORT_FORMATS = {
  mp4: { label: "MP4 · H.264 + AAC", ext: "mp4", mime: "video/mp4" },
  webm: { label: "WebM · VP9 + Opus", ext: "webm", mime: "video/webm" },
  "webm-vp8": { label: "WebM · VP8 + Opus", ext: "webm", mime: "video/webm" },
  wav: { label: "WAV · 仅音频", ext: "wav", mime: "audio/wav" },
};

/** 质量预设 → 视频码率（bits/pixel/frame 经验值 × 总像素 × fps） */
const QUALITY_BPP = { low: 0.06, medium: 0.12, high: 0.22 };
export function estimateBitrate(width, height, fps, quality = "medium") {
  if (typeof quality === "number" && isFinite(quality) && quality > 0) {
    // 数字：<=200 视为 Mbps，否则视为 bps
    return Math.round(quality <= 200 ? quality * 1_000_000 : quality);
  }
  const bpp = QUALITY_BPP[quality] || QUALITY_BPP.medium;
  return Math.max(500_000, Math.min(40_000_000, Math.round(width * height * fps * bpp)));
}

function videoCodecFor(format, width, height) {
  const px = width * height;
  if (format === "webm") return px > 1280 * 720 ? "vp09.00.40.08" : "vp09.00.10.08";
  if (format === "webm-vp8") return "vp8";
  // mp4 H.264
  if (px > 1280 * 720) return "avc1.4d0028"; // 1080p main 4.0
  return "avc1.42001f"; // 720p baseline 3.1
}

/** AudioBuffer(48k stereo) → 16-bit PCM WAV Blob */
function audioBufferToWav(buf) {
  const ch = buf.numberOfChannels,
    n = buf.length,
    sr = buf.sampleRate;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF");
  dv.setUint32(4, 36 + n * ch * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  ws(36, "data");
  dv.setUint32(40, n * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Blob([dv.buffer], { type: "audio/wav" });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Chromium 的 SVG-in-img 隔离文档完全不绘制 foreignObject 内嵌的 <svg>
 *  （长年未修的渲染 bug）——导出前把每个内嵌 svg 换成等价的
 *  data:image/svg+xml <img>（独立 svg 文档可正常栅格化）。
 *  缓存按 markup 命中：shape/svg 元素的动画走外层 transform，
 *  markup 跨帧不变，只有 draw 描边动画逐帧变化。 */
const svgUrlCache = new Map();
function svgToDataUrl(markup) {
  let url = svgUrlCache.get(markup);
  if (!url) {
    url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    if (svgUrlCache.size > 4000) svgUrlCache.clear();
    svgUrlCache.set(markup, url);
  }
  return url;
}
function inlineNestedSvgs(clone) {
  for (const s of [...clone.querySelectorAll("svg")]) {
    let markup = s.outerHTML;
    if (!/xmlns\s*=/.test(markup)) {
      markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const img = document.createElement("img");
    img.src = svgToDataUrl(markup);
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;display:block;";
    s.replaceWith(img);
  }
}

/** 序列化帧 DOM 为 SVG foreignObject data URL，绘制到 canvas 上（含 three 合成）。
 *  Deterministic; waits for image decode.
 *  Notes (SVG-as-image constraints):
 *   - root element MUST carry the XHTML namespace (children inherit it);
 *   - void elements MUST be self-closed (strict XML parsing);
 *   - only data: URLs are loadable inside the isolated document (no blob:);
 *   - nested <svg> inside foreignObject is NOT painted (see inlineNestedSvgs);
 *   - viewBox transforms do NOT apply to foreignObject content (CSS scale used). */
export async function drawFrameToCanvas(node, canvas, ctx, width, height) {
  const clone = node.cloneNode(true);
  inlineNestedSvgs(clone);
  // <video> 在 SVG-in-img 隔离文档中不绘制（纯黑块），且 data: 大体积 src 序列化进
  // SVG 字符串既慢又可能超限——克隆中直接移除，帧画面由下方 __mediaItems 合成。
  for (const v of [...clone.querySelectorAll("video")]) v.remove();
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  let html = clone.outerHTML;
  html = html.replace(
    /<(img|br|hr|input|meta|link|source|col|wbr|embed|area|base|track|param)(\s[^>]*?)?(?<!\/)>/g,
    "<$1$2 />",
  );
  // XML 不识别 HTML 具名实体（stagger 空格等产生的 &nbsp;）——换数值实体
  html = html.replace(/&nbsp;/g, "&#160;");
  const rootW = +((/width:(\d+)px/.exec(node.style.cssText) || [])[1] || width);
  const rootH = +((/height:(\d+)px/.exec(node.style.cssText) || [])[1] || height);
  // 分辨率缩放：Chromium 的 SVG-in-img 不对 foreignObject 应用 viewBox 变换
  // （实测内容 1:1 渲染后被裁剪），改用 CSS transform 缩放——矢量内容
  // （svg-img / 文本）在目标分辨率重新栅格化，任意分辨率都清晰。
  const sx = width / rootW,
    sy = height / rootH;
  const scaled =
    sx === 1 && sy === 1
      ? html
      : `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;position:relative">` +
        `<div style="width:${rootW}px;height:${rootH}px;transform:scale(${sx},${sy});transform-origin:0 0">${html}</div></div>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${scaled}</foreignObject></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  img.decoding = "async";
  img.src = url;

  // three 合成准备：WebGL canvas 序列化进 foreignObject 后是空白，按引擎
  // buildFrame 收集的 __threeItems（文档坐标几何/变换/透明度）直接叠加。
  // preserveDrawingBuffer=false，必须在同一任务内同步拷贝位图（await decode
  // 之后缓冲区可能已被浏览器清空），再用副本绘制。
  const items = node.__threeItems || [];
  const snaps = items.map((it) => {
    if (it.opacity <= 0.003) return null;
    const c = document.createElement("canvas");
    c.width = it.canvas.width;
    c.height = it.canvas.height;
    c.getContext("2d").drawImage(it.canvas, 0, 0);
    return c;
  });

  await img.decode();
  ctx.drawImage(img, 0, 0, width, height);

  // media 合成：活 video 元素（已 seek 到本帧，waitMediaSeek 保证）按元素几何
  // 与 object-fit 数学绘制；变换/透明度与 three 合成同一套（中心原点）。
  const mediaItems = node.__mediaItems || [];
  if (mediaItems.length) {
    mediaItems.forEach((it) => {
      const v = it.video;
      const vw = v.videoWidth || 0,
        vh = v.videoHeight || 0;
      if (!vw || !vh || it.opacity <= 0.003) return;
      let sx0 = 0,
        sy0 = 0,
        sw = vw,
        sh = vh,
        dw = it.w,
        dh = it.h,
        ox = 0,
        oy = 0;
      if (it.fit === "cover") {
        const s = Math.max(it.w / vw, it.h / vh);
        sw = it.w / s;
        sh = it.h / s;
        sx0 = (vw - sw) / 2;
        sy0 = (vh - sh) / 2;
      } else if (it.fit !== "fill") {
        // contain（默认）：完整画面居中，两侧留白
        const s = Math.min(it.w / vw, it.h / vh);
        dw = vw * s;
        dh = vh * s;
        ox = (it.w - dw) / 2;
        oy = (it.h - dh) / 2;
      }
      const w = it.w * sx,
        h = it.h * sy;
      ctx.save();
      ctx.translate((it.x + it.dx) * sx + w / 2, (it.y + it.dy) * sy + h / 2);
      if (it.rotation) ctx.rotate((it.rotation * Math.PI) / 180);
      if (it.scaleX !== 1 || it.scaleY !== 1) ctx.scale(it.scaleX, it.scaleY);
      ctx.globalAlpha = Math.max(0, Math.min(1, it.opacity));
      ctx.drawImage(v, sx0, sy0, sw, sh, -w / 2 + ox * sx, -h / 2 + oy * sy, dw * sx, dh * sy);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  if (items.length) {
    items.forEach((it, i) => {
      const snap = snaps[i];
      if (!snap) return;
      const w = it.w * sx,
        h = it.h * sy;
      ctx.save();
      ctx.translate((it.x + it.dx) * sx + w / 2, (it.y + it.dy) * sy + h / 2);
      if (it.rotation) ctx.rotate((it.rotation * Math.PI) / 180);
      if (it.scaleX !== 1 || it.scaleY !== 1) ctx.scale(it.scaleX, it.scaleY);
      ctx.globalAlpha = Math.max(0, Math.min(1, it.opacity));
      ctx.drawImage(snap, -w / 2, -h / 2, w, h);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }
}

/** Preload every asset URL (data:) into the browser image cache so frames
 *  referencing them render synchronously inside the isolated SVG document. */
async function preloadAssets(assetMap) {
  const urls = Object.values(assetMap || {}).filter((u) => /^data:/i.test(u));
  await Promise.all(
    urls.map(
      (u) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = i.onerror = res;
          i.src = u;
        }),
    ),
  );
}

function checkAbort(signal) {
  if (signal && signal.aborted) {
    const e = new Error("export cancelled");
    e.name = "AbortError";
    throw e;
  }
}

/** 编码混音进 muxer：AAC 一次性喂入；Opus 有帧长限制按 20ms(960 帧) 分块。
 *  返回 false = 当前浏览器不支持该音频编码（静默跳过音轨） */
async function encodeAudioToMuxer(mix, muxer, codec) {
  let ok = false;
  try {
    if (typeof AudioEncoder !== "undefined" && AudioEncoder.isConfigSupported) {
      const sup = await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
      ok = !!sup.supported;
    } else {
      ok = true;
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) return false;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  enc.configure({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
  const total = mix.length;
  const L = mix.getChannelData(0),
    R = mix.getChannelData(1);
  if (codec === "opus") {
    const CHUNK = 960; // 20ms @48k
    for (let off = 0; off < total; off += CHUNK) {
      const n = Math.min(CHUNK, total - off);
      const planar = new Float32Array(n * 2);
      planar.set(L.subarray(off, off + n), 0);
      planar.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / SR) * 1e6), data: planar });
      enc.encode(ad);
      ad.close();
    }
  } else {
    const planar = new Float32Array(total * 2);
    planar.set(L, 0);
    planar.set(R, total);
    const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: total, numberOfChannels: 2, timestamp: 0, data: planar });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  return true;
}

/**
 * Export the engine's document to a video/audio Blob.
 * opts: { format: 'mp4'|'webm'|'webm-vp8'|'wav' (默认 mp4),
 *         width, height, fps, totalFrames,
 *         quality: 'low'|'medium'|'high' 或 bitrate Mbps/bps 数字,
 *         onProgress({phase,pct,frame,total}), signal }
 */
export async function exportVideo(engine, opts = {}) {
  const { onProgress = () => {}, signal } = opts;
  const format = EXPORT_FORMATS[opts.format] ? opts.format : "mp4";
  const width = opts.width || engine.doc.size.width;
  const height = opts.height || engine.doc.size.height;
  const fps = opts.fps || engine.doc.fps;
  const totalFrames = opts.totalFrames || engine.doc.totalFrames;
  const fmt = EXPORT_FORMATS[format];

  onProgress({ phase: "setup", pct: 0, frame: 0, total: totalFrames });

  // ---- 纯音频路径：WAV ----
  if (format === "wav") {
    onProgress({ phase: "audio", pct: 30, frame: 0, total: totalFrames });
    const mix = await engine.renderAudioMix(totalFrames / fps);
    if (!mix) throw new Error("文档没有可导出的音轨（音乐 / 配音 / 未静音媒体）");
    checkAbort(signal);
    onProgress({ phase: "done", pct: 100, frame: totalFrames, total: totalFrames });
    return audioBufferToWav(mix);
  }

  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge 导出视频");
  }

  await preloadAssets(engine.assets);
  if (engine.prepare) await engine.prepare(); // 懒加载 three 渲染器

  const isWebm = format === "webm" || format === "webm-vp8";
  const codec = videoCodecFor(format, width, height);
  const bitrate = estimateBitrate(width, height, fps, opts.bitrate != null ? +opts.bitrate : (opts.quality || "medium"));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const hasAudio = engine.audioTracks().length > 0;
  const muxer = isWebm
    ? new WebmMuxer({
        target: new WebmArrayBufferTarget(),
        video: { codec: format === "webm" ? "V_VP9" : "V_VP8", width, height },
        ...(hasAudio ? { audio: { codec: "A_OPUS", sampleRate: SR, numberOfChannels: 2 } } : {}),
      })
    : new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width, height },
        ...(hasAudio ? { audio: { codec: "aac", sampleRate: SR, numberOfChannels: 2 } } : {}),
        fastStart: "in-memory",
      });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({
    codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: "quality",
  });

  // ---- video track: deterministic frames ----
  const BATCH = 24;
  // 预热 media 池元素（解码缓存共享，逐帧 seek 快），循环中等待 seeked 保证画面帧正确；
  // forExport：audio 元素不产生视觉（声音走混音）
  prepareMedia(engine.doc, engine.assets);
  for (let f = 0; f < totalFrames; f++) {
    checkAbort(signal);
    const node = engine.buildFrame(f, { forExport: true });
    await waitMediaSeek(node);
    await drawFrameToCanvas(node, canvas, ctx, width, height);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((f / fps) * 1e6) });
    encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
    frame.close();
    if (f % BATCH === 0) {
      onProgress({
        phase: "frames",
        pct: Math.round((f / totalFrames) * 100),
        frame: f,
        total: totalFrames,
      });
      await sleep(0); // keep UI responsive
    }
  }
  onProgress({ phase: "frames", pct: 100, frame: totalFrames, total: totalFrames });

  // ---- audio track: OfflineAudioContext mix → AAC/Opus (skip if unsupported) ----
  if (hasAudio) {
    const mix = await engine.renderAudioMix(totalFrames / fps);
    if (mix) {
      checkAbort(signal);
      onProgress({ phase: "audio", pct: 100, frame: totalFrames, total: totalFrames });
      const audioOk = await encodeAudioToMuxer(mix, muxer, isWebm ? "opus" : "mp4a.40.2");
      if (!audioOk) onProgress({ phase: "audio-skip", pct: 100, frame: totalFrames, total: totalFrames });
    }
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const buffer = muxer.target.buffer;
  onProgress({ phase: "done", pct: 100, frame: totalFrames, total: totalFrames });
  return new Blob([buffer], { type: fmt.mime });
}
