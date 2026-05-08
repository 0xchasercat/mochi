// Page: Profiles API reference
const PR_TOC = [
  { id: "overview", label: "Overview" },
  { id: "list", label: "List profiles" },
  { id: "get", label: "Get a profile" },
  { id: "examples", label: "Examples" },
];

function PageProfiles({ navigate, registerToc }) {
  React.useEffect(() => { registerToc?.(PR_TOC); }, []);
  return (
    <main className="d-main">
      <div className="d-crumbs"><span>API</span><span>›</span><span>Reference</span><span>›</span><span>Profiles</span></div>
      <h1 className="d-page-title">Profiles</h1>
      <p className="d-page-lede">A profile is a frozen snapshot of an OS × browser × version. Every probe (WebGL, audio, canvas, navigator, JA4) derives from this matrix. Pass the same <code>profile</code> + <code>seed</code> twice; get the same fingerprint twice.</p>

      <div className="d-prose">
        <h2 id="overview">Overview <Anchor id="overview"/></h2>
        <p>mochi ships ~120 production-vetted profiles. The naming convention is <code>{`<os>-<browser>-<major>`}</code>, e.g. <code>mac-safari-17</code>, <code>linux-chrome-124</code>, <code>win-edge-122</code>. Aliases like <code>latest</code> and <code>stable</code> resolve at boot.</p>

        <Callout type="warn" title="Profiles drift">
          Browser versions ship every 4–6 weeks. We bump the matrix on every <code>0.x.0</code> release. Pin to a specific version in production — using <code>latest</code> is fine for dev but will silently rotate your fingerprints between releases.
        </Callout>

        {/* List profiles --------------------------------------------------- */}
        <h2 id="list">List profiles <Anchor id="list"/></h2>
        <div className="d-api-row">
          <div>
            <Endpoint method="GET" path="profiles.list(filter?)" />
            <p>Returns the full profile matrix, optionally narrowed by an <code>os</code>, <code>browser</code>, or <code>tag</code> filter.</p>

            <ParamGroup title="Parameters">
              <Param name="os" type={'"mac" | "linux" | "win"'}>
                Restrict to a single operating system. Profiles are <em>not</em> runtime-portable — picking <code>mac-safari-17</code> on a Linux host is fine; mochi handles the impersonation.
              </Param>
              <Param name="browser" type={'"chrome" | "safari" | "edge" | "firefox"'}>
                Restrict to a single browser engine.
              </Param>
              <Param name="tag" type="string[]">
                Filter by tags. Common: <code>latest</code>, <code>stable</code>, <code>mobile</code>, <code>residential-friendly</code>.
              </Param>
            </ParamGroup>
          </div>

          <CodeBlock
            tabs={[{
              label: "Request",
              tokens: [
                ["key", "import"], ["pun", " { profiles } "], ["key", "from"], ["str", " \"mochi\""], ["pun", ";"],
                "\n\n",
                ["key", "const"], ["var", " safaris = "], ["key", "await"], ["fn", " profiles.list"], ["pun", "({"],
                "\n  ", ["var", "browser"], ["pun", ": "], ["str", "\"safari\""], ["pun", ","],
                "\n  ", ["var", "tag"], ["pun", ": ["], ["str", "\"stable\""], ["pun", "]"],
                "\n", ["pun", "});"],
              ]
            }, {
              label: "Response",
              tokens: [
                ["pun", "[\n  {\n    "], ["var", "id"], ["pun", ": "], ["str", "\"mac-safari-17\""], ["pun", ","],
                "\n    ", ["var", "os"], ["pun", ":      "], ["str", "\"mac\""], ["pun", ","],
                "\n    ", ["var", "browser"], ["pun", ": "], ["str", "\"safari\""], ["pun", ","],
                "\n    ", ["var", "version"], ["pun", ": "], ["str", "\"17.4.1\""], ["pun", ","],
                "\n    ", ["var", "ja4"], ["pun", ":     "], ["str", "\"t13d1517h2_8daaf6152771_b1ff8ab2d16f\""],
                "\n  ", ["pun", "},"],
                "\n  ", ["pun", "{ "], ["var", "id"], ["pun", ": "], ["str", "\"ios-safari-17\""], ["pun", ", … },"],
                "\n", ["pun", "]"],
              ]
            }]}
          />
        </div>

        {/* Get a profile --------------------------------------------------- */}
        <h2 id="get">Get a profile <Anchor id="get"/></h2>
        <div className="d-api-row">
          <div>
            <Endpoint method="GET" path="profiles.get(id, options?)" />
            <p>Resolves a single profile, optionally seeded. Returns the same shape as <code>list()</code> with one extra field: <code>fingerprint</code>, the deterministic snapshot for the supplied seed.</p>

            <ParamGroup title="Parameters">
              <Param name="id" type="string" required>
                The profile id (e.g. <code>mac-safari-17</code>) or an alias (<code>latest</code>, <code>stable</code>, <code>mobile</code>).
              </Param>
              <Param name="seed" type="number" defaultValue="random">
                Any 32-bit integer. The same <code>(id, seed)</code> pair always produces the same fingerprint.
              </Param>
              <Param name="lock" type={'("webgl" | "audio" | "canvas" | "navigator")[]'} defaultValue={'["webgl","audio","canvas","navigator"]'}>
                Subsystems to lock to the seed. Unlocked subsystems re-randomize per page.
              </Param>
            </ParamGroup>
          </div>

          <CodeBlock
            tabs={[{
              label: "Request",
              tokens: [
                ["key", "const"], ["var", " p = "], ["key", "await"], ["fn", " profiles.get"], ["pun", "("], ["str", "\"mac-safari-17\""], ["pun", ", {"],
                "\n  ", ["var", "seed"], ["pun", ": "], ["num", "0xb3a1"],
                "\n", ["pun", "});"],
                "\n\n",
                ["var", "p.fingerprint.webgl"], ["pun", ";"],
                "\n", ["com", "// → { unmaskedRenderer: \"Apple GPU\", … }"],
              ]
            }, {
              label: "Response",
              tokens: [
                ["pun", "{\n  "], ["var", "id"], ["pun", ":          "], ["str", "\"mac-safari-17\""], ["pun", ","],
                "\n  ", ["var", "fingerprint"], ["pun", ": {"],
                "\n    ", ["var", "webgl"], ["pun", ":    { "], ["var", "unmaskedRenderer"], ["pun", ": "], ["str", "\"Apple GPU\""], ["pun", ", … },"],
                "\n    ", ["var", "audio"], ["pun", ":    { "], ["var", "hash"], ["pun", ": "], ["str", "\"f3:91:cc:2a\""], ["pun", " },"],
                "\n    ", ["var", "canvas"], ["pun", ":   { "], ["var", "noise"], ["pun", ": "], ["num", "0.0021"], ["pun", " },"],
                "\n    ", ["var", "navigator"], ["pun", ":{ "], ["var", "ua"], ["pun", ": "], ["str", "\"Mozilla/5.0 (Macintosh; …)\""], ["pun", " }"],
                "\n  ", ["pun", "}"],
                "\n", ["pun", "}"],
              ]
            }]}
          />
        </div>

        {/* Examples -------------------------------------------------------- */}
        <h2 id="examples">Examples <Anchor id="examples"/></h2>
        <h3>Reproduce a fingerprint across runs</h3>
        <p>Pin both the profile and the seed; the resulting fingerprint is byte-identical between runs, hosts, and CI shards.</p>
        <CodeBlock
          tabs={[{
            label: "deterministic.ts",
            tokens: [
              ["key", "const"], ["var", " browser = "], ["key", "await"], ["fn", " chromium.launch"], ["pun", "({"],
              "\n  ", ["var", "profile"], ["pun", ": "], ["str", "\"mac-safari-17\""], ["pun", ","],
              "\n  ", ["var", "seed"], ["pun", ":    "], ["num", "0xb3a1"], ["com", "  // pin me"],
              "\n", ["pun", "});"],
            ]
          }]}
        />

        <h3>Rotate fingerprints on a schedule</h3>
        <p>Use <code>profiles.rotate(pattern, every)</code> to shapeshift on an interval. Rotation respects in-flight requests and never tears down a session mid-checkout.</p>
        <CodeBlock
          tabs={[{
            label: "rotate.ts",
            tokens: [
              ["fn", "profiles.rotate"], ["pun", "({"],
              "\n  ", ["var", "pattern"], ["pun", ": "], ["str", "\"mac-safari-*\""], ["pun", ","],
              "\n  ", ["var", "every"], ["pun", ":   "], ["str", "\"30m\""],
              "\n", ["pun", "});"],
            ]
          }]}
        />

        <Callout type="danger" title="Don't shapeshift mid-flow">
          Rotating profiles between <code>page.goto</code> and <code>page.click</code> in the same session is a strong detection signal. mochi will refuse and emit <code>MochiError.RotationConflict</code>.
        </Callout>
      </div>

      <PageFooter navigate={navigate} prev={{id:"consistency-engine",label:"The Consistency Engine"}} next={{id:"fingerprints",label:"Fingerprints"}} />
    </main>
  );
}
window.PageProfiles = PageProfiles;
