// TopNav, Sidebar, TOC, Footer, SearchModal, ThemeToggle
// All exposed on window.

const NAV_TABS = [
  { id: "docs",   label: "Docs",      route: "getting-started" },
  { id: "guides", label: "Guides",    route: "guides" },
  { id: "api",    label: "API",       route: "profiles" },
  { id: "changelog", label: "Changelog", route: "changelog" },
];

function TopNav({ route, navigate, openSearch, theme, toggleTheme }) {
  const activeTab = (
    route === "guides" ? "guides" :
    route === "profiles" ? "api" :
    route === "changelog" ? "changelog" :
    "docs"
  );
  return (
    <header className="d-nav">
      <a className="d-nav-brand" href="#" onClick={(e) => { e.preventDefault(); navigate("home"); }}>
        <span className="d-wordmark">mochi<span className="d-dot"></span>js</span>
        <span className="d-nav-tag">docs</span>
      </a>
      <nav className="d-nav-links">
        {NAV_TABS.map(t => (
          <a key={t.id}
             href="#"
             className={activeTab === t.id ? "is-active" : ""}
             onClick={(e) => { e.preventDefault(); navigate(t.route); }}>
            {t.label}
          </a>
        ))}
      </nav>
      <div className="d-nav-actions">
        <button className="d-search" onClick={openSearch}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <span className="d-search-text">Search docs…</span>
          <span className="d-kbd">⌘ K</span>
        </button>
        <button className="d-version">
          <span className="d-version-dot"></span>
          v0.4.2
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <button className="d-icon-btn" title="GitHub">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a10.93 10.93 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.8.56 4.56-1.52 7.84-5.83 7.84-10.91C23.5 5.65 18.35.5 12 .5z"/></svg>
        </button>
        <button className="d-icon-btn" title="Toggle theme" onClick={toggleTheme}>
          {theme === "stealth"
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
        </button>
      </div>
    </header>
  );
}

const SIDEBAR = [
  { h: "🍡", label: "Get Started", links: [
    { id: "home", label: "Welcome" },
    { id: "getting-started", label: "Installation" },
    { id: "first-script", label: "Your first script" },
    { id: "concepts", label: "Concepts" },
  ]},
  { h: "🧬", label: "Core", links: [
    { id: "consistency-engine", label: "The Consistency Engine" },
    { id: "profiles", label: "Profiles", tag: "api" },
    { id: "fingerprints", label: "Fingerprints" },
    { id: "stealth-mode", label: "Stealth Mode" },
  ]},
  { h: "👻", label: "Networking", links: [
    { id: "rust-tls", label: "Rust TLS bridge" },
    { id: "ja4", label: "JA4 spoofing" },
    { id: "proxies", label: "Proxies" },
    { id: "http2", label: "HTTP/2 frames" },
  ]},
  { h: "🎯", label: "Behavior", links: [
    { id: "mouse", label: "Inverse playback" },
    { id: "typing", label: "Human typing" },
    { id: "scroll", label: "Natural scroll" },
  ]},
  { h: "🦀", label: "Advanced", links: [
    { id: "ffi", label: "bun:ffi internals" },
    { id: "isolates", label: "V8 isolates" },
    { id: "telemetry", label: "Telemetry replay", tag: "new" },
  ]},
];

function Sidebar({ route, navigate }) {
  return (
    <aside className="d-side">
      {SIDEBAR.map((sec, i) => (
        <div key={i} className="d-side-section">
          <div className="d-side-h">
            <span className="d-side-h-emoji">{sec.h}</span>
            {sec.label}
          </div>
          {sec.links.map(l => (
            <a
              key={l.id}
              className={"d-side-link" + (route === l.id ? " is-active" : "")}
              onClick={() => navigate(l.id)}
            >
              <span>{l.label}</span>
              {l.tag === "api" && <span className="d-side-link-tag t-get">GET</span>}
              {l.tag === "new" && <span className="d-side-link-tag t-new">new</span>}
            </a>
          ))}
        </div>
      ))}
    </aside>
  );
}

function Toc({ items, active }) {
  return (
    <aside className="d-toc">
      <div className="d-toc-h">On this page</div>
      {items.map((it, i) => (
        <a
          key={i}
          href={"#" + it.id}
          className={"d-toc-link" + (it.sub ? " is-sub" : "") + (active === it.id ? " is-active" : "")}
        >{it.label}</a>
      ))}
      <div className="d-toc-edit">
        <a href="#"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Edit on GitHub</a>
        <a href="#"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg> Last updated 2d ago</a>
      </div>
      <div className="d-toc-meta">
        <span>shipped in <strong>v0.4.0</strong></span>
        <span>tested with bun ≥ 1.1.31</span>
      </div>
    </aside>
  );
}

function PageFooter({ prev, next, navigate }) {
  return (
    <div className="d-pagefooter">
      {prev ? (
        <button className="d-pf" onClick={() => navigate(prev.id)}>
          <span className="d-pf-label">← Previous</span>
          <span className="d-pf-title"><span className="d-pf-arr">‹</span> {prev.label}</span>
        </button>
      ) : <span></span>}
      {next ? (
        <button className="d-pf is-next" onClick={() => navigate(next.id)}>
          <span className="d-pf-label">Next →</span>
          <span className="d-pf-title">{next.label} <span className="d-pf-arr">›</span></span>
        </button>
      ) : <span></span>}
    </div>
  );
}

const SEARCH_INDEX = [
  { sec: "Get started", title: "Installation", sub: "bun add mochi", id: "getting-started" },
  { sec: "Get started", title: "Your first script", sub: "Launch a stealth browser in 6 lines", id: "first-script" },
  { sec: "Core", title: "The Consistency Engine", sub: "Seed-based fingerprint shapeshifting", id: "consistency-engine" },
  { sec: "Core", title: "Profiles", sub: "API · GET /profiles", id: "profiles" },
  { sec: "Core", title: "Fingerprints", sub: "WebGL, AudioContext, Canvas", id: "fingerprints" },
  { sec: "Networking", title: "Rust TLS bridge", sub: "bun:ffi to rustls — JA4 perfect", id: "rust-tls" },
  { sec: "Networking", title: "Proxies", sub: "Zero-jitter injection", id: "proxies" },
  { sec: "Behavior", title: "Inverse playback", sub: "Bezier mouse from real telemetry", id: "mouse" },
];

function SearchModal({ open, onClose, navigate }) {
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (open) {
      setQ(""); setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);
  const results = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return SEARCH_INDEX;
    return SEARCH_INDEX.filter(r =>
      r.title.toLowerCase().includes(term) ||
      r.sub.toLowerCase().includes(term) ||
      r.sec.toLowerCase().includes(term)
    );
  }, [q]);
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(results.length - 1, i + 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    if (e.key === "Enter")     { e.preventDefault(); const r = results[idx]; if (r) { navigate(r.id); onClose(); } }
    if (e.key === "Escape")    { onClose(); }
  };
  if (!open) return null;
  // group by sec
  const groups = {};
  results.forEach((r, i) => { (groups[r.sec] = groups[r.sec] || []).push({ ...r, _i: i }); });
  return (
    <div className="d-search-overlay" onClick={onClose}>
      <div className="d-search-modal" onClick={e => e.stopPropagation()}>
        <div className="d-search-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{color: 'var(--fg-muted)'}}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input
            ref={inputRef}
            className="d-search-input"
            placeholder="Search docs, API, guides…"
            value={q}
            onChange={e => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={onKey}
          />
          <span className="d-kbd">esc</span>
        </div>
        <div className="d-search-results">
          {Object.keys(groups).length === 0 && (
            <div style={{padding: '40px 20px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 14}}>
              <div style={{fontSize: 28, marginBottom: 8}}>🍡</div>
              No crumbs match "{q}".
            </div>
          )}
          {Object.entries(groups).map(([sec, rs]) => (
            <div key={sec}>
              <div className="d-search-section-h">{sec}</div>
              {rs.map(r => (
                <div
                  key={r.id}
                  className={"d-search-result" + (idx === r._i ? " is-active" : "")}
                  onMouseEnter={() => setIdx(r._i)}
                  onClick={() => { navigate(r.id); onClose(); }}
                >
                  <span className="d-search-result-ic">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </span>
                  <div>
                    <div className="d-search-result-title">{r.title}</div>
                    <div className="d-search-result-sub">{r.sub}</div>
                  </div>
                  <span className="d-search-result-kbd">↵</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="d-search-foot">
          <span><span className="d-kbd">↑</span> <span className="d-kbd">↓</span> navigate</span>
          <span><span className="d-kbd">↵</span> open</span>
          <span><span className="d-kbd">esc</span> close</span>
          <span style={{marginLeft: 'auto'}}>powered by <strong style={{color: 'var(--mochi-honey-600)'}}>mochi search</strong> 🍡</span>
        </div>
      </div>
    </div>
  );
}

window.TopNav = TopNav;
window.Sidebar = Sidebar;
window.Toc = Toc;
window.PageFooter = PageFooter;
window.SearchModal = SearchModal;
window.SIDEBAR = SIDEBAR;
