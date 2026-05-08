// Page: Guides landing
const GU_TOC = [
  { id: "starter", label: "Starter" },
  { id: "checkout", label: "Checkout flows" },
  { id: "scrape", label: "Scraping" },
  { id: "qa", label: "QA & monitoring" },
];
function PageGuides({ navigate, registerToc }) {
  React.useEffect(() => { registerToc?.(GU_TOC); }, []);
  return (
    <main className="d-main">
      <div className="d-crumbs"><span>Docs</span><span>›</span><span>Guides</span></div>
      <h1 className="d-page-title">Guides</h1>
      <p className="d-page-lede">End-to-end recipes for the targets and patterns you'll hit most. Each guide is a single self-contained file — copy, run, adapt.</p>

      <div className="d-prose">
        <h2 id="starter">Starter <Anchor id="starter"/></h2>
        <div className="d-card-grid cols-2">
          <DocCard emoji="🍡" title="Hello, mochi" body="Six lines: launch, navigate, screenshot. The traditional first script." onClick={() => navigate("first-script")} />
          <DocCard emoji="🧬" title="Pin a fingerprint" body="Reproduce the exact same fingerprint across runs and CI shards." onClick={() => navigate("consistency-engine")} />
        </div>

        <h2 id="checkout">Checkout flows <Anchor id="checkout"/></h2>
        <div className="d-card-grid cols-2">
          <DocCard emoji="🛒" title="Pass a Cloudflare Turnstile" body="Why direct token-pasting fails, and what mochi does instead." />
          <DocCard emoji="💳" title="DataDome on a guest checkout" body="Profile + JA4 + behavioral playback, end-to-end." />
          <DocCard emoji="📦" title="Inventory polling at 60Hz" body="Stay under detection thresholds while polling fast." />
          <DocCard emoji="🎟" title="High-frequency drops" body="Run 200 sessions in parallel without sharing fingerprints." />
        </div>

        <h2 id="scrape">Scraping <Anchor id="scrape"/></h2>
        <div className="d-card-grid cols-3">
          <DocCard emoji="🌐" title="Infinite scroll" body="Scroll like a human. Detect end-of-feed without tripping heuristics." />
          <DocCard emoji="🗂" title="JSON-LD harvesting" body="Pull structured data without rendering full DOM." />
          <DocCard emoji="🛰" title="Residential proxy pools" body="Rotate IPs without rotating fingerprints. Or vice-versa." />
        </div>

        <h2 id="qa">QA & monitoring <Anchor id="qa"/></h2>
        <div className="d-card-grid cols-2">
          <DocCard emoji="🟢" title="Synthetic monitoring" body="Run mochi on a schedule and alert when JA4 drift is detected." />
          <DocCard emoji="🧪" title="Cross-browser regression" body="Same script, every profile in your matrix, every commit." />
        </div>
      </div>

      <PageFooter navigate={navigate} prev={{id:"home",label:"Welcome"}} next={{id:"getting-started",label:"Installation"}} />
    </main>
  );
}
window.PageGuides = PageGuides;
