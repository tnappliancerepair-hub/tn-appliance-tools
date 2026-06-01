// Returns count of active techs for a company. Used by company-admin
// + subscription billing.
query get_active_techs_count verb=GET {
  api_group = "intake"

  input {
    int? company_id?
  }

  stack {
    var $cid {
      value = ($input.company_id ?? 1)
    }
  
    db.query technicians {
      where = $db.technicians.company_id == $cid && $db.technicians.active == true && $db.technicians.id != 8
      return = {type: "count"}
    } as $cnt
  }

  response = {
    success     : true
    company_id  : $cid
    active_techs: ($cnt ?? 0)
  }

  guid = "get-active-techs-count-v1"
}