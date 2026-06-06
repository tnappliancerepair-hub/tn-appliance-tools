// Generates a downloadable .ics calendar file for a customer's
// appointment. URL: /.netlify/functions/appointment-ics?job_id=X&last4=YYYY
//
// Lets the customer add the appointment to Apple Calendar / Google
// Calendar with one tap.

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const jobId = Number(p.job_id || 0);
  const last4 = String(p.last4 || '').trim();
  if (!jobId || !last4) return { statusCode: 400, body: 'job_id + last4 required' };

  // Verify customer via the same last4 gate used by customer-portal
  let view;
  try {
    const r = await fetch(`${XANO_INTAKE}/get_customer_job_view`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ job_id: jobId, phone_last4: last4 }),
    });
    view = await r.json();
  } catch (err) {
    return { statusCode: 500, body: 'fetch failed' };
  }
  if (!view || !view.success) return { statusCode: 401, body: 'unauthorized' };

  const job = view.job || {};
  const cust = view.customer || {};
  const tech = view.tech || {};
  const startMs = Number(job.scheduled_start || 0);
  if (!startMs) return { statusCode: 404, body: 'no scheduled time' };

  const start = new Date(startMs);
  const end = new Date(startMs + 2 * 60 * 60 * 1000); // 2h block default

  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const summary = `Appliance repair: ${(job.brand || '') + ' ' + (job.appliance || '')}`.trim() || 'TN Appliance Repair';
  const techName = (tech.first_name || '') + (tech.last_name ? ' ' + tech.last_name : '');
  const description = `Your tech: ${techName || 'TBA'}\\nIssue: ${(job.problem_summary || '').replace(/\n/g, ' ')}\\nQuestions: 866-268-0111`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TN Appliance Exchange//Ant//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:tn-job-${jobId}@tnapplianceexchange.net`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${(cust.first_name || 'customer') + ' (home)'}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Tech arrives in 1 hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="tn-appliance-job-${jobId}.ics"`,
    },
    body: ics,
  };
};
