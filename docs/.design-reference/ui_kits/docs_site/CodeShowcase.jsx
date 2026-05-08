const SAMPLES = {
  launch: [
    ['c', '// boot a stealth browser in three lines'],
    ['k', 'import'], ['t', ' { chromium } '], ['k', 'from'], ['s', ' "mochi"'], ['p', ';'],
    ['n', '\n'],
    ['k', 'const'], ['t', ' browser = '], ['k', 'await'], ['f', ' chromium.launch'], ['p', '({'],
    ['n', '\n  '], ['t', 'profile'], ['p', ': '], ['s', '"mac-safari-17"'], ['p', ','],
    ['n', '\n  '], ['t', 'seed'], ['p', ':    '], ['num', '0xb3a1'], ['p', ','],
    ['n', '\n  '], ['t', 'proxy'], ['p', ':   '], ['s', '"http://us-east.mochi.proxy:443"'],
    ['n', '\n'], ['p', '});'],
    ['n', '\n\n'],
    ['k', 'const'], ['t', ' page = '], ['k', 'await'], ['f', ' browser.newPage'], ['p', '();'],
    ['n', '\n'], ['k', 'await'], ['f', ' page.goto'], ['p', '('], ['s', '"https://target.example/checkout"'], ['p', ');'],
  ],
  fingerprint: [
    ['c', '// shapeshift a relationally-coherent fingerprint'],
    ['k', 'const'], ['t', ' fp = '], ['k', 'await'], ['f', ' page.fingerprint'], ['p', '({'],
    ['n', '\n  '], ['t', 'seed'], ['p', ': '], ['num', '0xb3a1'], ['p', ','],
    ['n', '\n  '], ['t', 'lock'], ['p', ': ['], ['s', '"webgl"'], ['p', ', '], ['s', '"audio"'], ['p', ', '], ['s', '"canvas"'], ['p', ', '], ['s', '"navigator"'], ['p', ']'],
    ['n', '\n'], ['p', '});'],
    ['n', '\n\n'],
    ['c', '// every probe sees the same Mac + Safari 17 reality'],
    ['t', 'fp.webgl.unmaskedRenderer'], ['p', '; '], ['c', '// "Apple GPU"'],
  ],
  human: [
    ['c', '// replay a real human trajectory'],
    ['k', 'await'], ['f', ' page.mouse.moveHuman'], ['p', '({'],
    ['n', '\n  '], ['t', 'to'], ['p', ': { x: '], ['num', '420'], ['p', ', y: '], ['num', '318'], ['p', ' },'],
    ['n', '\n  '], ['t', 'curve'], ['p', ': '], ['s', '"bezier"'], ['p', ','],
    ['n', '\n  '], ['t', 'jitter'], ['p', ': '], ['s', '"natural"'],
    ['n', '\n'], ['p', '});'],
    ['n', '\n'], ['k', 'await'], ['f', ' page.click'], ['p', '('], ['s', '"#submit"'], ['p', ');'],
  ],
};
const COLORS = { c: '#5b6178', k: '#f5b65a', t: '#ece6d6', s: '#7dcb9a', p: '#9aa0b3', num: '#f5b65a', f: '#8db1ea', n: '#ece6d6' };

function CodeShowcase() {
  const [tab, setTab] = React.useState('launch');
  const [copied, setCopied] = React.useState(false);
  const onCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return (
    <section className="m-code-show">
      <div className="m-code-head">
        <div className="m-eyebrow">three-line stealth</div>
        <h2 className="m-h2">Same Playwright muscle memory.<br/>None of the crumbs.</h2>
      </div>
      <div className="m-code-frame">
        <div className="m-code-tabs">
          {[['launch','launch.ts'],['fingerprint','fingerprint.ts'],['human','human.ts']].map(([k,l]) => (
            <button key={k} className={"m-code-tab"+(tab===k?" is-active":"")} onClick={() => setTab(k)}>{l}</button>
          ))}
          <button className="m-code-copy" onClick={onCopy}>{copied ? "copied ✓" : "copy"}</button>
        </div>
        <pre className="m-code-body">
          {SAMPLES[tab].map(([t, v], i) => (
            <span key={i} style={{color: COLORS[t], whiteSpace: 'pre'}}>{v}</span>
          ))}
        </pre>
      </div>
    </section>
  );
}
window.CodeShowcase = CodeShowcase;
