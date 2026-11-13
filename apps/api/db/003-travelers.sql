CREATE TABLE travelers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  family_id uuid NOT NULL,
  first_name text NOT NULL CHECK (length(btrim(first_name)) BETWEEN 1 AND 80),
  last_name text NOT NULL CHECK (length(btrim(last_name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, family_id) REFERENCES families(trip_id, id) ON DELETE CASCADE,
  UNIQUE (trip_id, id)
);
CREATE INDEX travelers_family_idx ON travelers(family_id);
