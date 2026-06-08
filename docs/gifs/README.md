# Optional Demo GIFs

This folder is reserved for future animated walkthroughs.

The main README currently uses full-screen PNG screenshots from
[`docs/screenshots/`](../screenshots/) because the first GIF pass was too busy
for a clean project overview. To record calmer manual GIFs later, use
[`scripts/record-demos.mjs`](../../scripts/record-demos.mjs) (Playwright → ffmpeg):

```bash
# one-time browser/encoder setup
npx playwright install chromium
# + ffmpeg on PATH  (macOS: brew install ffmpeg)

# with the frontend (5173) and backend (3001) both running:
npm run record:demos            # records home.gif, jobs.gif, graph.gif, research.gif
npm run record:demos -- home    # just one tab
```

Keep future clips stable: full-screen viewport, one tab at a time, and only one
small workflow per clip, such as opening a Job Board detail panel.
