CREATE TABLE trip_transport_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES members(id),
  leg text NOT NULL CHECK (leg IN ('outbound','return')),
  mode text NOT NULL CHECK (mode IN ('train','metro','flight','bus','taxi','car','walk','ferry','arrival','other')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  origin text NOT NULL DEFAULT '' CHECK (length(origin) <= 200),
  destination text NOT NULL DEFAULT '' CHECK (length(destination) <= 200),
  starts_at jsonb NOT NULL,
  ends_at jsonb,
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 120),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 800),
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_transport_steps_order_idx ON trip_transport_steps(trip_id, leg, position, id);
CREATE TABLE trip_travel_preferences (
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  boarding_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (trip_id,member_id),
  FOREIGN KEY (trip_id,member_id) REFERENCES trip_members(trip_id,member_id) ON DELETE CASCADE
);
ALTER TABLE reminders ADD COLUMN transport_step_id uuid REFERENCES trip_transport_steps(id) ON DELETE CASCADE;
ALTER TABLE reminders ADD COLUMN transport_offset_minutes integer;
ALTER TABLE reminders ADD COLUMN transport_step_version integer;
ALTER TABLE reminders ADD CONSTRAINT reminders_transport_check CHECK (
  (transport_step_id IS NULL AND transport_offset_minutes IS NULL AND transport_step_version IS NULL) OR
  (transport_step_id IS NOT NULL AND transport_offset_minutes IS NOT NULL AND transport_step_version IS NOT NULL AND transport_offset_minutes IN (60,30,15,10,5,0) AND transport_step_version > 0)
);
CREATE UNIQUE INDEX reminders_transport_unique_idx ON reminders(transport_step_id,owner_member_id,transport_offset_minutes) WHERE transport_step_id IS NOT NULL;
CREATE TABLE trip_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES members(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1200),
  source_url text NOT NULL DEFAULT '' CHECK (length(source_url) <= 800),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_tips_trip_idx ON trip_tips(trip_id, created_at DESC);
CREATE TABLE family_readiness (
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  leg text NOT NULL CHECK (leg IN ('outbound','return')),
  ready boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id,leg)
);
