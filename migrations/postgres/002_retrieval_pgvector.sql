-- Retrieval foundation for PostgreSQL 17 + pgvector.
-- Extension creation is intentionally fail-fast: production must not silently
-- start with a lexical-only schema when pgvector or pg_trgm is unavailable.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF to_regtype('vector') IS NULL THEN
    RAISE EXCEPTION 'pgvector extension did not register the vector type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm extension is required for Chinese lexical retrieval';
  END IF;
END $$;

ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;

-- Preserve chunk identity from the legacy deterministic health-document IDs.
UPDATE rag_documents
SET chunk_index = substring(id FROM ':chunk:([0-9]+)$')::INTEGER
WHERE id ~ ':chunk:[0-9]+$' AND chunk_index = 0;

UPDATE rag_documents
SET search_text = trim(concat_ws(' ', title, content))
WHERE search_text = '';

UPDATE rag_documents
SET metadata = CASE
  WHEN metadata_json IS NULL OR btrim(metadata_json) = '' THEN '{}'::jsonb
  ELSE metadata_json::jsonb
END
WHERE metadata = '{}'::jsonb;

UPDATE rag_documents
SET content_hash = md5(coalesce(title, '') || E'\x1f' || coalesce(content, '')),
    indexed_at = coalesce(indexed_at, now())
WHERE content_hash = '' OR indexed_at IS NULL;

-- The previous experimental schema used vector(128). Existing experimental
-- vectors cannot be meaningfully widened, so they are dropped and rebuilt by
-- scripts/reindex-retrieval.mjs.
DO $$
DECLARE
  embedding_type TEXT;
BEGIN
  SELECT format_type(attribute.atttypid, attribute.atttypmod)
  INTO embedding_type
  FROM pg_attribute attribute
  WHERE attribute.attrelid = 'rag_documents'::regclass
    AND attribute.attname = 'embedding'
    AND NOT attribute.attisdropped;

  IF embedding_type IS NULL THEN
    ALTER TABLE rag_documents ADD COLUMN embedding vector(1536);
  ELSIF embedding_type <> 'vector(1536)' THEN
    ALTER TABLE rag_documents DROP COLUMN embedding;
    ALTER TABLE rag_documents ADD COLUMN embedding vector(1536);
  END IF;
END $$;

-- Remove legacy duplicate logical documents before enforcing tenant-safe
-- uniqueness. The newest row wins.
WITH ranked AS (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY tenant_id, source_type, source_id, chunk_index
           ORDER BY indexed_at DESC NULLS LAST, updated_at DESC NULLS LAST, ctid DESC
         ) AS duplicate_rank
  FROM rag_documents
)
DELETE FROM rag_documents document
USING ranked
WHERE document.ctid = ranked.ctid AND ranked.duplicate_rank > 1;

UPDATE rag_documents
SET id = concat('retrieval:', tenant_id, ':', source_type, ':', source_id, ':chunk:', chunk_index)
WHERE id <> concat('retrieval:', tenant_id, ':', source_type, ':', source_id, ':chunk:', chunk_index);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_documents_tenant_source_chunk
  ON rag_documents(tenant_id, source_type, source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_rag_documents_tenant_type
  ON rag_documents(tenant_id, source_type, indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_documents_search_trgm
  ON rag_documents USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rag_documents_metadata
  ON rag_documents USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding_hnsw
  ON rag_documents USING hnsw(embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS retrieval_index_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  document_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retrieval_index_runs_tenant_started
  ON retrieval_index_runs(tenant_id, started_at DESC);

INSERT INTO schema_migrations(version) VALUES ('002_retrieval_pgvector')
ON CONFLICT (version) DO NOTHING;
