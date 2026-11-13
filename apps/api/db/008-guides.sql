CREATE TABLE guides (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  audience text NOT NULL DEFAULT 'family' CHECK (audience IN ('family', 'trip')),
  pinned boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  content jsonb NOT NULL,
  contributor jsonb NOT NULL,
  updated_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (trip_id, family_id) REFERENCES families(trip_id, id) ON DELETE CASCADE
);
CREATE INDEX guides_trip_idx ON guides(trip_id, pinned, updated_at);
CREATE TABLE guide_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_fields text[] NOT NULL,
  UNIQUE (guide_id, version)
);
