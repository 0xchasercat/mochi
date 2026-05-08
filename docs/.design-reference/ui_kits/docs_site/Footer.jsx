function Footer() {
  return (
    <footer className="m-footer">
      <div className="m-footer-inner">
        <div className="m-footer-brand">
          <span className="m-wordmark-sm">mochi<span className="m-dot"></span>js</span>
          <p className="m-footer-tag">leaves no crumbs.</p>
        </div>
        <div className="m-footer-cols">
          <div>
            <div className="m-footer-h">Docs</div>
            <a href="#">Getting started</a>
            <a href="#">Profiles</a>
            <a href="#">Fingerprints</a>
            <a href="#">CLI reference</a>
          </div>
          <div>
            <div className="m-footer-h">Project</div>
            <a href="#">GitHub</a>
            <a href="#">Releases</a>
            <a href="#">Discord</a>
            <a href="#">Sponsor</a>
          </div>
          <div>
            <div className="m-footer-h">Legal</div>
            <a href="#">License (MIT)</a>
            <a href="#">Code of conduct</a>
            <a href="#">Acceptable use</a>
          </div>
        </div>
      </div>
      <div className="m-footer-bottom">
        <span>© 2026 mochi labs</span>
        <span className="m-mono">v0.4.2 · built with bun 🍡</span>
      </div>
    </footer>
  );
}
window.Footer = Footer;
