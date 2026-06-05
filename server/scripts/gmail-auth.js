// ============================================================
//  One-time Gmail authorization (read-only).
//
//  Run once:  npm run gmail:auth
//
//  Prints a Google consent URL, you approve in the browser, paste the code
//  back here, and the token is cached to server/gmail-token.json (gitignored).
//  After that the email agent runs unattended. Scope is gmail.readonly only —
//  this never grants send or delete.
// ============================================================
import 'dotenv/config';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { makeOAuthClient, buildAuthUrl, saveTokenFromCode } from '../agents/gmailAuth.js';
import { GMAIL_CREDENTIALS_PATH, GMAIL_TOKEN_PATH } from '../config.js';

// Pull the auth code out of whatever the user pasted: a full
// "http://localhost/?code=XXX&scope=..." redirect URL, a "code=XXX" fragment,
// or a bare (possibly percent-encoded) code. Returns the decoded code.
function extractCode(input) {
  let s = String(input).trim();
  if (!s) return s;
  // full URL → read the `code` query param (URLSearchParams decodes it)
  try {
    if (/^https?:\/\//i.test(s)) {
      const code = new URL(s).searchParams.get('code');
      if (code) return code;
    }
  } catch { /* fall through to manual parse */ }
  // "code=XXX&..." or "?code=XXX"
  const m = s.match(/[?&]?code=([^&\s]+)/i);
  if (m) s = m[1];
  // decode percent-encoding if present (address-bar copies look like 4%2F0...)
  try { if (s.includes('%')) s = decodeURIComponent(s); } catch { /* keep as-is */ }
  return s;
}

async function main() {
  if (!existsSync(GMAIL_CREDENTIALS_PATH)) {
    console.error(`\n✗ credentials.json not found at ${GMAIL_CREDENTIALS_PATH}`);
    console.error('  Create OAuth "Desktop app" credentials in Google Cloud (enable the Gmail API),');
    console.error('  download the JSON, and save it there. Then re-run `npm run gmail:auth`.\n');
    process.exit(1);
  }

  const oAuth2Client = makeOAuthClient();
  const url = buildAuthUrl(oAuth2Client);
  console.log('\n1) Open this URL and grant read-only Gmail access:\n');
  console.log('   ' + url + '\n');
  console.log('2) Your browser will then redirect to http://localhost/?code=...  — that page');
  console.log('   will show "site can\'t be reached", which is FINE. Copy the whole address-bar');
  console.log('   URL (or just the code) and paste it here.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const raw = await new Promise((resolve) => rl.question('Pasted URL or code: ', resolve));
  rl.close();

  // Accept either the full redirect URL (extract ?code=) or a bare code, and
  // URL-decode it (the address bar shows the code percent-encoded, e.g. 4%2F0...).
  const code = extractCode(raw);

  try {
    await saveTokenFromCode(oAuth2Client, code);
    console.log(`\n✓ Token saved to ${GMAIL_TOKEN_PATH}. The email agent is now authorized (read-only).\n`);
  } catch (e) {
    console.error(`\n✗ Failed to exchange the code: ${e.message}\n`);
    process.exit(1);
  }
}

main();
