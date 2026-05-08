// Shared docs primitives — load before pages
// Exposes: Callout, CodeBlock, ShellCmd, Steps, Step, Endpoint, ParamGroup, Param, DocCard, Anchor, useCopy

function useCopy(text) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = React.useCallback(() => {
    try { navigator.clipboard?.writeText(text); } catch (_) {}
    setCopied(true);
    clearTimeout(useCopy._t);
    useCopy._t = setTimeout(() => setCopied(false), 1300);
  }, [text]);
  return [copied, onCopy];
}

function Callout({ type = "info", title, children }) {
  const icon = {
    info: "ℹ", tip: "✦", warn: "⚠", danger: "✕", honey: "🍡"
  }[type] || "ℹ";
  return (
    <div className={"d-callout t-" + type}>
      <div className="d-callout-icon">{icon}</div>
      <div>
        {title && <div className="d-callout-title">{title}</div>}
        <div className="d-callout-body">{children}</div>
      </div>
    </div>
  );
}

// Render an array of [tokenType, text] pairs
function Tokens({ tokens }) {
  return tokens.map((tk, i) => {
    if (typeof tk === 'string') return <span key={i}>{tk}</span>;
    const [t, v] = tk;
    return <span key={i} className={"t-" + t}>{v}</span>;
  });
}

function CodeBlock({ tabs, filename }) {
  // tabs: [{ label, lang, tokens, plain? }]
  const [active, setActive] = React.useState(0);
  const tab = tabs[active];
  const plain = tab.plain || (tab.tokens || []).map(t => Array.isArray(t) ? t[1] : t).join('');
  const [copied, onCopy] = useCopy(plain);
  return (
    <div className="d-code">
      <div className="d-code-tabs">
        {tabs.map((t, i) => (
          <button
            key={i}
            className={"d-code-tab" + (active === i ? " is-active" : "")}
            onClick={() => setActive(i)}
          >{t.label}</button>
        ))}
        <div className="d-code-meta">
          {filename && <span className="d-code-filename">{filename}</span>}
          <button className="d-code-copy" onClick={onCopy}>{copied ? "copied ✓" : "copy"}</button>
        </div>
      </div>
      <pre className="d-code-body">
        <Tokens tokens={tab.tokens || [tab.plain]} />
      </pre>
    </div>
  );
}

function ShellCmd({ cmd }) {
  const [copied, onCopy] = useCopy(cmd);
  return (
    <div className="d-shell-cmd">
      <span className="d-shell-prompt">$</span>
      <span>{cmd}</span>
      <button className="d-shell-copy" onClick={onCopy}>{copied ? "✓" : "copy"}</button>
    </div>
  );
}

function Steps({ children }) { return <div className="d-steps">{children}</div>; }
function Step({ title, children }) {
  return (
    <div className="d-step">
      <div className="d-step-num"></div>
      <div className="d-step-body">
        <div className="d-step-h">{title}</div>
        {children}
      </div>
    </div>
  );
}

function Endpoint({ method = "GET", path }) {
  return (
    <div className="d-endpoint">
      <span className={"d-method m-" + method.toLowerCase()}>{method}</span>
      <span>{path}</span>
    </div>
  );
}

function ParamGroup({ title = "Parameters", children }) {
  return (
    <div className="d-param-group">
      <div className="d-param-group-h">{title}</div>
      {children}
    </div>
  );
}
function Param({ name, type, required, defaultValue, children }) {
  return (
    <div className="d-param">
      <div className="d-param-head">
        <span className="d-param-name">{name}</span>
        <span className="d-param-type">{type}</span>
        {required && <span className="d-param-required">required</span>}
        {defaultValue !== undefined && <span className="d-param-default">default <span>{defaultValue}</span></span>}
      </div>
      <div className="d-param-desc">{children}</div>
    </div>
  );
}

function DocCard({ icon, emoji, title, body, onClick }) {
  return (
    <button className="d-card" onClick={onClick}>
      {emoji && <div className="d-card-emoji">{emoji}</div>}
      {icon && <div className="d-card-icon">{icon}</div>}
      <div className="d-card-title">
        {title}
        <span className="d-card-arrow">→</span>
      </div>
      <div className="d-card-body">{body}</div>
    </button>
  );
}

function Anchor({ id }) { return <a href={"#" + id} className="d-anchor" aria-label="anchor">#</a>; }

window.Callout = Callout;
window.CodeBlock = CodeBlock;
window.ShellCmd = ShellCmd;
window.Steps = Steps;
window.Step = Step;
window.Endpoint = Endpoint;
window.ParamGroup = ParamGroup;
window.Param = Param;
window.DocCard = DocCard;
window.Anchor = Anchor;
window.Tokens = Tokens;
window.useCopy = useCopy;
