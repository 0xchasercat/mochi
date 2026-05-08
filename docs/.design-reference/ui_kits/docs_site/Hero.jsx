function Hero() {
  const [copied, setCopied] = React.useState(false);
  const onCopy = () => {
    navigator.clipboard?.writeText("bun add mochi");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <section className="m-hero">
      <div className="m-hero-pattern"></div>
      <div className="m-hero-inner">
        <div className="m-hero-copy">
          <div className="m-eyebrow">v0.4.2 · stealth release</div>
          <h1 className="m-h1">
            Sticky on the outside.<br/>
            <span className="m-h1-honey">Untouchable on the inside.</span>
          </h1>
          <p className="m-lede">
            <strong>mochi.js</strong> is a Bun-native, raw-CDP browser automation framework built to defeat advanced WAFs. Seed-based fingerprint shapeshifting, zero-jitter execution, and native Rust TLS impersonation. Leaves no crumbs.
          </p>
          <div className="m-hero-ctas">
            <button className="m-btn m-btn-primary" onClick={onCopy}>
              <span className="m-mono">$ bun add mochi</span>
              <span className="m-copy-ic">{copied ? "✓" : "⧉"}</span>
            </button>
            <a className="m-btn m-btn-secondary" href="#docs">Read the docs →</a>
          </div>
          <div className="m-hero-meta">
            <span className="m-chip-light">bun ≥ 1.1</span>
            <span className="m-chip-light">macOS · Linux</span>
            <span className="m-chip-light">MIT</span>
          </div>
        </div>
        <div className="m-hero-mascot">
          <div className="m-blob"></div>
          <img src="../../assets/mochi-mascot.png" alt="mochi mascot" />
        </div>
      </div>
    </section>
  );
}
window.Hero = Hero;
