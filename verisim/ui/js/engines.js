/* VeriSim Pro - WASM engine layer (Icarus Verilog + Yosys), no UI code */
(function () {
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : ((window.VeriSimBase || '') + '/js/engines.js');
  const BASE = new URL('..', scriptUrl).href.replace(/\/$/, '');

  // 引擎源由 js/sources.js 统一配置（国内镜像 → 海外镜像 → 本地），见 window.VeriSimSources。
  async function importEngine(name, localPath) {
    if (window.VeriSimSources) return await window.VeriSimSources.loadModule(name, BASE);
    return await import(BASE + localPath);
  }

  const ivlConf = (g) => `basedir:/
module:system.vpi
generation:${g}
generation:no-specify
out:/out.vvp
iwidth:32
widthcap:65536
functor:cprop
functor:nodangle
flag:DLL=vvp.tgt
`;

  let _ivlpp = null;
  let _ivl = null;
  let _vvp = null;

  async function simRun(design, tb, onStage) {
    if (!_ivlpp) _ivlpp = (await importEngine('ivlpp', '/iverilog/ivlpp.js')).default;
    if (!_ivl) _ivl = (await importEngine('ivl', '/iverilog/ivl.js')).default;
    if (!_vvp) _vvp = (await importEngine('vvp', '/iverilog/vvp.js')).default;

    onStage && onStage('preprocess');
    const ppOut = [];
    let m = await _ivlpp({ print: s => ppOut.push(s), printErr: () => {} });
    m.FS.writeFile('/design.v', design.endsWith('\n') ? design : design + '\n');
    m.FS.writeFile('/tb.v', (tb || '').endsWith('\n') ? (tb || '') : (tb || '') + '\n');
    m.callMain(['-L', '/design.v', '/tb.v']);
    const pp = ppOut.join('\n') + '\n';

    onStage && onStage('compile');
    const err = [];
    m = await _ivl({ print: () => {}, printErr: s => err.push(s) });
    m.FS.writeFile('/ivl.conf', ivlConf('2012'));
    m.FS.writeFile('/src.v', pp);
    m.callMain(['-C/ivl.conf', '--', '/src.v']);
    let vvp = null;
    try { vvp = m.FS.readFile('/out.vvp'); } catch (_) {}
    const cleanErr = err.join('\n').split('\n')
      .filter(l => !/system\.vpi|dynamic linking not enabled/.test(l))
      .join('\n');
    if (!vvp) throw new Error(cleanErr || '编译失败 (compile failed)');

    onStage && onStage('execute');
    const out = [];
    m = await _vvp({ print: s => out.push(s), printErr: s => out.push(s) });
    m.FS.writeFile('/sim.vvp', vvp);
    m.callMain(['/sim.vvp']);
    let vcd = null;
    try { vcd = m.FS.readFile('/dump.vcd', { encoding: 'utf8' }); } catch (_) {}
    return { out: out.join('\n'), vcd, warn: cleanErr };
  }

  // ---- Yosys Web Worker (off-main-thread synthesis) ----
  let _synthWorker = null;
  let _synthReqId = 0;

  function _getSynthWorker() {
    if (!_synthWorker) {
      _synthWorker = new Worker(BASE + '/js/yosys-worker.js');
    }
    return _synthWorker;
  }

  function _getYosysUrls() {
    const urls = [];
    if (window.VeriSimSources) {
      for (const s of window.VeriSimSources.sourceList('yosys')) {
        urls.push(s.url || (BASE + '/' + (s.local || '').replace(/^\//, '')));
      }
    } else {
      urls.push(BASE + '/yosys/gen/bundle.js');
    }
    return urls;
  }

  async function synthRun(script, files, onProgress) {
    const urls = _getYosysUrls();
    const worker = _getSynthWorker();
    const id = ++_synthReqId;

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.id !== id) return;
        if (d.type === 'ok') {
          resolve({ out: d.out, files: d.files });
        } else if (d.type === 'err') {
          const err = new Error(d.error);
          if (d.out) err.out = d.out;
          reject(err);
        }
      };
      worker.onerror = (e) => {
        reject(new Error('Yosys worker error: ' + (e.message || 'unknown')));
      };
      worker.postMessage({ id, type: 'synth', urls, script, files });
    });
  }

  window.VeriSimEngines = { simRun, synthRun };
  window.__simRun = simRun;
  window.__synthRun = synthRun;
})();
