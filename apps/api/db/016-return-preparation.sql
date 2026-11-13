-- Independent return requirements and verified possession. No outbound claim is copied.
CREATE TABLE return_items (
  family_id uuid NOT NULL,
  entry_id uuid PRIMARY KEY,
  origin text NOT NULL CHECK (origin IN ('outbound','destination')),
  proposed_quantity numeric(10,3) NOT NULL CHECK (proposed_quantity BETWEEN 0 AND 1000000),
  source_quantity numeric(10,3) NOT NULL CHECK (source_quantity BETWEEN 0 AND 1000000),
  required_quantity numeric(10,3) NOT NULL CHECK (required_quantity BETWEEN 0 AND 1000000),
  possession_quantity numeric(10,3) NOT NULL DEFAULT 0 CHECK (possession_quantity BETWEEN 0 AND 1000000),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES members(id),
  possession_confirmed_at timestamptz,
  possession_confirmed_by uuid REFERENCES members(id),
  consumed numeric(10,3) NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  gifted numeric(10,3) NOT NULL DEFAULT 0 CHECK (gifted >= 0),
  left_quantity numeric(10,3) NOT NULL DEFAULT 0 CHECK (left_quantity >= 0),
  lost numeric(10,3) NOT NULL DEFAULT 0 CHECK (lost >= 0),
  consumed_reason text NOT NULL DEFAULT '', gifted_reason text NOT NULL DEFAULT '',
  left_reason text NOT NULL DEFAULT '', lost_reason text NOT NULL DEFAULT '',
  CHECK (origin = 'destination' OR possession_quantity + consumed + gifted + left_quantity + lost <= source_quantity),
  CHECK ((consumed = 0 OR length(btrim(consumed_reason)) BETWEEN 1 AND 800)
    AND (gifted = 0 OR length(btrim(gifted_reason)) BETWEEN 1 AND 800)
    AND (left_quantity = 0 OR length(btrim(left_reason)) BETWEEN 1 AND 800)
    AND (lost = 0 OR length(btrim(lost_reason)) BETWEEN 1 AND 800)),
  FOREIGN KEY (family_id,entry_id) REFERENCES checklist_entries(family_id,id) ON DELETE CASCADE
);
CREATE TABLE return_checkout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  area text NOT NULL CHECK (area IN ('rooms','cupboards','safes','charging_points')),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  checked boolean NOT NULL DEFAULT false,
  checked_at timestamptz, checked_by uuid REFERENCES members(id),
  UNIQUE (family_id,area)
);
