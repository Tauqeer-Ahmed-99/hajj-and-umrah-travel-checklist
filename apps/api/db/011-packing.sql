-- Physical bags are reused across legs. No return possession is inferred here.
ALTER TABLE travelers ADD UNIQUE (family_id, id);
ALTER TABLE checklist_entries ADD UNIQUE (family_id, id);
CREATE TABLE bags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  type text NOT NULL CHECK (length(btrim(type)) BETWEEN 1 AND 120),
  carrier_traveler_id uuid NOT NULL,
  identifying_note text NOT NULL DEFAULT '' CHECK (length(identifying_note) <= 800),
  weight_note text NOT NULL DEFAULT '' CHECK (length(weight_note) <= 800),
  allowance_note text NOT NULL DEFAULT '' CHECK (length(allowance_note) <= 800),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, id),
  FOREIGN KEY (family_id, carrier_traveler_id) REFERENCES travelers(family_id, id)
);
CREATE TABLE bag_legs (
  family_id uuid NOT NULL,
  bag_id uuid NOT NULL,
  leg text NOT NULL CHECK (leg IN ('outbound', 'return')),
  status text NOT NULL DEFAULT 'packing' CHECK (status IN ('packing','ready','in_transit','collected')),
  needs_review boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES members(id),
  PRIMARY KEY (bag_id, leg),
  FOREIGN KEY (family_id, bag_id) REFERENCES bags(family_id, id) ON DELETE CASCADE
);
CREATE TABLE packing_history (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  leg text NOT NULL CHECK (leg IN ('outbound','return')),
  entry_id uuid REFERENCES checklist_entries(id),
  bag_ids uuid[] NOT NULL DEFAULT '{}',
  action text NOT NULL,
  actor jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changes jsonb NOT NULL,
  command jsonb,
  undoes uuid UNIQUE REFERENCES packing_history(id)
);
CREATE INDEX packing_history_family_idx ON packing_history(family_id, sequence DESC);
CREATE TABLE packing_items (
  family_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  leg text NOT NULL CHECK (leg IN ('outbound','return')),
  repacking_quantity numeric(10,3) NOT NULL DEFAULT 0 CHECK (repacking_quantity >= 0 AND repacking_quantity <= 1000000),
  PRIMARY KEY (entry_id, leg),
  FOREIGN KEY (family_id, entry_id) REFERENCES checklist_entries(family_id, id) ON DELETE CASCADE
);
CREATE TABLE packing_allocations (
  family_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  leg text NOT NULL CHECK (leg IN ('outbound','return')),
  bag_id uuid,
  traveler_id uuid,
  quantity numeric(10,3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  CHECK ((bag_id IS NULL) <> (traveler_id IS NULL)),
  UNIQUE NULLS NOT DISTINCT (entry_id, leg, bag_id, traveler_id),
  FOREIGN KEY (family_id, entry_id) REFERENCES checklist_entries(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, bag_id) REFERENCES bags(family_id, id),
  FOREIGN KEY (family_id, traveler_id) REFERENCES travelers(family_id, id)
);
CREATE INDEX packing_allocations_family_idx ON packing_allocations(family_id, leg);
CREATE TABLE departure_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  leg text NOT NULL CHECK (leg IN ('outbound','return')),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  entry_id uuid,
  bag_id uuid,
  traveler_id uuid,
  checked boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  checked_by uuid REFERENCES members(id),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bag_id IS NULL OR traveler_id IS NULL),
  CHECK (NOT checked OR coalesce(bag_id,traveler_id) IS NOT NULL),
  FOREIGN KEY (family_id, entry_id) REFERENCES checklist_entries(family_id,id),
  FOREIGN KEY (family_id, bag_id) REFERENCES bags(family_id,id),
  FOREIGN KEY (family_id, traveler_id) REFERENCES travelers(family_id,id)
);
CREATE INDEX departure_checks_family_idx ON departure_checks(family_id,leg);
