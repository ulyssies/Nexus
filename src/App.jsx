import { useEffect, useState } from 'react';
import JobsView from './views/JobsView.jsx';
import JournalView from './views/JournalView.jsx';
import GraphView from './views/GraphView.jsx';
import CouncilView from './views/CouncilView.jsx';
import GoalsView from './views/GoalsView.jsx';
import AccountabilityView from './views/AccountabilityView.jsx';
import ProjectsView from './views/ProjectsView.jsx';
import HomeView from './views/HomeView.jsx';
import CalendarView from './views/CalendarView.jsx';
import SettingsView from './views/SettingsView.jsx';
import Placeholder from './views/Placeholder.jsx';

// Topbar title/subtitle per view — ported from master.html viewMeta.
const VIEW_META = {
  home: ['Morning digest', '· good morning'],
  jobs: ['Job board', '· this run'],
  graph: ['Second brain', '· knowledge graph'],
  journal: ['Journal', '· 24 entries'],
  goals: ['Goals', '· 6 active'],
  calendar: ['Calendar', '· june 2026'],
  council: ['Council of 5', '· ask for perspective'],
  accountability: ['Accountability', '· daily check-in'],
  projects: ['Projects', '· archivist active'],
  settings: ['Settings', '· agents, cost & steering'],
};

// Sidebar nav — icons + indicator dots match master.html exactly.
const NAV = [
  { id: 'home', tip: 'Morning digest', dot: 'var(--news)', icon: (
    <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
  ) },
  { id: 'jobs', tip: 'Job board', dot: 'var(--job)', icon: (
    <svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /></svg>
  ) },
  { id: 'graph', tip: 'Second brain', icon: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="M12 7v4M12 11l-5.5 6M12 11l5.5 6" /></svg>
  ) },
  { divider: true },
  { id: 'journal', tip: 'Journal', icon: (
    <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
  ) },
  { id: 'goals', tip: 'Goals', icon: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
  ) },
  { id: 'calendar', tip: 'Calendar', icon: (
    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
  ) },
  { divider: true },
  { id: 'council', tip: 'Council of 5', dot: 'var(--council)', icon: (
    <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
  ) },
  { id: 'accountability', tip: 'Accountability', dot: 'var(--acct)', icon: (
    <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
  ) },
  { id: 'projects', tip: 'Projects', icon: (
    <svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
  ) },
];

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function App() {
  const [view, setView] = useState('jobs'); // open on the Job board (the wired slice)
  const now = useClock();
  const [title, sub] = VIEW_META[view] || [view, ''];

  const dateChip = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeChip = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-logo" onClick={() => setView('home')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></svg>
        </div>

        {NAV.map((item, i) =>
          item.divider ? (
            <div className="nav-divider" key={`d${i}`} />
          ) : (
            <button
              key={item.id}
              className={`nav-btn${view === item.id ? ' active' : ''}`}
              data-tip={item.tip}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              {item.dot && <span className="nav-indicator" style={{ background: item.dot }} />}
            </button>
          )
        )}

        <div className="nav-bottom">
          <button
            className={`nav-btn${view === 'settings' ? ' active' : ''}`}
            data-tip="Settings"
            onClick={() => setView('settings')}
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <span className="topbar-sub">{sub}</span>
          <div className="topbar-spacer" />
          <div className="topbar-chip"><span className="dot" style={{ background: 'var(--success)' }} />6 agents active</div>
          <div className="topbar-chip">{dateChip}</div>
          <div className="topbar-chip" style={{ fontFamily: 'var(--font-mono)' }}>{timeChip}</div>
        </header>

        <div className="content">
          {view === 'home' ? <HomeView onNavigate={setView} />
            : view === 'jobs' ? <JobsView />
            : view === 'journal' ? <JournalView />
            : view === 'graph' ? <GraphView />
            : view === 'council' ? <CouncilView />
            : view === 'goals' ? <GoalsView />
            : view === 'accountability' ? <AccountabilityView />
            : view === 'projects' ? <ProjectsView />
            : view === 'calendar' ? <CalendarView />
            : view === 'settings' ? <SettingsView />
            : <Placeholder title={title} />}
        </div>
      </div>
    </div>
  );
}
