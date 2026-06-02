#!/usr/bin/env bash
# Bulk-import of tech operational profiles from docs/tech-operational-profiles.md
# (captured 2026-05-07 from direct conversations with Lee, Jimmy, Andre, John).
#
# Ran once 2026-06-02 as part of Block 1 of the Ant Scheduler vision build.
# Pre-fills each tech's profile so they open tech-scheduler.html and CONFIRM
# their answers rather than re-entering from scratch.
#
# Idempotent: re-running just re-applies the same payload (PUT semantics).
#
# Requires XANO_METADATA_TOKEN in colony-loop/.env. Run from repo root.

set -euo pipefail
source colony-loop/.env 2>/dev/null

META="https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1"
TECH_TABLE_ID=15

put_tech() {
  local id="$1"
  local payload="$2"
  curl -s -X PUT \
    -H "Authorization: Bearer $XANO_METADATA_TOKEN" \
    -H "Content-Type: application/json" \
    "$META/table/$TECH_TABLE_ID/content/$id" \
    -d "$payload" \
    | jq -r '.id // .error // "?"'
}

# ID 4 — Lee Harding
LEE=$(jq -n '{home_zone: "Clarksville", max_stops_per_day: 7, geographic_strategy: "zone_commit", personal_context: "Full Nashville days OR full Clarksville days, no mixing. Only 1 job after 3:00 PM. Dickson only as last-stop on the way home from West Nashville. Hour drives between jobs are the primary complaint."}')
echo "Lee (id=4): $(put_tech 4 "$LEE")"

# ID 2 — Jimmy Pivacek
JIMMY=$(jq -n '{home_zone: "Antioch", max_stops_per_day: 7, geographic_strategy: "linear", personal_context: "Linear progression — start at FURTHEST point, work back toward Antioch. Some days entirely local in Antioch/Davidson core. End-of-day jobs within 5-20 min of home preferred. Avoid Sumner + Wilson + Williamson same day. Williamson County NOT in stated territory."}')
echo "Jimmy (id=2): $(put_tech 2 "$JIMMY")"

# ID 3 — Andre
ANDRE=$(jq -n '{home_zone: "Hammond, LA (dual-state)", preferred_hours_start: "09:00", preferred_hours_end: "18:00", max_stops_per_day: 7, geographic_strategy: "linear", personal_context: "Dual-state: LA primary + TN trips when demand justifies. Linear progression — start furthest, work back to Hammond. Trailer in LA, houseboat in TN. Demand-following flex resource. 1 week notice for trip planning. Min viable trip: 6 jobs/day x 5 days = 30 jobs."}')
echo "Andre (id=3): $(put_tech 3 "$ANDRE")"

# ID 6 — John Houk
JOHN=$(jq -n '{home_zone: "Walker, LA", preferred_hours_start: "07:30", preferred_hours_end: "15:30", max_stops_per_day: 6, max_drive_distance: 60, geographic_strategy: "linear", personal_context: "Preference hierarchy: Baton Rouge first (30-45 min, primary), North Shore second (Slidell/Mandeville/Covington), South Shore last resort (Metairie/NOLA proper). Avoids being far from home in traffic. BR as much as possible, NOLA as little as possible."}')
echo "John (id=6): $(put_tech 6 "$JOHN")"

# ID 1 — Teddy Pivacek
TEDDY=$(jq -n '{home_zone: "Antioch", geographic_strategy: "linear", personal_context: "Dual-state owner-operator. Cybertruck-equipped, location-independent triage. Primary functions: Quick Check (remote triage), routing decisions, system monitoring, customer escalation. LA trips monthly to every 6 weeks."}')
echo "Teddy (id=1): $(put_tech 1 "$TEDDY")"

# ID 5 — Billy Savoy (NOT YET INTERVIEWED — placeholder)
BILLY=$(jq -n '{home_zone: "Hammond, LA (unconfirmed)", personal_context: "NOT YET INTERVIEWED 2026-05-07. Coverage assumed Hammond + North Shore overlap with Andre + John. To-do: confirm day shape, split with Andre/John, dealbreakers."}')
echo "Billy (id=5): $(put_tech 5 "$BILLY")"
