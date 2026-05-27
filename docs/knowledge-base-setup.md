# Knowledge Base Setup (Task 54-56)

## Tables to add via Xano Metadata API

### knowledge_base
```
id              int (PK)
created_at      timestamp
appliance_type  text  (refrigerator, washer, dryer, dishwasher, range, microwave, hvac)
brand           text  (Whirlpool, GE, LG, Samsung, etc — empty = any)
model_pattern   text  (regex or wildcard — empty = any)
symptom_tags    text  (comma-separated: "not cooling, ice maker leak")
title           text
body            text  (markdown)
video_url       text  (optional YouTube/Vimeo)
source          text  (manual, ifixit, manufacturer, claude)
upvote_count    int (default 0)
created_by_tech_id int (nullable)
```

### vehicle_log
```
id              int (PK)
tech_id         int
created_at      timestamp
type            text  (fuel, oil, tire, maintenance, repair)
mileage         int
amount_cents    int
notes           text
```

### tool_inventory
```
id              int (PK)
tech_id         int
created_at      timestamp
tool_name       text
serial_number   text  (optional)
purchased_at    timestamp
replacement_due timestamp  (optional)
status          text  (active, lost, replaced)
```

## Endpoints to build once tables exist

- `add_knowledge_base_entry_POST` (office-only)
- `list_knowledge_base_GET` (already scaffolded, returns empty until table)
- `log_vehicle_event_POST` (tech-facing, from a future tech-vehicle.html)
- `log_tool_event_POST` (tech-facing)

## Pages to build

- `knowledge-base.html` — searchable repair guides (tech-facing in-truck)
- `tech-vehicle.html` — log mileage/fuel/oil/tire (tech-facing)
- `tech-tools.html` — tool inventory (tech-facing)

## Operator todo

1. Use Xano UI or Metadata API to create the three tables above
2. Seed knowledge_base with 50-100 entries (Claude can generate from ifixit
   scrapes once we have permission)
3. Re-deploy list_knowledge_base endpoint with the real db.query
4. Build the 3 HTML pages
