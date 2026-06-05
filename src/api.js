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
  jobApplications: () => get('/jobs/applications'),
  runJob: () => post('/jobs/run'),         // kick off the pipeline (the "run now" button)
  jobRunStatus: () => get('/jobs/run/status'), // poll while a run is in flight

  // notes / second brain
  notes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/notes${qs ? `?${qs}` : ''}`);
  },
  createNote: (note) => post('/notes', note),
  setNoteTags: (id, tags) => put(`/notes/${id}/tags`, { tags }),
  noteGraph: () => get('/notes/graph'),

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

  // morning brief
  brief: (date) => get(`/brief${date ? `?date=${date}` : ''}`),
  runBrief: () => post('/brief/run'),

  // email agent + calendar
  emailStatus: () => get('/email/status'),
  emailStats: () => get('/email/stats'),
  emailFlags: (importance) => get(`/email/flags${importance ? `?importance=${importance}` : ''}`),
  runEmail: () => post('/email/run'),
  calendar: (all = false) => get(`/calendar${all ? '?all=1' : ''}`),
  addCalendarEvent: (ev) => post('/calendar', ev),
};
