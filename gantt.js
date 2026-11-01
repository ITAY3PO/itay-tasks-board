"use strict";

// Pure Gantt model: which open top-level tasks get a row, the day columns,
// and the overdue / waiting marks. No DOM and no network.
// Loaded as a classic script in the browser and as CommonJS in unit tests.
(function (root, factory) {
  function loadBoard() {
    if (root.ItayBoard) return root.ItayBoard;
    if (typeof require === "function") {
      try {
        return require("./schedule.js");
      } catch (error) {
        return {};
      }
    }
    return {};
  }

  const api = factory(loadBoard);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ItayGantt = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (loadBoard) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const PROJECTS = {
    chat: { key: "c", color: "#4466e6" },
    umi: { key: "p", color: "#8b3fd9" },
    "travel town": { key: "g", color: "#1f9d55" },
  };
  const NEUTRAL = { key: "n", color: "#6b7280" };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function parseYMD(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? "" : value).trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
    const weekdayIndex = utc.getUTCDay();
    return {
      year,
      month,
      day,
      key: `${match[1]}-${match[2]}-${match[3]}`,
      weekday: WEEKDAYS[weekdayIndex],
      weekend: weekdayIndex === 5 || weekdayIndex === 6,
    };
  }

  function addDays(parsed, days) {
    const utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
    return parseYMD(`${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`);
  }

  function daysBetween(from, to) {
    const start = Date.UTC(from.year, from.month - 1, from.day);
    const end = Date.UTC(to.year, to.month - 1, to.day);
    return Math.round((end - start) / 86400000);
  }

  function taskId(task) {
    if (!task || task.id == null) return "";
    if (typeof task.id === "string") return task.id.trim();
    if (typeof task.id === "number" || typeof task.id === "boolean") return String(task.id);
    return "";
  }

  function rawDue(task) {
    if (!task || typeof task !== "object") return "";
    if (typeof task.dueRaw === "string" && task.dueRaw.trim()) return task.dueRaw.trim();
    if (typeof task.due === "string" && task.due.trim()) return task.due.trim();
    return "";
  }

  function waitingOn(task) {
    const value = task && task.waiting_on;
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim();
  }

  function projectStyle(name) {
    const key = String(name == null ? "" : name).trim().toLowerCase();
    return PROJECTS[key] || NEUTRAL;
  }

  function parentMap(tasks) {
    const board = loadBoard() || {};
    if (typeof board.subtaskLinks === "function") return board.subtaskLinks(tasks).parentOf || {};
    return {};
  }

  function shortLabel(task) {
    const board = loadBoard() || {};
    if (typeof board.shortTitle === "function") return board.shortTitle(task);
    return String((task && task.title) || "").trim();
  }

  function dateLabel(parsed) {
    return `${MONTHS[parsed.month - 1]} ${parsed.day}`;
  }

  // Open top-level tasks only. A parent link counts when it names another
  // task in this list; a missing or unknown parent leaves the task top-level.
  // Each bar is one day, on the due date. `today` is YYYY-MM-DD.
  function buildGantt(tasks, options) {
    const source = Array.isArray(tasks) ? tasks.filter((task) => task && typeof task === "object") : [];
    const opts = options || {};
    const today = parseYMD(opts.today);
    const include = typeof opts.include === "function" ? opts.include : function () { return true; };
    const parents = parentMap(source);
    const seen = new Set();
    let undated = 0;
    const dated = [];

    source.forEach((task, index) => {
      const id = taskId(task);
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (parents[id]) return;
      if (task.status === "done") return;
      if (!include(task)) return;
      const due = parseYMD(rawDue(task));
      if (!due) {
        undated += 1;
        return;
      }
      dated.push({ task, index, id, due });
    });

    dated.sort((a, b) => (a.due.key < b.due.key ? -1 : a.due.key > b.due.key ? 1 : a.index - b.index));

    let start = null;
    let end = null;
    const days = [];
    if (dated.length) {
      const earliest = dated[0].due;
      const latest = dated[dated.length - 1].due;
      start = today && today.key < earliest.key ? today : earliest;
      end = latest;
      const count = daysBetween(start, end) + 1;
      for (let i = 0; i < count; i += 1) {
        const day = addDays(start, i);
        days.push({
          date: day.key,
          weekday: day.weekday,
          day: day.day,
          weekend: day.weekend,
          today: Boolean(today && day.key === today.key),
        });
      }
    }

    const rows = dated.map((item) => {
      const style = projectStyle(item.task.project);
      const overdue = Boolean(today && item.due.key < today.key);
      const waiting = item.task.status === "waiting";
      const who = waitingOn(item.task);
      const label = dateLabel(item.due);
      const classes = [style.key];
      if (overdue) classes.push("od");
      if (waiting) classes.push("wt");
      const dueText = `${item.due.weekday} ${label}`;
      return {
        id: item.id,
        title: typeof item.task.title === "string" ? item.task.title : "",
        shortTitle: shortLabel(item.task),
        project: item.task.project || "",
        color: style.color,
        colorKey: style.key,
        due: item.due.key,
        dateLabel: label,
        weekday: item.due.weekday,
        overdue,
        waiting,
        waitingOn: who,
        classes,
        span: 1,
        tooltip: who ? `${dueText} · Waiting on ${who}` : dueText,
        dayIndex: start ? daysBetween(start, item.due) : 0,
      };
    });

    const todayIndex = today ? days.findIndex((day) => day.date === today.key) : -1;
    return {
      today: today ? today.key : "",
      start: start ? start.key : "",
      end: end ? end.key : "",
      undated,
      undatedLabel: `${undated} with no date`,
      days,
      rows,
      todayIndex,
      todayFraction: todayIndex >= 0 ? (todayIndex + 0.5) / days.length : null,
    };
  }

  return {
    buildGantt,
    projectStyle,
    parseYMD,
    PROJECTS,
    NEUTRAL,
  };
});
