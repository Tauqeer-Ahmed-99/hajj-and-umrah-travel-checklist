ALTER TABLE reminders DROP CONSTRAINT reminders_transport_check;
ALTER TABLE reminders ADD CONSTRAINT reminders_transport_check CHECK (
  (transport_step_id IS NULL AND transport_offset_minutes IS NULL AND transport_step_version IS NULL) OR
  (transport_step_id IS NOT NULL AND transport_offset_minutes IS NOT NULL AND transport_step_version IS NOT NULL AND transport_offset_minutes IN (1440,600,300,120,60,30,15,10,5,0) AND transport_step_version > 0)
);
