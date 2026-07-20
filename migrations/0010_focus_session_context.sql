-- Preserve the plan and source context needed to resume or review a focus session.
-- Existing focus rows remain valid; the application normalizes null legacy values.
ALTER TABLE focus_blocks ADD COLUMN planned_chunk_count INTEGER;
ALTER TABLE focus_blocks ADD COLUMN task_kind TEXT;
ALTER TABLE focus_blocks ADD COLUMN source_status TEXT;

CREATE INDEX IF NOT EXISTS idx_focus_blocks_student_task_completed
  ON focus_blocks(student_id, task_id, completed_at DESC);
