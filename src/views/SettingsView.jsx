import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const AGENT_COLOR = {
  job: 'var(--job)', email: 'var(--email)', council: 'var(--council)',
  accountability: 'var(--acct)', brief: 'var(--news)', archivist: 'var(--project)', tag: 'var(--accent)',
};
const STATUS_COLOR = { ok: 'var(--success)', error: 'var(--danger)', running: 'var(--warn)', skipped: 'var(--text-dim)' };
const usd = (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}`;

function ago(ts) {
  if (!ts) return 'never';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function when(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Job agent controls — edit search locations, search terms, and the two
// résumés the scorer compares against, all without touching config files.
function JobAgentSettings({ onError }) {
  const [data, setData] = useState(null);
  const [cities, setCities] = useState([]);
  const [cityDraft, setCityDraft] = useState({ city: '', state: '' });
  const [titles, setTitles] = useState({ da: [], swe: [] });
  const [titleDraft, setTitleDraft] = useState({ da: '', swe: '' });
  const [savingCities, setSavingCities] = useState(false);
  const [savingTitles, setSavingTitles] = useState({ da: false, swe: false });
  const [editResume, setEditResume] = useState(null);   // { track, content } | null
  const [resumeBusy, setResumeBusy] = useState(false);
  const [note, setNote] = useState(null);               // transient success line
  const fileRef = useRef(null);
  const [pendingTrack, setPendingTrack] = useState(null);

  function load() {
    api.jobSettings().then((d) => {
      setData(d);
      setCities(d.cities);
      setTitles({ da: d.titles.da, swe: d.titles.swe });
    }).catch((e) => onError(e.message));
  }
  useEffect(() => { load(); }, []);

  const flash = (msg) => { setNote(msg); setTimeout(() => setNote(null), 2500); };

  // locations
  function addCity() {
    const city = cityDraft.city.trim();
    if (!city) return;
    setCities((cs) => [...cs, { city, state: cityDraft.state.trim().toUpperCase(), adzunaRegion: 'us' }]);
    setCityDraft({ city: '', state: '' });
  }
  const removeCity = (i) => setCities((cs) => cs.filter((_, j) => j !== i));
  async function saveCities() {
    setSavingCities(true);
    try { const r = await api.setJobCities(cities); setCities(r.cities); flash('Locations saved — the next run uses them.'); load(); }
    catch (e) { onError(e.message); } finally { setSavingCities(false); }
  }
  async function resetCities() {
    try { const r = await api.resetJobCities(); setCities(r.cities); flash('Locations reset to defaults.'); load(); }
    catch (e) { onError(e.message); }
  }

  // search terms
  function addTitle(track) {
    const t = titleDraft[track].trim();
    if (!t) return;
    setTitles((p) => ({ ...p, [track]: [...p[track], t] }));
    setTitleDraft((p) => ({ ...p, [track]: '' }));
  }
  const removeTitle = (track, i) => setTitles((p) => ({ ...p, [track]: p[track].filter((_, j) => j !== i) }));
  async function saveTitles(track) {
    setSavingTitles((p) => ({ ...p, [track]: true }));
    try { const r = await api.setJobTitles(track, titles[track]); setTitles((p) => ({ ...p, [track]: r.titles })); flash(`${track.toUpperCase()} search terms saved.`); load(); }
    catch (e) { onError(e.message); } finally { setSavingTitles((p) => ({ ...p, [track]: false })); }
  }

  // résumés
  function pickFile(track) { setPendingTrack(track); fileRef.current?.click(); }
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !pendingTrack) return;
    const content = await file.text();
    setResumeBusy(true);
    try { await api.setJobResume(pendingTrack, content); flash(`${pendingTrack.toUpperCase()} résumé replaced from ${file.name}.`); load(); }
    catch (err) { onError(err.message); } finally { setResumeBusy(false); setPendingTrack(null); }
  }
  async function openEdit(track) {
    try { const r = await api.jobResume(track); setEditResume({ track, content: r.content }); }
    catch (e) { onError(e.message); }
  }
  async function saveEdit() {
    if (!editResume) return;
    setResumeBusy(true);
    try { await api.setJobResume(editResume.track, editResume.content); flash(`${editResume.track.toUpperCase()} résumé saved.`); setEditResume(null); load(); }
    catch (e) { onError(e.message); } finally { setResumeBusy(false); }
  }

  if (!data) return <div className="card"><div className="card-title" style={{ color: 'var(--job)' }}>job agent · controls</div><p className="text-sm" style={{ color: 'var(--text-dim)' }}>loading…</p></div>;

  const chip = (label, onX, key) => (
    <span key={key} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}<span onClick={onX} style={{ cursor: 'pointer', opacity: 0.6 }} title="remove">×</span>
    </span>
  );
  const titleSection = (track) => (
    <div style={{ marginTop: 10 }}>
      <div className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
        {track === 'da' ? 'Data / analytics' : 'Software engineering'} search terms
        {data.titlesCustom[track] && <span style={{ color: 'var(--job)', marginLeft: 8 }}>· customized</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {titles[track].map((t, i) => chip(t, () => removeTitle(track, i), track + i))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="journal-input" style={{ minHeight: 0, height: 34, flex: 1, maxWidth: 280 }}
          placeholder={`add a ${track.toUpperCase()} title…`} value={titleDraft[track]}
          onChange={(e) => setTitleDraft((p) => ({ ...p, [track]: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && addTitle(track)} />
        <button className="btn" onClick={() => addTitle(track)}>add</button>
        <button className="btn btn-primary" disabled={savingTitles[track]} onClick={() => saveTitles(track)}>
          {savingTitles[track] ? 'saving…' : 'save'}
        </button>
        {data.titlesCustom[track] && <button className="btn" onClick={async () => { try { const r = await api.resetJobTitles(track); setTitles((p) => ({ ...p, [track]: r.titles })); flash(`${track.toUpperCase()} terms reset.`); load(); } catch (e) { onError(e.message); } }}>reset</button>}
      </div>
    </div>
  );

  return (
    <div className="card">
      <div className="card-title" style={{ color: 'var(--job)' }}>job agent · controls</div>
      <p className="text-sm" style={{ color: 'var(--text-secondary)', marginTop: -4, marginBottom: 14 }}>
        Change where the agent searches, what it searches for, and the résumés it scores against — no need to edit any files.
        Changes apply on the next run (cron or “run now”). {note && <span style={{ color: 'var(--success)' }}>{note}</span>}
      </p>

      {/* locations */}
      <div style={{ marginBottom: 18 }}>
        <div className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
          Search locations {data.citiesCustom ? <span style={{ color: 'var(--job)' }}>· customized</span> : <span style={{ color: 'var(--text-dim)' }}>· defaults</span>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {cities.map((c, i) => chip(`${c.city}${c.state ? ', ' + c.state : ''}`, () => removeCity(i), 'c' + i))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="journal-input" style={{ minHeight: 0, height: 34, width: 180 }}
            placeholder="city (e.g. Miami)" value={cityDraft.city}
            onChange={(e) => setCityDraft((p) => ({ ...p, city: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && addCity()} />
          <input className="journal-input" style={{ minHeight: 0, height: 34, width: 80 }}
            placeholder="ST" value={cityDraft.state} maxLength={2}
            onChange={(e) => setCityDraft((p) => ({ ...p, state: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && addCity()} />
          <button className="btn" onClick={addCity}>add</button>
          <button className="btn btn-primary" disabled={savingCities} onClick={saveCities}>{savingCities ? 'saving…' : 'save locations'}</button>
          {data.citiesCustom && <button className="btn" onClick={resetCities}>reset</button>}
        </div>
      </div>

      {/* search terms */}
      {titleSection('da')}
      {titleSection('swe')}

      {/* résumés */}
      <div style={{ marginTop: 18 }}>
        <div className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>Résumés the scorer compares against</div>
        <input ref={(el) => (fileRef.current = el)} type="file" accept=".tex,.txt,.text,.md" style={{ display: 'none' }} onChange={onFile} />
        {data.resumes.map((r) => (
          <div key={r.track} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="tag" style={{ textTransform: 'uppercase', color: 'var(--job)', borderColor: 'var(--job)' }}>{r.track}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.path.split('/').pop()}</div>
              <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
                {r.exists ? `${r.chars.toLocaleString()} chars · updated ${ago(r.updatedAt)}` : 'missing — upload one'}
              </div>
            </div>
            <button className="btn" disabled={resumeBusy} onClick={() => pickFile(r.track)}>replace file…</button>
            <button className="btn" disabled={resumeBusy} onClick={() => openEdit(r.track)}>edit text</button>
          </div>
        ))}
        {editResume && (
          <div style={{ marginTop: 12 }}>
            <div className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>Editing <strong style={{ textTransform: 'uppercase' }}>{editResume.track}</strong> résumé</div>
            <textarea className="journal-input" style={{ width: '100%', minHeight: 240, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              value={editResume.content} onChange={(e) => setEditResume((p) => ({ ...p, content: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary" disabled={resumeBusy} onClick={saveEdit}>{resumeBusy ? 'saving…' : 'save résumé'}</button>
              <button className="btn" onClick={() => setEditResume(null)}>cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsView() {
  const [obs, setObs] = useState(null);
  const [interests, setInterests] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.observability().then(setObs).catch((e) => setError(e.message));
    api.briefInterests().then((r) => setInterests(r.interests)).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function addInterest() {
    const label = draft.trim();
    if (!label || busy) return;
    setBusy(true);
    try { await api.addBriefInterest(label); setDraft(''); const r = await api.briefInterests(); setInterests(r.interests); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function toggle(id) {
    await api.toggleBriefInterest(id).catch((e) => setError(e.message));
    const r = await api.briefInterests(); setInterests(r.interests);
  }
  async function remove(id) {
    await api.deleteBriefInterest(id).catch((e) => setError(e.message));
    const r = await api.briefInterests(); setInterests(r.interests);
  }

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

  const cost = obs?.cost || { today: 0, total: 0, calls: 0, daily: [] };
  const agents = obs?.agents || [];
  const errors = obs?.errors || [];
  const maxDaily = Math.max(0.0001, ...(cost.daily || []).map((d) => d.cost));

  return (
    <div className="view active">
      {/* cost summary */}
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--news)' }}>{usd(cost.today)}</div><div className="stat-label">spend today</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--accent)' }}>{usd(cost.total)}</div><div className="stat-label">all-time spend</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--job)' }}>{cost.calls}</div><div className="stat-label">Claude calls</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{agents.filter((a) => a.lastRun?.status !== 'error').length}/{agents.length}</div><div className="stat-label">agents healthy</div></div>
      </div>

      <div className="home-grid">
        {/* agents — last run, next run, cost */}
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>agents · runs & cost</div>
            <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} onClick={load}>refresh</button>
          </div>
          {agents.map((a) => {
            const st = a.lastRun?.status;
            return (
              <div className="agent-row" key={a.key}>
                <div className="agent-icon" style={{ background: `${AGENT_COLOR[a.key]}22`, color: AGENT_COLOR[a.key] }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{a.label[0]}</span>
                </div>
                <div className="agent-info">
                  <div className="agent-name">{a.label} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {usd(a.costTotal)}</span></div>
                  <div className="agent-sub">
                    {st ? <>last {st} {ago(a.lastRun.started_at)}{a.lastRun.summary ? ` · ${a.lastRun.summary}` : ''}</> : 'never run'}
                    {a.nextRun ? ` · next ${when(a.nextRun)}` : ' · on-demand'}
                  </div>
                </div>
                <div className="agent-dot" style={{ background: STATUS_COLOR[st] || 'var(--text-dim)' }} />
              </div>
            );
          })}
        </div>

        {/* daily cost trend + error log */}
        <div>
          <div className="card">
            <div className="card-title">daily cost · last {cost.daily?.length || 0} days</div>
            {(!cost.daily || cost.daily.length === 0) && (
              <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No spend recorded yet.</p>
            )}
            {(cost.daily || []).map((d) => (
              <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
                <span className="text-xs text-mono text-dim" style={{ width: 54 }}>{d.day.slice(5)}</span>
                <div className="prog-track" style={{ flex: 1 }}>
                  <div className="prog-fill" style={{ width: `${Math.round((d.cost / maxDaily) * 100)}%`, background: 'var(--news)' }} />
                </div>
                <span className="text-xs text-mono" style={{ width: 56, textAlign: 'right' }}>{usd(d.cost)}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">recent errors</div>
            {errors.length === 0
              ? <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No failed runs. All agents healthy.</p>
              : errors.map((e, i) => (
                <div className="agent-row" key={i}>
                  <div className="agent-info">
                    <div className="agent-name" style={{ color: 'var(--danger)' }}>{e.agent} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {ago(e.started_at)}</span></div>
                    <div className="agent-sub">{e.error}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* per-agent controls */}
      <JobAgentSettings onError={setError} />

      {/* brief interest steering */}
      <div className="card">
        <div className="card-title">morning brief · news topics</div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)', marginTop: -4, marginBottom: 12 }}>
          These are exactly the topics the brief searches for — what's <strong>active</strong> below is what gets prioritized each morning.
          Click a tag to toggle it, or add your own (e.g. “Space”, “Big Tech”, “World News”). Common topics expand into a full
          news-section query automatically; anything else is searched as-is.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {interests.length === 0 && (
            <span className="text-sm" style={{ color: 'var(--text-dim)' }}>No topics yet — add one (e.g. “Artificial Intelligence”, “Startups”, “Cybersecurity”).</span>
          )}
          {interests.map((it) => (
            <span key={it.id} className="tag"
              style={{
                cursor: 'pointer', userSelect: 'none',
                background: it.active ? 'var(--news-dim)' : 'var(--bg-raised)',
                color: it.active ? 'var(--news)' : 'var(--text-dim)',
                border: it.active ? '1px solid var(--news)' : '1px solid transparent',
              }}>
              <span onClick={() => toggle(it.id)}># {it.label}</span>
              <span onClick={() => remove(it.id)} style={{ marginLeft: 6, opacity: 0.6 }} title="remove">×</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="journal-input" style={{ minHeight: 0, height: 36, flex: 1, maxWidth: 320 }}
            placeholder="add an interest tag…" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addInterest()} />
          <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={addInterest}>add</button>
        </div>
      </div>
    </div>
  );
}
