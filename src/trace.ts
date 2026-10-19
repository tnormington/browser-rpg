// In-browser frame trace (?debug=1). Rolling ~30 s of per-frame numbers in one preallocated Float64Array, plus shader links,
// long tasks and (when the platform has it) GPU time. Press T to download everything as trace-<time>.json.
// Measurement only: nothing here changes what the game renders or simulates. Without ?debug=1 main.ts never imports a trace,
// so a normal session pays nothing: no wrapper, no listener, no DOM.
import type { GameEvent } from './sim';
import type { WebGLRenderer } from 'three';


/** Event categories packed into one number per frame. */
const EV = ['swing', 'cast', 'hit', 'crit', 'hitPlayer', 'telegraph', 'slam', 'interrupt', 'kill', 'death', 'levelup', 'loot', 'drop', 'quest', 'crafted'] as const;
const EV_BIT: Record<string, number> = { swing: 0, cast: 1, interrupt: 7, kill: 8, death: 9, levelup: 10, loot: 11, drop: 12, quest: 13, crafted: 14, telegraph: 5, slam: 6 };
const evNames = (m: number) => EV.filter((_, i) => m & (1 << i));

/** Columns of one frame; each frame is a row of FIELDS.length numbers. */
const FIELDS = ['t', 'dt', 'work', 'sim', 'draw', 'hud', 'gpu', 'heap', 'calls', 'tris', 'programs', 'geoms', 'textures', 'linkMs', 'ticks', 'ev'] as const;
const F = Object.fromEntries(FIELDS.map((n, i) => [n, i])) as Record<(typeof FIELDS)[number], number>;
const W = FIELDS.length, CAP = 8192; // 8192 frames = 30 s at up to ~270 fps
const HEAP_UNKNOWN = -1, GPU_UNKNOWN = -1;

interface LinkRec { at: number; ms: number; key: string }
interface LongTask { at: number; ms: number; kind: string }

/** Program label: the material name if it has one (three prints it as SHADER_NAME), else fragment length plus its USE_* defines. */
const shaderName = (gl: WebGLRenderingContext | WebGL2RenderingContext, p: WebGLProgram): string => {
  try {
    const fs = (gl.getAttachedShaders(p) ?? []).map(s => gl.getShaderSource(s) ?? '');
    const src = fs.find(s => s.includes('gl_FragColor') || s.includes('pc_fragColor')) ?? fs[0] ?? '';
    const name = /#define SHADER_NAME (\w+)/.exec(src)?.[1];
    if (name) return name;
    const defs = [...src.matchAll(/#define (USE_\w+)/g)].map(m => m[1].slice(4)).slice(0, 8).join(',');
    return `frag${src.length}${defs ? ':' + defs : ''}`;
  } catch { return 'unknown'; }
};

/** Wraps every GL link before the game builds its context. Must run before `new Renderer`. */
export class Trace {
  /** Program links (and the blocking LINK_STATUS read that follows), newest last; capped. */
  readonly links: LinkRec[] = [];
  private pendingLinkMs = 0;
  private readonly data = new Float64Array(CAP * W);
  private n = 0; // frames ever written
  private readonly tasks: LongTask[] = [];
  private readonly marks: { at: number; what: string }[] = [];
  private renderer: WebGLRenderer | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private timer: any = null;
  private gpuState = 'not attached';
  private disjoint = 0;
  private readonly queries: { q: WebGLQuery; frame: number }[] = [];
  private queryOpen = false;
  private hasHeap = false;
  private readonly t0 = performance.now();
  // per-frame scratch
  private row = 0; private frameStart = 0; private mark = 0; private mask = 0; private ticks = 0; private prevNow = 0;
  private readonly readout: HTMLDivElement;
  private nextReadout = 0;

  constructor() {
    const links = this.links;
    const note = (ms: number, key: string, at: number) => {
      this.pendingLinkMs += ms;
      if (links.length >= 512) links.shift();
      links.push({ at, ms, key });
    };
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      const link = C.prototype.linkProgram, param = C.prototype.getProgramParameter;
      C.prototype.linkProgram = function (p: WebGLProgram) { const t = performance.now(); link.call(this, p); note(performance.now() - t, shaderName(this, p), t); };
      // three reads LINK_STATUS right after linking; on ANGLE that read is where the driver's compile actually blocks.
      C.prototype.getProgramParameter = function (p: WebGLProgram, pname: number) {
        if (pname !== this.LINK_STATUS) return param.call(this, p, pname);
        const t = performance.now(), r = param.call(this, p, pname), ms = performance.now() - t;
        if (ms >= 0.5) note(ms, `${shaderName(this, p)}:status`, t);
        return r;
      };
    }
    try {
      const obs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) { if (this.tasks.length >= 256) this.tasks.shift(); this.tasks.push({ at: e.startTime, ms: e.duration, kind: e.entryType }); }
      });
      for (const type of ['longtask', 'long-animation-frame']) { try { obs.observe({ type, buffered: false }); } catch { /* not in this browser */ } }
    } catch { /* no PerformanceObserver */ }
    this.hasHeap = !!(performance as any).memory;
    addEventListener('visibilitychange', () => this.mark_(document.hidden ? 'tab hidden' : 'tab visible'));
    addEventListener('keydown', e => { if (e.code === 'KeyT' && !e.repeat && !(e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) this.dump(); });
    this.readout = document.createElement('div');
    this.readout.style.cssText = 'position:fixed;top:2px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;font:11px/1.3 monospace;color:#9f9;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:3px;white-space:nowrap';
    document.body.appendChild(this.readout);
  }

  private mark_(what: string) { this.marks.push({ at: performance.now(), what }); }

  /** Call once the Renderer exists: switches off three's per-render stat reset (we reset per frame) and opens the GPU timer. */
  attach(renderer: WebGLRenderer) {
    this.renderer = renderer;
    renderer.info.autoReset = false; // the composer renders several times a frame; per-frame totals need one reset per frame
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) { this.gpuState = 'unavailable: not a WebGL2 context'; return; }
    this.gl = gl;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuState = this.timer ? 'available' : 'unavailable: EXT_disjoint_timer_query_webgl2 not exposed by this browser/GPU';
  }

  beginFrame(now: number) {
    this.frameStart = performance.now(); this.mask = 0; this.ticks = 0;
    this.row = (this.n % CAP) * W;
    const d = this.data, r = this.row;
    d.fill(0, r, r + W);
    d[r + F.t] = now; d[r + F.dt] = this.prevNow ? now - this.prevNow : 0; this.prevNow = now;
    d[r + F.gpu] = GPU_UNKNOWN; d[r + F.heap] = HEAP_UNKNOWN;
    this.renderer?.info.reset();
    this.mark = performance.now();
  }

  /** One sim tick finished: fold its events into this frame's mask. */
  tick(events: readonly GameEvent[]) {
    this.ticks++;
    for (const e of events) {
      if (e.t === 'hit') { this.mask |= e.target === 'player' ? 1 << 4 : 1 << 2; if (e.crit) this.mask |= 1 << 3; }
      else { const b = EV_BIT[e.t]; if (b !== undefined) this.mask |= 1 << b; }
    }
  }

  simDone() { const t = performance.now(); this.data[this.row + F.sim] = t - this.mark; this.mark = t; }

  drawStart() {
    if (!this.timer || !this.gl || this.queryOpen) return;
    const gl = this.gl, q = gl.createQuery();
    gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q); this.queryOpen = true;
    this.queries.push({ q, frame: this.n });
  }

  drawEnd() {
    const t = performance.now(); this.data[this.row + F.draw] = t - this.mark; this.mark = t;
    if (this.queryOpen && this.gl) { this.gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queryOpen = false; }
    const info = this.renderer?.info;
    if (info) {
      const d = this.data, r = this.row;
      d[r + F.calls] = info.render.calls; d[r + F.tris] = info.render.triangles; d[r + F.programs] = info.programs?.length ?? 0;
      d[r + F.geoms] = info.memory.geometries; d[r + F.textures] = info.memory.textures;
    }
  }

  endFrame() {
    const d = this.data, r = this.row, t = performance.now();
    d[r + F.hud] = t - this.mark;
    d[r + F.work] = t - this.frameStart;
    d[r + F.ticks] = this.ticks; d[r + F.ev] = this.mask;
    d[r + F.linkMs] = this.pendingLinkMs; this.pendingLinkMs = 0;
    if (this.hasHeap) d[r + F.heap] = (performance as any).memory.usedJSHeapSize / 1048576;
    this.collectGpu();
    this.n++;
    if (t > this.nextReadout) { this.nextReadout = t + 250; this.updateReadout(); }
  }

  /** Harvest finished timer queries; results arrive a few frames late and are written back into their own frame's row. */
  private collectGpu() {
    if (!this.gl || !this.queries.length) return;
    const gl = this.gl;
    if (gl.getParameter(this.timer.GPU_DISJOINT_EXT)) { this.disjoint++; for (const q of this.queries) gl.deleteQuery(q.q); this.queries.length = 0; this.queryOpen = false; return; }
    while (this.queries.length && !(this.queries.length === 1 && this.queryOpen)) {
      const { q, frame } = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (this.n - frame < CAP) this.data[(frame % CAP) * W + F.gpu] = ns / 1e6;
      gl.deleteQuery(q); this.queries.shift();
    }
    if (this.queries.length > 16) { gl.deleteQuery(this.queries.shift()!.q); } // GPU is not answering: do not grow forever
  }

  private recent(ms: number): { fps: number; worst: number } {
    const d = this.data, count = Math.min(this.n, CAP), cutoff = this.prevNow - ms;
    let sum = 0, k = 0, worst = 0;
    for (let i = 1; i <= count; i++) {
      const r = ((this.n - i) % CAP) * W;
      if (d[r + F.t] < cutoff) break;
      const dt = d[r + F.dt]; if (!dt) continue;
      sum += dt; k++; if (dt > worst) worst = dt;
    }
    return { fps: k ? 1000 * k / sum : 0, worst };
  }

  private updateReadout() {
    const { fps, worst } = this.recent(5000);
    this.readout.textContent = `${fps.toFixed(0)} fps | worst ${worst.toFixed(0)} ms (5 s) | press T to save trace`;
    this.readout.style.color = worst > 50 ? '#f66' : worst > 25 ? '#fd6' : '#9f9';
  }

  private flash(msg: string) { this.readout.textContent = msg; this.readout.style.color = '#6cf'; this.nextReadout = performance.now() + 4000; }

  /** Everything the buffer holds, oldest first, as columns, plus the frames worth looking at first. */
  snapshot() {
    const d = this.data, count = Math.min(this.n, CAP), first = this.n - count;
    const cols: Record<string, number[]> = Object.fromEntries(FIELDS.map(f => [f, [] as number[]]));
    const t0 = this.t0;
    for (let i = 0; i < count; i++) {
      const r = ((first + i) % CAP) * W;
      for (let c = 0; c < W; c++) {
        const f = FIELDS[c], v = d[r + c];
        cols[f].push(f === 't' ? Math.round((v - t0) * 100) / 100 : f === 'ev' || f === 'ticks' || f === 'calls' || f === 'tris' || f === 'programs' || f === 'geoms' || f === 'textures' ? v : Math.round(v * 100) / 100);
      }
    }
    const dts = cols.dt.slice(1).sort((a, b) => a - b), med = dts[dts.length >> 1] ?? 0;
    const spikeAt = Math.max(2 * med, med + 8);
    const spikes = cols.dt.flatMap((dt, i) => (i && (dt > spikeAt || cols.work[i] > spikeAt) ? [i] : [])).map(i => {
      const at = cols.t[i] + t0;
      return {
        frame: i, tMs: cols.t[i], dt: cols.dt[i], jsWorkMs: cols.work[i], simMs: cols.sim[i], drawMs: cols.draw[i], hudMs: cols.hud[i],
        gpuMs: cols.gpu[i] < 0 ? null : cols.gpu[i], linkMsInFrame: cols.linkMs[i], heapMB: cols.heap[i] < 0 ? null : cols.heap[i],
        heapDeltaMB: cols.heap[i] >= 0 && cols.heap[i - 1] >= 0 ? Math.round((cols.heap[i] - cols.heap[i - 1]) * 100) / 100 : null,
        drawCalls: cols.calls[i], programs: cols.programs[i], programsDelta: cols.programs[i] - cols.programs[i - 1],
        events: evNames(cols.ev[i]), eventsPrev: evNames(cols.ev[i - 1]),
        longTasks: this.tasks.filter(k => k.at + k.ms >= at - cols.dt[i] && k.at <= at).map(k => ({ kind: k.kind, ms: Math.round(k.ms * 10) / 10 })),
        linksNear: this.links.filter(l => l.at >= at - cols.dt[i] - 5 && l.at <= at).map(l => ({ key: l.key, ms: Math.round(l.ms * 10) / 10 })),
      };
    }).sort((a, b) => Math.max(b.dt, b.jsWorkMs) - Math.max(a.dt, a.jsWorkMs)).slice(0, 40);
    const cv = this.renderer?.domElement;
    return {
      format: 'frame-trace-v1',
      meta: {
        capturedAt: new Date().toISOString(), url: location.href, userAgent: navigator.userAgent, webgpuApi: 'gpu' in navigator,
        renderer: this.rendererString(), quality: (window as any).__debug?.view?.quality ?? null,
        window: { inner: [innerWidth, innerHeight], canvas: cv ? [cv.width, cv.height] : null, devicePixelRatio },
        gpuTimer: this.gpuState, gpuTimerDisjointEvents: this.disjoint, jsHeap: this.hasHeap ? 'performance.memory (Chrome; coarse, quantised)' : 'unavailable',
        bufferSeconds: Math.round(((cols.t.at(-1) ?? 0) - (cols.t[0] ?? 0)) / 10) / 100, frames: count, medianDtMs: med, spikeThresholdMs: spikeAt,
        fields: FIELDS, eventBits: EV, dumpedAtMs: Math.round((performance.now() - t0) * 100) / 100,
        notes: 'A spike is a frame whose dt (gap since the previous rAF) or work exceeds the threshold: a slow frame shows up as high work in itself and high dt in the next one. dt = gap between rAF callbacks; work = JS time inside the game callback (sim+draw+hud). dt >> work with low gpu => stall outside game JS (compositor/driver/GC/other). gpu is the whole view.draw in ms, -1/null = not measured. Heap drops at a spike = GC.',
      },
      spikes, marks: this.marks.map(m => ({ tMs: Math.round((m.at - t0) * 100) / 100, what: m.what })),
      links: this.links.map(l => ({ tMs: Math.round((l.at - t0) * 100) / 100, ms: Math.round(l.ms * 100) / 100, key: l.key })),
      longTasks: this.tasks.map(k => ({ tMs: Math.round((k.at - t0) * 100) / 100, ms: Math.round(k.ms * 10) / 10, kind: k.kind })),
      frames: cols,
    };
  }

  private rendererString(): string {
    const gl = this.gl ?? this.renderer?.getContext();
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} | ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : 'unavailable';
  }

  dump() {
    this.mark_('dump requested');
    const snap = this.snapshot();
    const name = `trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(snap)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    this.flash(`saved ${name} (${snap.meta.frames} frames, ${snap.spikes.length} spikes) to your Downloads folder`);
    return snap;
  }
}
