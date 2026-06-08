# Demo GIFs

Short animated walkthroughs of the README-highlighted tabs.

The current README embeds committed GIFs for every active tab:

- `home.gif`
- `jobs.gif`
- `graph.gif`
- `research.gif`
- `journal.gif`
- `goals.gif`
- `calendar.gif`
- `council.gif`
- `projects.gif`
- `settings.gif`

To regenerate richer browser recordings locally, use
[`scripts/record-demos.mjs`](../../scripts/record-demos.mjs) (Playwright → ffmpeg):

```bash
# one-time browser/encoder setup
npx playwright install chromium
# + ffmpeg on PATH  (macOS: brew install ffmpeg)

# with the frontend (5173) and backend (3001) both running:
npm run record:demos            # records home.gif, jobs.gif, graph.gif, research.gif
npm run record:demos -- home    # just one tab
```

Output lands here as `home.gif`, `jobs.gif`, `graph.gif`, and `research.gif`. Edit
the per-tab `steps` in the script to change what each recorded clip demonstrates.
