import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Bubble({ m }) {
  if (m.role === 'source') {
    let meta = {};
    try { meta = m.meta ? JSON.parse(m.meta) : {}; } catch { /* ignore */ }
    return (
      <div style={{ margin: '8px 0', padding: '10px 12px', borderLeft: '2px solid var(--news)', background: 'var(--bg-raised)', borderRadius: 6 }}>
        <div className="text-xs text-mono" style={{ color: 'var(--news)', marginBottom: 4 }}>
          source{meta.url ? ` · ${meta.title || meta.url}` : meta.kind === 'pasted' ? ' · pasted' : ''}
        </div>
        <div className="text-sm" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 90, overflow: 'hidden' }}>{m.content}</div>
      </div>
    );
  }
  const isUser = m.role === 'user';
  // light markdown cleanup so chat reads cleanly (headers/bold markers → plain)
  const text = isUser ? m.content : m.content.replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1');
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', margin: '10px 0' }}>
      <div style={{
        maxWidth: '80%', padding: '10px 14px', borderRadius: 12,
        background: isUser ? 'var(--accent)' : 'var(--bg-card)',
        color: isUser ? '#fff' : 'var(--text)',
        border: isUser ? 'none' : '1px solid var(--border)',
        whiteSpace: 'pre-wrap', lineHeight: 1.5, fontSize: 14,
      }}>{text}</div>
    </div>
  );
}

export default function ResearchView() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [session, setSession] = useState(null);
  const [draft, setDraft] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedNode, setSavedNode] = useState(null);
  const [error, setError] = useState(null);
  const [parents, setParents] = useState([]);
  const [parentId, setParentId] = useState('');
  const [newConcept, setNewConcept] = useState('');
  const scrollRef = useRef(null);

  function loadSessions() {
    api.researchSessions().then((r) => setSessions(r.sessions)).catch((e) => setError(e.message));
  }
  function loadParents() {
    api.noteParents().then((r) => setParents(r.parents)).catch(() => {});
  }
  useEffect(() => { loadSessions(); loadParents(); }, []);

  async function makeConcept() {
    const title = newConcept.trim();
    if (!title) return;
    try {
      const { note } = await api.createConcept({ title });
      setNewConcept('');
      loadParents();
      setParentId(String(note.id));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    if (activeId == null) { setSession(null); return; }
    api.researchSession(activeId).then((r) => setSession(r.session)).catch((e) => setError(e.message));
  }, [activeId]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [session]);

  async function reload() {
    const r = await api.researchSession(activeId); setSession(r.session); loadSessions();
  }
  async function startSession() {
    setBusy(true); setError(null); setSavedNode(null);
    try { const { session } = await api.newResearchSession(null); setActiveId(session.id); loadSessions(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function send() {
    const message = draft.trim();
    if (!message || busy || !activeId) return;
    setBusy(true); setError(null); setDraft('');
    try { await api.researchChat(activeId, message); await reload(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function addUrl() {
    const url = sourceUrl.trim();
    if (!url || busy || !activeId) return;
    setBusy(true); setError(null); setSourceUrl('');
    try { await api.researchSource(activeId, { url }); await reload(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function pasteSource() {
    const text = draft.trim();
    if (!text || busy || !activeId) return;
    setBusy(true); setError(null); setDraft('');
    try { await api.researchSource(activeId, { text }); await reload(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function save() {
    if (busy || !activeId) return;
    setBusy(true); setError(null);
    try { const { node } = await api.saveResearchSession(activeId, parentId || null); setSavedNode(node); await reload(); loadParents(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const messages = session?.messages || [];

  return (
    <div className="view active" style={{ flex: 1 }}>
      <div className="journal-layout" style={{ flex: 1, minHeight: 0 }}>
        {/* chat */}
        <div className="journal-editor" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {error && <div className="text-xs" style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}

          {!activeId ? (
            <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <div className="card-title">research a topic</div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)', maxWidth: 420, margin: '4px 0 16px' }}>
                Have a real conversation — paste articles, fetch URLs, ask questions, go down rabbit holes. When you're done, <b>save the session</b> and it distills into one permanent, structured node in your second brain.
              </p>
              <button className="btn btn-primary" disabled={busy} onClick={startSession}>{busy ? 'starting…' : '+ new research session'}</button>
            </div>
          ) : (
            <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {session?.topic || 'research session'} {session?.status === 'saved' && <span className="badge" style={{ background: 'var(--job-dim)', color: 'var(--job)' }}>saved</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select className="btn" style={{ fontSize: 11, padding: '4px 8px', maxWidth: 160 }}
                    value={parentId} onChange={(e) => setParentId(e.target.value)} title="file this node under a parent/concept">
                    <option value="">file under… (optional)</option>
                    {parents.map((p) => <option key={p.id} value={p.id}>{p.is_concept ? '◆ ' : ''}{p.label}</option>)}
                  </select>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }} disabled={busy || messages.length === 0} onClick={save}>
                    {busy ? '…' : 'save → node'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input className="journal-input" style={{ minHeight: 0, height: 30, flex: 1, maxWidth: 220, fontSize: 12 }}
                  placeholder="+ new concept (organizational anchor)" value={newConcept}
                  onChange={(e) => setNewConcept(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && makeConcept()} />
                <button className="btn" style={{ fontSize: 11 }} disabled={!newConcept.trim()} onClick={makeConcept}>create concept</button>
              </div>

              {/* messages */}
              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                {messages.length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Start by asking a question, or add a source below.</p>
                )}
                {messages.map((m) => <Bubble key={m.id} m={m} />)}
                {savedNode && (
                  <div className="card" style={{ marginTop: 12, borderColor: 'var(--job)' }}>
                    <div className="card-title">saved to second brain · {savedNode.title}</div>
                    {savedNode.tags?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {savedNode.tags.map((t) => <span key={t.id} className="tag" style={{ background: `${t.color}22`, color: t.color }}># {t.name}</span>)}
                      </div>
                    )}
                    <div className="text-sm" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{savedNode.body}</div>
                  </div>
                )}
              </div>

              {/* composer */}
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input className="journal-input" style={{ minHeight: 0, height: 34, flex: 1 }}
                    placeholder="paste an article URL to fetch…" value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
                  <button className="btn" disabled={busy || !sourceUrl.trim()} onClick={addUrl}>fetch URL</button>
                </div>
                <textarea className="journal-input" style={{ minHeight: 70 }}
                  placeholder="ask a question… (or paste article text, then hit “add as source”)"
                  value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
                <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                  <button className="btn" style={{ fontSize: 11 }} disabled={busy || !draft.trim()} onClick={pasteSource}>add as source</button>
                  <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={send}>{busy ? 'thinking…' : 'send'}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* sessions list */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <div className="section-label" style={{ margin: 0 }}>sessions</div>
            <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }} disabled={busy} onClick={startSession}>+ new</button>
          </div>
          <div className="journal-entries">
            {sessions.length === 0 && <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No sessions yet.</p>}
            {sessions.map((s) => (
              <div key={s.id} className={`entry-item${s.id === activeId ? ' active' : ''}`} style={{ cursor: 'pointer' }}
                onClick={() => { setActiveId(s.id); setSavedNode(null); }}>
                <div className="entry-date">{fmt(s.updated_at)} · {s.message_count} msgs {s.status === 'saved' && '· ✓ saved'}</div>
                <div className="entry-preview">{s.topic || 'untitled session'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
