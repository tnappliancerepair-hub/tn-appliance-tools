// Returns embeddings rows for a company + namespace. Used by the
// semantic retrieval Netlify function to compute similarity.
// Capped at 5000 rows; for larger corpora move to a real vector DB.
query list_embeddings verb=GET {
  api_group = "intake"

  input {
    int? company_id?
    text? namespace?
    int? limit?
  }

  stack {
    var $cid {
      value = ($input.company_id ?? 1)
    }

    var $ns {
      value = ($input.namespace ?? "general")
    }

    var $lim {
      value = ($input.limit ?? 5000)
    }

    db.query embeddings {
      where  = $db.embeddings.company_id == $cid && $db.embeddings.namespace == $ns
      sort   = {embeddings.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $rows
  }

  response = {
    success    : true
    company_id : $cid
    namespace  : $ns
    embeddings : $rows.items
  }

  guid = "list-embeddings-v1"
}
