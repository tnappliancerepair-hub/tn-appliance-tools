# Fix: TDR `parts_needed` never saves/displays (blocks 100% warranty readiness)

**Date:** 2026-07-04 · **Found while wiring the inline-edit TDR card.**

## Root cause (proven live on job 20004)
`technician_decision_report.parts_needed` is configured as a **JSON / list column**, but
**every writer in the app writes a plain string** and **every reader `to_text`s it**:

| Writer | writes | result |
|---|---|---|
| `update_tdr_field_from_voice` (`db.edit {parts_needed:$clean_value}`) | string | silently stays `null` |
| `save_part_from_photo` (`db.edit {parts_needed:$label}`) | string | silently stays `null` |
| `set-tdr-field` (metadata PUT) | string/array | metadata API silently drops list columns |

| Reader | reads | result |
|---|---|---|
| `get_unified_tdr_status` | `($tdr.parts_needed ?? "")｜to_text` | a list renders as `""` |
| `list_warranty_pipeline`, `dispatch_ant_field_assist`, `tech-simple.html` | same | `""` |

Nobody treats it as a list (the real structured parts field is **`parts_used`**, a JSON array of
`{part_number,description,quantity}` — see `create_tdr` line 333). So `parts_needed` should just be
plain text. Because parts is 1 of the 7 fields `get_unified` requires, **no job can hit 100% →
"Submit Warranty" never enables.**

Test proof: writing `parts_needed` as a string (function API `db.edit`) OR as an array (metadata PUT)
both left the raw column `null`, while `diagnosis`/`failed_component`/`labor_time_hours`/
`repair_completed`/`verified_part_number` (all text columns) persist fine.

---

## ✅ Option A — RECOMMENDED (no code, ~15 sec, fixes every writer at once)
Change the column type in the Xano UI:

1. Xano → Database → **technician_decision_report** → column **`parts_needed`**.
2. Change its type from **JSON / list** to **Text** (single-line or long-text), **list = OFF**.
3. Save. (No data to migrate — every existing value is `null` because writes have been failing.)

That's it. `update_tdr_field_from_voice`, `save_part_from_photo`, and `get_unified`'s `to_text`
all start working immediately with **zero XS changes**. Then ping me (or flip it yourself — one line)
to re-enable parts editing in the card (see bottom).

Why A over B: it fixes ALL parts writers at once (B only fixes the voice endpoint + reader), and it
matches how every consumer already uses the field (as text).

---

## Option B — code-only alternative (keep it a list; push 2 XS files)
Only if you'd rather not touch the schema. This makes the writer store a 1-element list and the
reader join it back to text. **Mutually exclusive with Option A** — if you do A, do NOT apply B
(the `｜join` read would break on scalar text).

### B1. `api/intake/get_unified_tdr_status_GET.xs`
Change the parts read (was line ~71):
```
// BEFORE
var $v_parts  { value = ($tdr == null) ? "" : (($tdr.parts_needed ?? "")|to_text) }
// AFTER  (join a list back to text; null -> [] -> "")
var $v_parts  { value = ($tdr == null) ? "" : (($tdr.parts_needed ?? [])|join:", ") }
```

### B2. `api/intake/update_tdr_field_from_voice_POST.xs`
Add a list-wrapped value (proven `[]|push:` pattern) and write it as a list.

Change the create-path var (was lines ~60-62):
```
// BEFORE
var $v_parts {
  value = ($field_clean == "parts_needed") ? $clean_value : ""
}
// AFTER
var $parts_list {
  value = ([] |push: $clean_value)
}
var $v_parts {
  value = ($field_clean == "parts_needed") ? $parts_list : null
}
```
Change the edit-path conditional (was lines ~144-152):
```
// BEFORE
conditional {
  if ($existing != null && $field_clean == "parts_needed") {
    db.edit technician_decision_report {
      field_name = "id"
      field_value = $existing_id
      data = {parts_needed: $clean_value}
    }
  }
}
// AFTER
conditional {
  if ($existing != null && $field_clean == "parts_needed") {
    db.edit technician_decision_report {
      field_name = "id"
      field_value = $existing_id
      data = {parts_needed: $parts_list}
    }
  }
}
```
Push:
```
xano workspace push -i "api/**/{get_unified_tdr_status,update_tdr_field_from_voice}*" --force
```
Note: B leaves `save_part_from_photo` (photo→part) still writing a string — separate follow-up.
B's XS is unverified until pushed (can't test XS from the cloud env); `xano push` will report a
parse error if any. Option A carries none of that risk.

---

## After the column is fixed — re-enable parts editing in the card (front-end, 1 line)
In `ant-tdr-card.js`, the field loop currently forces `parts_needed` read-only:
```
var editable = canEdit && !!FIELD_META[f.key] && f.key !== 'parts_needed';
```
Change to:
```
var editable = canEdit && !!FIELD_META[f.key];
```
and bump the `?v=` on the 4 pages that embed it. Then all 5 TDR fields are inline-editable and a
job can reach 100% ready-for-warranty. (I'll do this the moment you confirm the column is fixed.)
