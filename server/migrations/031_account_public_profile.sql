ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_users_tenant_profile_completed
  ON users(tenant_id, profile_completed_at);

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'auth_verification_codes'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE auth_verification_codes DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  ALTER TABLE auth_verification_codes ADD CONSTRAINT auth_verification_codes_purpose_check
    CHECK(purpose IN ('register','login','bind_phone','reset_password','delete_account'));
END $$;
