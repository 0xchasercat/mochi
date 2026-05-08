function MochiBanner() {
  return (
    <div className="t-banner">
      <pre className="t-ascii">{`     .--""""--.
    /  _  _   \\
   |  (o)(o)   |    mochi.js v0.4.2
   |   .-.     |    sticky on the outside.
    \\ (___)  /     untouchable on the inside.
     '------'`}</pre>
      <div className="t-banner-meta">
        <span className="t-chip t-chip-honey">bun 1.1.31</span>
        <span className="t-chip t-chip-honey">chromium 124.0</span>
        <span className="t-chip t-chip-honey">rust-tls 0.9.2</span>
      </div>
    </div>
  );
}
window.MochiBanner = MochiBanner;
