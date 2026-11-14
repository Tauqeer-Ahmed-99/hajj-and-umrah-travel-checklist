CREATE TABLE trip_completion (
  trip_id uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  completed_at timestamptz,
  completed_by uuid REFERENCES members(id),
  archived_at timestamptz,
  archived_by uuid REFERENCES members(id)
);
CREATE TABLE trip_completion_history (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('completed','phase_corrected','lesson_added','archived')),
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lesson text CHECK (length(btrim(lesson)) BETWEEN 1 AND 3000)
);
CREATE INDEX trip_completion_history_trip ON trip_completion_history(trip_id,sequence);
