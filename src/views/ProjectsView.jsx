import { useEffect, useState } from 'react';
import { api } from '../api.js';

// "Jun 3, 2:14 PM" from a git ISO date or SQLite timestamp.
function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ProjectCard({ project, changes }) {
  return (
    <div className="project-card">
      <div className="project-header">
        <div className="project-icon">
          <svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
        </div>
        <div>
          <div className="project-name">{project.name}</div>
          <div className="project-desc">{project.path}</div>
          <div className="project-meta">
            <span className="badge" style={{ background: 'var(--job-dim)', color: 'var(--job)' }}>{project.type || 'repo'}</span>
            <span className="text-xs text-mono text-dim">
              {project.change_count} change{project.change_count === 1 ? '' : 's'}
              {project.last_changed_at ? ` · last ${fmt(project.last_changed_at)}` : ' · not scanned yet'}
            </span>
          </div>
        </div>
      </div>
      <div className="divider" style={{ marginBottom: 10 }} />
      <div className="card-title">recent changes · by archivist</div>
      <div className="change-log">
        {(!changes || changes.length === 0) && (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No changes recorded yet — commit to this repo, or hit “scan now”.
          </p>
        )}
        {changes && changes.map((c) => (
          <div className="change-entry" key={c.id}>
            <div className="change-time">{fmt(c.changed_at)}</div>
            <div>
              <div className="change-text">{c.summary}</div>
              {(c.why || c.impact) && (
                <div className="change-ai-note">
                  {c.why ? c.why : ''}{c.why && c.impact ? ' · ' : ''}{c.impact ? `Impact: ${c.impact}` : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProjectsView() {
  const [projects, setProjects] = useState([]);
  const [changesByProject, setChangesByProject] = useState({});
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);

  async function load() {
    try {
      const { projects } = await api.projects();
      setProjects(projects);
      const entries = await Promise.all(
        projects.map(async (p) => [p.name, (await api.projectChanges(p.name)).changes])
      );
      setChangesByProject(Object.fromEntries(entries));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function scan() {
    setScanning(true);
    try { await api.scanProjects(); await load(); }
    catch (e) { setError(e.message); } finally { setScanning(false); }
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

  return (
    <div className="view active">
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <span className="text-xs text-mono text-dim">
          archivist watches {projects.length} repo{projects.length === 1 ? '' : 's'} · git history → second brain
        </span>
        <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} disabled={scanning} onClick={scan}>
          {scanning ? 'scanning…' : 'scan now'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {projects.map((p) => <ProjectCard key={p.name} project={p} changes={changesByProject[p.name]} />)}
      </div>
    </div>
  );
}
