-- Stable semester catalog and pay-at-stall reservation contract.

ALTER TABLE canteens
  ADD COLUMN IF NOT EXISTS venue_kind TEXT NOT NULL DEFAULT 'dining_hall';
ALTER TABLE canteens DROP CONSTRAINT IF EXISTS canteens_venue_kind_check;
ALTER TABLE canteens ADD CONSTRAINT canteens_venue_kind_check
  CHECK (venue_kind IN ('campus_zone','dining_hall','service_building','supermarket'));

ALTER TABLE stalls
  ADD COLUMN IF NOT EXISTS reservation_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS reservation_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stall_id TEXT REFERENCES stalls(id) ON DELETE RESTRICT;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'reservation';
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'at_stall';
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pricing_status TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS estimated_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS final_amount DOUBLE PRECISION;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('reservation'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('at_stall'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pricing_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_pricing_status_check
  CHECK (pricing_status IN ('exact','pending_confirmation','confirmed'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_estimated_amount_check;
ALTER TABLE orders ADD CONSTRAINT orders_estimated_amount_check CHECK (estimated_amount >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_final_amount_check;
ALTER TABLE orders ADD CONSTRAINT orders_final_amount_check CHECK (final_amount IS NULL OR final_amount >= 0);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS price_display TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pricing_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pricing_status TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS estimated_unit_price DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS confirmed_unit_price DOUBLE PRECISION;
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS item_note TEXT NOT NULL DEFAULT '';

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pricing_mode_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_pricing_mode_check
  CHECK (pricing_mode IN ('fixed','per_weight','per_unit','per_person','variants','tiered'));
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pricing_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_pricing_status_check
  CHECK (pricing_status IN ('exact','pending_confirmation','confirmed'));
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_estimated_unit_price_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_estimated_unit_price_check CHECK (estimated_unit_price >= 0);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_confirmed_unit_price_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_confirmed_unit_price_check
  CHECK (confirmed_unit_price IS NULL OR confirmed_unit_price >= 0);

CREATE INDEX IF NOT EXISTS idx_canteens_tenant_kind
  ON canteens(tenant_id, venue_kind, parent_id);
CREATE INDEX IF NOT EXISTS idx_stalls_catalog_reservations
  ON stalls(tenant_id, canteen_id, reservation_enabled, id);
CREATE INDEX IF NOT EXISTS idx_dishes_catalog_reservations
  ON dishes(tenant_id, stall_id, status, reservation_enabled, id);
CREATE INDEX IF NOT EXISTS idx_dishes_name_trgm
  ON dishes USING gin(name gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tenant_user_idempotency
  ON orders(tenant_id, user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_orders_tenant_stall_created
  ON orders(tenant_id, stall_id, created_at DESC);

DROP INDEX IF EXISTS idx_rag_documents_embedding_hnsw;
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
    ALTER TABLE rag_documents ADD COLUMN embedding vector(1024);
  ELSIF embedding_type <> 'vector(1024)' THEN
    ALTER TABLE rag_documents ALTER COLUMN embedding TYPE vector(1024)
      USING NULL::vector(1024);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding_hnsw
  ON rag_documents USING hnsw(embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;
