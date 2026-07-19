import type { LearningCoachMode } from "../../lib/domain/learning-tracks";

export type LearningPhase =
  | "check_in"
  | "diagnostic"
  | "guided_practice"
  | "transfer"
  | "recap";

const roadmapSteps = [
  { label: "Plan", detail: "Set one goal" },
  { label: "See it", detail: "Find the pattern" },
  { label: "Try it", detail: "Practice a step" },
  { label: "Explain it", detail: "Use your own words" },
  { label: "Wrap up", detail: "Name what helped" }
] as const;

const phaseStep: Record<LearningPhase, number> = {
  check_in: 0,
  diagnostic: 1,
  guided_practice: 2,
  transfer: 3,
  recap: 4
};

function displayTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function LearningSessionRoadmap({
  phase,
  completed
}: {
  phase: LearningPhase;
  completed: boolean;
}) {
  const currentStep = completed ? roadmapSteps.length : phaseStep[phase];

  return (
    <nav className="learning-roadmap" aria-label="Session roadmap">
      <div className="learning-tool-heading">
        <span className="learning-tool-icon" aria-hidden="true">↗</span>
        <div>
          <strong>Session roadmap</strong>
          <small>{completed ? "Roadmap complete" : `Current step: ${roadmapSteps[currentStep].label}`}</small>
        </div>
      </div>
      <ol>
        {roadmapSteps.map((step, index) => {
          const state = completed || index < currentStep
            ? "complete"
            : index === currentStep ? "current" : "upcoming";
          return (
            <li className={state} key={step.label} aria-current={state === "current" ? "step" : undefined}>
              <span className="learning-roadmap-marker" aria-hidden="true">
                {state === "complete" ? "✓" : index + 1}
              </span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function LearningTimebox({
  durationMinutes,
  remainingSeconds,
  active
}: {
  durationMinutes: number;
  remainingSeconds: number;
  active: boolean;
}) {
  const totalSeconds = Math.max(60, durationMinutes * 60);
  const boundedRemaining = active
    ? Math.max(0, Math.min(totalSeconds, remainingSeconds))
    : totalSeconds;
  const ratio = boundedRemaining / totalSeconds;
  const paceLabel = !active
    ? "You choose the pace"
    : ratio > 0.67
      ? "Plenty of time"
      : ratio > 0.5
        ? "Steady pace"
        : ratio >= 0.4
          ? "Halfway there"
          : ratio >= 0.15 ? "Final stretch" : "Wrap up your thought";

  return (
    <section className="learning-timebox-card" aria-labelledby="learning-timebox-title">
      <div className="learning-timebox-ring-wrap">
        <svg
          className="learning-timebox-ring"
          viewBox="0 0 100 100"
          role="progressbar"
          aria-label={`${displayTimer(boundedRemaining)} remaining in a ${durationMinutes}-minute focus block`}
          aria-valuemin={0}
          aria-valuemax={totalSeconds}
          aria-valuenow={boundedRemaining}
        >
          <circle className="learning-timebox-track" cx="50" cy="50" r="42" />
          <circle
            className="learning-timebox-progress"
            cx="50"
            cy="50"
            r="42"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - ratio * 100}
          />
        </svg>
        <span aria-hidden="true">{active ? displayTimer(boundedRemaining) : durationMinutes}</span>
        {!active && <small aria-hidden="true">MIN</small>}
      </div>
      <div>
        <p className="learning-micro-label" id="learning-timebox-title">Manage your time</p>
        <strong>{paceLabel}</strong>
        <small>{active ? "The ring shows how much focus time is left." : "A timebox gives this task a clear beginning and end."}</small>
      </div>
    </section>
  );
}

export function LearningPriorityCard({
  courseName,
  missionTitle,
  objective,
  nextAction
}: {
  courseName: string;
  missionTitle: string;
  objective: string;
  nextAction?: string;
}) {
  return (
    <section className="learning-priority-card" aria-labelledby="learning-priority-title">
      <div className="learning-priority-rank" aria-hidden="true">1</div>
      <div>
        <p className="learning-micro-label">One priority · one target</p>
        <h4 id="learning-priority-title">{missionTitle}</h4>
        <span>{courseName}</span>
      </div>
      <div className="learning-success-target">
        <small>Done for today means</small>
        <strong>{nextAction ?? objective}</strong>
      </div>
    </section>
  );
}

export function TaskChunkOrganizer({
  phase,
  completed,
  nextAction
}: {
  phase: LearningPhase;
  completed: boolean;
  nextAction?: string;
}) {
  const activeChunk = completed
    ? 3
    : phase === "check_in" || phase === "diagnostic"
      ? 0
      : phase === "guided_practice" ? 1 : 2;
  const chunks = [
    { title: "Understand", detail: "Spot what the question is asking." },
    { title: "Practice", detail: "Work one manageable step." },
    { title: "Show what you know", detail: nextAction ?? "Explain the idea in your own words." }
  ];

  return (
    <section className="learning-chunk-organizer" aria-labelledby="learning-chunks-title">
      <div className="learning-tool-heading">
        <span className="learning-tool-icon coral" aria-hidden="true">▦</span>
        <div>
          <strong id="learning-chunks-title">Break it into 3 chunks</strong>
          <small>Organize first. Then take one piece at a time.</small>
        </div>
      </div>
      <ol>
        {chunks.map((chunk, index) => {
          const state = completed || index < activeChunk
            ? "complete"
            : index === activeChunk ? "current" : "upcoming";
          return (
            <li key={chunk.title} className={state} aria-current={state === "current" ? "step" : undefined}>
              <span aria-hidden="true">{state === "complete" ? "✓" : index + 1}</span>
              <div>
                <strong>{chunk.title}</strong>
                <small>{chunk.detail}</small>
                {state === "current" && <em>Current chunk</em>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const scaffoldCopy: Record<LearningCoachMode, {
  title: string;
  alt: string;
  prompt: string;
}> = {
  claim_evidence_dialogue: {
    title: "Connect claim to evidence",
    alt: "A claim card connected by an arrow to an evidence card",
    prompt: "Point to the detail that makes the strongest bridge to your claim."
  },
  guided_problem_solving: {
    title: "Balance both sides",
    alt: "A balance scale showing the same action on both sides",
    prompt: "Do the same thing to each side, then check that the scale still balances."
  },
  scientific_reasoning: {
    title: "Change one thing",
    alt: "A three-part investigation showing what changes, what stays the same, and what is measured",
    prompt: "Separate the changed variable from what you observe and measure."
  },
  map_evidence_dialogue: {
    title: "Read the pattern",
    alt: "A simple map grid with two places and a highlighted spatial pattern",
    prompt: "Use location, distance, or direction as visible evidence."
  },
  rhythm_rehearsal: {
    title: "Keep a steady pulse",
    alt: "Four evenly spaced beats grouped into one measure",
    prompt: "Track one beat at a time: 1, 2, 3, 4."
  },
  observation_reflection: {
    title: "Notice before judging",
    alt: "A composition frame showing shape, open space, and a high-contrast focal point",
    prompt: "Name what you can see: shape, spacing, and contrast."
  },
  conversation_retrieval: {
    title: "Build the exchange",
    alt: "Two conversation bubbles that alternate a greeting and an introduction",
    prompt: "Use the visual cue to recall one phrase at a time."
  }
};

function ScaffoldDiagram({ coachMode }: { coachMode: LearningCoachMode }) {
  if (coachMode === "guided_problem_solving") {
    return (
      <div className="scaffold-balance" aria-hidden="true">
        <span>x + 3</span><i /><span>7</span>
        <small>− 3</small><small>− 3</small>
      </div>
    );
  }
  if (coachMode === "claim_evidence_dialogue") {
    return <div className="scaffold-bridge" aria-hidden="true"><span>CLAIM</span><i>→</i><span>EVIDENCE</span></div>;
  }
  if (coachMode === "scientific_reasoning") {
    return <div className="scaffold-science" aria-hidden="true"><span>CHANGE</span><i>→</i><span>OBSERVE</span><i>→</i><span>MEASURE</span></div>;
  }
  if (coachMode === "map_evidence_dialogue") {
    return <div className="scaffold-map" aria-hidden="true"><span>A</span><i>↗</i><span>B</span><small>direction + distance</small></div>;
  }
  if (coachMode === "rhythm_rehearsal") {
    return <div className="scaffold-rhythm" aria-hidden="true">{[1, 2, 3, 4].map((beat) => <span key={beat}><i>♪</i><small>{beat}</small></span>)}</div>;
  }
  if (coachMode === "observation_reflection") {
    return <div className="scaffold-art" aria-hidden="true"><span /><span /><i /><small>shape · space · contrast</small></div>;
  }
  return <div className="scaffold-language" aria-hidden="true"><span>¡Hola!</span><span>Me llamo Emily.</span></div>;
}

export function SubjectVisualScaffold({
  coachMode,
  courseName,
  phase,
  visualScaffold
}: {
  coachMode: LearningCoachMode;
  courseName: string;
  phase: LearningPhase;
  visualScaffold?: {
    kind: "sequence" | "comparison" | "organizer" | "timeline" | "grid";
    title: string;
    items: Array<{ label: string; detail: string }>;
  };
}) {
  const fallback = scaffoldCopy[coachMode];
  const title = visualScaffold?.title || fallback.title;
  const accessibleDescription = visualScaffold
    ? `${visualScaffold.title}: ${visualScaffold.items.map((item) => `${item.label}, ${item.detail}`).join("; ")}`
    : fallback.alt;

  return (
    <figure className={`learning-visual-scaffold ${coachMode}`}>
      <figcaption>
        <p className="learning-micro-label">Visual thinking board · {courseName}</p>
        <h4>{title}</h4>
      </figcaption>
      <div
        className={`learning-scaffold-canvas ${visualScaffold ? `structured ${visualScaffold.kind}` : ""}`}
        role="img"
        aria-label={accessibleDescription}
      >
        {visualScaffold ? (
          <ol>
            {visualScaffold.items.slice(0, 5).map((item, index) => (
              <li key={`${item.label}-${index}`}>
                <span aria-hidden="true">{index + 1}</span>
                <div><strong>{item.label}</strong><small>{item.detail}</small></div>
              </li>
            ))}
          </ol>
        ) : <ScaffoldDiagram coachMode={coachMode} />}
      </div>
      <p>{visualScaffold ? "Use each visible part to plan your next response." : fallback.prompt}</p>
      <small>Use the model to support your thinking—not to skip the thinking.</small>
      <span className="visually-hidden">Learning phase: {phase.replace("_", " ")}</span>
    </figure>
  );
}
