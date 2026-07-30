-- Catalog publication boundary: administrative data remains tenant-scoped, while
-- student-facing APIs and RAG consume only approved, explicitly eligible records.
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS retrieval_eligible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_review_status_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_review_status_check
  CHECK (review_status IN ('approved', 'pending', 'excluded'));
ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_retrieval_eligible_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_retrieval_eligible_check
  CHECK (retrieval_eligible IN (0, 1));

ALTER TABLE stalls
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE stalls
  ADD COLUMN IF NOT EXISTS retrieval_eligible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stalls DROP CONSTRAINT IF EXISTS stalls_review_status_check;
ALTER TABLE stalls ADD CONSTRAINT stalls_review_status_check
  CHECK (review_status IN ('approved', 'pending', 'excluded'));
ALTER TABLE stalls DROP CONSTRAINT IF EXISTS stalls_retrieval_eligible_check;
ALTER TABLE stalls ADD CONSTRAINT stalls_retrieval_eligible_check
  CHECK (retrieval_eligible IN (0, 1));

ALTER TABLE canteens
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE canteens
  ADD COLUMN IF NOT EXISTS retrieval_eligible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE canteens DROP CONSTRAINT IF EXISTS canteens_review_status_check;
ALTER TABLE canteens ADD CONSTRAINT canteens_review_status_check
  CHECK (review_status IN ('approved', 'pending', 'excluded'));
ALTER TABLE canteens DROP CONSTRAINT IF EXISTS canteens_retrieval_eligible_check;
ALTER TABLE canteens ADD CONSTRAINT canteens_retrieval_eligible_check
  CHECK (retrieval_eligible IN (0, 1));

-- Structural and priced add-on rows are retained for source audit but are never
-- discoverable as standalone meals or evidence in student retrieval.
UPDATE dishes
SET review_status = 'excluded', retrieval_eligible = 0
WHERE catalog_item_type IN ('addon', 'fee', 'variant', 'section');

CREATE INDEX IF NOT EXISTS idx_dishes_publication_boundary
  ON dishes(tenant_id, review_status, retrieval_eligible, catalog_item_type, status);
CREATE INDEX IF NOT EXISTS idx_stalls_publication_boundary
  ON stalls(tenant_id, review_status, retrieval_eligible, canteen_id);
CREATE INDEX IF NOT EXISTS idx_canteens_publication_boundary
  ON canteens(tenant_id, review_status, retrieval_eligible, parent_id);
