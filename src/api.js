// Thin fetch client -> Express. Vite proxies /api to localhost:3001 in dev.
async function get(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function send(method, path, payload) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${method} ${path} -> ${res.status}`);
  return body;
}
const post = (path, payload) => send('POST', path, payload);
const put = (path, payload) => send('PUT', path, payload);
const del = (path) => send('DELETE', path);

export const api = {
  jobs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/jobs${qs ? `?${qs}` : ''}`);
  },
  jobStats: () => get('/jobs/stats'),
  jobStatsFiltered: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/jobs/stats${qs ? `?${qs}` : ''}`);
  },
  jobMeta: () => get('/jobs/meta'),
  jobApplications: () => get('/jobs/applications'),
  markJobApplied: (id) => post(`/jobs/${id}/applied`),
  setJobStatus: (id, status) => post(`/jobs/${id}/status`, { status }),
  runJob: () => post('/jobs/run'),         // kick off the pipeline (the "run now" button)
  jobRunStatus: () => get('/jobs/run/status'), // poll while a run is in flight

  // notes / second brain
  notes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/notes${qs ? `?${qs}` : ''}`);
  },
  note: (id) => get(`/notes/${id}`),
  createNote: (note) => post('/notes', note),
  setNoteTags: (id, tags) => put(`/notes/${id}/tags`, { tags }),
  noteGraph: () => get('/notes/graph'),
  // hierarchy (Phase 9)
  noteParents: () => get('/notes/parents'),
  createConcept: (payload) => post('/notes/concepts', payload),
  setNoteParent: (id, parent_id) => put(`/notes/${id}/parent`, { parent_id }),

  // council of 5
  councilElders: () => get('/council/elders'),
  councilHistory: () => get('/council'),
  askCouncil: (question) => post('/council/ask', { question }),
  councilSession: (id) => get(`/council/${id}`),

  // accountability — goals, streaks, check-ins, nudge
  goals: (status = 'active') => get(`/accountability/goals?status=${status}`),
  goal: (id) => get(`/accountability/goals/${id}`),
  createGoal: (goal) => post('/accountability/goals', goal),
  updateGoal: (id, patch) => put(`/accountability/goals/${id}`, patch),
  deleteGoal: (id) => del(`/accountability/goals/${id}`),
  checkinGoal: (id, payload) => post(`/accountability/goals/${id}/checkin`, payload),
  accountabilityNudge: () => get('/accountability/nudge'),
  runAccountability: () => post('/accountability/run'),

  // project archivist
  projects: () => get('/projects'),
  projectChanges: (name) => get(`/projects/${encodeURIComponent(name)}/changes`),
  scanProjects: () => post('/projects/scan'),

  // home overview (cross-agent: stats + agent status + activity feed)
  overview: () => get('/overview'),
  // home command center: alerts + agenda + agent health + digest + full feed
  home: () => get('/home'),

  // morning brief
  brief: (date) => get(`/brief${date ? `?date=${date}` : ''}`),
  runBrief: () => post('/brief/run'),
  // home digest paragraph: cached, only re-calls Claude when stale (or force)
  briefDigest: (force = false) => post(`/brief/digest${force ? '?force=1' : ''}`),

  // brief interest steering (Settings → direct the news agent)
  briefInterests: () => get('/brief/interests'),
  addBriefInterest: (label) => post('/brief/interests', { label }),
  toggleBriefInterest: (id) => put(`/brief/interests/${id}/toggle`),
  deleteBriefInterest: (id) => del(`/brief/interests/${id}`),

  // observability (Settings → agent runs, errors, cost)
  observability: () => get('/observability'),

  // agent settings (Settings → per-agent controls)
  jobSettings: () => get('/settings/job'),
  setJobCities: (cities) => put('/settings/job/cities', { cities }),
  resetJobCities: () => del('/settings/job/cities'),
  setJobTitles: (track, titles) => put(`/settings/job/titles/${track}`, { titles }),
  resetJobTitles: (track) => del(`/settings/job/titles/${track}`),
  jobResume: (track) => get(`/settings/job/resume/${track}`),
  setJobResume: (track, content) => put(`/settings/job/resume/${track}`, { content }),

  // research agent — chat sessions that distill into second-brain nodes
  researchSessions: () => get('/research/sessions'),
  researchSession: (id) => get(`/research/sessions/${id}`),
  newResearchSession: (topic) => post('/research/sessions', { topic }),
  deleteResearchSession: (id) => del(`/research/sessions/${id}`),
  researchChat: (id, message) => post(`/research/sessions/${id}/message`, { message }),
  researchSource: (id, payload) => post(`/research/sessions/${id}/source`, payload),
  saveResearchSession: (id, parent_id) => post(`/research/sessions/${id}/save`, { parent_id }),
  openQuestions: (resolved = 0) => get(`/research/open-questions?resolved=${resolved}`),
  resolveQuestion: (id) => put(`/research/open-questions/${id}/resolve`),

  // email agent + calendar
  emailStatus: () => get('/email/status'),
  emailStats: () => get('/email/stats'),
  emailFlags: (importance) => get(`/email/flags${importance ? `?importance=${importance}` : ''}`),
  emailInbox: ({ filter = 'all', page = 1, pageSize = 25 } = {}) =>
    get(`/email/flags?filter=${encodeURIComponent(filter)}&page=${page}&pageSize=${pageSize}`),
  emailCounts: () => get('/email/counts'),
  emailInsights: () => get('/email/insights'),
  runEmail: () => post('/email/run'),
  calendar: (all = false) => get(`/calendar${all ? '?all=1' : ''}`),
  addCalendarEvent: (ev) => post('/calendar', ev),
};
