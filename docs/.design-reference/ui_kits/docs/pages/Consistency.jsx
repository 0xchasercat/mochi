// Page: The Consistency Engine (concept)
const CE_TOC = [
  { id: "what",   label: "What it does" },
  { id: "how",    label: "How it works" },
  { id: "subsystems", label: "Subsystems" },
  { id: "seeds",  label: "Seeds & rotation" },
];

function PageConsistency({ navigate, registerToc }) {
  React.useEffect(() => { registerToc?.(CE_TOC); }, []);
  return (
    <main className="d-main">
      <div className="d-crumbs"><span>Docs</span><span>›</span><span>Core</span><span>›</span><span>The Consistency Engine</span></div>
      <h1 className="d-page-title">The Consistency Engine</h1>
      <p className="d-page-lede">Anti-bot vendors don't catch you because one signal looks weird — they catch you because two signals <em>disagree</em>. The Consistency Engine guarantees they never will.</p>

      <div className="d-prose">
        <h2 id="what">What it does <Anchor id="what"/></h2>
        <p>Pass a <strong>seed</strong> + a <strong>profile</strong>; the engine derives a coherent fingerprint snapshot — WebGL renderer, AudioContext fan-out, Canvas noise, navigator props, and the JA4 the TLS bridge will send — all from the same root entropy.</p>

        <div className="d-diagram">
          <svg viewBox="0 0 720 220" width="100%" style={{display:'block'}}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill="#e89425"/>
              </marker>
            </defs>
            {/* seed + profile */}
            <g>
              <rect x="20" y="80" width="160" height="60" rx="14" fill="#1b2447"/>
              <text x="100" y="106" textAnchor="middle" fontFamily="Nunito" fontWeight="800" fontSize="14" fill="#fdf3df">seed 0xb3a1</text>
              <text x="100" y="126" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="11" fill="#f5b65a">+ mac-safari-17</text>
            </g>
            {/* engine */}
            <g>
              <rect x="240" y="60" width="200" height="100" rx="20" fill="#fdf3df" stroke="#e89425" strokeWidth="2"/>
              <text x="340" y="98" textAnchor="middle" fontFamily="Nunito" fontWeight="800" fontSize="16" fill="#1b2447">Consistency Engine</text>
              <text x="340" y="120" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="10" fill="#c5791a">deterministic, V8-isolate-injected</text>
              <text x="340" y="140" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="11" fill="#1b2447">🧬</text>
            </g>
            {/* outputs */}
            <g fontFamily="JetBrains Mono" fontSize="11" fill="#1b2447">
              <rect x="500" y="20" width="200" height="32" rx="10" fill="#fff" stroke="#e6d6b6"/>
              <text x="514" y="40">webgl: Apple GPU</text>
              <rect x="500" y="62" width="200" height="32" rx="10" fill="#fff" stroke="#e6d6b6"/>
              <text x="514" y="82">audio: f3:91:cc:2a</text>
              <rect x="500" y="104" width="200" height="32" rx="10" fill="#fff" stroke="#e6d6b6"/>
              <text x="514" y="124">canvas: Δ 0.0021</text>
              <rect x="500" y="146" width="200" height="32" rx="10" fill="#fff" stroke="#e6d6b6"/>
              <text x="514" y="166">navigator: Safari/17.4</text>
              <rect x="500" y="188" width="200" height="22" rx="8" fill="#1b2447"/>
              <text x="514" y="203" fill="#f5b65a">JA4: t13d1517h2_…</text>
            </g>
            {/* arrows */}
            <line x1="180" y1="110" x2="240" y2="110" stroke="#e89425" strokeWidth="2" markerEnd="url(#arr)"/>
            <line x1="440" y1="90"  x2="500" y2="36"  stroke="#e89425" strokeWidth="1.5" markerEnd="url(#arr)"/>
            <line x1="440" y1="100" x2="500" y2="78"  stroke="#e89425" strokeWidth="1.5" markerEnd="url(#arr)"/>
            <line x1="440" y1="115" x2="500" y2="120" stroke="#e89425" strokeWidth="1.5" markerEnd="url(#arr)"/>
            <line x1="440" y1="125" x2="500" y2="162" stroke="#e89425" strokeWidth="1.5" markerEnd="url(#arr)"/>
            <line x1="440" y1="140" x2="500" y2="199" stroke="#e89425" strokeWidth="1.5" markerEnd="url(#arr)"/>
          </svg>
        </div>

        <h2 id="how">How it works <Anchor id="how"/></h2>
        <p>The engine runs <em>before</em> the page's first JavaScript. We inject a 4 KB bootloader into the V8 isolate over the CDP pipe; it overrides the relevant globals (<code>WebGLRenderingContext.prototype.getParameter</code>, <code>OfflineAudioContext.prototype.startRendering</code>, etc.) with stubs that read from the seed-derived snapshot.</p>

        <Callout type="honey" title="Why a single seed?">
          A coherent fingerprint isn't 5 random values; it's 5 values <em>drawn from the same distribution</em>. A Mac Safari 17 user's WebGL renderer is "Apple GPU" — and their AudioContext fan-out has a specific shape. The seed is what keeps them in sync.
        </Callout>

        <h2 id="subsystems">Subsystems <Anchor id="subsystems"/></h2>
        <div className="d-card-grid cols-2">
          <DocCard emoji="🖼" title="WebGL" body="Locks unmaskedVendor, unmaskedRenderer, supported extensions, shader precision." />
          <DocCard emoji="🔊" title="AudioContext" body="Stable fan-out shape on OfflineAudioContext startRendering hashes." />
          <DocCard emoji="🎨" title="Canvas" body="Sub-pixel noise pattern is seed-derived; survives data-URL re-hashing." />
          <DocCard emoji="🧭" title="Navigator" body="UA, platform, deviceMemory, hardwareConcurrency, language fan-out." />
        </div>

        <h2 id="seeds">Seeds & rotation <Anchor id="seeds"/></h2>
        <p>A seed is any 32-bit integer. The same <code>(profile, seed)</code> pair always produces the same fingerprint — across runs, hosts, and CI shards.</p>
        <CodeBlock
          tabs={[{
            label: "deterministic.ts",
            tokens: [
              ["com", "// Pin a seed in production. Bytewise reproducible."],
              "\n", ["key", "const"], ["var", " browser = "], ["key", "await"], ["fn", " chromium.launch"], ["pun", "({"],
              "\n  ", ["var", "profile"], ["pun", ": "], ["str", "\"mac-safari-17\""], ["pun", ","],
              "\n  ", ["var", "seed"], ["pun", ":    "], ["num", "0xb3a1"],
              "\n", ["pun", "});"],
            ]
          }]}
        />
        <Callout type="warn" title="Rotate, don't randomize">
          A naive <code>seed: Date.now()</code> randomizes per launch, but it doesn't <em>distribute</em> — your fingerprints cluster around recent timestamps. Use <code>profiles.rotate</code> for production-grade rotation that draws from the matrix.
        </Callout>
      </div>

      <PageFooter navigate={navigate} prev={{id:"first-script",label:"Your first script"}} next={{id:"profiles",label:"Profiles"}} />
    </main>
  );
}
window.PageConsistency = PageConsistency;
