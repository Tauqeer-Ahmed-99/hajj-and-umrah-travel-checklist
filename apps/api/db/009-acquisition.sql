ALTER TABLE checklist_entries
  ADD COLUMN ordered numeric(10,3) NOT NULL DEFAULT 0 CHECK (ordered >= 0),
  ADD COLUMN delivered numeric(10,3) NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  ADD COLUMN bought numeric(10,3) NOT NULL DEFAULT 0 CHECK (bought >= 0),
  ADD COLUMN received numeric(10,3) NOT NULL DEFAULT 0 CHECK (received >= 0),
  ADD COLUMN already_available numeric(10,3) NOT NULL DEFAULT 0 CHECK (already_available >= 0),
  ADD COLUMN expected_delivery_date date,
  ADD COLUMN not_needed_reason text CHECK (length(btrim(not_needed_reason)) BETWEEN 1 AND 800),
  ADD CONSTRAINT acquisition_requirement CHECK (
    (kind = 'task' AND ordered + delivered + bought + received + already_available = 0
      AND expected_delivery_date IS NULL AND not_needed_reason IS NULL)
    OR (kind = 'item' AND ordered + delivered + bought + received + already_available
      <= CASE WHEN not_needed_reason IS NULL THEN required_quantity ELSE 0 END)
  );
