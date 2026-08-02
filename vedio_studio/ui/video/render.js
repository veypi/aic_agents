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

const SR = 48000;

function codecFor(width, height, fps) {
  const px = width * height;
  if (px > 1280 * 720) return { codec: "avc1.4d0028", bitrate: 8_000_000 }; // 1080p main 4.0
  return { codec: "avc1.42001f", bitrate: 4_000_000 }; // 720p baseline 3.1
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Serialize a frame DOM node to an SVG foreignObject data URL, then draw it
 *  onto the given canvas at (0,0). Deterministic; waits for image decode.
 *  Notes (SVG-as-image constraints):
 *   - root element MUST carry the XHTML namespace (children inherit it);
 *   - void elements MUST be self-closed (strict XML parsing);
 *   - only data: URLs are loadable inside the isolated document (no blob:). */
async function drawFrameToCanvas(node, canvas, ctx, width, height) {
  const clone = node.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  let html = clone.outerHTML;
  html = html.replace(
    /<(img|br|hr|input|meta|link|source|col|wbr|embed|area|base|track|param)(\s[^>]*?)?(?<!\/)>/g,
    "<$1$2 />",
  );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  ctx.drawImage(img, 0, 0, width, height);
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

/**
 * Export the engine's document to an MP4 Blob.
 * opts: { fps, width, height, totalFrames, onProgress({phase,pct,frame,total}), signal }
 */
export async function exportVideo(engine, opts = {}) {
  const { onProgress = () => {}, signal } = opts;
  const width = opts.width || engine.doc.size.width;
  const height = opts.height || engine.doc.size.height;
  const fps = opts.fps || engine.doc.fps;
  const totalFrames = opts.totalFrames || engine.doc.totalFrames;

  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge 导出视频");
  }

  onProgress({ phase: "setup", pct: 0, frame: 0, total: totalFrames });

  await preloadAssets(engine.assets);

  const { codec, bitrate } = codecFor(width, height, fps);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    ...(engine.audioTracks().length ? { audio: { codec: "aac", sampleRate: SR, numberOfChannels: 2 } } : {}),
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
  for (let f = 0; f < totalFrames; f++) {
    checkAbort(signal);
    const node = engine.buildFrame(f);
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

  // ---- audio track: OfflineAudioContext mix → AAC (skip if unsupported) ----
  const mix = await engine.renderAudioMix(totalFrames / fps);
  if (mix) {
    checkAbort(signal);
    onProgress({ phase: "audio", pct: 100, frame: totalFrames, total: totalFrames });
    let aacOk = false;
    try {
      if (typeof AudioEncoder !== "undefined" && AudioEncoder.isConfigSupported) {
        const sup = await AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, bitrate: 128_000,
        });
        aacOk = !!sup.supported;
      } else {
        aacOk = true; // assume supported (older Chromium)
      }
    } catch (e) {
      aacOk = false;
    }
    if (aacOk) {
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => {
          throw e;
        },
      });
      audioEncoder.configure({ codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
      const frames = mix.length; // 2-channel planar float
      const planar = new Float32Array(frames * 2);
      planar.set(mix.getChannelData(0), 0);
      planar.set(mix.getChannelData(1), frames);
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: SR,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: 0,
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      await audioEncoder.flush();
      audioEncoder.close();
    } else {
      onProgress({ phase: "audio-skip", pct: 100, frame: totalFrames, total: totalFrames });
    }
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const buffer = muxer.target.buffer;
  onProgress({ phase: "done", pct: 100, frame: totalFrames, total: totalFrames });
  return new Blob([buffer], { type: "video/mp4" });
}
