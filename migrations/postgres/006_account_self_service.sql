-- Permit authenticated student accounts to delete only their own user row.
ALTER TABLE auth_verification_codes
  DROP CONSTRAINT IF EXISTS auth_verification_codes_purpose_check;
ALTER TABLE auth_verification_codes
  ADD CONSTRAINT auth_verification_codes_purpose_check
  CHECK (purpose IN ('register','reset_password','delete_account'));

DROP POLICY IF EXISTS users_self_delete ON users;
CREATE POLICY users_self_delete ON users
  FOR DELETE USING (
    app_tenant_matches(tenant_id)
    AND id = app_current_user_id()
    AND role = 'student'
    AND app_current_role() = 'student'
  );
