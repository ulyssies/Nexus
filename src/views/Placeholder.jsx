// Stub for views not yet built. Keeps the shell/nav fully navigable while
// only the Job board is wired to real data in this slice.
export default function Placeholder({ title }) {
  return (
    <div className="view active">
      <div className="card">
        <div className="card-title">{title}</div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Not built yet. This view comes in a later phase — see the build order in <code>CLAUDE.md</code>.
          The Job board is the wired slice for now.
        </p>
      </div>
    </div>
  );
}
