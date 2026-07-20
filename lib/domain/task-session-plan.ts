import type { ExecutiveSkill } from "./student-support-profile";

export type TaskSessionKind =
  | "reading"
  | "writing"
  | "math_problem_set"
  | "study_review"
  | "vocabulary"
  | "project_research"
  | "creative"
  | "checklist_preparation"
  | "performance_practice"
  | "generic";

export interface TaskSessionStep {
  id: string;
  order: number;
  label: string;
  action: string;
  minutes: number;
  skill: ExecutiveSkill;
  visualState: "ready" | "next" | "check";
}

interface StepTemplate extends Omit<TaskSessionStep, "id" | "order" | "minutes"> {
  key: string;
  weight: number;
}

const templates: Record<TaskSessionKind, StepTemplate[]> = {
  reading: [
    { key: "preview", label: "Preview the reading", action: "Look at the title, headings, and directions so you know what to notice.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "read", label: "Read one section", action: "Read one visible section and mark the idea that matters most.", weight: 6, skill: "time_management", visualState: "next" },
    { key: "capture", label: "Capture the key idea", action: "Write one sentence or note that will help you return to the reading.", weight: 2, skill: "prioritization", visualState: "check" }
  ],
  writing: [
    { key: "decode", label: "Name what the prompt asks", action: "Underline the action word and say what the finished response needs to include.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "gather", label: "Choose your evidence", action: "Pick the strongest detail, example, or fact you will use.", weight: 2, skill: "prioritization", visualState: "next" },
    { key: "draft", label: "Draft one clear section", action: "Write the next paragraph or response section without stopping to perfect every word.", weight: 5, skill: "time_management", visualState: "next" },
    { key: "revise", label: "Read and improve", action: "Check that your response answers the prompt, then make one useful revision.", weight: 2, skill: "prioritization", visualState: "check" }
  ],
  math_problem_set: [
    { key: "scan", label: "Scan the problems", action: "Find the directions, count the problems, and circle the first one you can start.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "model", label: "Set up the first problem", action: "Write the known information and choose the operation, rule, or equation you need.", weight: 3, skill: "prioritization", visualState: "next" },
    { key: "solve", label: "Work a small set", action: "Solve a manageable group of problems and show enough work to check your thinking.", weight: 6, skill: "time_management", visualState: "next" },
    { key: "verify", label: "Check one answer", action: "Re-read one problem and verify the answer using a second check or substitution.", weight: 2, skill: "prioritization", visualState: "check" }
  ],
  study_review: [
    { key: "target", label: "Choose the review target", action: "Pick one topic or question type to review in this session.", weight: 2, skill: "prioritization", visualState: "ready" },
    { key: "retrieve", label: "Practice from memory", action: "Answer a short set without notes first, then check what you remembered.", weight: 6, skill: "time_management", visualState: "next" },
    { key: "next", label: "Mark what needs another look", action: "Name one thing you know now and one thing to review next time.", weight: 2, skill: "organization", visualState: "check" }
  ],
  vocabulary: [
    { key: "preview_words", label: "Preview the words", action: "Scan the full word set and mark the words you already recognize.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "match_known", label: "Match the familiar words", action: "Complete the matches you know first to build momentum.", weight: 4, skill: "prioritization", visualState: "next" },
    { key: "solve_unknown", label: "Work through the unsure words", action: "Use the picture, context, or word parts to decide the remaining matches.", weight: 4, skill: "time_management", visualState: "next" },
    { key: "check_matches", label: "Check every match", action: "Review the full set and change only the matches that have clear evidence.", weight: 2, skill: "prioritization", visualState: "check" }
  ],
  project_research: [
    { key: "deliverable", label: "Name the deliverable", action: "Write down what you must make and the requirements it must include.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "choose_piece", label: "Choose one project piece", action: "Pick the smallest useful section you can complete in this session.", weight: 2, skill: "prioritization", visualState: "next" },
    { key: "build_piece", label: "Build that piece", action: "Research, draft, or assemble only the section you chose.", weight: 6, skill: "time_management", visualState: "next" },
    { key: "record_next", label: "Record the next move", action: "Save your source or draft and write the exact next action for your return.", weight: 2, skill: "organization", visualState: "check" }
  ],
  creative: [
    { key: "requirements", label: "Check the requirements", action: "Identify the required materials, format, and details before you create.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "idea", label: "Choose one idea", action: "Sketch or name one direction so you do not have to hold every possibility at once.", weight: 2, skill: "prioritization", visualState: "next" },
    { key: "make", label: "Create one section", action: "Work on one visible part of the piece until the focus time ends.", weight: 6, skill: "time_management", visualState: "next" },
    { key: "look", label: "Step back and look", action: "Compare your work with the requirements and choose one next improvement.", weight: 2, skill: "prioritization", visualState: "check" }
  ],
  checklist_preparation: [
    { key: "review_list", label: "Check the list", action: "Read the full checklist once and mark what is already ready.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "find_missing", label: "Find what is missing", action: "Gather the missing items into one visible place.", weight: 4, skill: "prioritization", visualState: "next" },
    { key: "get_ready", label: "Get items ready", action: "Pack, charge, label, or prepare each item that needs action.", weight: 4, skill: "time_management", visualState: "next" },
    { key: "final_check", label: "Do a final check", action: "Compare everything with the source list and name any item that still needs help.", weight: 2, skill: "prioritization", visualState: "check" }
  ],
  performance_practice: [
    { key: "target", label: "Choose the practice target", action: "Pick one passage, measure range, or technique for this session.", weight: 2, skill: "prioritization", visualState: "ready" },
    { key: "slow", label: "Practice it slowly", action: "Work below performance speed and correct one issue at a time.", weight: 4, skill: "time_management", visualState: "next" },
    { key: "repeat", label: "Repeat with a clear goal", action: "Try the same section again while listening or watching for the chosen goal.", weight: 4, skill: "time_management", visualState: "next" },
    { key: "reflect", label: "Name what changed", action: "Record what improved and the exact spot to begin next time.", weight: 2, skill: "organization", visualState: "check" }
  ],
  generic: [
    { key: "understand", label: "Understand the task", action: "Read the directions and say what the finished work needs to show.", weight: 2, skill: "organization", visualState: "ready" },
    { key: "work", label: "Complete one useful part", action: "Work on one visible section until the focus time ends.", weight: 6, skill: "time_management", visualState: "next" },
    { key: "decide", label: "Check and choose", action: "Check your progress and choose whether to continue, submit in the school tool, or return later.", weight: 2, skill: "prioritization", visualState: "check" }
  ]
};

function taskText(input: { title: string; directions?: string | null; workType?: string | null }): string {
  return `${input.title} ${input.directions ?? ""} ${input.workType ?? ""}`.toLowerCase();
}

export function classifyTaskSessionKind(input: {
  title: string;
  directions?: string | null;
  workType?: string | null;
}): TaskSessionKind {
  const text = taskText(input);
  if (/vocab|vocabulary|word match|picture match|flashcard|definition/.test(text)) return "vocabulary";
  if (/pack|checklist|bring |suppl|materials ready|prepare your|uniform|equipment/.test(text)) return "checklist_preparation";
  if (/\b(equations?|problems?|calculate|solve|graph|fraction|algebra|geometry|math)\b/.test(text)) return "math_problem_set";
  if (/rehears|practice measure|concert excerpt|instrument|play through|performance/.test(text)) return "performance_practice";
  if (/project|research|presentation|poster|slide|report/.test(text)) return "project_research";
  if (/draw|paint|design|create art|sculpt|visual art/.test(text)) return "creative";
  if (/write|paragraph|essay|response|reflection|claim|evidence|draft/.test(text)) return "writing";
  if (/read|chapter|passage|pages?\s+\d|article|novel/.test(text)) return "reading";
  if (/quiz|test|review|study|readiness check|exam/.test(text)) return "study_review";
  return "generic";
}

function allocateMinutes(selectedMinutes: number, steps: StepTemplate[]): number[] {
  const total = Math.max(steps.length, Math.min(60, Math.round(selectedMinutes)));
  const minutes = Array.from({ length: steps.length }, () => 1);
  let remaining = total - steps.length;
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
  const raw = steps.map((step) => remaining * step.weight / totalWeight);
  raw.forEach((value, index) => {
    const whole = Math.floor(value);
    minutes[index] += whole;
    remaining -= whole;
  });
  const remainderOrder = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) {
    minutes[remainderOrder[index % remainderOrder.length]!.index] += 1;
  }
  return minutes;
}

export function buildTaskSessionPlan(input: {
  externalId: string;
  title: string;
  directions?: string | null;
  workType?: string | null;
  taskKind?: TaskSessionKind;
  selectedMinutes: number;
  maxSteps?: number;
}) {
  const classifiedKind = classifyTaskSessionKind(input);
  const kind = input.taskKind && input.taskKind !== "generic"
    ? input.taskKind
    : classifiedKind;
  const maxSteps = Math.max(2, Math.min(5, Math.round(input.maxSteps ?? 4)));
  const selectedTemplates = templates[kind].slice(0, maxSteps);
  const allocated = allocateMinutes(input.selectedMinutes, selectedTemplates);
  const steps: TaskSessionStep[] = selectedTemplates.map((step, index) => ({
    id: `${input.externalId}:${kind}:${step.key}`,
    order: index + 1,
    label: step.label,
    action: step.action,
    minutes: allocated[index]!,
    skill: step.skill,
    visualState: step.visualState
  }));
  return { kind, selectedMinutes: steps.reduce((sum, step) => sum + step.minutes, 0), steps };
}
