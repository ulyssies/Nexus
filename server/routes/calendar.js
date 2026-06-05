// Calendar API — shared context written by the user AND the email agent
// (extracted deadlines). Reads are merged; the source_agent column shows
// where each event came from so the UI can label it ("synced by email agent").
import { Router } from 'express';
import { listUpcomingEvents, listAllEvents, addCalendarEvent } from '../db/emailRepo.js';

const router = Router();

// GET /api/calendar?all=1 — upcoming events (default) or the full list.
router.get('/', (req, res) => {
  const events = req.query.all ? listAllEvents() : listUpcomingEvents();
  res.json({ events });
});

// POST /api/calendar { title, start_at, ... } — a user-created event.
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.title || !body.start_at) return res.status(400).json({ error: 'title and start_at are required' });
  try {
    res.status(201).json({ event: addCalendarEvent({ ...body, source_agent: 'user' }) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
