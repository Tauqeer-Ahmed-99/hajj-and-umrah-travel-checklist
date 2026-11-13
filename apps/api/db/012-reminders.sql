CREATE TABLE reminders (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  owner_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('assignment','expected_delivery','departure_preparation','return_packing')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  due_at jsonb NOT NULL,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES checklist_entries(id) ON DELETE CASCADE,
  dismissed boolean NOT NULL DEFAULT false,
  needs_review boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (entry_id IS NULL OR family_id IS NOT NULL)
);
CREATE INDEX reminders_owner_idx ON reminders(owner_member_id, trip_id);

CREATE TABLE notification_preferences (
  member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  assignments boolean NOT NULL DEFAULT false,
  deadlines boolean NOT NULL DEFAULT false,
  trip_changes boolean NOT NULL DEFAULT false
);
CREATE TABLE notification_devices (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  session_id text NOT NULL,
  token text NOT NULL UNIQUE,
  trip_ids uuid[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE notification_local_schedules (
  device_id uuid NOT NULL REFERENCES notification_devices(id) ON DELETE CASCADE,
  reminder_id uuid NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (device_id, reminder_id)
);
CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  recipient_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES checklist_entries(id) ON DELETE CASCADE,
  reminder_id uuid REFERENCES reminders(id) ON DELETE CASCADE,
  reminder_version integer,
  kind text NOT NULL CHECK (kind IN ('assignments', 'deadlines', 'tripChanges')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_key, recipient_id)
);
CREATE TABLE notification_deliveries (
  event_id uuid NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES notification_devices(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','submitted','provider_accepted','unknown','failed','suppressed')),
  ticket_id text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id, device_id)
);
CREATE INDEX notification_deliveries_pending_idx ON notification_deliveries(state, updated_at);
