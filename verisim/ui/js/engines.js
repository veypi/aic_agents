/* VeriSim Pro - WASM engine layer (Icarus Verilog + Yosys), no UI code */
(function () {
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : ((window.VeriSimBase || '') + '/js/engines.js');
  const BASE = new URL('..', scriptUrl).href.replace(/\/$/, '');

  // 引擎源由 js/sources.js 统一配置（国内镜像 → 海外镜像 → 本地），见 window.VeriSimSources。
  async function importEngine(name, localPath, onStage) {
    if (window.VeriSimSources) return await window.VeriSimSources.loadModule(name, BASE, onStage);
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
    onStage && onStage('加载 ivlpp 引擎…');
    if (!_ivlpp) _ivlpp = (await importEngine('ivlpp', '/iverilog/ivlpp.js', onStage)).default;
    if (!_ivl) _ivl = (await importEngine('ivl', '/iverilog/ivl.js', onStage)).default;
    if (!_vvp) _vvp = (await importEngine('vvp', '/iverilog/vvp.js', onStage)).default;

    onStage && onStage('预处理 ivlpp…');
    const ppOut = [];
    let m = await _ivlpp({ print: s => ppOut.push(s), printErr: () => {} });
    m.FS.writeFile('/design.v', design.endsWith('\n') ? design : design + '\n');
    m.FS.writeFile('/tb.v', (tb || '').endsWith('\n') ? (tb || '') : (tb || '') + '\n');
    m.callMain(['-L', '/design.v', '/tb.v']);
    const pp = ppOut.join('\n') + '\n';

    onStage && onStage('编译 ivl…');
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
    if (!vvp) throw new Error(cleanErr || 'ivl 编译失败');

    onStage && onStage('仿真 vvp 运行中…');
    const out = [];
    m = await _vvp({ print: s => out.push(s), printErr: s => out.push(s) });
    m.FS.writeFile('/sim.vvp', vvp);
    m.callMain(['/sim.vvp']);
    let vcd = null;
    try { vcd = m.FS.readFile('/dump.vcd', { encoding: 'utf8' }); } catch (_) {}
    return { out: out.join('\n'), vcd, warn: cleanErr };
  }

  let _yosys = null;
  async function synthRun(script, files, onProgress) {
    if (!_yosys) _yosys = await importEngine('yosys', '/yosys/gen/bundle.js', p => onProgress && onProgress(p));
    const dec = new TextDecoder();
    let out = '';
    const opt = {
      stdout: b => { if (b) out += dec.decode(b); },
      stderr: b => { if (b) out += dec.decode(b); },
      fetchProgress: ev => onProgress && onProgress({ total: ev.totalLength, done: ev.doneLength })
    };
    try {
      const res = await _yosys.runYosys(['-p', script], files, opt);
      const text = {};
      for (const k of Object.keys(res)) {
        const v = res[k];
        if (typeof v === 'string') text[k] = v;
        else if (v instanceof Uint8Array) {
          try { text[k] = dec.decode(v); } catch (_) {}
        }
      }
      return { out, files: text };
    } catch (err) {
      throw Object.assign(new Error(err.message), { out });
    }
  }

  window.VeriSimEngines = { simRun, synthRun };
  window.__simRun = simRun;
  window.__synthRun = synthRun;
})();
