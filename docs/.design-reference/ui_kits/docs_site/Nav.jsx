function Nav() {
  return (
    <nav className="m-nav">
      <a className="m-nav-brand" href="#">
        <span className="m-wordmark-sm">
          mochi<span className="m-dot"></span>js
        </span>
      </a>
      <div className="m-nav-links">
        <a href="#docs">Docs</a>
        <a href="#api">API</a>
        <a href="#profiles">Profiles</a>
        <a href="#changelog">Changelog</a>
      </div>
      <div className="m-nav-actions">
        <button className="m-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <span>Search</span>
          <span className="m-kbd">⌘K</span>
        </button>
        <a className="m-btn m-btn-ghost-sm" href="#">GitHub</a>
        <a className="m-btn m-btn-primary-sm" href="#">Install</a>
      </div>
    </nav>
  );
}
window.Nav = Nav;
