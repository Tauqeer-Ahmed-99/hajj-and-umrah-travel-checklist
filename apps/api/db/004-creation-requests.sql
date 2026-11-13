-- Receipts commit atomically with each trip, family, or traveler creation.
-- Concurrent retries wait on the same member/request key, never create twice.
CREATE TABLE creation_requests (
  member_id uuid NOT NULL REFERENCES members(id),
  request_id uuid NOT NULL,
  scope text NOT NULL,
  input jsonb NOT NULL,
  resource_id uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY (member_id, request_id)
);
