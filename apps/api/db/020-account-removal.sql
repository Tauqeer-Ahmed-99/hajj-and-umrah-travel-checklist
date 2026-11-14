-- A retained, non-authenticating member is necessary for immutable attribution,
-- notably SQL017's NOT NULL travel_file_versions.actor_id. Never hard-delete it.
ALTER TABLE members ADD COLUMN removal_started_at timestamptz;
CREATE TABLE account_removals (
  member_id uuid PRIMARY KEY REFERENCES members(id),
  request_id uuid NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'provider_pending' CHECK (state IN ('provider_pending','completed')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);
