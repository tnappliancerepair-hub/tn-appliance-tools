// One-shot admin endpoint to edit a technician row.
// Used for cleanup actions (deactivate orphans, mark onboarded, etc.).
// No auth - operator-only, ad-hoc. Do NOT call from client code.
query update_technician verb=POST {
  api_group = "intake"

  input {
    int technician_id
    bool? deactivate?
    bool? activate?
    bool? set_onboarding_now?
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech_before

    conditional {
      if ($tech_before == null) {
        return {
          value = {success: false, error: "tech_not_found", technician_id: $input.technician_id}
        }
      }
    }

    var $did_active_update {
      value = false
    }

    var $did_onb_update {
      value = false
    }

    conditional {
      if ($input.deactivate == true) {
        db.edit technicians {
          field_name = "id"
          field_value = $input.technician_id
          data = {active: false}
        } as $upd_deactivate

        var.update $did_active_update {
          value = true
        }
      }
    }

    conditional {
      if ($input.activate == true) {
        db.edit technicians {
          field_name = "id"
          field_value = $input.technician_id
          data = {active: true}
        } as $upd_activate

        var.update $did_active_update {
          value = true
        }
      }
    }

    conditional {
      if ($input.set_onboarding_now == true) {
        db.edit technicians {
          field_name = "id"
          field_value = $input.technician_id
          data = {onboarding_completed_at: now}
        } as $upd_onb

        var.update $did_onb_update {
          value = true
        }
      }
    }

    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech_after

    db.add event_log {
      data = {
        action  : "technician_admin_update"
        metadata: {
          technician_id        : $input.technician_id
          did_active_update    : $did_active_update
          did_onboarding_update: $did_onb_update
          new_active           : ($tech_after.active ?? null)
          new_onboarding_at    : ($tech_after.onboarding_completed_at ?? null)
        }
      }
    } as $log
  }

  response = {
    success              : true
    technician_id        : $input.technician_id
    did_active_update    : $did_active_update
    did_onboarding_update: $did_onb_update
    technician           : $tech_after
  }

  guid = "update-technician-v1"
}
