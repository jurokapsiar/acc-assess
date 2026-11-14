// Library-like component: creates the host <button> itself, so a React fiber walk must
// follow `_debugOwner` up to find the first JSX call site outside node_modules (there is no
// node_modules boundary in this fixture, but the component boundary - TabButton vs Tabs vs
// App - exercises the same owner-chain logic the real resolver relies on).
export function TabButton({ label }) {
  return <button className="tab-btn">{label}</button>;
}

function Tabs({ items }) {
  return (
    <div role="tablist" aria-label="Demo tabs">
      {items.map((item) => (
        <TabButton key={item.id} label={item.label} />
      ))}
    </div>
  );
}

// Repeated list: every <button> here is created from the SAME JSX call site (this one
// line), so relocation's source-based tier can only disambiguate siblings by `ordinal`
// among same-source-line candidates - the scenario tests/fix.test.mjs exercises.
function RepeatedList({ items }) {
  return (
    <ul id="repeated-list">
      {items.map((item) => (
        <li key={item.id}>
          <button className="icon-btn" aria-label={item.label || undefined}>
            <span aria-hidden="true">&#9654;</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function App({ variant }) {
  const repeated = [0, 1, 2, 3, 4].map((i) => ({ id: i, label: variant === 'after' && i === 3 ? 'Play track 3' : null }));
  return (
    <div id="app-root">
      <h2 id="react-title">React fixture</h2>
      <Tabs items={[{ id: 'a', label: 'Tab A' }, { id: 'b', label: 'Tab B' }]} />
      <RepeatedList items={repeated} />
    </div>
  );
}
