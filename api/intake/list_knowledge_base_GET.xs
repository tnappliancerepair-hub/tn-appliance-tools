// Returns indexed repair-guide entries filtered by appliance + brand.
// Schema: knowledge_base table needs to be added (id, appliance_type,
// brand, model_pattern, title, body, video_url, source, created_at).
// Until then returns empty placeholder + operator note.
query list_knowledge_base verb=GET {
  api_group = "intake"

  input {
    text? appliance_type?
    text? brand?
    text? symptom?
  }

  stack {
    // Placeholder: knowledge_base table doesn't exist yet.
    // db.query would go here once operator creates the table.
  }

  response = {
    success: true
    note   : "knowledge_base table not yet created — see docs/knowledge-base-setup.md"
    entries: []
  }

  guid = "list-knowledge-base-v1"
}