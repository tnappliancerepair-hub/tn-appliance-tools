// Tiny Vapi REST API client. Read VAPI_PRIVATE_KEY from colony-loop/.env
// (or process.env). All calls return parsed JSON or throw on non-2xx.
//
// Usage:
//   const v = require('./vapi-client');
//   const assistants = await v.listAssistants();
//   await v.updateAssistant(id, { model: { ... }});

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.vapi.ai';

function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', 'colony-loop', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}
loadEnv();

const KEY = process.env.VAPI_PRIVATE_KEY;
if (!KEY) {
  console.error('VAPI_PRIVATE_KEY missing. Add it to colony-loop/.env (copy from Xano env).');
  process.exit(1);
}

async function call(method, pathSeg, body) {
  const url = `${BASE}${pathSeg}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Vapi ${method} ${pathSeg} → ${r.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);
const del = (p) => call('DELETE', p);

module.exports = {
  // Raw verbs (escape hatch)
  get,
  post,
  patch,
  delete: del,

  // Assistants
  listAssistants: () => get('/assistant?limit=100'),
  getAssistant: (id) => get(`/assistant/${id}`),
  createAssistant: (body) => post('/assistant', body),
  updateAssistant: (id, body) => patch(`/assistant/${id}`, body),
  deleteAssistant: (id) => del(`/assistant/${id}`),

  // Phone numbers
  listPhoneNumbers: () => get('/phone-number?limit=100'),
  getPhoneNumber: (id) => get(`/phone-number/${id}`),
  updatePhoneNumber: (id, body) => patch(`/phone-number/${id}`, body),

  // Tools (server-side custom functions)
  listTools: () => get('/tool?limit=100'),
  getTool: (id) => get(`/tool/${id}`),
  createTool: (body) => post('/tool', body),
  updateTool: (id, body) => patch(`/tool/${id}`, body),
  deleteTool: (id) => del(`/tool/${id}`),

  // Squads
  listSquads: () => get('/squad?limit=100'),
  getSquad: (id) => get(`/squad/${id}`),
  createSquad: (body) => post('/squad', body),
  updateSquad: (id, body) => patch(`/squad/${id}`, body),

  // Calls (for test orchestrator)
  createCall: (body) => post('/call', body),
  getCall: (id) => get(`/call/${id}`),
  listCalls: (q) => get(`/call?${q || 'limit=20'}`),
};
