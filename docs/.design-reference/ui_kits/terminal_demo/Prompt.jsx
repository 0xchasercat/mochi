function Prompt({ cmd, typed = true }) {
  return (
    <div className="t-line">
      <span className="t-prompt">
        <span className="t-prompt-host">mochi</span>
        <span className="t-prompt-arrow">›</span>
      </span>
      <span className="t-cmd">{cmd}</span>
      {typed && <span className="t-caret"></span>}
    </div>
  );
}
window.Prompt = Prompt;
