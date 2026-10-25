"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAgenda,
  formatAgendaText,
  collectLinearLinks,
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

test("open tasks are ordered by priority, then due, then created", () => {
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
