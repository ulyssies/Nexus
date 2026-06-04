import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Short archetype descriptions (UI copy from the design, keyed by elder).
const DESC = {
  Marcus: 'Discipline, reason, and what is within your control. Cuts through emotion to the actionable truth.',
  Lyra: "Long-game thinker. Sees the 5-year arc you can't. Pushes you toward who you're becoming.",
  Zeno: "Challenges every assumption. Finds the flaw, the bias, the thing you don't want to hear.",
  Aria: 'Emotional intelligence and human truth. Asks what you actually feel vs. what you think you should.',
  Rex: 'Cuts the philosophy. What are we doing, by when, how? No plan survives contact with him unscathed.',
};

const STANCE_STYLE = {
  agrees: { background: 'var(--job-dim)', color: 'var(--job)' },
  challenges: { background: 'rgba(224,91,91,0.15)', color: 'var(--danger)' },
  neutral: { background: 'rgba(240,160,80,0.15)', color: 'var(--acct)' },
};

function consensusLabel(score, dissenters) {
  if (score == null) return '—';
  const base = score >= 80 ? 'consensus' : score >= 60 ? 'aligned' : score >= 40 ? 'split' : 'divided';
  return dissenters.length ? `${base} · ${dissenters.join(', ')} dissenting` : base;
}

export default function CouncilView() {
  const [elders, setElders] = useState([]);
  const [question, setQuestion] = useState('');
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.councilElders().then((r) => setElders(r.elders)).catch((e) => setError(e.message));
    // Replay the most recent session so the view isn't empty on revisit.
    api.councilHistory()
      .then((r) => r.sessions[0] && api.councilSession(r.sessions[0].id))
      .then((r) => r && setSession(r.session))
      .catch(() => {});
  }, []);

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true); setError(null);
    try {
      const { session } = await api.askCouncil(q);
      setSession(session);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // pass-2 responses carry the stance + final reply
  const finals = (session?.responses || []).filter((r) => r.pass === 2);
  const stanceOf = (name) => finals.find((r) => r.elder === name)?.stance || null;
  const dissenters = finals.filter((r) => r.stance === 'challenges').map((r) => r.elder);
  const score = session?.consensus_score ?? null;

  return (
    <div className="view active">
      <div className="council-layout">
        {/* elder cards */}
        <div className="elder-panel">
          {elders.map((e) => {
            const stance = stanceOf(e.name);
            return (
              <div className={`elder-card${stance ? ' active' : ''}`} key={e.name}>
                <div className="elder-avatar" style={{ background: 'var(--bg-raised)' }}>
                  <span style={{ color: e.color, fontFamily: 'var(--font-mono)' }}>{e.name[0]}</span>
                </div>
                <div className="elder-name">{e.name}</div>
                <div className="elder-archetype">{e.role}</div>
                <div className="elder-desc">{DESC[e.name]}</div>
                {stance && <span className="elder-stance" style={STANCE_STYLE[stance]}>{stance}</span>}
              </div>
            );
          })}
        </div>

        {/* consensus bar */}
        <div className="consensus-bar">
          <div className="consensus-header">
            <span className="consensus-label">council consensus</span>
            <span className="consensus-value">{consensusLabel(score, dissenters)}{score != null ? ` · ${score}` : ''}</span>
          </div>
          <div className="consensus-track">
            <div className="consensus-fill" style={{ width: `${score ?? 0}%` }} />
          </div>
          <div className="consensus-markers">
            <span className="consensus-marker">divided</span>
            <span className="consensus-marker">split</span>
            <span className="consensus-marker">aligned</span>
            <span className="consensus-marker">consensus</span>
          </div>
        </div>

        {/* ask the council */}
        <div className="council-input-area">
          <textarea
            className="council-ask"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask the council for perspective — a decision, a situation, a question you're wrestling with..."
          />
          <div className="council-input-footer">
            <span className="text-xs text-mono text-dim">
              {loading ? 'the elders are deliberating…' : 'all 5 elders respond simultaneously · they may debate each other'}
            </span>
            <button className="btn btn-primary" onClick={ask} disabled={loading || !question.trim()}>
              {loading ? 'consulting…' : 'Consult the council'}
            </button>
          </div>
          {error && <div className="text-xs" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
        </div>

        {/* responses (final / challenge round) */}
        <div className="council-responses">
          {finals.length === 0 && !loading && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Ask a question above and the five elders will weigh in, challenge each other, and land on a consensus.
            </p>
          )}
          {elders.map((e) => {
            const r = finals.find((x) => x.elder === e.name);
            if (!r) return null;
            return (
              <div className="council-response" key={e.name}
                style={r.stance === 'challenges' ? { borderColor: 'rgba(224,91,91,0.3)' } : undefined}>
                <div className="response-header">
                  <div className="response-avatar" style={{ background: 'var(--bg-raised)', color: e.color }}>{e.name[0]}</div>
                  <span className="response-name">{e.name}</span>
                  <span className="response-arch">· {e.role}</span>
                  <span className="badge" style={{ marginLeft: 'auto', ...STANCE_STYLE[r.stance] }}>{r.stance}</span>
                </div>
                <div className="response-text">{r.response}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
