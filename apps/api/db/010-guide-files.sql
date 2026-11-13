-- Independent of concurrent checklist/acquisition migrations 007 and 009.
CREATE TABLE guide_files (
  id uuid PRIMARY KEY,
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL,
  UNIQUE (guide_id, id)
);
CREATE TABLE guide_uploads (
  id uuid PRIMARY KEY,
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  details jsonb NOT NULL,
  file_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (guide_id, file_id) REFERENCES guide_files(guide_id, id)
);
CREATE INDEX guide_uploads_guide_idx ON guide_uploads(guide_id, created_at);
