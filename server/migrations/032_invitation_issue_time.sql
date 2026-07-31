ALTER TABLE pilot_invitation_settings
  ADD COLUMN IF NOT EXISTS issue_time TEXT NOT NULL DEFAULT '09:00';

INSERT INTO schema_migrations(version) VALUES ('032_invitation_issue_time')
ON CONFLICT (version) DO NOTHING;
