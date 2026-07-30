ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS retrieval_eligible INTEGER NOT NULL DEFAULT 1;

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_review_status_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_review_status_check
  CHECK (review_status IN ('approved', 'pending', 'excluded'));

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_retrieval_eligible_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_retrieval_eligible_check
  CHECK (retrieval_eligible IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_dishes_review_status
  ON dishes(tenant_id, review_status, catalog_item_type, status);

CREATE INDEX IF NOT EXISTS idx_dishes_retrieval
  ON dishes(tenant_id, review_status, retrieval_eligible, catalog_item_type, status);

ALTER TABLE stalls
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE stalls
  ADD COLUMN IF NOT EXISTS retrieval_eligible INTEGER NOT NULL DEFAULT 1;

ALTER TABLE stalls DROP CONSTRAINT IF EXISTS stalls_review_status_check;
ALTER TABLE stalls
  ADD CONSTRAINT stalls_review_status_check
  CHECK (review_status IN ('approved', 'pending', 'excluded'));

ALTER TABLE stalls DROP CONSTRAINT IF EXISTS stalls_retrieval_eligible_check;
ALTER TABLE stalls
  ADD CONSTRAINT stalls_retrieval_eligible_check
  CHECK (retrieval_eligible IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_stalls_retrieval
  ON stalls(tenant_id, review_status, retrieval_eligible);

ALTER TABLE canteens
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE canteens
  ADD COLUMN IF NOT EXISTS retrieval_eligible INTEGER NOT NULL DEFAULT 1;

ALTER TABLE canteens DROP CONSTRAINT IF EXISTS canteens_review_status_check;
ALTER TABLE canteens
  ADD CONSTRAINT canteens_review_status_check
  CHECK (review_status IN ('approved', 'pending', 'excluded'));

ALTER TABLE canteens DROP CONSTRAINT IF EXISTS canteens_retrieval_eligible_check;
ALTER TABLE canteens
  ADD CONSTRAINT canteens_retrieval_eligible_check
  CHECK (retrieval_eligible IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_canteens_retrieval
  ON canteens(tenant_id, review_status, retrieval_eligible);
