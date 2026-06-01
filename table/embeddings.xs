// v0 — text → vector index. Backend TBD.
table embeddings {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    int company_id?
    text namespace?
    text source_table?
    int source_row_id?
    text content_preview?
    text embedding_json?
    text embedding_model?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "OzwkJyTgdPtqkOPLao_JuHFt_uE"
}