// Agent settings API — UI-editable controls for individual agents, layered over
// config.js. Today: the job agent's search locations, search terms, and the two
// résumés (DA / SWE) the scorer compares against — so the owner can update them
// from Settings instead of editing files in an editor.
import { Router } from 'express';
import {
  getJobCities, setJobCities, jobCitiesAreCustom,
  getJobTitles, setJobTitles, jobTitlesAreCustom,
  clearSetting,
  getAllResumeMeta, getResumeContent, setResumeContent,
} from '../db/settingsRepo.js';
import { TARGET_CITIES, DA_JOB_TITLES, SWE_JOB_TITLES } from '../config.js';

const router = Router();

// GET /api/settings/job — everything the job-agent control panel needs:
// effective locations + search terms (with whether they're custom or default),
// the config defaults (for a "reset"), and résumé file metadata.
router.get('/job', (_req, res) => {
  res.json({
    cities: getJobCities(),
    citiesCustom: jobCitiesAreCustom(),
    citiesDefault: TARGET_CITIES,
    titles: {
      da: getJobTitles('da'),
      swe: getJobTitles('swe'),
    },
    titlesCustom: { da: jobTitlesAreCustom('da'), swe: jobTitlesAreCustom('swe') },
    titlesDefault: { da: DA_JOB_TITLES, swe: SWE_JOB_TITLES },
    resumes: getAllResumeMeta(),
  });
});

// PUT /api/settings/job/cities { cities: [{city,state,adzunaRegion}] }
router.put('/job/cities', (req, res) => {
  try {
    res.json({ cities: setJobCities((req.body || {}).cities) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/settings/job/cities — revert to the config.js default list.
router.delete('/job/cities', (_req, res) => {
  clearSetting('job.cities');
  res.json({ cities: getJobCities(), citiesCustom: false });
});

// PUT /api/settings/job/titles/:track { titles: [...] }  (track = da | swe)
router.put('/job/titles/:track', (req, res) => {
  try {
    res.json({ titles: setJobTitles(req.params.track, (req.body || {}).titles) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/settings/job/titles/:track — revert that track to its default.
router.delete('/job/titles/:track', (req, res) => {
  const { track } = req.params;
  if (!['da', 'swe'].includes(track)) return res.status(400).json({ error: 'track must be da or swe' });
  clearSetting(`job.titles.${track}`);
  res.json({ titles: getJobTitles(track), custom: false });
});

// GET /api/settings/job/resume/:track — full résumé text (for the in-UI editor).
router.get('/job/resume/:track', (req, res) => {
  const { track } = req.params;
  if (!['da', 'swe'].includes(track)) return res.status(400).json({ error: 'track must be da or swe' });
  res.json({ track, content: getResumeContent(track) });
});

// PUT /api/settings/job/resume/:track { content } — replace that résumé file.
// The frontend reads the .tex the user picks and posts its text here; the scorer
// reads whatever is on disk, so the next run uses the new résumé immediately.
router.put('/job/resume/:track', (req, res) => {
  try {
    res.json({ resume: setResumeContent(req.params.track, (req.body || {}).content) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
