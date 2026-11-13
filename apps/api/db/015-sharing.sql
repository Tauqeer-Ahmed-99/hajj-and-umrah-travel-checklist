ALTER TABLE checklist_entries ADD COLUMN audience text NOT NULL DEFAULT 'family' CHECK (audience IN ('family','trip'));
ALTER TABLE checklist_entries ADD COLUMN shared_at timestamptz;
ALTER TABLE bags ADD COLUMN audience text NOT NULL DEFAULT 'family' CHECK (audience IN ('family','trip'));
ALTER TABLE bags ADD COLUMN shared_at timestamptz;
CREATE INDEX checklist_entries_shared_idx ON checklist_entries(family_id) WHERE audience = 'trip' AND removed_at IS NULL;
CREATE INDEX bags_shared_idx ON bags(family_id) WHERE audience = 'trip' AND removed_at IS NULL;
