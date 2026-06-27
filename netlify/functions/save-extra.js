// Blocker-proof alias for record-addon. Some customer phones run content/ad
// blockers with broad filters that kill any request URL containing "addon"
// (record-addon), so the customer portal posts add-on requests HERE instead —
// identical behavior + CORS, just a name a blocker won't match. Office/tech
// surfaces keep using record-addon directly.
'use strict';
module.exports = require('./record-addon');
