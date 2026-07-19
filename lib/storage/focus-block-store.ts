import type { D1DatabaseLike } from "./session-store";

export interface FocusBlockRecord {
  id: string;
  studentId: string;
  sessionId: string;
  taskId: string;
  taskTitle: string;
  courseName: string;
  sourceProvider: string;
  sourceExternalId: string;
  estimatedMinutes: number;
  selectedMinutes: number;
  elapsedSeconds: number;
  completedChunkIds: string[];
  completedChunkCount: number;
  completedAt: string;
}

export interface FocusBlockStore {
  save(record: FocusBlockRecord): Promise<FocusBlockRecord>;
  listRecent(studentId: string): Promise<FocusBlockRecord[]>;
}

interface AggregateRow { records_json: string; }

export class D1FocusBlockStore implements FocusBlockStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async save(record: FocusBlockRecord): Promise<FocusBlockRecord> {
    const result = await this.database.prepare(
      `INSERT INTO focus_blocks (
        id, student_id, session_id, task_id, task_title, course_name, source_provider,
        source_external_id, estimated_minutes, selected_minutes, elapsed_seconds,
        completed_chunk_ids_json, completed_chunk_count, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      record.id, record.studentId, record.sessionId, record.taskId, record.taskTitle,
      record.courseName, record.sourceProvider, record.sourceExternalId,
      record.estimatedMinutes, record.selectedMinutes, record.elapsedSeconds,
      JSON.stringify(record.completedChunkIds), record.completedChunkCount, record.completedAt
    ).run();
    if (!result.success) throw new Error("The focus block could not be saved.");
    return record;
  }

  async listRecent(studentId: string): Promise<FocusBlockRecord[]> {
    const row = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'id', id, 'studentId', student_id, 'sessionId', session_id, 'taskId', task_id,
        'taskTitle', task_title, 'courseName', course_name, 'sourceProvider', source_provider,
        'sourceExternalId', source_external_id, 'estimatedMinutes', estimated_minutes,
        'selectedMinutes', selected_minutes, 'elapsedSeconds', elapsed_seconds,
        'completedChunkIds', json(completed_chunk_ids_json),
        'completedChunkCount', completed_chunk_count, 'completedAt', completed_at
      )), '[]') AS records_json FROM (
        SELECT * FROM focus_blocks WHERE student_id = ? ORDER BY completed_at DESC LIMIT 50
      )`
    ).bind(studentId).first<AggregateRow>();
    return JSON.parse(row?.records_json ?? "[]") as FocusBlockRecord[];
  }
}
