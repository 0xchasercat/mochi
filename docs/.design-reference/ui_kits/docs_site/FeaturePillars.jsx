const PILLARS = [
  { e: "🍡", title: "Bun-First Architecture", body: "Talks to Chrome over --remote-debugging-pipe FDs. Sub-millisecond latency. Zero open TCP ports for WAFs to scan." },
  { e: "🧬", title: "The Consistency Engine", body: "Pass a seed and a profile. WebGL, AudioContext, Canvas noise, and navigator props lock into a relationally-coherent fingerprint." },
  { e: "🦀", title: "Native Rust Networking", body: "bun:ffi bridges directly to Rust-based TLS impersonators — perfect HTTP/2 frames and JA4 signatures, no N-API overhead." },
  { e: "👻", title: "Zero-Jitter Proxies", body: "Injection payloads are TurboFan JIT-friendly. They execute at native speed and pass performance.now() micro-jitter checks." },
  { e: "🎯", title: "Inverse Behavioral Playback", body: "Replaces teleporting bot clicks with Bezier-curved trajectories built from real, red-teamed human telemetry." },
];

function FeaturePillars() {
  return (
    <section className="m-features">
      <div className="m-features-head">
        <div className="m-eyebrow">five pillars</div>
        <h2 className="m-h2">Built for the strictest probes.</h2>
        <p className="m-lede" style={{maxWidth: 640}}>Where Playwright and Puppeteer leave fingerprints, mochi.js leaves nothing. Each pillar covers one class of detection.</p>
      </div>
      <div className="m-features-grid">
        {PILLARS.map((p, i) => (
          <article key={i} className="m-feat">
            <div className="m-feat-emoji">{p.e}</div>
            <h3 className="m-feat-title">{p.title}</h3>
            <p className="m-feat-body">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
window.FeaturePillars = FeaturePillars;
