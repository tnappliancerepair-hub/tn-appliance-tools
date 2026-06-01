// Catalog of upsell addons techs can offer customers. Keyed by appliance type. tech_split defaults to 0.50 (50/50 split).
table addon_catalog {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // refrigerator, oven, dryer, etc.
    text? appliance_type?
  
    // Addon name shown to customer
    text? name?
  
    // Customer-facing addon description
    text? description?
  
    // Internal cost
    decimal? our_cost?
  
    // Customer-facing price
    decimal? sell_price?
  
    // Tech share of profit (default 0.50)
    decimal? tech_split?="0.5"
  
    // Available for upsell (default true)
    bool? active?=true
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "appliance_type", op: "asc"}]}
    {type: "btree", field: [{name: "active", op: "asc"}]}
  ]

  guid = "WyrhbDdwr4_K4OCTR67TCQWur4E"
}