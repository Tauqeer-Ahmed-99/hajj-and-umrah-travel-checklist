CREATE TABLE checklist_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, id)
);

CREATE TABLE checklist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('item', 'task')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  required_quantity numeric(10,3) CHECK (required_quantity > 0 AND required_quantity <= 1000000),
  unit text NOT NULL CHECK (length(unit) <= 40),
  beneficiaries jsonb NOT NULL,
  responsible_member_id uuid NOT NULL REFERENCES members(id),
  priority text NOT NULL CHECK (priority IN ('essential', 'high', 'normal', 'low')),
  due_date date,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 800),
  leg text NOT NULL CHECK (leg IN ('outbound', 'return', 'both')),
  source text NOT NULL DEFAULT '' CHECK (length(source) <= 800),
  last_reviewed_on date,
  task_status text CHECK (task_status IN ('to_do', 'in_progress', 'done', 'not_needed')),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, category_id) REFERENCES checklist_categories(family_id, id),
  CHECK ((kind = 'item' AND required_quantity IS NOT NULL AND length(btrim(unit)) > 0 AND task_status IS NULL)
    OR (kind = 'task' AND required_quantity IS NULL AND unit = '' AND task_status IS NOT NULL))
);
CREATE INDEX checklist_entries_family_idx ON checklist_entries(family_id);

CREATE TABLE checklist_history (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('category', 'entry')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'removed')),
  actor jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changes jsonb NOT NULL
);
CREATE INDEX checklist_history_family_idx ON checklist_history(family_id, sequence DESC);

CREATE TABLE checklist_copies (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category_ids uuid[] NOT NULL,
  entry_ids uuid[] NOT NULL
);
