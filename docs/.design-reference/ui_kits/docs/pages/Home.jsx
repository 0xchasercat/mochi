// Page: Home (landing on docs)
function PageHome({ navigate }) {
  return (
    <main className="d-main">
      <div className="d-crumbs"><span>Docs</span></div>
      <h1 className="d-page-title">Welcome to mochi.js</h1>
      <p className="d-page-lede">A Bun-native, raw-CDP browser automation framework — built to defeat advanced WAFs where Playwright and Puppeteer fail. Sticky on the outside. Untouchable on the inside.</p>

      <div className="d-pillars">
        <div className="d-pillar"><span className="d-pillar-emoji">🍡</span><div className="d-pillar-text"><span className="d-pillar-h">Bun-First</span><span className="d-pillar-s">CDP over FDs · sub-ms latency</span></div></div>
        <div className="d-pillar"><span className="d-pillar-emoji">🧬</span><div className="d-pillar-text"><span className="d-pillar-h">Consistency Engine</span><span className="d-pillar-s">Seed-locked fingerprints</span></div></div>
        <div className="d-pillar"><span className="d-pillar-emoji">🦀</span><div className="d-pillar-text"><span className="d-pillar-h">Native Rust TLS</span><span className="d-pillar-s">JA4-perfect via bun:ffi</span></div></div>
        <div className="d-pillar"><span className="d-pillar-emoji">👻</span><div className="d-pillar-text"><span className="d-pillar-h">Zero-Jitter</span><span className="d-pillar-s">TurboFan-friendly injection</span></div></div>
      </div>

      <div className="d-prose">
        <h2 id="start-here">Start here<Anchor id="start-here"/></h2>
        <div className="d-card-grid cols-2">
          <DocCard emoji="🍡" title="Installation" body="Add mochi to your Bun project in 30 seconds." onClick={() => navigate("getting-started")} />
          <DocCard emoji="✦" title="Your first script" body="Launch a stealth browser and pass a DataDome challenge." onClick={() => navigate("first-script")} />
          <DocCard emoji="🧬" title="Consistency Engine" body="How mochi locks WebGL, audio, and canvas into one coherent fingerprint." onClick={() => navigate("consistency-engine")} />
          <DocCard emoji="📚" title="Browse guides" body="Recipes for checkout, infinite scroll, captcha-walls, and more." onClick={() => navigate("guides")} />
        </div>

        <h2 id="popular">Popular<Anchor id="popular"/></h2>
        <div className="d-card-grid cols-3">
          <DocCard title="Profiles API" body="GET /profiles — every supported OS × browser × version matrix." onClick={() => navigate("profiles")} />
          <DocCard title="JA4 spoofing" body="The TLS handshake mochi sends, frame-by-frame." onClick={() => navigate("ja4")} />
          <DocCard title="Inverse playback" body="Replay real human telemetry as Bezier mouse curves." onClick={() => navigate("mouse")} />
        </div>
      </div>

      <PageFooter navigate={navigate} next={{id: "getting-started", label: "Installation"}} />
    </main>
  );
}
window.PageHome = PageHome;
