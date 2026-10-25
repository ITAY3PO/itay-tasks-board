"use strict";

// Pure scheduling and Linear-link helpers. No DOM, no network.
// Loaded as a classic script in the browser and as CommonJS in unit tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ItayBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_TIMEZONE = "Asia/Jerusalem";
  const DEFAULT_WORKDAY = { start: "09:00", end: "19:00" };
  const DEFAULT_SLOT_MINUTES = 30;
  const WORKDAY_WEEKDAYS = new Set(["Sun", "Mon", "Tue", "Wed", "Thu"]);
  const CALENDAR_NOTE = "Calendar not loaded, meetings not excluded";
  const NOT_WORKDAY_NOTE = "Not a workday";
  const LINEAR_ID = /\b[A-Z][A-Z0-9]+-\d+\b/g;

  function zonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    const bag = {};
    fmt.formatToParts(date).forEach((part) => {
      if (part.type !== "literal") bag[part.type] = part.value;
    });
    const hour = bag.hour === "24" ? "00" : bag.hour;
    return {
      year: bag.year,
      month: bag.month,
      day: bag.day,
      hour,
      minute: bag.minute,
      second: bag.second || "00",
      weekday: bag.weekday,
    };
  }

  function formatZonedDate(date, timeZone) {
    const parts = zonedParts(date, timeZone || DEFAULT_TIMEZONE);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function zonedDateTime(ymd, hm, timeZone) {
    const zone = timeZone || DEFAULT_TIMEZONE;
    const [year, month, day] = String(ymd).split("-").map(Number);
    const [hour, minute] = String(hm).split(":").map(Number);
    const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
    let utc = wall;
    for (let pass = 0; pass < 2; pass += 1) {
      const parts = zonedParts(new Date(utc), zone);
      const asUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second || 0),
      );
      utc = wall - (asUtc - utc);
    }
    return new Date(utc);
  }

  function parseHM(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function formatHM(minutes) {
    const rounded = Math.max(0, Math.round(minutes));
    const hour = Math.floor(rounded / 60) % 24;
    const minute = rounded % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function parseInstant(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function minutesOnDate(date, ymd, timeZone, role) {
    const parts = zonedParts(date, timeZone);
    const stamp = `${parts.year}-${parts.month}-${parts.day}`;
    const mins = Number(parts.hour) * 60 + Number(parts.minute);
    if (stamp === ymd) return mins;
    if (role === "start") return stamp < ymd ? 0 : null;
    if (stamp > ymd) return 24 * 60;
    return null;
  }

  function localIntervalOnDate(startIso, endIso, ymd, timeZone, fallbackMinutes) {
    const startDate = parseInstant(startIso);
    if (!startDate) return null;
    let endDate = parseInstant(endIso);
    if (!endDate || endDate <= startDate) {
      if (!fallbackMinutes) return null;
      endDate = new Date(startDate.getTime() + fallbackMinutes * 60000);
    }
    const start = minutesOnDate(startDate, ymd, timeZone, "start");
    const end = minutesOnDate(endDate, ymd, timeZone, "end");
    if (start == null || end == null || end <= start) return null;
    return { start, end };
  }

  function intersect(start, end, lo, hi) {
    const a = Math.max(start, lo);
    const b = Math.min(end, hi);
    return b > a ? { start: a, end: b } : null;
  }

  function mergeIntervals(intervals) {
    const sorted = intervals
      .filter((item) => item && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    sorted.forEach((item) => {
      const last = merged[merged.length - 1];
      if (!last || item.start > last.end) merged.push({ start: item.start, end: item.end });
      else last.end = Math.max(last.end, item.end);
    });
    return merged;
  }

  function priorityIndex(priority, priorities) {
    const order = priorities && priorities.length ? priorities : ["urgent", "high", "medium", "low"];
    const index = order.indexOf(priority);
    return index === -1 ? order.length + 1 : index;
  }

  function dueValue(task) {
    if (task.dueDate instanceof Date && !Number.isNaN(task.dueDate.getTime())) return task.dueDate.getTime();
    if (typeof task.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.due)) return Date.parse(`${task.due}T00:00:00Z`);
    return Number.POSITIVE_INFINITY;
  }

  function createdValue(task) {
    if (!task || !task.created) return Number.POSITIVE_INFINITY;
    const parsed = Date.parse(task.created);
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  }

  const QUADRANT_LABEL = {
    Q1: "Q1 Do",
    Q2: "Q2 Schedule",
    Q3: "Q3 Delegate",
    Q4: "Q4 Drop",
  };

  function quadrantKey(task) {
    const value = String((task && task.quadrant) || "").trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(QUADRANT_LABEL, value) ? value : "";
  }

  // Q1, then Q2, then Q3, then no quadrant. Q4 is not scheduled.
  function agendaQuadrantRank(task) {
    const key = quadrantKey(task);
    if (key === "Q1") return 0;
    if (key === "Q2") return 1;
    if (key === "Q3") return 2;
    return 3;
  }

  function compareAgendaTasks(a, b, priorities) {
    const byQuadrant = agendaQuadrantRank(a) - agendaQuadrantRank(b);
    if (byQuadrant) return byQuadrant;
    const byPriority = priorityIndex(a.priority, priorities) - priorityIndex(b.priority, priorities);
    if (byPriority) return byPriority;
    const byDue = dueValue(a) - dueValue(b);
    if (byDue) return byDue;
    return createdValue(a) - createdValue(b);
  }

  function workdayMinutes(calendarToday, calendar) {
    const raw = calendarToday && calendar ? calendar.workday : null;
    const start = parseHM(raw && raw.start);
    const end = parseHM(raw && raw.end);
    if (start == null || end == null || end <= start) {
      return { start: parseHM(DEFAULT_WORKDAY.start), end: parseHM(DEFAULT_WORKDAY.end) };
    }
    return { start, end };
  }

  function buildAgenda(input) {
    const source = input || {};
    const now = source.now instanceof Date ? new Date(source.now.getTime()) : new Date(source.now || Date.now());
    const slotMinutes = Number(source.slotMinutes) > 0 ? Math.round(Number(source.slotMinutes)) : DEFAULT_SLOT_MINUTES;
    const calendar = source.calendar && typeof source.calendar === "object" && !Array.isArray(source.calendar) ? source.calendar : null;
    let timezone = (calendar && typeof calendar.timezone === "string" && calendar.timezone.trim()) || source.timezone || DEFAULT_TIMEZONE;
    let parts;
    try {
      parts = zonedParts(now, timezone);
    } catch {
      timezone = DEFAULT_TIMEZONE;
      parts = zonedParts(now, timezone);
    }
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const nowMin = Number(parts.hour) * 60 + Number(parts.minute);
    const isWorkday = WORKDAY_WEEKDAYS.has(parts.weekday);
    const calendarToday = Boolean(calendar && calendar.date === today);
    const bounds = workdayMinutes(calendarToday, calendar);
    const cursor = nowMin <= bounds.start ? bounds.start : Math.min(nowMin, bounds.end);

    const meetings = [];
    if (calendarToday && Array.isArray(calendar.busy)) {
      calendar.busy.forEach((block) => {
        if (!block || typeof block !== "object") return;
        const interval = localIntervalOnDate(block.start, block.end, today, timezone, 0);
        if (!interval) return;
        // A block may start before the workday (for example 08:00) or run past the end.
        // Only the overlap is shown and only that overlap consumes free time.
        const visible = intersect(interval.start, interval.end, bounds.start, bounds.end);
        if (!visible) return;
        meetings.push({
          kind: "meeting",
          title: meetingTitle(block.title),
          start: visible.start,
          end: visible.end,
        });
      });
    }

    const priorities = Array.isArray(source.priorities) ? source.priorities : [];
    const tasks = Array.isArray(source.tasks) ? source.tasks.filter((task) => task && typeof task === "object") : [];
    const open = tasks.filter((task) => task.status !== "done" && quadrantKey(task) !== "Q4");
    const sorted = open.slice().sort((a, b) => compareAgendaTasks(a, b, priorities));

    const pins = [];
    const flexible = [];
    sorted.forEach((task) => {
      const scheduled = task.scheduled;
      const startIso = scheduled && typeof scheduled === "object" ? scheduled.start : "";
      if (startIso) {
        const interval = localIntervalOnDate(startIso, scheduled.end, today, timezone, slotMinutes);
        if (interval) {
          pins.push({ task, start: interval.start, end: interval.end });
          return;
        }
      }
      flexible.push(task);
    });

    const blockers = [];
    meetings.forEach((meeting) => {
      const clipped = intersect(meeting.start, meeting.end, cursor, bounds.end);
      if (clipped) blockers.push(clipped);
    });
    pins.forEach((pin) => {
      const clipped = intersect(pin.start, pin.end, cursor, bounds.end);
      if (clipped) blockers.push(clipped);
    });

    const gaps = [];
    let pointer = cursor;
    mergeIntervals(blockers).forEach((block) => {
      if (block.start > pointer) gaps.push({ start: pointer, end: block.start });
      pointer = Math.max(pointer, block.end);
    });
    if (pointer < bounds.end) gaps.push({ start: pointer, end: bounds.end });

    const placed = [];
    const overflow = [];
    let gapIndex = 0;
    let gapCursor = gaps.length ? gaps[0].start : bounds.end;
    flexible.forEach((task) => {
      let fitted = false;
      while (gapIndex < gaps.length) {
        const gap = gaps[gapIndex];
        if (gapCursor < gap.start) gapCursor = gap.start;
        if (gapCursor + slotMinutes <= gap.end) {
          placed.push({ task, start: gapCursor, end: gapCursor + slotMinutes });
          gapCursor += slotMinutes;
          fitted = true;
          break;
        }
        gapIndex += 1;
        gapCursor = gapIndex < gaps.length ? gaps[gapIndex].start : bounds.end;
      }
      if (!fitted) overflow.push(task);
    });

    const items = [];
    meetings.forEach((meeting) => {
      items.push({
        kind: "meeting",
        title: meeting.title,
        start: meeting.start,
        end: meeting.end,
        startLabel: formatHM(meeting.start),
        endLabel: formatHM(meeting.end),
      });
    });
    pins.forEach((pin) => {
      items.push({
        kind: "task",
        pinned: true,
        task: pin.task,
        id: pin.task.id,
        title: pin.task.title,
        start: pin.start,
        end: pin.end,
        startLabel: formatHM(pin.start),
        endLabel: formatHM(pin.end),
      });
    });
    placed.forEach((item) => {
      items.push({
        kind: "task",
        pinned: false,
        task: item.task,
        id: item.task.id,
        title: item.task.title,
        start: item.start,
        end: item.end,
        startLabel: formatHM(item.start),
        endLabel: formatHM(item.end),
      });
    });
    items.sort((a, b) => a.start - b.start || a.end - b.end || (a.kind === "meeting" ? -1 : 1));

    return {
      date: today,
      weekday: parts.weekday,
      timezone,
      workday: { start: formatHM(bounds.start), end: formatHM(bounds.end) },
      isWorkday,
      notWorkdayNote: isWorkday ? null : NOT_WORKDAY_NOTE,
      calendarNote: calendarToday ? null : CALENDAR_NOTE,
      slotMinutes,
      items,
      overflow,
    };
  }

  function meetingTitle(value) {
    if (typeof value !== "string") return "Busy";
    const text = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    return text || "Busy";
  }

  function formatAgendaText(agenda) {
    const lines = [
      `Daily agenda — ${agenda.date} (${agenda.weekday})`,
      `Workday ${agenda.workday.start}-${agenda.workday.end} ${agenda.timezone}`,
    ];
    if (agenda.notWorkdayNote) lines.push(agenda.notWorkdayNote);
    if (agenda.calendarNote) lines.push(agenda.calendarNote);
    lines.push("");
    if (!agenda.items.length) lines.push("Nothing scheduled.");
    agenda.items.forEach((item) => {
      if (item.kind === "meeting") {
        lines.push(`${item.startLabel}-${item.endLabel}  ${item.title} (meeting)`);
        return;
      }
      const task = item.task || {};
      const bits = [QUADRANT_LABEL[quadrantKey(task)] || "", task.project, task.priority].filter(Boolean);
      const suffix = bits.length ? ` — ${bits.join(" · ")}` : "";
      const pinned = item.pinned ? " (scheduled)" : "";
      lines.push(`${item.startLabel}-${item.endLabel}  ${task.title || item.title || "Untitled task"}${suffix}${pinned}`);
    });
    lines.push("");
    lines.push("Didn't fit today");
    if (!agenda.overflow.length) lines.push("-");
    else {
      agenda.overflow.forEach((task) => {
        const project = task.project ? ` (${task.project})` : "";
        const label = QUADRANT_LABEL[quadrantKey(task)] || "";
        const quad = label ? ` — ${label}` : "";
        lines.push(`- ${task.title || "Untitled task"}${project}${quad}`);
      });
    }
    return lines.join("\n");
  }

  function collectLinearLinks(task) {
    const links = [];
    const seen = new Set();
    function add(id, url) {
      const clean = String(id || "").trim();
      if (!clean) return;
      const key = clean.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      const href = String(url || "").trim();
      links.push({
        id: clean,
        url: href || `https://linear.app/issue/${encodeURIComponent(clean)}`,
      });
    }
    const explicit = task && Array.isArray(task.linear) ? task.linear : [];
    explicit.forEach((item) => {
      if (!item || typeof item !== "object") return;
      add(item.id, item.url);
    });
    const blob = [task && task.title, task && task.notes, task && task.source].filter((part) => typeof part === "string").join("\n");
    const matches = blob.match(LINEAR_ID) || [];
    matches.forEach((id) => add(id));
    return links;
  }

  return {
    DEFAULT_TIMEZONE,
    DEFAULT_WORKDAY,
    CALENDAR_NOTE,
    NOT_WORKDAY_NOTE,
    buildAgenda,
    formatAgendaText,
    collectLinearLinks,
    formatZonedDate,
    zonedDateTime,
    quadrantKey,
  };
});
