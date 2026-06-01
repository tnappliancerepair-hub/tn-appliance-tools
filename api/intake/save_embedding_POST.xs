// Persists an embedding to the embeddings table. Called by
// netlify/functions/embed-text after it generates the vector.
query save_embedding verb=POST {
  api_group = "intake"

  input {
    int company_id
    text namespace
    text source_table
    int source_row_id
    text content_preview
    text embedding_json
    text embedding_model
  }

  stack {
    // Upsert: replace existing row if same (source_table, source_row_id, namespace)
    db.query embeddings {
      where = $db.embeddings.source_table == $input.source_table && $db.embeddings.source_row_id == $input.source_row_id && $db.embeddings.namespace == $input.namespace
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows
  
    var $existing {
      value = (($existing_rows.items|first) ?? null)
    }
  
    var $row_id {
      value = 0
    }
  
    var $action {
      value = ""
    }
  
    conditional {
      if ($existing == null) {
        db.add embeddings {
          data = {
            company_id     : $input.company_id
            namespace      : $input.namespace
            source_table   : $input.source_table
            source_row_id  : $input.source_row_id
            content_preview: $input.content_preview
            embedding_json : $input.embedding_json
            embedding_model: $input.embedding_model
          }
        } as $new_row
      
        var.update $row_id {
          value = $new_row.id
        }
      
        var.update $action {
          value = "created"
        }
      }
    
      else {
        db.edit embeddings {
          field_name = "id"
          field_value = $existing.id
          data = {
            content_preview: $input.content_preview
            embedding_json : $input.embedding_json
            embedding_model: $input.embedding_model
          }
        } as $updated
      
        var.update $row_id {
          value = $existing.id
        }
      
        var.update $action {
          value = "updated"
        }
      }
    }
  }

  response = {success: true, row_id: $row_id, action: $action}
  guid = "save-embedding-v1"
}