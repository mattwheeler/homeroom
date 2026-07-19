"use client";

import { useMemo, useState } from "react";

import type {
  ProjectedCalendarItem,
  ProjectedPriority,
  StudentSourceProjection
} from "../../lib/domain/student-source-projection";
import styles from "./student-calendar.module.css";

export interface CalendarDay {
  date: string;
  dayNumber: number;
  inMonth: boolean;
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) throw new Error("Invalid calendar month.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("Invalid calendar month.");
  return { year, month };
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function shiftMonthKey(monthKey: string, change: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const shifted = new Date(Date.UTC(year, month - 1 + change, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildCalendarMonth(monthKey: string): CalendarDay[] {
  const { year, month } = parseMonthKey(monthKey);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return {
      date: dateKey(date),
      dayNumber: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1
    };
  });
}

function fallbackCalendarItems(projection: StudentSourceProjection): ProjectedCalendarItem[] {
  return projection.week.days.flatMap((day) => day.items.map((item) => ({
    id: `${item.id}:calendar-fallback`,
    kind: item.kind,
    title: item.title,
    date: day.date,
    timeLabel: item.timeLabel,
    startsAt: null,
    endsAt: null,
    courseExternalId: null,
    courseName: item.courseName,
    statusLabel: item.kind === "event" ? "Scheduled" : "Upcoming",
    visualToken: item.visualToken,
    category: item.kind === "coursework"
      ? "schoolwork"
      : item.source.provider === "school_calendar" ? "school" : "band",
    source: item.source
  })));
}

function sourceLabel(item: ProjectedCalendarItem): string {
  if (item.source.provider === "google_classroom") return "Google Classroom";
  if (item.source.provider === "school_calendar") return "Pieper / Comal ISD official calendar";
  return "BAND calendar";
}

function categoryClass(item: ProjectedCalendarItem): string {
  if (item.kind === "coursework" || item.category === "schoolwork") return styles.categorySchoolwork;
  if (item.category === "school") return styles.categorySchool;
  return styles.categoryEvent;
}

function fullDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

function monthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric"
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function StudentCalendar({
  projection,
  initialSelectedDate,
  onOpenTask
}: {
  projection: StudentSourceProjection;
  initialSelectedDate?: string;
  onOpenTask?: (priority: ProjectedPriority) => void;
}) {
  const firstDate = initialSelectedDate ?? projection.context.localDate;
  const [visibleMonth, setVisibleMonth] = useState(firstDate.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(firstDate);
  const calendarItems = projection.calendar?.items ?? fallbackCalendarItems(projection);
  const itemMap = useMemo(() => {
    const result = new Map<string, ProjectedCalendarItem[]>();
    for (const item of calendarItems) {
      const entries = result.get(item.date) ?? [];
      entries.push(item);
      result.set(item.date, entries);
    }
    return result;
  }, [calendarItems]);
  const days = useMemo(() => buildCalendarMonth(visibleMonth), [visibleMonth]);
  const selectedItems = itemMap.get(selectedDate) ?? [];
  const guardianAssist = projection.guardianAssistCandidates?.find((candidate) =>
    candidate.due?.date === selectedDate
  ) ?? projection.guardianAssistCandidates?.find((candidate) =>
    candidate.due?.date.startsWith(visibleMonth)
  );
  const guardianAssistPriority = guardianAssist
    ? projection.priorities.find((priority) => priority.id === guardianAssist.taskId)
    : undefined;

  function moveMonth(change: number) {
    const nextMonth = shiftMonthKey(visibleMonth, change);
    setVisibleMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  }

  return (
    <section className={styles.calendar} aria-labelledby="student-calendar-title">
      <header className={styles.intro}>
        <div>
          <p>CALENDAR · ONE DAY AT A TIME</p>
          <h2 id="student-calendar-title">See the month. Focus on one date.</h2>
          <span>Dots show how full a day is. Choose a date to see only that day’s details.</span>
        </div>
        <span className={styles.visualKey}><i /> Schoolwork <i /> Band <i /> School</span>
      </header>

      {guardianAssist && (
        <aside className={styles.assistNudge} aria-label="Guardian assist candidate">
          <span aria-hidden="true">◇</span>
          <div>
            <small>Guardian assist · source-backed</small>
            <strong>{guardianAssist.title}</strong>
            <p>{guardianAssist.reason}</p>
          </div>
          {guardianAssistPriority && onOpenTask && (
            <button type="button" onClick={() => onOpenTask(guardianAssistPriority)}>Review task</button>
          )}
        </aside>
      )}

      <div className={styles.layout}>
        <section className={styles.monthCard} aria-label={`${monthLabel(visibleMonth)} calendar`}>
          <header className={styles.monthHeader}>
            <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>←</button>
            <h3 aria-live="polite">{monthLabel(visibleMonth)}</h3>
            <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>→</button>
          </header>
          <div className={styles.weekdays} aria-hidden="true">
            {weekdays.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className={styles.grid} role="grid" aria-label={monthLabel(visibleMonth)}>
            {days.map((day) => {
              const items = itemMap.get(day.date) ?? [];
              const itemText = `${items.length} ${items.length === 1 ? "item" : "items"}`;
              return (
                <div className={`${styles.cell} ${!day.inMonth ? styles.outside : ""}`} role="gridcell" key={day.date}>
                  <button
                    type="button"
                    disabled={!day.inMonth}
                    aria-label={`${fullDateLabel(day.date)}, ${itemText}`}
                    aria-pressed={selectedDate === day.date}
                    aria-current={projection.context.localDate === day.date ? "date" : undefined}
                    onClick={() => setSelectedDate(day.date)}
                  >
                    <span>{day.dayNumber}</span>
                    {items.length > 0 && (
                      <span className={styles.dots} aria-hidden="true">
                        {items.slice(0, 3).map((item) => (
                          <i
                            className={categoryClass(item)}
                            key={item.id}
                          />
                        ))}
                      </span>
                    )}
                    {items.length > 0 && <small>{items.length}</small>}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <aside className={styles.agenda} aria-labelledby="selected-day-title" aria-live="polite">
          <header>
            <p>SELECTED DAY</p>
            <h3 id="selected-day-title">{fullDateLabel(selectedDate)}</h3>
            <span>{selectedItems.length === 0 ? "A clear day" : `${selectedItems.length} ${selectedItems.length === 1 ? "item" : "items"}`}</span>
          </header>
          {selectedItems.length === 0 ? (
            <div className={styles.empty}>
              <span aria-hidden="true">✓</span>
              <strong>Nothing scheduled here.</strong>
              <p>Choose another date or return to Today for your next step.</p>
            </div>
          ) : (
            <ol className={styles.agendaList}>
              {selectedItems.map((item) => {
                const priority = projection.priorities.find((candidate) => candidate.source.externalId === item.source.externalId);
                return <li key={item.id}>
                  <i className={categoryClass(item)} aria-hidden="true" />
                  <div>
                    <span><strong>{item.timeLabel}</strong><em>{item.statusLabel}</em></span>
                    <h4>{item.title}</h4>
                    {item.courseName && <p>{item.courseName}</p>}
                    <small>{sourceLabel(item)}</small>
                    {priority && onOpenTask && <button type="button" onClick={() => onOpenTask(priority)}>Open task</button>}
                  </div>
                </li>;
              })}
            </ol>
          )}
          <p className={styles.reminder}><span aria-hidden="true">◷</span> You only need to plan the selected day.</p>
        </aside>
      </div>
    </section>
  );
}
