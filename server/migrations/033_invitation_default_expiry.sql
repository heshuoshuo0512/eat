ALTER TABLE pilot_invitation_settings
  ALTER COLUMN expires_after_days SET DEFAULT 3;

UPDATE pilot_invitation_settings
SET expires_after_days = 3
WHERE expires_after_days = 30;

INSERT INTO schema_migrations(version) VALUES ('033_invitation_default_expiry')
ON CONFLICT (version) DO NOTHING;
