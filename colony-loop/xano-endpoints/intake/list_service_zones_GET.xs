// Public list of all service zones — drives the customer-facing
// service-area.html "do you cover my area?" page.
query list_service_zones verb=GET {
  api_group = "intake"

  input {
    text? state?
    bool? accepting_only?
  }

  stack {
    var $state_in {
      value = ($input.state ?? "")|trim|upper
    }

    var $accepting_only_in {
      value = ($input.accepting_only ?? false)
    }

    db.query service_zone {
      where  = ($state_in == "" || $db.service_zone.state == $state_in) && ($accepting_only_in == false || $db.service_zone.accept_new_jobs == true)
      sort   = {service_zone.state: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows
  }

  response = {
    success    : true
    state      : $state_in
    count      : ($rows.items|count)
    zones      : $rows.items
  }

  guid = "list-service-zones-v1"
}
