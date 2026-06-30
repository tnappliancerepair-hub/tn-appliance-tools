// Xano Metadata API wrappers for the tech-sms-inbound v2 brain.
//
// Why this exists: the original plan was to ship 7 small Xano endpoints
// (each <50 lines XanoScript) that the brain would call. That plan died
// in the canary phase when even an 18-line endpoint failed to deploy
// cleanly due to Xano's unresolved-references-become-placeholders import
// behavior (full writeup at docs/xano-deploy-corruption-explained-2026-05-20.md).
//
// Pivot: bypass XanoScript entirely. The Metadata API
//   /api:meta/workspace/{id}/table/{id}/content/...
// is Xano's admin-CRUD surface, documented and stable. It speaks raw
// table operations without going through the XanoScript import resolver,
// so the corruption surface doesn't exist.
//
// Auth: bearer token in env var XANO_METADATA_TOKEN. For 2026-05-20
// emergency build we set this from the user-scoped access token in
// ~/.xano/credentials.yaml; production hardening will rotate to a
// scoped Metadata API key (workspace:content:* only).

'use strict';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

// Table IDs are fixed per-workspace. Confirmed 2026-05-20 via
// /api:meta/workspace/1/table list endpoint.
const TABLES = {
  event_log: 3,
  agent_conversation: 4,
  agent_message: 5,
  customer: 6,
  jobs: 7,
  technicians: 15,
  tech_preferences: 27,
};

// ─── INTERNAL: HTTP layer with retry ──────────────────────────────────

function authHeaders() {
  const token = process.env.XANO_METADATA_TOKEN;
  if (!token) {
    throw new Error('XANO_METADATA_TOKEN env var not set');
  }
  return {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
  };
}

// fetch + 1 retry on 5xx. Throws { status, body, op } on persistent
// non-2xx so callers can branch on operation type. 4xx is fatal-no-retry.
async function callXano(method, path, body, op) {
  const url = XANO_BASE + path;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res, text;
    try {
      res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: body == null ? undefined : JSON.stringify(body),
      });
      text = await res.text();
    } catch (netErr) {
      if (attempt === 0) {
        await sleep(500);
        continue;
      }
      const err = new Error('xano network error: ' + netErr.message);
      err.op = op;
      throw err;
    }

    if (res.status >= 200 && res.status < 300) {
      try { return text ? JSON.parse(text) : null; }
      catch (_) { return text; }
    }

    if (res.status >= 500 && attempt === 0) {
      await sleep(500);
      continue;
    }

    const err = new Error('xano ' + method + ' ' + path + ' -> ' + res.status);
    err.status = res.status;
    err.body = text;
    err.op = op;
    throw err;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Xano Metadata API's `search` parameter SILENTLY IGNORES multi-field
// filters — `{a: 1, b: 2}` returns up-to-per_page unfiltered rows instead
// of narrowing. Single-field works correctly. Discovered 2026-05-20 during
// v2 brain rollout (caused Andre's messages to persist into Jimmy's conv
// because findOrCreateTechConversation searched with {tech_id, channel}
// and got conv 673 back).
function warnIfMultiField(filter, helper) {
  if (
    filter &&
    typeof filter === 'object' &&
    !Array.isArray(filter) &&
    Object.keys(filter).length > 1
  ) {
    console.warn(
      '[metadata-crud] ' + helper + ' called with multi-field filter [' +
        Object.keys(filter).join(', ') +
        ']. Xano silently ignores multi-field searches — only single-field works. Use one field at the API and filter the rest client-side.'
    );
  }
}

// ─── INTERNAL: shape helpers ──────────────────────────────────────────

async function search(tableId, filter) {
  warnIfMultiField(filter, 'search');
  const body = { search: filter };
  const r = await callXano('POST', `/table/${tableId}/content/search`, body, 'search');
  return (r && r.items) || [];
}

async function searchOne(tableId, filter, sort) {
  warnIfMultiField(filter, 'searchOne');
  const body = { search: filter, per_page: 1 };
  if (sort) body.sort = sort;
  const r = await callXano('POST', `/table/${tableId}/content/search`, body, 'searchOne');
  const items = (r && r.items) || [];
  return items[0] || null;
}

async function searchPage(tableId, filter, sort, perPage) {
  warnIfMultiField(filter, 'searchPage');
  const body = { search: filter, per_page: perPage, page: 1 };
  if (sort) body.sort = sort;
  const r = await callXano('POST', `/table/${tableId}/content/search`, body, 'searchPage');
  return (r && r.items) || [];
}

// Same as searchPage but with an explicit page number, for walking past page 1.
async function searchPageN(tableId, filter, sort, perPage, page) {
  warnIfMultiField(filter, 'searchPageN');
  const body = { search: filter, per_page: perPage, page: page || 1 };
  if (sort) body.sort = sort;
  const r = await callXano('POST', `/table/${tableId}/content/search`, body, 'searchPageN');
  return (r && r.items) || [];
}

async function insert(tableId, row) {
  return await callXano('POST', `/table/${tableId}/content`, row, 'insert');
}

async function update(tableId, rowId, partial) {
  return await callXano('PUT', `/table/${tableId}/content/${rowId}`, partial, 'update');
}

// ─── PUBLIC: brain-facing helpers ─────────────────────────────────────

// getTechByPhone — phone lookup with E.164 + bare-10-digit fallback.
// Mirrors the source endpoint's lines 31 + 51.
async function getTechByPhone(phone) {
  if (!phone) return null;

  const exact = await searchOne(TABLES.technicians, { phone });
  if (exact) return exact;

  const bare = String(phone).replace(/\D/g, '').slice(-10);
  if (!bare || bare === phone) return null;

  const fallback = await searchOne(TABLES.technicians, { phone: bare });
  return fallback || null;
}

// findOrCreateTechConversation — finds the latest sms conversation for a tech,
// creates one if missing. Mirrors source lines 86–117.
//
// IMPORTANT: cannot use searchOne with {tech_id, channel} together — Xano
// Metadata API silently ignores multi-field filters (see warnIfMultiField).
// Single-field search on tech_id (the more selective field), then JS-filter
// channel.
async function findOrCreateTechConversation(techId, channel) {
  const ch = channel || 'sms';

  const candidates = await searchPage(
    TABLES.agent_conversation,
    { tech_id: techId },
    { created_at: 'desc' },
    20
  );
  const existing = candidates.find((c) => c.channel === ch);
  if (existing) return existing;

  const sessionId = 'tech_' + techId + '_' + Date.now();
  return await insert(TABLES.agent_conversation, {
    tech_id: techId,
    channel: ch,
    title: 'Tech SMS',
    last_message_at: Date.now(),
    session_id: sessionId,
  });
}

// addAgentMessage — inserts a message row and bumps the conversation's
// last_message_at timestamp. The bump is fire-and-forget; we don't fail
// the whole call if it errors. Mirrors source lines 123 + 2127.
async function addAgentMessage(conversationId, role, content) {
  const msg = await insert(TABLES.agent_message, {
    conversation_id: conversationId,
    role,
    content,
  });
  update(TABLES.agent_conversation, conversationId, { last_message_at: Date.now() })
    .catch((e) => console.warn('[metadata-crud] conversation timestamp bump failed (non-fatal):', e.message));
  return msg;
}

// getRecentTechMessages — pulls last N messages sorted desc, returns in
// chronological order (oldest first) so caller can map directly to
// Anthropic's messages array. Mirrors source lines 143-163.
async function getRecentTechMessages(conversationId, limit) {
  const cap = Math.min(limit || 20, 50);
  const desc = await searchPage(
    TABLES.agent_message,
    { conversation_id: conversationId },
    { created_at: 'desc' },
    cap
  );
  return desc.reverse();
}

// updateTechFields — partial update on technicians. Caller passes only
// the fields it wants to change. Handles SET_HOURS (two fields),
// SET_SUMMARY_TIME, SET_PERSONAL_CONTEXT, and ONBOARDING_DONE
// (caller passes { onboarding_completed_at: <ts> }). Mirrors source
// lines 275, 309, 340, 419.
async function updateTechFields(techId, fields) {
  if (!fields || Object.keys(fields).length === 0) return null;
  return await update(TABLES.technicians, techId, fields);
}

// addTechPreference — inserts a tech_preferences row. Caller passes the
// full preference object; we default `active=true` and `source="explicit"`
// to match the source endpoint's behavior at line 382.
async function addTechPreference(prefObject) {
  const row = Object.assign(
    { active: true, source: 'explicit' },
    prefObject
  );
  return await insert(TABLES.tech_preferences, row);
}

// logEvent — writes an event_log row. NEVER throws; audit failures must
// not break the caller. Mirrors source line 230 (Fix 2 Claude-error
// logging) plus general-purpose use elsewhere in the brain.
async function logEvent(action, metadata) {
  try {
    return await insert(TABLES.event_log, { action, metadata: metadata || {} });
  } catch (e) {
    console.error('[metadata-crud] logEvent failed (non-fatal):', e.message);
    return null;
  }
}

module.exports = {
  TABLES,
  search,
  searchPage,
  searchPageN,
  searchOne,
  insert,
  update,
  getTechByPhone,
  findOrCreateTechConversation,
  addAgentMessage,
  getRecentTechMessages,
  updateTechFields,
  addTechPreference,
  logEvent,
};
