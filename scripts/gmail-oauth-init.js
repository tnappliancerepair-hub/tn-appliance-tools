#!/usr/bin/env node
// Gmail OAuth refresh-token minter.
// Prints a Google consent URL → user signs in → pastes the redirected URL
// (or just the code parameter) → script exchanges for refresh token.
//
// Run from repo root:
//   node scripts/gmail-oauth-init.js
//
// You'll need GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET from Google Cloud
// Console (Credentials → OAuth client → Desktop app).

const readline = require('readline');
const http = require('http');
const { URL } = require('url');

const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const REDIRECT = 'http://localhost:53682';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log('\n=== Gmail OAuth refresh-token init ===\n');

  const clientId = (await ask('GMAIL_CLIENT_ID: ')).trim();
  const clientSecret = (await ask('GMAIL_CLIENT_SECRET: ')).trim();
  if (!clientId || !clientSecret) {
    console.error('Both client_id and client_secret required.');
    process.exit(1);
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');

  console.log('\nOpen this URL in your browser:\n');
  console.log(url.toString());
  console.log('\nSign in as tnappliancerepair@gmail.com. If you see');
  console.log('"Google hasn\'t verified this app" → click Advanced →');
  console.log('"Go to ... (unsafe)". Click Allow.\n');
  console.log('After consent your browser will fail to load localhost:53682.');
  console.log('That\'s fine — this script is listening there to catch the code.\n');

  // Listen on localhost:53682 to receive the OAuth callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      if (c) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>OK — you can close this tab</h1><p>Refresh token will be in the terminal.</p>');
        server.close();
        resolve(c);
      } else if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Error: ' + err);
        server.close();
        reject(new Error('OAuth error: ' + err));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(53682, () => console.log('Listening on http://localhost:53682 for the callback...'));
  });

  console.log('\nGot auth code. Exchanging for refresh token...');

  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });
  const data = await r.json();
  if (!data.refresh_token) {
    console.error('\nNo refresh_token returned. Response:');
    console.error(data);
    console.error('\nIf you see "No refresh_token", revoke this client at');
    console.error('https://myaccount.google.com/permissions and re-run.');
    process.exit(1);
  }

  console.log('\n=== Paste these into Netlify env vars ===\n');
  console.log('GMAIL_CLIENT_ID=' + clientId);
  console.log('GMAIL_CLIENT_SECRET=' + clientSecret);
  console.log('GMAIL_REFRESH_TOKEN=' + data.refresh_token);
  console.log('\nThen trigger a redeploy and verify with:');
  console.log('  curl -X POST https://tnapplianceexchange.net/.netlify/functions/ahs-gmail-poller');
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
