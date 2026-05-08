// Page: Getting Started (Installation + first steps)
const GS_TOC = [
  { id: "requirements", label: "Requirements" },
  { id: "install",      label: "Install" },
  { id: "verify",       label: "Verify" },
  { id: "first-launch", label: "First launch" },
  { id: "next-steps",   label: "Next steps" },
];

function PageGettingStarted({ navigate, registerToc }) {
  React.useEffect(() => { registerToc?.(GS_TOC); }, []);
  return (
    <main className="d-main">
      <div className="d-crumbs"><span>Docs</span><span>›</span><span>Get started</span><span>›</span><span>Installation</span></div>
      <h1 className="d-page-title">Installation</h1>
      <p className="d-page-lede">mochi.js installs as a single Bun package. No system deps, no postinstall scripts, no hidden binaries beyond the rust-tls bridge — which is shipped pre-built per platform.</p>

      <div className="d-prose">
        <h2 id="requirements">Requirements <Anchor id="requirements"/></h2>
        <ul>
          <li><strong>Bun ≥ 1.1.31</strong> — earlier versions miss the FFI features mochi needs for the TLS bridge.</li>
          <li><strong>macOS or Linux</strong> — Windows is on the roadmap (we need to port the FD pipe transport to Win32 named pipes).</li>
          <li><strong>Chromium</strong> — bundled. Custom binaries are configurable via <code>chromium.path</code>.</li>
        </ul>

        <Callout type="info" title="Why not Node?">
          mochi.js depends on Bun-specific APIs: <code>bun:ffi</code> for the TLS bridge, the structured-clone fast path on workers, and the FD-passing pipe transport that keeps zero TCP ports open. A Node port would mean rewriting the spine.
        </Callout>

        <h2 id="install">Install <Anchor id="install"/></h2>
        <p>Add the package:</p>
        <ShellCmd cmd="bun add mochi" />
        <p>Or scaffold a fresh project from the starter:</p>
        <ShellCmd cmd="bunx create-mochi my-bot --profile mac-safari-17" />

        <h2 id="verify">Verify <Anchor id="verify"/></h2>
        <p>Confirm the install and print the loaded profile matrix. <code>--hello</code> is a no-op that boots the runtime, prints the mascot, and exits.</p>
        <ShellCmd cmd="bunx mochi --hello" />
        <Callout type="tip" title="No output?">
          If you see <code>command not found</code>, your shell hasn't picked up Bun's bin dir yet. Run <code>bun pm bin -g</code> and add it to your <code>$PATH</code>.
        </Callout>

        <h2 id="first-launch">First launch <Anchor id="first-launch"/></h2>
        <p>Three lines is enough to launch a fully-stealthed browser. Pass a <strong>profile</strong> (OS × browser × version) and an optional <strong>seed</strong> for deterministic fingerprints.</p>

        <CodeBlock
          filename="hello.ts"
          tabs={[{
            label: "TypeScript",
            tokens: [
              ["com", "// Launch a stealth browser, navigate, and screenshot.\n"],
              ["key", "import"], ["pun", " { chromium } "], ["key", "from"], ["str", " \"mochi\""], ["pun", ";"],
              "\n\n",
              ["key", "const"], ["var", " browser = "], ["key", "await"], ["fn", " chromium.launch"], ["pun", "({"],
              "\n  ", ["var", "profile"], ["pun", ": "], ["str", "\"mac-safari-17\""], ["pun", ","],
              "\n  ", ["var", "seed"], ["pun", ":    "], ["num", "0xb3a1"],
              "\n", ["pun", "});"],
              "\n\n",
              ["key", "const"], ["var", " page = "], ["key", "await"], ["fn", " browser.newPage"], ["pun", "();"],
              "\n", ["key", "await"], ["fn", " page.goto"], ["pun", "("], ["str", "\"https://example.com\""], ["pun", ");"],
              "\n", ["key", "await"], ["fn", " page.screenshot"], ["pun", "({ path: "], ["str", "\"hello.png\""], ["pun", " });"],
            ]
          }, {
            label: "JavaScript",
            tokens: [
              ["com", "// Same script, plain JS.\n"],
              ["key", "const"], ["pun", " { chromium } = "], ["key", "await"], ["fn", " import"], ["pun", "("], ["str", "\"mochi\""], ["pun", ");"],
              "\n\n",
              ["key", "const"], ["var", " browser = "], ["key", "await"], ["fn", " chromium.launch"], ["pun", "({"],
              "\n  ", ["var", "profile"], ["pun", ": "], ["str", "\"mac-safari-17\""], ["pun", ","],
              "\n  ", ["var", "seed"], ["pun", ":    "], ["num", "0xb3a1"],
              "\n", ["pun", "});"],
            ]
          }]}
        />

        <p>Run it:</p>
        <ShellCmd cmd="bun run hello.ts" />

        <Callout type="honey" title="What just happened?">
          mochi opened a CDP pipe over two file descriptors, injected a seed-derived <em>Profile Matrix</em> into the V8 isolate, and brought up a Rust TLS thread for outbound HTTPS — all before <code>chromium.launch</code> resolved.
        </Callout>

        <h2 id="next-steps">Next steps <Anchor id="next-steps"/></h2>
        <div className="d-card-grid cols-2">
          <DocCard emoji="🧬" title="The Consistency Engine" body="How a single seed produces a coherent fingerprint that survives every probe." onClick={() => navigate("consistency-engine")} />
          <DocCard emoji="🎯" title="Inverse playback" body="Make page.click feel like a real human reaching for it." onClick={() => navigate("mouse")} />
          <DocCard emoji="👻" title="Proxies & Rust TLS" body="Route traffic through residential pools without leaking JA4." onClick={() => navigate("rust-tls")} />
          <DocCard emoji="📚" title="Guides" body="End-to-end recipes for the most common scrape targets." onClick={() => navigate("guides")} />
        </div>
      </div>

      <PageFooter
        navigate={navigate}
        prev={{ id: "home", label: "Welcome" }}
        next={{ id: "consistency-engine", label: "The Consistency Engine" }}
      />
    </main>
  );
}
window.PageGettingStarted = PageGettingStarted;
