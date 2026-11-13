CREATE TABLE trip_itineraries (
  trip_id uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'planning' CHECK (phase IN ('planning', 'preparing_at_home', 'traveling_to_destination', 'during_stay', 'preparing_to_return', 'traveling_home', 'completed')),
  accommodation_address text NOT NULL DEFAULT '',
  transport_reference text NOT NULL DEFAULT '',
  meeting_point text NOT NULL DEFAULT '',
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE itinerary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('stop', 'hajj_milestone')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  position integer NOT NULL,
  starts_at jsonb,
  ends_at jsonb,
  accommodation_address text NOT NULL DEFAULT '',
  transport_reference text NOT NULL DEFAULT '',
  meeting_point text NOT NULL DEFAULT '',
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX itinerary_entries_trip_order ON itinerary_entries(trip_id, position, id);
