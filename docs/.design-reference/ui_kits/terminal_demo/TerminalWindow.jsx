function TerminalWindow({ children, title = "mochi.session — bun" }) {
  return (
    <div className="t-win">
      <div className="t-titlebar">
        <div className="t-lights">
          <span className="t-light t-red"></span>
          <span className="t-light t-yellow"></span>
          <span className="t-light t-green"></span>
        </div>
        <div className="t-title">{title}</div>
        <div className="t-tab">
          <span>~/projects/scrape-checkout</span>
          <span className="t-tab-x">×</span>
        </div>
      </div>
      <div className="t-body">{children}</div>
    </div>
  );
}
window.TerminalWindow = TerminalWindow;
