import { useEffect, useState } from 'react';
import { api } from '../api.js';

// "Wed Jun 3" — handles SQLite UTC ("YYYY-MM-DD HH:MM:SS") and ISO strings.
function fmtDate(ts, withYear = false) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

function TagChip({ tag }) {
  // Tag color from the DB; tint the background from the same hue.
  const color = tag.color || 'var(--accent)';
  return <span className="tag" style={{ background: `${color}22`, color }}># {tag.name}</span>;
}

export default function JournalView() {
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.notes({ kind: 'journal', limit: 50 })
      .then((r) => { setEntries(r.notes); if (!activeId && r.notes[0]) setActiveId(r.notes[0].id); })
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { note } = await api.createNote({ body, kind: 'journal' });
      setDraft('');
      setActiveId(note.id);
      load(); // the agent auto-tags on save; re-fetch to show tags as they land
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const active = entries.find((e) => e.id === activeId) || null;

  if (error) {
    return (
      <div className="view active">
        <div className="card">
          <div className="card-title">couldn't reach the backend</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {error}. Is the Nexus server running on <code>localhost:3001</code>?
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="view active" style={{ flex: 1 }}>
      <div className="journal-layout" style={{ flex: 1, minHeight: 0 }}>
        {/* editor */}
        <div className="journal-editor">
          <div className="card" style={{ flex: 1 }}>
            <div className="editor-meta" style={{ marginBottom: 12 }}>
              <span className="editor-date">{fmtDate(new Date().toISOString(), true)}</span>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-primary"
                style={{ fontSize: 11, padding: '5px 12px' }}
                onClick={handleSave}
                disabled={saving || !draft.trim()}
              >
                {saving ? 'saving…' : 'Save + auto-tag'}
              </button>
            </div>
            <textarea
              className="journal-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={'What’s on your mind today...\n\nWrite freely. The AI will read this, extract tags, and connect it to related notes in your second brain automatically.'}
            />
            {active && (
              <div className="auto-tags mt-2">
                <span className="auto-tag-label">ai tags:</span>
                {active.tags.length
                  ? active.tags.map((t) => <TagChip key={t.id} tag={t} />)
                  : <span className="tag" style={{ background: 'var(--bg-raised)', color: 'var(--text-dim)' }}>none yet</span>}
              </div>
            )}
          </div>
        </div>

        {/* recent entries */}
        <div>
          <div className="section-label">recent entries</div>
          <div className="journal-entries">
            {entries.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No entries yet — write your first one and save.
              </p>
            )}
            {entries.map((e) => (
              <div
                key={e.id}
                className={`entry-item${e.id === activeId ? ' active' : ''}`}
                onClick={() => setActiveId(e.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="entry-date">{fmtDate(e.created_at)}</div>
                <div className="entry-preview">{e.title || e.body}</div>
                {e.tags.length > 0 && (
                  <div className="entry-tags">
                    {e.tags.map((t) => <TagChip key={t.id} tag={t} />)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
