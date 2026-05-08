function Log({ kind = "info", children }) {
  return <div className={"t-log t-log-" + kind}>{children}</div>;
}
function Chip({ kind = "info", children }) {
  return <span className={"t-chip t-chip-" + kind}>{children}</span>;
}
function Fingerprint({ rows }) {
  return (
    <div className="t-fp">
      <div className="t-fp-head">
        <span className="t-fp-title">↳ fingerprint locked</span>
        <Chip kind="success">coherent</Chip>
      </div>
      <table className="t-fp-table">
        <tbody>
          {rows.map(([k, v, c]) => (
            <tr key={k}>
              <td className="t-fp-k">{k}</td>
              <td className="t-fp-v">{v}</td>
              <td className="t-fp-c">{c && <Chip kind="success">✓</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
window.Log = Log;
window.Chip = Chip;
window.Fingerprint = Fingerprint;
