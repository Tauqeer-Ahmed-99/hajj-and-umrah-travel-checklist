-- Physical bag identification is family-private and independent of its travel legs.
CREATE TABLE travel_file_records (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bag_photo', 'attachment')),
  bag_id uuid REFERENCES bags(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES itinerary_entries(id) ON DELETE CASCADE,
  audience text NOT NULL DEFAULT 'family' CHECK (audience IN ('family', 'trip')),
  version integer NOT NULL DEFAULT 0,
  file_id uuid,
  CHECK ((kind = 'bag_photo' AND bag_id IS NOT NULL AND entry_id IS NULL AND audience = 'family') OR
    (kind = 'attachment' AND bag_id IS NULL)),
  UNIQUE (bag_id),
  UNIQUE (id, file_id)
);
CREATE TABLE travel_file_versions (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES travel_file_records(id) ON DELETE CASCADE,
  version integer NOT NULL,
  audience text NOT NULL CHECK (audience IN ('family', 'trip')),
  object_key text NOT NULL,
  metadata jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES members(id),
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (record_id, version),
  UNIQUE (record_id, id)
);
ALTER TABLE travel_file_records ADD FOREIGN KEY (id, file_id) REFERENCES travel_file_versions(record_id, id);
CREATE TABLE travel_file_uploads (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES travel_file_records(id) ON DELETE CASCADE,
  details jsonb NOT NULL,
  audience text NOT NULL DEFAULT 'family' CHECK (audience IN ('family', 'trip')),
  file_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (record_id, file_id) REFERENCES travel_file_versions(record_id, id)
);
CREATE INDEX travel_file_trip_idx ON travel_file_records(trip_id, family_id);
