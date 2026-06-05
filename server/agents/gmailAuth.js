// ============================================================
//  Gmail OAuth — read-only access for the email agent.
//
//  Scope is gmail.readonly and nothing else: Nexus never sends, modifies,
//  or deletes mail. Two files (both gitignored, both in server/):
//    - credentials.json   OAuth "Desktop app" client from Google Cloud.
//    - gmail-token.json    the cached user token (written by `npm run gmail:auth`).
//
//  getGmailClient() returns an authed googleapis Gmail client, or throws a
//  CODED error so callers can degrade gracefully and tell the user exactly
//  what to do:
//    code 'NO_CREDENTIALS' → credentials.json missing.
//    code 'NEEDS_AUTH'     → token missing; run the one-time auth (err.authUrl).
// ============================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { google } from 'googleapis';
import { GMAIL_SCOPES, GMAIL_CREDENTIALS_PATH, GMAIL_TOKEN_PATH } from '../config.js';

function loadCredentials() {
  if (!existsSync(GMAIL_CREDENTIALS_PATH)) {
    const e = new Error('Gmail credentials.json not found in server/. Create OAuth Desktop credentials in Google Cloud and save them there.');
    e.code = 'NO_CREDENTIALS';
    throw e;
  }
  const raw = JSON.parse(readFileSync(GMAIL_CREDENTIALS_PATH, 'utf8'));
  // Desktop creds nest under "installed"; support a flat shape too.
  const c = raw.installed || raw.web || raw;
  return { clientId: c.client_id, clientSecret: c.client_secret, redirectUri: (c.redirect_uris && c.redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob' };
}

export function makeOAuthClient() {
  const { clientId, clientSecret, redirectUri } = loadCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Is the email agent ready (creds + token both present)? For status surfaces. */
export function gmailStatus() {
  if (!existsSync(GMAIL_CREDENTIALS_PATH)) return { ready: false, reason: 'NO_CREDENTIALS' };
  if (!existsSync(GMAIL_TOKEN_PATH)) return { ready: false, reason: 'NEEDS_AUTH' };
  return { ready: true, reason: null };
}

/** An authed Gmail client. Throws coded NO_CREDENTIALS / NEEDS_AUTH otherwise. */
export function getGmailClient() {
  const oAuth2Client = makeOAuthClient();
  if (!existsSync(GMAIL_TOKEN_PATH)) {
    const e = new Error('Gmail not authorized yet. Run `npm run gmail:auth` once to grant read-only access.');
    e.code = 'NEEDS_AUTH';
    e.authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: GMAIL_SCOPES, prompt: 'consent' });
    throw e;
  }
  oAuth2Client.setCredentials(JSON.parse(readFileSync(GMAIL_TOKEN_PATH, 'utf8')));
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

// ── one-time interactive authorization (used by scripts/gmail-auth.js) ────────
export function buildAuthUrl(oAuth2Client) {
  return oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: GMAIL_SCOPES, prompt: 'consent' });
}

/** Exchange the pasted consent code for a token and cache it to disk. */
export async function saveTokenFromCode(oAuth2Client, code) {
  const { tokens } = await oAuth2Client.getToken(code.trim());
  writeFileSync(GMAIL_TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return GMAIL_TOKEN_PATH;
}
