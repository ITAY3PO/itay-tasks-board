"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGantt } = require("./gantt.js");
const { shortTitle } = require("./schedule.js");

function task(partial) {
  return {
    id: partial.id,
    title: partial.title || partial.id,
    status: partial.status || "todo",
    priority: partial.priority || "medium",
    due: Object.prototype.hasOwnProperty.call(partial, "due") ? partial.due : null,
    project: partial.project || "Personal",
    waiting_on: Object.prototype.hasOwnProperty.call(partial, "waiting_on") ? partial.waiting_on : null,
    parent: partial.parent,
    short_title: partial.short_title,
    notes: partial.notes || "",
  };
}

function ids(model) {
  return model.rows.map((row) => row.id);
}

test("row selection keeps open dated top-level tasks, earliest due first", () => {
  const tasks = [
    task({ id: "late", title: "Ship the notes", due: "2026-11-06", project: "Chat", priority: "low" }),
    task({ id: "done", title: "Finished work", status: "done", due: "2026-10-01", project: "UMI" }),
    task({
      id: "child",
      title: "Slice the demo watermelon",
      parent: "parent",
      due: "2026-10-02",
      project: "UMI",
    }),
    task({
      id: "parent",
      title: "Pack the fictional picnic - twelve steps and a blanket",
      due: "2026-11-04",
      project: "umi",
      short_title: "Picnic",
    }),
    task({ id: "nodate", title: "No date", due: null }),
    task({ id: "orphan", title: "Missing parent stays", parent: "nope", due: "2026-11-04", project: "Travel Town" }),
    task({ id: "same", title: "Same day, listed after the urgent one", due: "2026-11-06", project: "travel town", priority: "urgent" }),
    task({ id: "bad", title: "Bad date", due: "soon" }),
    task({ id: "blank", title: "Blank parent", parent: "  ", due: "2026-11-01", project: "Side Quest" }),
    task({ id: "done-child", title: "Done subtask", parent: "parent", status: "done", due: null }),
  ];

  const model = buildGantt(tasks, { today: "2026-11-02" });

  assert.deepEqual(ids(model), ["blank", "parent", "orphan", "late", "same"]);
  assert.deepEqual(model.rows.map((row) => row.due), [
    "2026-11-01",
    "2026-11-04",
    "2026-11-04",
    "2026-11-06",
    "2026-11-06",
  ]);

  const parent = model.rows.find((row) => row.id === "parent");
  assert.equal(parent.shortTitle, shortTitle(tasks.find((item) => item.id === "parent")));
  assert.equal(parent.shortTitle, "Picnic");
  assert.equal(parent.title, "Pack the fictional picnic - twelve steps and a blanket");
  assert.equal(parent.colorKey, "p");
  assert.equal(parent.color, "#8b3fd9");

  const late = model.rows.find((row) => row.id === "late");
  assert.equal(late.colorKey, "c");
  assert.equal(late.color, "#4466e6");
  assert.equal(late.shortTitle, shortTitle(tasks.find((item) => item.id === "late")));

  const orphan = model.rows.find((row) => row.id === "orphan");
  assert.equal(orphan.colorKey, "g");
  assert.equal(orphan.color, "#1f9d55");

  const same = model.rows.find((row) => row.id === "same");
  assert.equal(same.colorKey, "g");

  const blank = model.rows.find((row) => row.id === "blank");
  assert.equal(blank.colorKey, "n");
  assert.equal(blank.color, "#6b7280");

  model.rows.forEach((row) => {
    assert.equal(row.span, 1);
    assert.equal(model.days[row.dayIndex].date, row.due);
  });
});

test("day columns run from the earlier of today and the first due date through the last", () => {
  const spanning = buildGantt([
    task({ id: "a", due: "2026-10-30", project: "Chat" }),
    task({ id: "b", due: "2026-11-02", project: "UMI" }),
  ], { today: "2026-11-01" });

  assert.equal(spanning.start, "2026-10-30");
  assert.equal(spanning.end, "2026-11-02");
  assert.deepEqual(spanning.days.map((day) => day.date), [
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
  ]);
  assert.deepEqual(spanning.days.map((day) => [day.weekday, day.day, day.weekend, day.today]), [
    ["Fri", 30, true, false],
    ["Sat", 31, true, false],
    ["Sun", 1, false, true],
    ["Mon", 2, false, false],
  ]);
  assert.equal(spanning.todayIndex, 2);
  assert.equal(spanning.todayFraction, 2.5 / 4);
  assert.equal(spanning.rows[0].dayIndex, 0);
  assert.equal(spanning.rows[1].dayIndex, 3);
  assert.equal(spanning.rows[0].dateLabel, "Oct 30");
  assert.equal(spanning.rows[1].dateLabel, "Nov 2");

  const futureOnly = buildGantt([
    task({ id: "c", due: "2026-11-04" }),
    task({ id: "d", due: "2026-11-06" }),
  ], { today: "2026-11-01" });
  assert.equal(futureOnly.start, "2026-11-01");
  assert.equal(futureOnly.end, "2026-11-06");
  assert.equal(futureOnly.days[0].today, true);
  assert.equal(futureOnly.days.at(-1).date, "2026-11-06");
  assert.equal(futureOnly.days.at(-1).weekday, "Fri");
  assert.equal(futureOnly.days.at(-1).weekend, true);
  assert.equal(futureOnly.rows.find((row) => row.id === "c").dayIndex, 3);

  const pastOnly = buildGantt([
    task({ id: "e", due: "2026-10-18" }),
  ], { today: "2026-11-01" });
  assert.equal(pastOnly.start, "2026-10-18");
  assert.equal(pastOnly.end, "2026-10-18");
  assert.equal(pastOnly.days.length, 1);
  assert.equal(pastOnly.todayIndex, -1);
  assert.equal(pastOnly.todayFraction, null);
  assert.equal(pastOnly.days[0].today, false);

  const empty = buildGantt([
    task({ id: "f", due: null }),
  ], { today: "2026-11-01" });
  assert.equal(empty.start, "");
  assert.equal(empty.end, "");
  assert.deepEqual(empty.days, []);
  assert.equal(empty.todayFraction, null);
});

test("overdue and waiting bars are marked, and the tooltip names who a task is waiting on", () => {
  const model = buildGantt([
    task({ id: "over", due: "2026-10-20", project: "Personal", status: "todo" }),
    task({ id: "today", due: "2026-11-01", project: "Chat", status: "in_progress" }),
    task({ id: "later", due: "2026-11-04", project: "UMI", status: "todo" }),
    task({
      id: "wait",
      due: "2026-11-04",
      project: "Travel Town",
      status: "waiting",
      waiting_on: "Alex Rivera",
    }),
    task({
      id: "both",
      due: "2026-10-22",
      project: "Moon Active",
      status: "waiting",
      waiting_on: "  Riley   Cho ",
    }),
    task({
      id: "wait-empty",
      due: "2026-11-05",
      status: "waiting",
      waiting_on: "   ",
    }),
    task({
      id: "named",
      due: "2026-11-03",
      status: "todo",
      waiting_on: "Jordan Hale",
    }),
  ], { today: "2026-11-01" });

  const byId = Object.fromEntries(model.rows.map((row) => [row.id, row]));

  assert.equal(byId.over.overdue, true);
  assert.equal(byId.over.waiting, false);
  assert.ok(byId.over.classes.includes("od"));
  assert.equal(byId.over.classes.includes("wt"), false);
  assert.equal(byId.over.tooltip, "Tue Oct 20");
  assert.equal(byId.over.dateLabel, "Oct 20");

  assert.equal(byId.today.overdue, false);
  assert.equal(byId.today.classes.includes("od"), false);
  assert.equal(byId.today.classes.includes("wt"), false);
  assert.equal(byId.today.tooltip, "Sun Nov 1");

  assert.equal(byId.later.overdue, false);
  assert.equal(byId.later.classes.includes("od"), false);

  assert.equal(byId.wait.waiting, true);
  assert.equal(byId.wait.overdue, false);
  assert.ok(byId.wait.classes.includes("wt"));
  assert.equal(byId.wait.classes.includes("od"), false);
  assert.equal(byId.wait.tooltip, "Wed Nov 4 · Waiting on Alex Rivera");

  assert.equal(byId.both.overdue, true);
  assert.equal(byId.both.waiting, true);
  assert.ok(byId.both.classes.includes("od"));
  assert.ok(byId.both.classes.includes("wt"));
  assert.equal(byId.both.tooltip, "Thu Oct 22 · Waiting on Riley Cho");
  assert.equal(byId.both.colorKey, "n");

  assert.equal(byId["wait-empty"].waiting, true);
  assert.ok(byId["wait-empty"].classes.includes("wt"));
  assert.equal(byId["wait-empty"].waitingOn, "");
  assert.equal(byId["wait-empty"].tooltip, "Thu Nov 5");

  assert.equal(byId.named.waiting, false);
  assert.equal(byId.named.classes.includes("wt"), false);
  assert.equal(byId.named.tooltip, "Tue Nov 3 · Waiting on Jordan Hale");

  model.rows.forEach((row) => assert.equal(row.span, 1));
});

test("undated count is open top-level tasks without a due date", () => {
  const model = buildGantt([
    task({ id: "dated", due: "2026-11-04" }),
    task({ id: "null-due", due: null }),
    task({ id: "empty-due", due: "" }),
    task({ id: "missing" }),
    task({ id: "bad", due: "2026-02-31" }),
    task({ id: "text", due: "next week" }),
    task({ id: "done-undated", status: "done", due: null }),
    task({ id: "done-dated", status: "done", due: "2026-10-01" }),
    task({ id: "child-undated", parent: "dated", due: null }),
    task({ id: "child-dated", parent: "dated", due: "2026-11-08" }),
    task({ id: "orphan-undated", parent: "missing-parent", due: "   " }),
    task({ id: "whitespace", due: "  2026-11-02  " }),
  ], { today: "2026-11-01" });

  assert.equal(model.undated, 6);
  assert.equal(model.undatedLabel, "6 with no date");
  assert.deepEqual(ids(model), ["whitespace", "dated"]);
  assert.equal(model.rows.find((row) => row.id === "whitespace").due, "2026-11-02");
});
