import { z } from "zod";

export type ToolStage =
  | "orientation"
  | "plan_gathering"
  | "plan_save"
  | "source_sync"
  | "plan_update"
  | "learning_hint"
  | "learning_complete"
  | "family_preview"
  | "guardian_view";

type JsonProperty = { type: "string" | "integer"; description?: string };

export interface FunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: {
    type: "object";
    properties: Record<string, JsonProperty>;
    required: string[];
    additionalProperties: false;
  };
}

const id = z.string().min(1).max(160);
const integer = z.number().int().nonnegative();

function defineTool(
  name: string,
  description: string,
  properties: Record<string, JsonProperty>,
  schema: z.ZodType
) {
  return {
    definition: {
      type: "function" as const,
      name,
      description,
      strict: true as const,
      parameters: {
        type: "object" as const,
        properties,
        required: Object.keys(properties),
        additionalProperties: false as const
      }
    },
    schema
  };
}

const stringProperties = (...names: string[]) =>
  Object.fromEntries(names.map((name) => [name, { type: "string" as const }])) as Record<string, JsonProperty>;

const schemas = {
  list_courses: defineTool(
    "list_courses",
    "List the fictional student's approved course records.",
    stringProperties("sessionId", "studentId"),
    z.object({ sessionId: id, studentId: id }).strict()
  ),
  list_upcoming_events: defineTool(
    "list_upcoming_events",
    "List approved upcoming activity events through a date.",
    stringProperties("sessionId", "studentId", "throughDate"),
    z.object({ sessionId: id, studentId: id, throughDate: id }).strict()
  ),
  list_guardian_actions: defineTool(
    "list_guardian_actions",
    "List approved actions assigned to the guardian.",
    stringProperties("sessionId", "studentId", "status"),
    z.object({ sessionId: id, studentId: id, status: id }).strict()
  ),
  list_readiness_activities: defineTool(
    "list_readiness_activities",
    "List optional approved readiness activities.",
    stringProperties("sessionId", "studentId"),
    z.object({ sessionId: id, studentId: id }).strict()
  ),
  get_event_details: defineTool(
    "get_event_details",
    "Read an approved event record.",
    stringProperties("sessionId", "eventId"),
    z.object({ sessionId: id, eventId: id }).strict()
  ),
  read_material: defineTool(
    "read_material",
    "Read an approved source material.",
    stringProperties("sessionId", "materialId"),
    z.object({ sessionId: id, materialId: id }).strict()
  ),
  get_guardian_action: defineTool(
    "get_guardian_action",
    "Read one approved guardian action.",
    stringProperties("sessionId", "actionId"),
    z.object({ sessionId: id, actionId: id }).strict()
  ),
  get_student_plan_preferences: defineTool(
    "get_student_plan_preferences",
    "Read approved travel, buffer, and quiet-hour preferences.",
    stringProperties("sessionId", "studentId"),
    z.object({ sessionId: id, studentId: id }).strict()
  ),
  save_personal_plan: defineTool(
    "save_personal_plan",
    "Save an exactly approved Homeroom plan proposal.",
    {
      ...stringProperties("sessionId", "proposalId", "approvalReceipt", "idempotencyKey"),
      expectedPlanVersion: { type: "integer" },
      expectedSourceVersion: { type: "integer" }
    },
    z.object({ sessionId: id, proposalId: id, approvalReceipt: id, idempotencyKey: id, expectedPlanVersion: integer, expectedSourceVersion: integer }).strict()
  ),
  sync_activity_calendar: defineTool(
    "sync_activity_calendar",
    "Append the controlled next source version without writing to BAND.",
    {
      ...stringProperties("sessionId", "idempotencyKey"),
      expectedSourceVersion: { type: "integer" },
      targetSourceVersion: { type: "integer" }
    },
    z.object({ sessionId: id, idempotencyKey: id, expectedSourceVersion: integer, targetSourceVersion: integer }).strict()
  ),
  get_source_change: defineTool(
    "get_source_change",
    "Read one application-validated source change.",
    stringProperties("sessionId", "changeId"),
    z.object({ sessionId: id, changeId: id }).strict()
  ),
  update_personal_plan: defineTool(
    "update_personal_plan",
    "Commit an exactly approved new Homeroom plan version.",
    {
      ...stringProperties("sessionId", "planId", "proposalId", "approvalReceipt", "idempotencyKey"),
      expectedPlanVersion: { type: "integer" },
      expectedSourceVersion: { type: "integer" }
    },
    z.object({ sessionId: id, planId: id, proposalId: id, approvalReceipt: id, idempotencyKey: id, expectedPlanVersion: integer, expectedSourceVersion: integer }).strict()
  ),
  get_practice_exercise: defineTool(
    "get_practice_exercise",
    "Read an approved exercise and its instructional boundaries.",
    stringProperties("sessionId", "exerciseId"),
    z.object({ sessionId: id, exerciseId: id }).strict()
  ),
  record_practice_result: defineTool(
    "record_practice_result",
    "Record a deterministically graded private practice result.",
    {
      ...stringProperties("sessionId", "exerciseId", "graderReceipt", "idempotencyKey"),
      hintsUsed: { type: "integer" },
      attempts: { type: "integer" }
    },
    z.object({ sessionId: id, exerciseId: id, graderReceipt: id, idempotencyKey: id, hintsUsed: integer, attempts: integer }).strict()
  ),
  get_guardian_projection: defineTool(
    "get_guardian_projection",
    "Read the server-allowlisted guardian projection.",
    { ...stringProperties("sessionId"), projectionVersion: { type: "integer" } },
    z.object({ sessionId: id, projectionVersion: integer }).strict()
  ),
  publish_guardian_summary: defineTool(
    "publish_guardian_summary",
    "Publish the exact projection Emily approved.",
    { ...stringProperties("sessionId", "approvalReceipt", "idempotencyKey"), projectionVersion: { type: "integer" } },
    z.object({ sessionId: id, approvalReceipt: id, idempotencyKey: id, projectionVersion: integer }).strict()
  ),
  get_published_guardian_summary: defineTool(
    "get_published_guardian_summary",
    "Read the published guardian-safe summary.",
    { ...stringProperties("guardianToken"), projectionVersion: { type: "integer" } },
    z.object({ guardianToken: id, projectionVersion: integer }).strict()
  )
} as const;

type ToolName = keyof typeof schemas;

const stageToolNames: Record<ToolStage, readonly ToolName[]> = {
  orientation: ["list_courses", "list_upcoming_events", "list_guardian_actions", "list_readiness_activities"],
  plan_gathering: ["get_event_details", "read_material", "get_guardian_action", "get_student_plan_preferences"],
  plan_save: ["save_personal_plan"],
  source_sync: ["sync_activity_calendar", "get_source_change"],
  plan_update: ["update_personal_plan"],
  learning_hint: ["get_practice_exercise"],
  learning_complete: ["record_practice_result"],
  family_preview: ["get_guardian_projection", "publish_guardian_summary"],
  guardian_view: ["get_published_guardian_summary"]
};

export function getStageTools(stage: ToolStage): FunctionToolDefinition[] {
  return stageToolNames[stage].map((name) => schemas[name].definition);
}

export function isReadOnlyStage(stage: ToolStage) {
  return ["orientation", "plan_gathering", "learning_hint", "guardian_view"].includes(stage);
}

export function validateToolArguments(stage: ToolStage, name: string, args: unknown): unknown {
  if (!stageToolNames[stage].includes(name as ToolName)) {
    throw new Error("Tool " + name + " is not allowed during " + stage + ".");
  }
  return schemas[name as ToolName].schema.parse(args);
}
