-- hcp_vectors — semantic memory of HCP job history (pre-diagnosis "this model
-- failed like X, here's what we did"). Lives in Supabase pgvector, NOT Xano —
-- 24k embeddings = 24k bulk writes, and bulk Xano writes have melted it before.
-- Run once in the Supabase SQL editor. Then netlify/functions/hcp-embed.js grinds.

create extension if not exists vector;

create table if not exists hcp_vectors (
  id          bigserial primary key,
  hcp_id      text,                 -- the HCP job id this vector came from
  kind        text default 'job',
  body        text,                 -- the text that was embedded (description + notes)
  embedding   vector(1536),         -- text-embedding-3-small
  created_at  timestamptz default now()
);

create index if not exists hcp_vectors_hcpid_idx on hcp_vectors (hcp_id);
-- cosine-similarity index (hnsw = fast, no tuning). Supabase pgvector supports it.
create index if not exists hcp_vectors_emb_idx on hcp_vectors using hnsw (embedding vector_cosine_ops);
