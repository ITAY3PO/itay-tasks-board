"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAgenda,
  formatAgendaText,
  collectLinearLinks,
  subtaskLinks,
  formatSubtaskProgress,
  groupNested,
  zonedDateTime,
  CALENDAR_NOTE,
  NOT_WORKDAY_NOTE,
} = require("./schedule.js");

const TZ = "Asia/Jerusalem";
const PRIORITIES = ["urgent", "high", "medium", "low"];

function at(ymd, hm) {
  return zonedDateTime(ymd, hm, TZ);
}

function task(partial) {
  return {
    id: partial.id,
    title: partial.title,
    status: partial.status || "todo",
    priority: partial.priority || "medium",
    due: partial.due || null,
    created: partial.created || "2026-10-01",
    project: partial.project || "Personal",
    notes: partial.notes || "",
    source: partial.source || "",
    linear: partial.linear,
    scheduled: partial.scheduled || null,
    quadrant: partial.quadrant,
    parent: partial.parent,
  };
}

function labels(agenda) {
  return agenda.items.map((item) => {
    if (item.kind === "meeting") return `${item.startLabel}-${item.endLabel} meeting ${item.title}`;
    return `${item.startLabel}-${item.endLabel} ${item.pinned ? "pin " : ""}${item.title}`;
  });
}

test("busy blocks leave gaps that tasks fill around", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "08:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: {
      date: day,
      timezone: TZ,
      workday: { start: "09:00", end: "19:00" },
      busy: [
        {
          start: at(day, "10:00").toISOString(),
          end: at(day, "11:00").toISOString(),
          title: "Standup",
        },
      ],
    },
    tasks: [
      task({ id: "a", title: "First", priority: "urgent", due: "2026-10-20", created: "2026-10-01" }),
      task({ id: "b", title: "Second", priority: "urgent", due: "2026-10-21", created: "2026-10-02" }),
      task({ id: "c", title: "Third", priority: "high", due: "2026-10-22", created: "2026-10-03" }),
    ],
  });

  assert.equal(agenda.isWorkday, true);
  assert.equal(agenda.notWorkdayNote, null);
  assert.equal(agenda.calendarNote, null);
  assert.deepEqual(labels(agenda), [
    "09:00-09:30 First",
    "09:30-10:00 Second",
    "10:00-11:00 meeting Standup",
    "11:00-11:30 Third",
  ]);
  assert.deepEqual(agenda.overflow.map((item) => item.id), []);
});

test("a busy block that starts before the workday is clipped", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "08:10"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: {
      date: day,
      timezone: TZ,
      workday: { start: "09:00", end: "12:00" },
      busy: [
        {
          start: at(day, "07:15").toISOString(),
          end: at(day, "08:00").toISOString(),
          title: "Before anyone is in",
        },
        {
          start: at(day, "08:00").toISOString(),
          end: at(day, "09:00").toISOString(),
          title: "Ends as the workday starts",
          status: "needsAction",
        },
        {
          start: at(day, "08:00").toISOString(),
          end: at(day, "09:30").toISOString(),
          title: "Early sync\nwith a second line",
          status: "tentative",
        },
        {
          start: at(day, "10:00").toISOString(),
          end: at(day, "10:20").toISOString(),
          title: "   ",
          responseStatus: "needsAction",
        },
        {
          start: at(day, "11:00").toISOString(),
          end: at(day, "13:00").toISOString(),
          title: 'עוד פגישה & "quotes" <tag>',
        },
      ],
    },
    tasks: [
      task({ id: "a", title: "After the early block", priority: "urgent", due: "2026-10-20", created: "2026-10-01" }),
      task({ id: "b", title: "After the short block", priority: "high", due: "2026-10-21", created: "2026-10-02" }),
    ],
  });

  assert.deepEqual(labels(agenda), [
    "09:00-09:30 meeting Early sync with a second line",
    "09:30-10:00 After the early block",
    "10:00-10:20 meeting Busy",
    "10:20-10:50 After the short block",
    '11:00-12:00 meeting עוד פגישה & "quotes" <tag>',
  ]);
  agenda.items.forEach((item) => {
    assert.ok(item.start >= 9 * 60, item.title);
    assert.ok(item.end <= 12 * 60, item.title);
  });
  assert.equal(agenda.items.some((item) => /Before anyone|Ends as the workday/.test(item.title || "")), false);
  const text = formatAgendaText(agenda);
  assert.equal(text.includes("\nwith a second line"), false);
  assert.match(text, /09:00-09:30  Early sync with a second line \(meeting\)/);
  assert.match(text, /11:00-12:00  עוד פגישה & "quotes" <tag> \(meeting\)/);
});

test("a scheduled slot today is pinned and other tasks flow around it", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "08:30"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: { date: day, timezone: TZ, workday: { start: "09:00", end: "12:00" }, busy: [] },
    tasks: [
      task({
        id: "pin",
        title: "Pinned review",
        priority: "low",
        due: "2026-10-28",
        created: "2026-10-09",
        scheduled: { start: at(day, "09:30").toISOString(), end: at(day, "10:15").toISOString() },
      }),
      task({ id: "flex", title: "Urgent flex", priority: "urgent", due: "2026-10-18", created: "2026-10-02" }),
      task({ id: "next", title: "Next flex", priority: "high", due: "2026-10-19", created: "2026-10-03" }),
    ],
  });

  assert.deepEqual(labels(agenda), [
    "09:00-09:30 Urgent flex",
    "09:30-10:15 pin Pinned review",
    "10:15-10:45 Next flex",
  ]);
  assert.equal(agenda.items.filter((item) => item.id === "pin").length, 1);
  assert.equal(agenda.overflow.length, 0);
});

test("tasks that cannot take a full slot overflow", () => {
  const day = "2026-10-26";
  const agenda = buildAgenda({
    now: at(day, "07:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: {
      date: day,
      timezone: TZ,
      workday: { start: "09:00", end: "10:30" },
      busy: [
        {
          start: at(day, "09:30").toISOString(),
          end: at(day, "10:00").toISOString(),
          title: "Interview",
        },
      ],
    },
    tasks: [
      task({ id: "1", title: "One", priority: "high", due: "2026-10-26", created: "2026-10-01" }),
      task({ id: "2", title: "Two", priority: "medium", due: "2026-10-27", created: "2026-10-02" }),
      task({ id: "3", title: "Three", priority: "low", due: "2026-10-28", created: "2026-10-03" }),
      task({ id: "done", title: "Finished", status: "done", priority: "urgent", due: "2026-10-01", created: "2026-10-01" }),
    ],
  });

  assert.deepEqual(labels(agenda), [
    "09:00-09:30 One",
    "09:30-10:00 meeting Interview",
    "10:00-10:30 Two",
  ]);
  assert.deepEqual(agenda.overflow.map((item) => item.title), ["Three"]);
  assert.equal(agenda.items.some((item) => item.id === "done"), false);
  assert.equal(agenda.overflow.some((item) => item.id === "done"), false);
});

test("mid-day now schedules only the remaining workday", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "13:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: {
      date: day,
      timezone: TZ,
      workday: { start: "09:00", end: "19:00" },
      busy: [
        { start: at(day, "10:00").toISOString(), end: at(day, "11:00").toISOString(), title: "Morning sync" },
        { start: at(day, "12:30").toISOString(), end: at(day, "13:30").toISOString(), title: "Lunch" },
      ],
    },
    tasks: [
      task({
        id: "pin",
        title: "Pinned later",
        priority: "low",
        scheduled: { start: at(day, "15:00").toISOString(), end: at(day, "15:30").toISOString() },
      }),
      task({ id: "a", title: "Alpha", priority: "urgent", due: "2026-10-20", created: "2026-10-01" }),
      task({ id: "b", title: "Beta", priority: "urgent", due: "2026-10-21", created: "2026-10-02" }),
      task({ id: "c", title: "Gamma", priority: "high", due: "2026-10-22", created: "2026-10-03" }),
    ],
  });

  assert.deepEqual(labels(agenda), [
    "10:00-11:00 meeting Morning sync",
    "12:30-13:30 meeting Lunch",
    "13:30-14:00 Alpha",
    "14:00-14:30 Beta",
    "14:30-15:00 Gamma",
    "15:00-15:30 pin Pinned later",
  ]);
  assert.equal(agenda.items.some((item) => item.startLabel === "09:00"), false);
});

test("missing calendar uses 09:00-19:00 and still schedules", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "08:15"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: null,
    tasks: [task({ id: "a", title: "Only task", priority: "high" })],
  });

  assert.equal(agenda.calendarNote, CALENDAR_NOTE);
  assert.deepEqual(agenda.workday, { start: "09:00", end: "19:00" });
  assert.deepEqual(labels(agenda), ["09:00-09:30 Only task"]);
  assert.match(formatAgendaText(agenda), /Calendar not loaded, meetings not excluded/);
  assert.match(formatAgendaText(agenda), /Workday 09:00-19:00 Asia\/Jerusalem/);
});

test("a calendar whose date is not today does not block time", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "09:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: {
      date: "2026-10-24",
      timezone: TZ,
      workday: { start: "10:00", end: "16:00" },
      busy: [{ start: at(day, "09:00").toISOString(), end: at(day, "19:00").toISOString(), title: "All day" }],
    },
    tasks: [task({ id: "a", title: "Still scheduled", priority: "urgent" })],
  });

  assert.equal(agenda.calendarNote, CALENDAR_NOTE);
  assert.deepEqual(agenda.workday, { start: "09:00", end: "19:00" });
  assert.deepEqual(labels(agenda), ["09:00-09:30 Still scheduled"]);
});

test("Friday and Saturday are not workdays but still schedule", () => {
  for (const day of ["2026-10-30", "2026-10-31"]) {
    const agenda = buildAgenda({
      now: at(day, "09:10"),
      timezone: TZ,
      priorities: PRIORITIES,
      calendar: null,
      tasks: [task({ id: "a", title: "Weekend task", priority: "medium", due: day })],
    });
    assert.equal(agenda.isWorkday, false);
    assert.equal(agenda.notWorkdayNote, NOT_WORKDAY_NOTE);
    assert.equal(agenda.workday.end, "19:00");
    assert.deepEqual(labels(agenda), ["09:10-09:40 Weekend task"]);
    const text = formatAgendaText(agenda);
    assert.match(text, /Not a workday/);
    assert.match(text, /Calendar not loaded, meetings not excluded/);
  }
});

test("Sunday through Thursday stay workdays", () => {
  for (const day of ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]) {
    const agenda = buildAgenda({ now: at(day, "12:00"), timezone: TZ, tasks: [], calendar: null });
    assert.equal(agenda.isWorkday, true, day);
    assert.equal(agenda.notWorkdayNote, null);
  }
});

test("open tasks with no quadrant are ordered by priority, then due, then created", () => {
  const day = "2026-10-27";
  const agenda = buildAgenda({
    now: at(day, "09:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: { date: day, timezone: TZ, workday: { start: "09:00", end: "12:00" }, busy: [] },
    tasks: [
      task({ id: "low", title: "Low", priority: "low", due: "2026-10-01", created: "2026-09-01" }),
      task({ id: "urgent-later", title: "Urgent later", priority: "urgent", due: "2026-10-20", created: "2026-10-01" }),
      task({ id: "urgent-sooner", title: "Urgent sooner", priority: "urgent", due: "2026-10-18", created: "2026-10-08" }),
      task({ id: "same-newer", title: "Same newer", priority: "high", due: "2026-10-19", created: "2026-10-05" }),
      task({ id: "same-older", title: "Same older", priority: "high", due: "2026-10-19", created: "2026-10-02" }),
      task({ id: "done", title: "Done", status: "done", priority: "urgent", due: "2026-10-01", created: "2026-09-01" }),
    ],
  });

  assert.deepEqual(
    agenda.items.map((item) => item.id),
    ["urgent-sooner", "urgent-later", "same-older", "same-newer", "low"],
  );
});

test("a loaded calendar can override the workday", () => {
  const day = "2026-10-26";
  const agenda = buildAgenda({
    now: at(day, "08:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: { date: day, timezone: TZ, workday: { start: "10:00", end: "16:00" }, busy: [] },
    tasks: [task({ id: "a", title: "Late start", priority: "high" })],
  });
  assert.deepEqual(agenda.workday, { start: "10:00", end: "16:00" });
  assert.equal(agenda.calendarNote, null);
  assert.deepEqual(labels(agenda), ["10:00-10:30 Late start"]);
});

test("plain text includes the overflow section", () => {
  const day = "2026-10-26";
  const agenda = buildAgenda({
    now: at(day, "09:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: { date: day, timezone: TZ, workday: { start: "09:00", end: "09:30" }, busy: [] },
    tasks: [
      task({ id: "a", title: "Fits", priority: "urgent", project: "UMI" }),
      task({ id: "b", title: "Leftover", priority: "low", project: "Personal" }),
    ],
  });
  const text = formatAgendaText(agenda);
  assert.match(text, /09:00-09:30  Fits — UMI · urgent/);
  assert.match(text, /Didn't fit today\n- Leftover \(Personal\)/);
});

test("the demo calendar clips 08:00 and keeps every busy title", () => {
  const calendar = require("./demo-calendar.json");
  const agenda = buildAgenda({
    now: at(calendar.date, "08:30"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar,
    tasks: [task({ id: "a", title: "First open task", priority: "urgent" })],
  });
  assert.deepEqual(
    agenda.items.filter((item) => item.kind === "meeting").map((item) => `${item.startLabel}-${item.endLabel} ${item.title}`),
    [
      "09:00-09:20 Early cargo that starts before the workday",
      "10:00-10:45 Standup with the cardboard cactus",
      "13:00-14:00 Fictional design review (pending invite)",
    ],
  );
  assert.equal(agenda.items.find((item) => item.id === "a").startLabel, "09:20");
});

test("agenda orders Q1, then Q2, then Q3, then unsorted, and leaves Q4 out", () => {
  const day = "2026-10-27";
  const agenda = buildAgenda({
    now: at(day, "09:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: { date: day, timezone: TZ, workday: { start: "09:00", end: "14:00" }, busy: [] },
    tasks: [
      task({ id: "q4", title: "Drop this", priority: "urgent", due: "2026-10-01", created: "2026-09-01", quadrant: "Q4" }),
      task({
        id: "q4-pin",
        title: "Pinned drop",
        priority: "urgent",
        due: "2026-10-01",
        created: "2026-09-01",
        quadrant: "Q4",
        scheduled: { start: at(day, "09:00").toISOString(), end: at(day, "09:30").toISOString() },
      }),
      task({ id: "done", title: "Finished Q1", status: "done", priority: "urgent", due: "2026-10-01", quadrant: "Q1" }),
      task({ id: "unsorted-low", title: "Unsorted low", priority: "low", due: "2026-10-01", created: "2026-10-01", quadrant: "nope" }),
      task({ id: "unsorted-later", title: "Unsorted later", priority: "urgent", due: "2026-10-20", created: "2026-10-02", quadrant: " " }),
      task({ id: "unsorted-soon", title: "Unsorted soon", priority: "urgent", due: "2026-10-02", created: "2026-10-04" }),
      task({ id: "q3-nodue", title: "Q3 no due", priority: "high", due: null, created: "2026-10-01", quadrant: "Q3" }),
      task({ id: "q3-later", title: "Q3 later", priority: "urgent", due: "2026-10-19", created: "2026-10-01", quadrant: "Q3" }),
      task({ id: "q3-sooner", title: "Q3 sooner", priority: "urgent", due: "2026-10-18", created: "2026-10-08", quadrant: "q3" }),
      task({ id: "q2", title: "Q2 later", priority: "low", due: "2026-11-01", created: "2026-10-01", quadrant: "Q2" }),
      task({ id: "q1-medium", title: "Q1 medium", priority: "medium", due: "2026-10-01", created: "2026-10-03", quadrant: "Q1" }),
      task({ id: "q1-high-newer", title: "Q1 newer", priority: "high", due: "2026-10-19", created: "2026-10-05", quadrant: "Q1" }),
      task({ id: "q1-high-older", title: "Q1 older", priority: "high", due: "2026-10-19", created: "2026-10-02", quadrant: "Q1" }),
      task({ id: "q1-urgent-none", title: "Q1 no due", priority: "urgent", due: null, created: "2026-10-01", quadrant: "Q1" }),
      task({ id: "q1-urgent-due", title: "Q1 due", priority: "urgent", due: "2026-10-21", created: "2026-10-08", quadrant: "Q1" }),
    ],
  });

  assert.deepEqual(
    agenda.items.map((item) => item.id),
    [
      "q1-urgent-due",
      "q1-urgent-none",
      "q1-high-older",
      "q1-high-newer",
      "q1-medium",
      "q2",
      "q3-sooner",
      "q3-later",
      "q3-nodue",
      "unsorted-soon",
    ],
  );
  assert.deepEqual(agenda.overflow.map((item) => item.id), ["unsorted-later", "unsorted-low"]);
  assert.equal(agenda.items.some((item) => item.id === "q4" || item.id === "q4-pin" || item.id === "done"), false);
  assert.equal(agenda.overflow.some((item) => item.id === "q4" || item.id === "q4-pin" || item.id === "done"), false);
  const text = formatAgendaText(agenda);
  assert.match(text, /09:00-09:30  Q1 due — Q1 Do · Personal · urgent/);
  assert.match(text, /Didn't fit today\n- Unsorted later \(Personal\)/);
  assert.equal(text.includes("Drop this"), false);
  assert.equal(text.includes("Pinned drop"), false);
});

test("a scheduled slot still pins while Q4 stays off the agenda", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "08:30"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: { date: day, timezone: TZ, workday: { start: "09:00", end: "11:00" }, busy: [] },
    tasks: [
      task({
        id: "q4-pin",
        title: "Drop the pinned errand",
        priority: "urgent",
        quadrant: "Q4",
        scheduled: { start: at(day, "09:00").toISOString(), end: at(day, "09:30").toISOString() },
      }),
      task({
        id: "q3-pin",
        title: "Delegated review",
        priority: "low",
        quadrant: "Q3",
        scheduled: { start: at(day, "09:30").toISOString(), end: at(day, "10:00").toISOString() },
      }),
      task({ id: "q1", title: "Do this first", priority: "medium", quadrant: "Q1", due: "2026-10-20" }),
      task({ id: "q2", title: "Schedule this", priority: "urgent", quadrant: "Q2", due: "2026-10-18" }),
      task({ id: "loose", title: "No quadrant", priority: "urgent", due: "2026-10-01" }),
    ],
  });

  assert.deepEqual(labels(agenda), [
    "09:00-09:30 Do this first",
    "09:30-10:00 pin Delegated review",
    "10:00-10:30 Schedule this",
    "10:30-11:00 No quadrant",
  ]);
  assert.equal(agenda.items.some((item) => item.id === "q4-pin"), false);
  assert.equal(agenda.overflow.some((item) => item.id === "q4-pin"), false);
  assert.equal(agenda.overflow.length, 0);
});

test("Linear ids come from the field and from title, notes, and source", () => {
  const links = collectLinearLinks({
    title: "Fix SOLV-1687 before lunch",
    notes: "Also see PLAT-2516. solv-1687 is not an id.",
    source: "Imported from POL-89",
    linear: [
      { id: "SOLV-1687" },
      { id: "OPS-2", url: "https://example.test/OPS-2" },
      { id: "  " },
    ],
  });
  assert.deepEqual(links, [
    { id: "SOLV-1687", url: "https://linear.app/issue/SOLV-1687" },
    { id: "OPS-2", url: "https://example.test/OPS-2" },
    { id: "PLAT-2516", url: "https://linear.app/issue/PLAT-2516" },
    { id: "POL-89", url: "https://linear.app/issue/POL-89" },
  ]);
  assert.deepEqual(collectLinearLinks({ title: "No ticket here", notes: "", source: "" }), []);
});

function idsOf(rows) {
  return rows.map((row) => `${row.task.id}:${row.depth}`);
}

test("tasks without a parent, and tasks whose parent id does not exist, stay top-level", () => {
  const tasks = [
    task({ id: "a", title: "Alpha" }),
    task({ id: "b", title: "Beta", parent: "" }),
    task({ id: "c", title: "Gamma", parent: "   " }),
    task({ id: "d", title: "Delta", parent: "t071" }),
    task({ id: "e", title: "Epsilon", parent: "e" }),
    task({ id: "f", title: "Phi", parent: "  missing  " }),
  ];
  const links = subtaskLinks(tasks);
  assert.deepEqual(links.parentOf, {});
  assert.deepEqual(links.children, {});
  assert.deepEqual(links.progress, {});

  const groups = groupNested({
    tasks,
    visible: tasks,
    groupOf: () => "todo",
    groupOrder: ["todo"],
    compare: (a, b) => a.title.localeCompare(b.title),
  });
  assert.deepEqual(groups.map(([key]) => key), ["todo"]);
  assert.deepEqual(idsOf(groups[0][1]), ["a:0", "b:0", "d:0", "e:0", "c:0", "f:0"]);
});

test("subtasks nest under a real parent with an N/M done count", () => {
  const tasks = [
    task({ id: "p", title: "Parent", status: "todo" }),
    task({ id: "s1", title: "Second", status: "todo", parent: "p" }),
    task({ id: "s2", title: "First", status: "done", parent: " p " }),
    task({ id: "other", title: "Other", status: "todo" }),
  ];
  const links = subtaskLinks(tasks);
  assert.equal(links.parentOf.s1, "p");
  assert.equal(links.parentOf.s2, "p");
  assert.equal(links.parentOf.other, undefined);
  assert.deepEqual(links.children.p, ["s1", "s2"]);
  assert.deepEqual(links.progress.p, { done: 1, total: 2 });
  assert.equal(links.progress.s1, undefined);

  const groups = groupNested({
    tasks,
    visible: tasks,
    groupOf: (item) => item.status,
    groupOrder: ["todo", "done"],
    compare: (a, b) => a.title.localeCompare(b.title),
  });
  const byKey = Object.fromEntries(groups);
  assert.deepEqual(idsOf(byKey.todo), ["other:0", "p:0", "s2:1", "s1:1"]);
  assert.equal(byKey.done, undefined);
});

test("a subtask moves into its parent's group, and a hidden parent leaves it in place", () => {
  const tasks = [
    task({ id: "p", title: "Parent", status: "in_progress", project: "UMI" }),
    task({ id: "child", title: "Child", status: "todo", project: "Personal", parent: "p" }),
    task({ id: "solo", title: "Solo", status: "todo", project: "Personal" }),
  ];
  const nested = groupNested({
    tasks,
    visible: tasks,
    groupOf: (item) => item.status,
    groupOrder: ["todo", "in_progress"],
    compare: (a, b) => a.title.localeCompare(b.title),
  });
  const byStatus = Object.fromEntries(nested);
  assert.deepEqual(idsOf(byStatus.todo), ["solo:0"]);
  assert.deepEqual(idsOf(byStatus.in_progress), ["p:0", "child:1"]);

  const parentHidden = groupNested({
    tasks,
    visible: tasks.filter((item) => item.id !== "p"),
    groupOf: (item) => item.status,
    groupOrder: ["todo", "in_progress"],
    compare: (a, b) => a.title.localeCompare(b.title),
  });
  const hidden = Object.fromEntries(parentHidden);
  assert.deepEqual(idsOf(hidden.todo), ["child:0", "solo:0"]);
  assert.equal(hidden.in_progress, undefined);
  assert.deepEqual(subtaskLinks(tasks).progress.p, { done: 0, total: 1 });
});

test("hidden subtasks still count toward N/M, and grandchildren nest one level deeper", () => {
  const tasks = [
    task({ id: "p", title: "Parent", status: "todo" }),
    task({ id: "done-child", title: "Done child", status: "done", parent: "p" }),
    task({ id: "mid", title: "Middle", status: "todo", parent: "p" }),
    task({ id: "leaf", title: "Leaf", status: "todo", parent: "mid" }),
  ];
  const links = subtaskLinks(tasks);
  assert.deepEqual(links.progress.p, { done: 1, total: 2 });
  assert.deepEqual(links.progress.mid, { done: 0, total: 1 });

  const visible = tasks.filter((item) => item.status !== "done");
  const groups = groupNested({
    tasks,
    visible,
    groupOf: () => "open",
    groupOrder: ["open"],
    compare: (a, b) => a.title.localeCompare(b.title),
  });
  assert.deepEqual(idsOf(groups[0][1]), ["p:0", "mid:1", "leaf:2"]);
});

test("a parent cycle stays visible as top-level tasks", () => {
  const tasks = [
    task({ id: "a", title: "A", parent: "b" }),
    task({ id: "b", title: "B", parent: "c" }),
    task({ id: "c", title: "C", parent: "b" }),
    task({ id: "plain", title: "Plain" }),
  ];
  const links = subtaskLinks(tasks);
  assert.deepEqual(links.parentOf, {});
  const groups = groupNested({
    tasks,
    visible: tasks,
    groupOf: () => "all",
    groupOrder: ["all"],
    compare: (a, b) => a.id.localeCompare(b.id),
  });
  assert.deepEqual(idsOf(groups[0][1]), ["a:0", "b:0", "c:0", "plain:0"]);
});

test("a valid chain nests under the top parent, including across groups", () => {
  const tasks = [
    task({ id: "top", title: "Top", status: "todo" }),
    task({ id: "mid", title: "Mid", status: "waiting", parent: "top" }),
    task({ id: "leaf", title: "Leaf", status: "in_progress", parent: "mid" }),
  ];
  const links = subtaskLinks(tasks);
  assert.equal(links.parentOf.mid, "top");
  assert.equal(links.parentOf.leaf, "mid");
  assert.deepEqual(links.progress.top, { done: 0, total: 1 });
  const groups = groupNested({
    tasks,
    visible: tasks,
    groupOf: (item) => item.status,
    groupOrder: ["todo", "waiting", "in_progress"],
    compare: (a, b) => a.title.localeCompare(b.title),
  });
  assert.deepEqual(groups.map(([key]) => key), ["todo"]);
  assert.deepEqual(idsOf(groups[0][1]), ["top:0", "mid:1", "leaf:2"]);
});

test("t072 through t083 nest under t071 and the parent progress is done/total", () => {
  const tasks = [task({ id: "t071", title: "Picnic", status: "in_progress", project: "UMI" })];
  for (let n = 72; n <= 83; n += 1) {
    const id = `t${String(n).padStart(3, "0")}`;
    tasks.push(task({
      id,
      title: `Step ${n}`,
      status: n <= 74 ? "done" : n % 2 === 0 ? "todo" : "in_progress",
      parent: "t071",
      project: n === 80 ? "Personal" : "UMI",
    }));
  }
  tasks.push(task({ id: "solo", title: "No parent", status: "todo" }));
  tasks.push(task({ id: "orphan", title: "Missing parent", status: "todo", parent: "t000" }));

  const links = subtaskLinks(tasks);
  for (let n = 72; n <= 83; n += 1) {
    assert.equal(links.parentOf[`t${String(n).padStart(3, "0")}`], "t071");
  }
  assert.equal(links.parentOf.solo, undefined);
  assert.equal(links.parentOf.orphan, undefined);
  assert.equal(links.parentOf.t071, undefined);
  assert.deepEqual(links.children.t071, tasks.filter((item) => item.parent === "t071").map((item) => item.id));
  assert.deepEqual(links.progress.t071, { done: 3, total: 12 });
  assert.equal(formatSubtaskProgress(links.progress.t071), "3/12");

  const groups = groupNested({
    tasks,
    visible: tasks,
    groupOf: (item) => item.project,
    groupOrder: ["UMI", "Personal"],
    compare: (a, b) => a.id.localeCompare(b.id),
  });
  const byProject = Object.fromEntries(groups);
  const childRows = [];
  for (let n = 72; n <= 83; n += 1) childRows.push(`t${String(n).padStart(3, "0")}:1`);
  assert.deepEqual(idsOf(byProject.UMI), ["t071:0", ...childRows]);
  assert.deepEqual(idsOf(byProject.Personal), ["orphan:0", "solo:0"]);
});

test("demo tasks parent t072–t083 on t071", () => {
  const demo = require("./demo-tasks.json");
  const links = subtaskLinks(demo.tasks);
  const children = [];
  for (let n = 72; n <= 83; n += 1) children.push(`t${String(n).padStart(3, "0")}`);
  assert.deepEqual(links.children.t071, children);
  children.forEach((id) => assert.equal(links.parentOf[id], "t071"));
  assert.equal(links.parentOf.t071, undefined);
  assert.equal(formatSubtaskProgress(links.progress.t071), "3/12");
  const orphan = demo.tasks.find((item) => item.id === "d23");
  assert.equal(orphan.parent, "t000");
  assert.equal(links.parentOf.d23, undefined);
});

test("agenda still schedules a subtask as a normal open task", () => {
  const day = "2026-10-25";
  const agenda = buildAgenda({
    now: at(day, "09:00"),
    timezone: TZ,
    priorities: PRIORITIES,
    calendar: {
      date: day,
      timezone: TZ,
      workday: { start: "09:00", end: "12:00" },
      busy: [],
    },
    tasks: [
      task({ id: "parent", title: "Parent", priority: "low", quadrant: "Q4" }),
      task({ id: "child", title: "Child task", priority: "urgent", parent: "parent", quadrant: "Q1" }),
    ],
  });
  assert.deepEqual(labels(agenda), ["09:00-09:30 Child task"]);
  assert.deepEqual(agenda.overflow.map((item) => item.id), []);
});
