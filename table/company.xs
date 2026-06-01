// Tenant table for multi-tenant SaaS. company_id=1 is TN Appliance Exchange (anchor).
table company {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    text name?
    text slug?
    text owner_phone?
    text owner_email?
    text tenant_status?
    text telnyx_from_customer?
    text telnyx_from_tech?
    text timezone?
    text branding_color?
    text logo_url?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "24vAzhFNUMn9jFbK7m5Dxc45gVk"
}