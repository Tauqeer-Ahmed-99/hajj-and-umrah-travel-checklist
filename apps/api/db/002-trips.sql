CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('hajj', 'umrah')),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  destinations text[] NOT NULL CHECK (cardinality(destinations) BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trip_members (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id),
  role text NOT NULL CHECK (role IN ('organizer', 'member', 'viewer')),
  PRIMARY KEY (trip_id, member_id)
);
CREATE INDEX trip_members_member_idx ON trip_members(member_id);

CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, id)
);

CREATE TABLE family_members (
  trip_id uuid NOT NULL,
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('coordinator', 'editor', 'viewer')),
  PRIMARY KEY (family_id, member_id),
  FOREIGN KEY (trip_id, family_id) REFERENCES families(trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, member_id) REFERENCES trip_members(trip_id, member_id) ON DELETE CASCADE
);
CREATE INDEX family_members_member_idx ON family_members(member_id, trip_id);
