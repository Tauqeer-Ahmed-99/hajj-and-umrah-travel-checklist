CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  family_id uuid,
  recipient_member_id uuid REFERENCES members(id),
  recipient_email text,
  trip_role text NOT NULL CHECK (trip_role IN ('organizer', 'member', 'viewer')),
  family_role text CHECK (family_role IN ('coordinator', 'editor', 'viewer')),
  trip_approved_by uuid REFERENCES members(id),
  family_approved_by uuid REFERENCES members(id),
  created_by uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '168 hours'),
  revoked_at timestamptz,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES members(id),
  FOREIGN KEY (trip_id, family_id) REFERENCES families(trip_id, id) ON DELETE CASCADE,
  CHECK ((recipient_member_id IS NULL) <> (recipient_email IS NULL)),
  CHECK ((family_id IS NULL) = (family_role IS NULL)),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),
  CHECK (trip_role <> 'viewer' OR family_role IS NULL OR family_role = 'viewer')
);
CREATE INDEX invitations_recipient_idx ON invitations(recipient_member_id);
CREATE INDEX invitations_email_idx ON invitations(recipient_email);
CREATE INDEX invitations_trip_idx ON invitations(trip_id);

-- Membership identity, rather than an email snapshot, invalidates older offers
-- after removal. A new, explicitly approved offer can still admit the member.
CREATE TABLE access_removals (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id),
  scope text NOT NULL,
  removed_at timestamptz NOT NULL,
  PRIMARY KEY (trip_id, member_id, scope)
);
