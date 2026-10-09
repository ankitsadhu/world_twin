// Record your game and share it: F8 (or the Record button) starts / stops a clip of the canvas (webm/mp4 via MediaRecorder,
// no server). On stop the clip downloads, or opens the phone's share sheet when it can. Max 60 s.
export class Clip {
  constructor({ canvas, toast }) {
    Object.assign(this, { canvas, toast });
    this.rec = null; this.chunks = []; this.timer = null;
    this.btn = document.createElement("button");
    this.btn.id = "recbtn"; this.btn.type = "button"; this.btn.setAttribute("aria-label", "Record screen (F8)");
    this.btn.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));z-index:30;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(20,20,24,.72);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(8px)";
    document.body.appendChild(this.btn);
    this.paint(false);
    this.btn.addEventListener("click", () => { this.btn.blur(); this.toggle(); });
    this.btn.addEventListener("keydown", e => e.stopPropagation());
    this.onChange = on => this.paint(on);
    addEventListener("keydown", e => { if (e.code === "F8" && !e.repeat) { e.preventDefault(); this.toggle(); } });
  }
  paint(on) {
    clearInterval(this.tick);
    const dot = `<span style="width:10px;height:10px;border-radius:50%;background:#ff3b30;${on ? "animation:recpulse 1s infinite" : ""}"></span>`;
    if (!document.getElementById("recstyle")) { const st = document.createElement("style"); st.id = "recstyle"; st.textContent = "@keyframes recpulse{50%{opacity:.3}}"; document.head.appendChild(st); }
    this.btn.style.display = on ? "flex" : "none";                  // only shown while recording (to stop it)
    if (!on) return;
    const t0 = Date.now(), draw = () => { const s = Math.floor((Date.now() - t0) / 1000); this.btn.innerHTML = dot + `Stop · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    draw(); this.tick = setInterval(draw, 500);
  }
  // ---- auto highlights: two staggered recorders keep the last ~6-12 s of play; after a big moment we offer to save that stretch
  startBuffer() {
    if (this.buf || !window.MediaRecorder || !this.canvas.captureStream) return;
    this.type = ["video/webm;codecs=vp9", "video/webm", "video/mp4"].find(t => MediaRecorder.isTypeSupported(t));
    if (!this.type) return;
    this.stream = this.canvas.captureStream(24);
    this.buf = [this.spawnBuf(), null];
    setTimeout(() => { if (this.buf) this.buf[1] = this.spawnBuf(); }, 6000);
    this.rot = setInterval(() => {                                       // every 12 s the older recorder is replaced by a fresh one
      if (!this.buf) return;
      const i = this.buf[0] && (!this.buf[1] || this.buf[0].t0 < this.buf[1].t0) ? 0 : 1;
      this.buf[i]?.rec.state !== "inactive" && this.buf[i]?.rec.stop();
      this.buf[i] = this.spawnBuf();
    }, 12000);
  }
  spawnBuf() {
    const b = { chunks: [], t0: performance.now(), rec: new MediaRecorder(this.stream, { mimeType: this.type, videoBitsPerSecond: 3e6 }) };
    b.rec.ondataavailable = e => e.data.size && b.chunks.push(e.data);
    b.rec.start(1000);
    return b;
  }
  stopBuffer() { clearInterval(this.rot); for (const b of this.buf || []) if (b?.rec.state !== "inactive") b?.rec.stop(); this.buf = null; }
  // after something big: wait a moment (so the clip includes the aftermath), then freeze the oldest-running buffer and offer it
  highlight(label = "Great moment") {
    if (!this.buf || this.pending || this.on) return;
    this.pending = true;
    setTimeout(() => {
      const ready = this.buf?.filter(b => b && performance.now() - b.t0 > 4000).sort((a, b) => a.t0 - b.t0)[0];
      this.pending = false;
      if (!ready) return;
      const { rec, chunks } = ready;
      this.buf[this.buf.indexOf(ready)] = null;
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: this.type.split(";")[0] });
        this.ask?.(`${label}! Save the clip?`, [["Save clip", () => this.share(blob), true], ["No thanks", () => {}]], { ms: 9000, key: "highlight" });
        this.buf && (this.buf[this.buf.indexOf(null)] = this.spawnBuf());
      };
      rec.stop();
    }, 2500);
  }
  async share(blob) {
    import("./analytics.js").then(({ Analytics }) => Analytics.first("clip_saved"));
    const ext = this.type.startsWith("video/mp4") ? "mp4" : "webm";
    const file = new File([blob], `times-square-highlight.${ext}`, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "My Times Square run" }); return; } catch { /* cancelled */ } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000); this.toast?.("Clip saved");
  }

  get on() { return !!this.rec; }
  toggle() { return this.on ? this.stop() : this.start(); }
  start() {
    if (!window.MediaRecorder || !this.canvas.captureStream) return this.toast?.("This browser can't record clips");
    const type = ["video/webm;codecs=vp9", "video/webm", "video/mp4"].find(t => MediaRecorder.isTypeSupported(t));
    this.chunks = [];
    this.rec = new MediaRecorder(this.canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 6e6 });
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => this.save(type);
    this.rec.start(1000);
    this.timer = setTimeout(() => this.stop(), 60000);
    this.toast?.("Recording · F8 to stop and save");
    this.onChange?.(true);
  }
  stop() {
    clearTimeout(this.timer);
    const r = this.rec; this.rec = null;
    if (r && r.state !== "inactive") r.stop();
    this.onChange?.(false);
  }
  async save(type) {
    const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
    const file = new File(this.chunks, `times-square-clip.${ext}`, { type: type.split(";")[0] });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "My Times Square run" }); return; } catch { /* cancelled: fall back to download */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    this.toast?.("Clip saved");
  }
}
