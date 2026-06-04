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
};
