"use strict";

// Public board. Real tasks are fetched in the browser from a private repo.
// The token lives in localStorage and is sent only to api.github.com.
const CONFIG = {
  owner: "ITAY3PO",
  repo: "itay-tasks",
  path: "tasks.json",
  branch: "main",
};

const GITHUB_API_VERSION = "2022-11-28";
const TOKEN_KEY = "itay-tasks.token";
const UI_KEY = "itay-tasks.ui";
const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

const PROJECT_COLORS = {
  "Moon Active": "#0073ea",
  "Travel Town": "#00c875",
  UMI: "#a25ddc",
  Personal: "#ff642e",
};

const PALETTE = ["#0073ea", "#00c875", "#a25ddc", "#ff642e", "#175a63", "#ff158a", "#037f4c", "#7f5347", "#579bfc", "#bb3354"];

const QUADRANTS = [
  { key: "Q1", name: "Do", subtitle: "Urgent + important", color: "#e2445c" },
  { key: "Q2", name: "Schedule", subtitle: "Important, not urgent", color: "#0073ea" },
  { key: "Q3", name: "Delegate", subtitle: "Urgent, not important", color: "#fdab3d" },
  { key: "Q4", name: "Drop", subtitle: "Neither urgent nor important", color: "#0f6e6b" },
];

const QUADRANT_FILTERS = ["Q1", "Q2", "Q3", "Q4", "unsorted"];

const VIEWS = ["table", "kanban", "manager", "eisenhower"];

const TABLE_COLUMNS = [
  { key: "title", label: "Task", className: "col-task" },
  { key: "project", label: "Project", className: "col-project" },
  { key: "status", label: "Status", className: "col-status" },
  { key: "priority", label: "Priority", className: "col-priority" },
  { key: "quadrant", label: "Quadrant", className: "col-quadrant" },
  { key: "due", label: "Due", className: "col-due" },
  { key: "waiting", label: "Waiting on", className: "col-waiting" },
];

const ICONS = {
  chevron: ["M6 9l6 6 6-6"],
  search: ["M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M20 20l-3.5-3.5"],
  refresh: ["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  moon: ["M21 14.5A8.5 8.5 0 0 1 10.5 3 7 7 0 1 0 21 14.5z"],
  sun: [
    "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
    "M12 2v2",
    "M12 20v2",
    "M4.9 4.9l1.4 1.4",
    "M17.7 17.7l1.4 1.4",
    "M2 12h2",
    "M20 12h2",
    "M4.9 19.1l1.4-1.4",
    "M17.7 6.3l1.4-1.4",
  ],
};

const state = {
  mode: "loading",
  demo: false,
  token: "",
  data: null,
  error: null,
  inlineError: null,
  storageWarning: "",
  setupMessage: "",
  refreshing: false,
  filters: { q: "", projects: [], status: "", priority: "", quadrant: "", hideDone: false },
  sort: { key: "", dir: "asc" },
  groupBy: "status",
  view: "table",
  theme: "light",
  collapsed: new Set(["done"]),
  openTaskId: null,
  agendaOpen: false,
  agendaText: "",
  calendar: null,
  dataVersion: 0,
  returnFocusId: null,
  projectMenuOpen: false,
  forgetArmed: false,
  forgetTimer: 0,
  liveMessage: "",
};

let requestId = 0;

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

function parseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readUI() {
  const parsed = parseJSON(storage.get(UI_KEY));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function writeUI(partial) {
  storage.set(UI_KEY, JSON.stringify({ ...readUI(), ...partial }));
}

function asText(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(asText).filter(Boolean);
}

function humanize(value) {
  const text = String(value).replace(/[_-]+/g, " ").trim();
  if (!text) return "Unknown";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

function firstDayOfWeek() {
  try {
    const locale = new Intl.Locale(navigator.language);
    const info = typeof locale.getWeekInfo === "function" ? locale.getWeekInfo() : locale.weekInfo;
    if (info && info.firstDay) return info.firstDay;
  } catch {
    /* use Monday */
  }
  return 1;
}

function startOfWeek(today) {
  const first = firstDayOfWeek();
  const firstJs = first % 7;
  const diff = (today.getDay() - firstJs + 7) % 7;
  return addDays(startOfDay(today), -diff);
}

function inThisWeek(date) {
  const start = startOfWeek(new Date());
  const end = addDays(start, 6);
  const day = startOfDay(date);
  return day >= start && day <= end;
}

function formatDue(date) {
  const today = startOfDay(new Date());
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const opts = { month: "short", day: "numeric" };
  if (date.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  if (Math.abs(diff) <= 6) opts.weekday = "short";
  return date.toLocaleDateString(undefined, opts);
}

function formatTimestamp(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = parseISODate(text);
    return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : text;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbHex(r, g, b) {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function safeHex(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex || "") ? hex.toLowerCase() : "#c4c4c4";
}

function titleColor(hex) {
  const color = safeHex(hex);
  const { r, g, b } = hexToRgb(color);
  if (luminance(r, g, b) < 0.45) return color;
  return rgbHex(Math.round(r * 0.45), Math.round(g * 0.45), Math.round(b * 0.45));
}

function pillFg(hex) {
  const color = safeHex(hex);
  if (color === "#00c875") return "#053322";
  const { r, g, b } = hexToRgb(color);
  return luminance(r, g, b) > 0.62 ? "#323338" : "#ffffff";
}

function paletteColor(seed) {
  if (PROJECT_COLORS[seed]) return PROJECT_COLORS[seed];
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function statusMeta(status) {
  const known = {
    todo: { label: "To do", pill: "To do", bar: "#c4c4c4" },
    in_progress: { label: "In progress", pill: "Working on it", bar: "#fdab3d" },
    waiting: { label: "Waiting on others", pill: "Waiting", bar: "#a25ddc" },
    done: { label: "Done", pill: "Done", bar: "#00c875" },
    unknown: { label: "No status", pill: "No status", bar: "#98a2b3" },
  };
  const base = known[status] || { label: humanize(status), pill: humanize(status), bar: "#98a2b3" };
  return { ...base, title: titleColor(base.bar) };
}

function priorityMeta(priority) {
  const known = {
    urgent: { label: "Urgent", bar: "#e2445c" },
    high: { label: "High", bar: "#fdab3d" },
    medium: { label: "Medium", bar: "#ffcb00" },
    low: { label: "Low", bar: "#c4c4c4" },
  };
  if (!priority) return { label: "No priority", bar: "#e6e9ef" };
  return known[priority] || { label: humanize(priority), bar: "#e6e9ef" };
}

function quadrantInfo(key) {
  return QUADRANTS.find((item) => item.key === key) || null;
}

function quadrantBadge(task) {
  const info = quadrantInfo(task && task.quadrant);
  if (!info) return el("span", { class: "quad-badge is-unsorted", text: "Unsorted" });
  const badge = el("span", { class: `quad-badge quad-${info.key.toLowerCase()}`, text: `${info.key} ${info.name}` });
  const color = safeHex(info.color);
  badge.style.background = color;
  badge.style.color = pillFg(color);
  return badge;
}

function groupMeta(key) {
  if (currentGroupBy() === "status") return statusMeta(key);
  const bar = paletteColor(key);
  return { label: key, pill: key, bar, title: titleColor(bar) };
}

function normalizeLinear(value) {
  if (!Array.isArray(value)) return [];
  const links = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const id = asText(item.id);
    if (!id) return;
    links.push({ id, url: asText(item.url) });
  });
  return links;
}

function normalizeScheduled(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const start = asText(value.start);
  if (!start) return null;
  return { start, end: asText(value.end) };
}

function normalizeQuadrant(value) {
  const text = asText(value).toUpperCase();
  return QUADRANTS.some((item) => item.key === text) ? text : "";
}

function cleanQuadrantFilter(value) {
  return QUADRANT_FILTERS.includes(value) ? value : "";
}

function normalizeView(value) {
  return VIEWS.includes(value) ? value : "table";
}

function normalizeCalendar(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const busy = [];
  if (Array.isArray(data.busy)) {
    data.busy.forEach((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return;
      const start = asText(block.start);
      const end = asText(block.end);
      if (!start || !end) return;
      busy.push({ start, end, title: asText(block.title) || "Busy" });
    });
  }
  const workday = data.workday && typeof data.workday === "object" && !Array.isArray(data.workday)
    ? { start: asText(data.workday.start), end: asText(data.workday.end) }
    : null;
  return {
    date: asText(data.date),
    timezone: asText(data.timezone) || "Asia/Jerusalem",
    workday,
    busy,
    updated: asText(data.updated),
  };
}

function normalize(data) {
  const warnings = [];
  let source = data;
  if (Array.isArray(data)) source = { tasks: data };
  if (!source || typeof source !== "object") {
    const error = new Error("parse");
    error.kind = "parse";
    throw error;
  }
  let taskList = source.tasks;
  if (taskList == null) taskList = [];
  if (!Array.isArray(taskList)) {
    warnings.push("The tasks field is not a list, so no tasks are shown.");
    taskList = [];
  }
  const seen = new Set();
  const tasks = [];
  taskList.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      warnings.push(`Skipped item ${index + 1} because it was not a task object.`);
      return;
    }
    let id = asText(raw.id) || `task-${index + 1}`;
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    const dueRaw = asText(raw.due);
    tasks.push({
      id,
      title: asText(raw.title) || "Untitled task",
      status: asText(raw.status) || "unknown",
      priority: asText(raw.priority),
      dueRaw,
      dueDate: parseISODate(dueRaw),
      project: asText(raw.project) || "Unassigned",
      waiting_on: asText(raw.waiting_on),
      source: asText(raw.source),
      notes: asText(raw.notes),
      created: asText(raw.created),
      updated: asText(raw.updated),
      tldr: asText(raw.tldr),
      linear: normalizeLinear(raw.linear),
      scheduled: normalizeScheduled(raw.scheduled),
      quadrant: normalizeQuadrant(raw.quadrant),
      parent: asText(raw.parent),
    });
  });
  return {
    updated: asText(source.updated),
    projects: asStringList(source.projects),
    statuses: asStringList(source.statuses),
    priorities: asStringList(source.priorities),
    tasks,
    warnings,
  };
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parsePayload(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!clean) {
    const error = new Error("empty");
    error.kind = "parse";
    throw error;
  }
  let data;
  try {
    data = JSON.parse(clean);
  } catch {
    const error = new Error("invalid json");
    error.kind = "parse";
    throw error;
  }
  if (data && data.encoding === "base64" && typeof data.content === "string" && !Array.isArray(data.tasks)) {
    try {
      data = JSON.parse(decodeBase64Utf8(data.content));
    } catch {
      const error = new Error("invalid json");
      error.kind = "parse";
      throw error;
    }
  }
  return normalize(data);
}

function parseCalendar(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!clean) return null;
  let data;
  try {
    data = JSON.parse(clean);
  } catch {
    return null;
  }
  if (data && data.encoding === "base64" && typeof data.content === "string" && data.date == null && data.busy == null) {
    try {
      data = JSON.parse(decodeBase64Utf8(data.content));
    } catch {
      return null;
    }
  }
  return normalizeCalendar(data);
}

function classify(error) {
  if (error && error.kind === "parse") {
    return { kind: "parse", message: "The tasks file couldn't be read. It should be JSON with a tasks list." };
  }
  const status = error && error.status;
  if (status === 401 || status === 403 || status === 404) {
    if (status === 403 && /rate limit/i.test(error.detail || "")) {
      return { kind: "rate", message: "GitHub rate limit reached. Wait a minute and try again.", status };
    }
    return {
      kind: "auth",
      message: "The token is invalid or lacks access.",
      hint: "Use a fine-grained token whose resource owner is ITAY3PO, with only itay-tasks selected and Contents set to Read-only.",
      status,
    };
  }
  if (typeof status === "number") {
    return { kind: "network", message: `GitHub responded with ${status}. Try again in a moment.`, status };
  }
  return { kind: "network", message: "Couldn't reach GitHub. Check your connection and try again." };
}

async function fetchRemote(token) {
  const path = CONFIG.path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(CONFIG.owner)}/${encodeURIComponent(CONFIG.repo)}/contents/${path}`);
  url.searchParams.set("ref", CONFIG.branch);
  const response = await fetch(url.href, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      /* ignore */
    }
    const error = new Error("request failed");
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return parsePayload(await response.text());
}

async function fetchCalendar(token) {
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(CONFIG.owner)}/${encodeURIComponent(CONFIG.repo)}/contents/calendar.json`);
  url.searchParams.set("ref", CONFIG.branch);
  try {
    const response = await fetch(url.href, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });
    if (!response.ok) return null;
    return parseCalendar(await response.text());
  } catch {
    return null;
  }
}

const FIXTURE_DAY = "2026-10-25";

function shiftFixtureStamp(value, today) {
  if (typeof value !== "string" || !value.includes(FIXTURE_DAY)) return value;
  return value.split(FIXTURE_DAY).join(today);
}

function alignDemoBoard(data, calendar) {
  const zone = (calendar && calendar.timezone) || "Asia/Jerusalem";
  let today = FIXTURE_DAY;
  try {
    today = globalThis.ItayBoard.formatZonedDate(new Date(), zone);
  } catch {
    today = FIXTURE_DAY;
  }
  if (today === FIXTURE_DAY) return { data, calendar };
  data.tasks.forEach((task) => {
    if (task.dueRaw === FIXTURE_DAY) {
      task.dueRaw = today;
      task.dueDate = parseISODate(today);
    }
    if (task.scheduled) {
      task.scheduled = {
        start: shiftFixtureStamp(task.scheduled.start, today),
        end: shiftFixtureStamp(task.scheduled.end, today),
      };
    }
  });
  if (calendar && calendar.date === FIXTURE_DAY) {
    calendar = {
      ...calendar,
      date: today,
      busy: (calendar.busy || []).map((block) => ({
        ...block,
        start: shiftFixtureStamp(block.start, today),
        end: shiftFixtureStamp(block.end, today),
      })),
    };
  }
  return { data, calendar };
}

function loadPrefs() {
  const params = new URLSearchParams(location.search);
  const stored = readUI();
  state.demo = params.get("demo") === "1";
  state.theme = (params.get("theme") || stored.theme) === "dark" ? "dark" : "light";
  const requestedView = params.get("view") || stored.view;
  state.view = normalizeView(requestedView);
  state.groupBy = (params.get("group") || stored.groupBy) === "project" ? "project" : "status";
  const urlFilters = ["q", "project", "status", "priority", "quadrant", "hideDone"].some((key) => params.has(key));
  if (urlFilters) {
    state.filters = {
      q: params.get("q") || "",
      projects: params.getAll("project").filter(Boolean),
      status: params.get("status") || "",
      priority: params.get("priority") || "",
      quadrant: cleanQuadrantFilter(params.get("quadrant") || ""),
      hideDone: params.get("hideDone") === "1",
    };
  } else {
    state.filters = {
      q: typeof stored.q === "string" ? stored.q : "",
      projects: Array.isArray(stored.projects) ? stored.projects.filter((item) => typeof item === "string") : [],
      status: typeof stored.status === "string" ? stored.status : "",
      priority: typeof stored.priority === "string" ? stored.priority : "",
      quadrant: cleanQuadrantFilter(typeof stored.quadrant === "string" ? stored.quadrant : ""),
      hideDone: typeof stored.hideDone === "boolean" ? stored.hideDone : true,
    };
  }
  const activeGroup = state.view === "manager" ? "project" : state.groupBy;
  const saved = stored.collapsed && Array.isArray(stored.collapsed[activeGroup])
    ? stored.collapsed[activeGroup].filter((key) => typeof key === "string")
    : null;
  state.collapsed = new Set(saved || (activeGroup === "status" ? ["done"] : []));
  state.token = storage.get(TOKEN_KEY) || "";
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.demo) params.set("demo", "1");
  const filters = state.filters;
  if (filters.q) params.set("q", filters.q);
  filters.projects.forEach((project) => params.append("project", project));
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.quadrant) params.set("quadrant", filters.quadrant);
  if (filters.hideDone) params.set("hideDone", "1");
  if (state.groupBy !== "status") params.set("group", state.groupBy);
  if (state.view !== "table") params.set("view", state.view);
  if (state.theme === "dark") params.set("theme", "dark");
  const qs = params.toString();
  const next = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(null, "", next);
  }
  const current = readUI();
  writeUI({
    theme: state.theme,
    view: state.view,
    groupBy: state.groupBy,
    q: filters.q,
    projects: filters.projects,
    status: filters.status,
    priority: filters.priority,
    quadrant: filters.quadrant,
    hideDone: filters.hideDone,
    collapsed: {
      ...(current.collapsed || {}),
      [currentGroupBy()]: [...state.collapsed],
    },
  });
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme === "dark" ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.theme === "dark" ? "#181b34" : "#f6f7fb";
}

function setTitle() {
  if (state.mode === "setup") document.title = "Connect · Itay's tasks";
  else if (state.mode === "error") document.title = "Couldn't load · Itay's tasks";
  else if (state.demo) document.title = "Demo · Itay's tasks";
  else document.title = "Itay's tasks";
}

function currentGroupBy() {
  return state.view === "manager" ? "project" : state.groupBy;
}

function filtersActive() {
  const filters = state.filters;
  return Boolean(filters.q || filters.status || filters.priority || filters.quadrant || filters.projects.length);
}

function matchesFilter(task) {
  const filters = state.filters;
  if (filters.hideDone && task.status === "done") return false;
  if (filters.status && task.status !== filters.status) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (filters.quadrant === "unsorted" && task.quadrant) return false;
  if (filters.quadrant && filters.quadrant !== "unsorted" && task.quadrant !== filters.quadrant) return false;
  if (filters.projects.length && !filters.projects.includes(task.project)) return false;
  const query = filters.q.trim().toLowerCase();
  if (query) {
    const linearIds = (task.linear || []).map((item) => item.id).join(" ");
    const quad = quadrantInfo(task.quadrant);
    const haystack = [task.title, task.tldr, task.notes, task.waiting_on, task.source, linearIds, task.quadrant, quad && quad.name].join("\n").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function priorityRank(priority) {
  const order = state.data.priorities.length ? state.data.priorities : ["urgent", "high", "medium", "low"];
  const index = order.indexOf(priority);
  return index === -1 ? order.length + 1 : index;
}

function statusRank(status) {
  const order = state.data.statuses.length ? state.data.statuses : ["todo", "in_progress", "waiting", "done"];
  const index = order.indexOf(status);
  return index === -1 ? order.length + 1 : index;
}

function quadrantSortRank(quadrant) {
  const index = QUADRANTS.findIndex((item) => item.key === quadrant);
  return index === -1 ? QUADRANTS.length : index;
}

function compareColumn(a, b, key) {
  if (key === "title") return a.title.localeCompare(b.title);
  if (key === "project") return a.project.localeCompare(b.project);
  if (key === "status") return statusRank(a.status) - statusRank(b.status) || a.status.localeCompare(b.status);
  if (key === "priority") return priorityRank(a.priority) - priorityRank(b.priority);
  if (key === "quadrant") return quadrantSortRank(a.quadrant) - quadrantSortRank(b.quadrant);
  if (key === "due") {
    const aDue = a.dueDate ? a.dueDate.getTime() : Infinity;
    const bDue = b.dueDate ? b.dueDate.getTime() : Infinity;
    return aDue - bDue;
  }
  if (key === "waiting") return (a.waiting_on || "\uffff").localeCompare(b.waiting_on || "\uffff");
  return 0;
}

function compareDefault(a, b) {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority) return byPriority;
  const aDue = a.dueDate ? a.dueDate.getTime() : Infinity;
  const bDue = b.dueDate ? b.dueDate.getTime() : Infinity;
  if (aDue !== bDue) return aDue - bDue;
  return a.title.localeCompare(b.title);
}

function compareTasks(a, b) {
  if (state.view === "table" && state.sort.key) {
    const primary = compareColumn(a, b, state.sort.key);
    const directed = state.sort.dir === "desc" ? -primary : primary;
    if (directed) return directed;
  }
  return compareDefault(a, b);
}

function uniquePush(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function groupOrder() {
  if (currentGroupBy() === "project") {
    const known = [...state.data.projects];
    const extra = [];
    state.data.tasks.forEach((task) => {
      if (!known.includes(task.project)) uniquePush(extra, task.project);
    });
    extra.sort((a, b) => a.localeCompare(b));
    return [...known, ...extra];
  }
  const known = state.data.statuses.length ? [...state.data.statuses] : ["todo", "in_progress", "waiting", "done"];
  const extra = [];
  state.data.tasks.forEach((task) => {
    if (!known.includes(task.status)) uniquePush(extra, task.status);
  });
  extra.sort((a, b) => a.localeCompare(b));
  return [...known, ...extra];
}

function boardLinks() {
  const empty = { parentOf: {}, children: {}, progress: {} };
  const logic = globalThis.ItayBoard;
  if (!state.data || !logic || typeof logic.subtaskLinks !== "function") return empty;
  if (state.subtaskLinks && state.subtaskLinksVersion === state.dataVersion) return state.subtaskLinks;
  state.subtaskLinks = logic.subtaskLinks(state.data.tasks);
  state.subtaskLinksVersion = state.dataVersion;
  return state.subtaskLinks;
}

function linkedParent(task) {
  if (!task || !state.data) return null;
  const parentId = boardLinks().parentOf[task.id];
  if (!parentId) return null;
  return state.data.tasks.find((item) => item.id === parentId) || null;
}

function grouped() {
  const visible = state.data.tasks.filter(matchesFilter);
  const logic = globalThis.ItayBoard;
  const groupOf = (task) => (currentGroupBy() === "project" ? task.project : task.status);
  if (!logic || typeof logic.groupNested !== "function") {
    const buckets = new Map();
    groupOrder().forEach((key) => buckets.set(key, []));
    visible.forEach((task) => {
      const key = groupOf(task);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(task);
    });
    buckets.forEach((list) => list.sort(compareTasks));
    return [...buckets.entries()]
      .filter(([, list]) => list.length)
      .map(([key, list]) => [key, list.map((task) => ({ task, depth: 0 }))]);
  }
  return logic.groupNested({
    tasks: state.data.tasks,
    visible,
    groupOf,
    groupOrder: groupOrder(),
    compare: compareTasks,
  });
}

function summarize(tasks) {
  const today = startOfDay(new Date());
  const counts = { open: 0, overdue: 0, week: 0, waiting: 0, total: tasks.length };
  tasks.forEach((task) => {
    const done = task.status === "done";
    if (!done) counts.open += 1;
    if (!done && task.dueDate && startOfDay(task.dueDate) < today) counts.overdue += 1;
    if (!done && task.dueDate && inThisWeek(task.dueDate)) counts.week += 1;
    if (task.status === "waiting") counts.waiting += 1;
  });
  return counts;
}

function dueClass(task) {
  if (!task.dueDate || task.status === "done") return "";
  const diff = daysBetween(new Date(), task.dueDate);
  if (diff < 0) return "due-overdue";
  if (diff === 0) return "due-today";
  if (diff <= 3) return "due-soon";
  return "";
}

function projectOptions() {
  const keys = [];
  state.data.projects.forEach((name) => uniquePush(keys, name));
  const extra = [];
  state.data.tasks.forEach((task) => {
    if (!keys.includes(task.project)) uniquePush(extra, task.project);
  });
  extra.sort((a, b) => a.localeCompare(b));
  return [...keys, ...extra];
}

function statusOptions() {
  const keys = [];
  const known = state.data.statuses.length ? state.data.statuses : ["todo", "in_progress", "waiting", "done"];
  known.forEach((key) => uniquePush(keys, key));
  state.data.tasks.forEach((task) => uniquePush(keys, task.status));
  uniquePush(keys, state.filters.status);
  return [{ value: "", label: "All statuses" }, ...keys.map((key) => ({ value: key, label: statusMeta(key).label }))];
}

function priorityOptions() {
  const keys = [];
  const known = state.data.priorities.length ? state.data.priorities : ["urgent", "high", "medium", "low"];
  known.forEach((key) => uniquePush(keys, key));
  state.data.tasks.forEach((task) => uniquePush(keys, task.priority));
  uniquePush(keys, state.filters.priority);
  return [{ value: "", label: "All priorities" }, ...keys.map((key) => ({ value: key, label: priorityMeta(key).label }))];
}

function quadrantOptions() {
  return [
    { value: "", label: "All quadrants" },
    ...QUADRANTS.map((item) => ({ value: item.key, label: `${item.key} ${item.name}` })),
    { value: "unsorted", label: "Unsorted" },
  ];
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => [...part][0] || "").join("");
  return letters.toUpperCase() || "?";
}

function cssEscape(value) {
  if (window.CSS && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "dir") node.dir = value;
    else node.setAttribute(key, String(value));
  });
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("icon");
  (ICONS[name] || []).forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  });
  return svg;
}

function setBar(node, hex) {
  const color = safeHex(hex);
  node.style.setProperty("--bar", color);
  node.style.setProperty("--title", titleColor(color));
}

function logoMark() {
  const logo = el("span", { class: "logo", "aria-hidden": "true" });
  ["#0073ea", "#00c875", "#fdab3d", "#a25ddc"].forEach((color) => {
    const swatch = el("i");
    swatch.style.background = color;
    logo.append(swatch);
  });
  return logo;
}

function brandLockup() {
  const brand = el("div", { class: "brand" });
  const text = el("div");
  text.append(el("h1", { class: "brand-name", text: "Itay" }));
  text.append(el("div", { class: "brand-sub", text: "Task board" }));
  brand.append(logoMark(), text);
  return brand;
}

function pill(text, bg) {
  const node = el("span", { class: "pill", text });
  const color = safeHex(bg);
  node.style.background = color;
  node.style.color = pillFg(color);
  return node;
}

function statusPill(status) {
  const meta = statusMeta(status);
  return pill(meta.pill, meta.bar);
}

function priorityPill(priority) {
  const meta = priorityMeta(priority);
  return pill(meta.label, meta.bar);
}

function projectTag(name) {
  const tag = el("span", { class: "project-tag", dir: "auto" });
  const dot = el("span", { class: "dot" });
  const color = paletteColor(name);
  dot.style.background = color;
  tag.style.setProperty("--c", color);
  tag.append(dot, document.createTextNode(name));
  return tag;
}

function waitChip(name, prominent) {
  const chip = el("span", { class: prominent ? "wait-chip is-prominent" : "wait-chip" });
  const avatar = el("span", { class: "avatar", text: initials(name) });
  const color = paletteColor(name);
  avatar.style.background = color;
  avatar.style.color = pillFg(color);
  chip.append(avatar, el("span", { class: "wait-name", dir: "auto", text: name }));
  return chip;
}

function dueNode(task) {
  const span = el("span", { class: "due" });
  if (task.dueDate) {
    const kind = dueClass(task);
    if (kind) span.classList.add(kind);
    if (kind === "due-overdue") {
      span.append(el("span", { class: "sr-only", text: "Overdue. " }));
      span.append(document.createTextNode(formatDue(task.dueDate)));
      span.append(el("span", { class: "due-tag", text: "Overdue" }));
    } else if (kind === "due-today") {
      span.append(el("span", { class: "sr-only", text: "Due today. " }));
      span.append(document.createTextNode("Today"));
    } else if (kind === "due-soon") {
      span.append(el("span", { class: "sr-only", text: "Due within 3 days. " }));
      span.append(document.createTextNode(formatDue(task.dueDate)));
    } else {
      span.textContent = formatDue(task.dueDate);
    }
    return span;
  }
  if (task.dueRaw) {
    span.classList.add("muted");
    span.textContent = task.dueRaw;
    return span;
  }
  span.classList.add("muted");
  span.textContent = "No date";
  return span;
}

function cell(label, child, className) {
  const td = el("td", { class: className, "data-label": label });
  td.append(child);
  return td;
}

function taskTldr(task) {
  const explicit = asText(task && task.tldr);
  if (explicit) return explicit;
  const notes = asText(task && task.notes);
  if (!notes) return "";
  const line = notes.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "";
  const match = line.match(/^[\s\S]*?[.!?؟](?=\s|$)/);
  return (match ? match[0] : line).trim();
}

function linearChips(task) {
  const logic = globalThis.ItayBoard;
  const links = logic ? logic.collectLinearLinks(task) : [];
  if (!links.length) return null;
  const row = el("div", { class: "linear-row" });
  links.forEach((link) => {
    const anchor = el("a", {
      class: "linear-chip",
      href: link.url,
      target: "_blank",
      rel: "noopener noreferrer",
      text: link.id,
      title: `Open ${link.id} in Linear`,
    });
    anchor.addEventListener("click", (event) => event.stopPropagation());
    row.append(anchor);
  });
  return row;
}

function progressChip(task) {
  const progress = boardLinks().progress[task.id];
  if (!progress || !progress.total) return null;
  const logic = globalThis.ItayBoard;
  const label = logic && typeof logic.formatSubtaskProgress === "function"
    ? logic.formatSubtaskProgress(progress)
    : `${progress.done}/${progress.total}`;
  return el("span", {
    class: "subtask-progress",
    text: label,
    title: `${progress.done} of ${progress.total} subtasks done`,
  });
}

function doneCheck(task) {
  const done = task.status === "done";
  const meta = statusMeta(task.status);
  return el("span", {
    class: done ? "done-check is-checked" : "done-check",
    role: "img",
    "aria-label": done ? "Done" : meta.label,
    title: done ? "Done" : meta.label,
  });
}

function statusWithCheck(task, nested) {
  if (!nested) return statusPill(task.status);
  const wrap = el("span", { class: "status-with-check" });
  wrap.append(doneCheck(task), statusPill(task.status));
  return wrap;
}

function parentChip(task) {
  const parent = linkedParent(task);
  if (!parent) return null;
  const chip = el("button", {
    type: "button",
    class: "parent-chip",
    "data-action": "open-task",
    "data-id": parent.id,
    title: `Parent ${parent.id}`,
    "aria-label": `Open parent ${parent.title}`,
  });
  chip.append(el("span", { class: "parent-chip-kicker", text: "Parent" }));
  chip.append(el("span", { class: "parent-chip-title", dir: "auto", text: parent.title }));
  return chip;
}

function relationChips(task) {
  const parent = parentChip(task);
  const linear = linearChips(task);
  if (!parent && !linear) return null;
  if (!parent) return linear;
  if (!linear) {
    const row = el("div", { class: "linear-row" });
    row.append(parent);
    return row;
  }
  linear.prepend(parent);
  return linear;
}

function titleHeading(task, depth) {
  const row = el("div", { class: "title-row" });
  if (depth > 0) row.append(el("span", { class: "subtask-mark", "aria-hidden": "true", text: "↳" }));
  row.append(el("div", { class: "task-title", dir: "auto", text: task.title }));
  const progress = progressChip(task);
  if (progress) row.append(progress);
  return row;
}

function taskCell(task, depth) {
  const td = el("td", { class: "col-task" });
  const nest = el("div", { class: depth ? "nest" : "" });
  if (depth) nest.style.setProperty("--nest", String(depth));
  const row = titleHeading(task, depth);
  if (task.notes) row.append(el("span", { class: "notes-flag", text: "Notes" }));
  nest.append(row);
  const sub = task.source || task.notes;
  if (sub) nest.append(el("div", { class: "task-sub", dir: "auto", text: sub }));
  const chips = relationChips(task);
  if (chips) nest.append(chips);
  td.append(nest);
  return td;
}

function renderRow(task, depth) {
  const nest = depth || 0;
  const parent = linkedParent(task);
  const tr = el("tr", {
    class: state.openTaskId === task.id ? "is-open" : "",
    tabindex: "0",
    role: "button",
    "data-action": "open-task",
    "data-id": task.id,
    "data-task-id": task.id,
    "aria-label": parent ? `Open subtask ${task.title}, parent ${parent.title}` : `Open ${task.title}`,
  });
  if (nest > 0) {
    tr.classList.add("is-subtask");
    tr.style.setProperty("--nest", String(nest));
    tr.dataset.depth = String(nest);
  }
  if (parent) tr.dataset.parentId = parent.id;
  setBar(tr, statusMeta(task.status).bar);
  tr.append(
    taskCell(task, nest),
    cell("Project", projectTag(task.project), "col-project"),
    cell("Status", statusWithCheck(task, nest > 0), "col-status"),
    cell("Priority", priorityPill(task.priority), "col-priority"),
    cell("Quadrant", quadrantBadge(task), "col-quadrant"),
    cell("Due", dueNode(task), "col-due"),
    cell("Waiting on", task.waiting_on ? waitChip(task.waiting_on, task.status === "waiting") : el("span", { class: "muted", text: "—" }), "col-waiting"),
  );
  return tr;
}

function renderGroupTable(rows) {
  const table = el("table", { class: "task-table" });
  const head = el("tr");
  TABLE_COLUMNS.forEach((column) => {
    const active = state.sort.key === column.key;
    const th = el("th", { scope: "col", class: column.className });
    th.setAttribute("aria-sort", active ? (state.sort.dir === "desc" ? "descending" : "ascending") : "none");
    const button = el("button", {
      type: "button",
      class: `sort-btn${active ? " is-active" : ""}`,
      "data-action": "sort",
      "data-key": column.key,
      "aria-label": `Sort by ${column.label}`,
    });
    button.append(document.createTextNode(column.label));
    if (active) {
      button.append(el("span", { class: "sort-mark", "aria-hidden": "true", text: state.sort.dir === "desc" ? "↓" : "↑" }));
    }
    th.append(button);
    head.append(th);
  });
  const thead = el("thead");
  thead.append(head);
  const tbody = el("tbody");
  rows.forEach(({ task, depth }) => tbody.append(renderRow(task, depth)));
  table.append(thead, tbody);
  return table;
}

function renderGroup(key, rows) {
  const meta = groupMeta(key);
  const collapsed = state.collapsed.has(key);
  const section = el("section", {
    class: `group${collapsed ? " is-collapsed" : ""}${key === "waiting" ? " group-waiting" : ""}`,
  });
  setBar(section, meta.bar);
  const header = el("button", {
    type: "button",
    class: "group-header",
    "data-action": "toggle-group",
    "data-key": key,
    "aria-expanded": String(!collapsed),
  });
  const chevron = icon("chevron");
  chevron.classList.add("chevron");
  const name = el("span", { class: "group-name", dir: "auto", text: meta.label });
  const count = el("span", { class: "count", text: String(rows.length) });
  count.style.background = safeHex(meta.bar);
  count.style.color = pillFg(meta.bar);
  header.append(chevron, name, count);
  section.append(header);
  if (!collapsed) section.append(renderGroupTable(rows));
  return section;
}

function renderCard(task, depth) {
  const nest = depth || 0;
  const parent = linkedParent(task);
  const card = el("div", { class: `card${state.openTaskId === task.id ? " is-open" : ""}` });
  if (nest > 0) {
    card.classList.add("is-subtask");
    card.style.setProperty("--nest", String(nest));
    card.dataset.depth = String(nest);
  }
  if (parent) card.dataset.parentId = parent.id;
  setBar(card, statusMeta(task.status).bar);
  const button = el("button", {
    type: "button",
    class: "card-open",
    "data-action": "open-task",
    "data-id": task.id,
    "data-task-id": task.id,
    "aria-label": parent ? `Open subtask ${task.title}, parent ${parent.title}` : `Open ${task.title}`,
  });
  const heading = titleHeading(task, nest);
  button.append(heading);
  const tags = el("div", { class: "card-tags" });
  if (currentGroupBy() !== "project") tags.append(projectTag(task.project));
  if (currentGroupBy() !== "status" || nest > 0) tags.append(statusWithCheck(task, nest > 0));
  tags.append(priorityPill(task.priority));
  button.append(tags);
  const meta = el("div", { class: "card-meta" });
  meta.append(dueNode(task));
  button.append(meta);
  if (task.waiting_on) button.append(waitChip(task.waiting_on, task.status === "waiting"));
  card.append(button);
  const chips = relationChips(task);
  if (chips) card.append(chips);
  return card;
}

function renderManagerRow(task, depth) {
  const nest = depth || 0;
  const parent = linkedParent(task);
  const flag = dueClass(task);
  const flagClass = flag === "due-overdue" ? " is-overdue" : flag === "due-today" ? " is-today" : "";
  const row = el("div", {
    class: `manager-row${flagClass}${state.openTaskId === task.id ? " is-open" : ""}`,
  });
  if (nest > 0) {
    row.classList.add("is-subtask");
    row.style.setProperty("--nest", String(nest));
    row.dataset.depth = String(nest);
  }
  if (parent) row.dataset.parentId = parent.id;
  const open = el("button", {
    type: "button",
    class: "manager-open",
    "data-action": "open-task",
    "data-id": task.id,
    "data-task-id": task.id,
    "aria-label": parent ? `Open subtask ${task.title}, parent ${parent.title}` : `Open ${task.title}`,
  });
  const main = el("div", { class: "manager-main" });
  main.append(titleHeading(task, nest));
  const summary = taskTldr(task);
  if (summary) main.append(el("p", { class: "tldr", dir: "auto", text: summary }));
  const due = el("div", { class: "manager-due" });
  due.append(dueNode(task));
  open.append(main, due);
  row.append(open);
  const meta = el("div", { class: "manager-meta" });
  if (nest > 0) meta.append(statusWithCheck(task, true));
  meta.append(quadrantBadge(task), projectTag(task.project), priorityPill(task.priority));
  const chips = relationChips(task);
  if (chips) meta.append(chips);
  row.append(meta);
  return row;
}

function renderManagerGroup(key, rows) {
  const meta = groupMeta(key);
  const collapsed = state.collapsed.has(key);
  const section = el("section", { class: `group${collapsed ? " is-collapsed" : ""}` });
  setBar(section, meta.bar);
  const header = el("button", {
    type: "button",
    class: "group-header",
    "data-action": "toggle-group",
    "data-key": key,
    "aria-expanded": String(!collapsed),
  });
  const chevron = icon("chevron");
  chevron.classList.add("chevron");
  const name = el("span", { class: "group-name", dir: "auto", text: meta.label });
  const count = el("span", { class: "count", text: String(rows.length) });
  count.style.background = safeHex(meta.bar);
  count.style.color = pillFg(meta.bar);
  header.append(chevron, name, count);
  section.append(header);
  if (!collapsed) {
    const list = el("div", { class: "manager-list" });
    rows.forEach(({ task, depth }) => list.append(renderManagerRow(task, depth)));
    section.append(list);
  }
  return section;
}

function renderMatrixCard(task) {
  const parent = linkedParent(task);
  const card = el("article", {
    class: `matrix-card${state.openTaskId === task.id ? " is-open" : ""}`,
    "data-task-id": task.id,
  });
  if (parent) card.dataset.parentId = parent.id;
  const button = el("button", {
    type: "button",
    class: "matrix-open",
    "data-action": "open-task",
    "data-id": task.id,
    "aria-label": parent ? `Open subtask ${task.title}, parent ${parent.title}` : `Open ${task.title}`,
  });
  button.append(titleHeading(task, 0));
  const summary = taskTldr(task);
  if (summary) button.append(el("p", { class: "tldr", dir: "auto", text: summary }));
  const meta = el("div", { class: "matrix-meta" });
  meta.append(dueNode(task), projectTag(task.project));
  button.append(meta);
  card.append(button);
  const chips = relationChips(task);
  if (chips) card.append(chips);
  return card;
}

function renderQuadCell(info, tasks) {
  const section = el("section", {
    class: `quad quad-${info.key.toLowerCase()}`,
    "data-quadrant": info.key,
  });
  const color = safeHex(info.color);
  section.style.setProperty("--q", color);
  section.style.setProperty("--q-ink", titleColor(color));
  const head = el("div", { class: "quad-head" });
  const titles = el("div", { class: "quad-titles" });
  titles.append(el("h2", { class: "quad-label", text: `${info.key} ${info.name}` }));
  titles.append(el("p", { class: "quad-sub", text: info.subtitle }));
  const count = el("span", { class: "count", text: String(tasks.length) });
  count.style.background = color;
  count.style.color = pillFg(color);
  head.append(titles, count);
  const cards = el("div", { class: "quad-cards" });
  if (!tasks.length) cards.append(el("p", { class: "quad-empty", text: "No tasks" }));
  else tasks.forEach((task) => cards.append(renderMatrixCard(task)));
  section.append(head, cards);
  return section;
}

function renderEisenhower(tasks) {
  const board = el("div", { class: "eisenhower" });
  const matrix = el("div", { class: "matrix", role: "group", "aria-label": "Eisenhower matrix" });
  QUADRANTS.forEach((info) => {
    const cellTasks = tasks.filter((task) => task.quadrant === info.key).sort(compareDefault);
    matrix.append(renderQuadCell(info, cellTasks));
  });
  board.append(matrix);
  const unsorted = tasks.filter((task) => !task.quadrant).sort(compareDefault);
  if (!unsorted.length) return board;
  const strip = el("section", { class: "unsorted", "data-quadrant": "unsorted" });
  const head = el("div", { class: "unsorted-head" });
  const titles = el("div", { class: "quad-titles" });
  titles.append(el("h2", { class: "quad-label", text: "Unsorted" }));
  titles.append(el("p", { class: "quad-sub", text: "No quadrant set" }));
  const count = el("span", { class: "count", text: String(unsorted.length) });
  count.style.background = "#c4c4c4";
  count.style.color = pillFg("#c4c4c4");
  head.append(titles, count);
  const grid = el("div", { class: "unsorted-grid" });
  unsorted.forEach((task) => grid.append(renderMatrixCard(task)));
  strip.append(head, grid);
  board.append(strip);
  return board;
}

function renderKanban(groups) {
  const board = el("div", { class: "kanban" });
  groups.forEach(([key, rows]) => {
    const meta = groupMeta(key);
    const collapsed = state.collapsed.has(key);
    const col = el("section", { class: `kanban-col${collapsed ? " is-collapsed" : ""}` });
    setBar(col, meta.bar);
    const header = el("button", {
      type: "button",
      class: "kanban-header",
      "data-action": "toggle-group",
      "data-key": key,
      "aria-expanded": String(!collapsed),
    });
    const name = el("span", { class: "group-name", dir: "auto", text: meta.label });
    const count = el("span", { class: "count", text: String(rows.length) });
    count.style.background = safeHex(meta.bar);
    count.style.color = pillFg(meta.bar);
    header.append(name, count);
    col.append(header);
    if (!collapsed) {
      const cards = el("div", { class: "kanban-cards" });
      rows.forEach(({ task, depth }) => cards.append(renderCard(task, depth)));
      col.append(cards);
    }
    board.append(col);
  });
  return board;
}

function emptyState(title, filtered) {
  const box = el("div", { class: "empty" });
  box.append(el("h2", { text: title }));
  if (filtered) {
    box.append(el("p", { text: "Try a different search, or clear the project, status, priority, and quadrant filters." }));
    box.append(el("button", { type: "button", class: "btn", "data-action": "clear-filters", text: "Clear filters" }));
  } else {
    box.append(el("p", { text: "Add tasks in the private repository, then refresh." }));
  }
  return box;
}

function renderBoardList() {
  const host = document.getElementById("board-list");
  if (!host) return;
  host.replaceChildren();
  if (!state.data.tasks.length) {
    host.append(emptyState("No tasks in this file yet.", false));
    return;
  }
  if (state.view === "eisenhower") {
    const tasks = state.data.tasks.filter(matchesFilter);
    if (!tasks.length) {
      host.append(emptyState("No tasks match these filters.", true));
      return;
    }
    host.append(renderEisenhower(tasks));
    return;
  }
  const groups = grouped();
  if (!groups.length) {
    host.append(emptyState("No tasks match these filters.", true));
    return;
  }
  if (state.view === "manager") {
    const wrap = el("div", { class: "groups" });
    groups.forEach(([key, tasks]) => wrap.append(renderManagerGroup(key, tasks)));
    host.append(wrap);
    return;
  }
  if (state.view === "kanban") {
    host.append(renderKanban(groups));
    return;
  }
  const wrap = el("div", { class: "groups" });
  groups.forEach(([key, tasks]) => wrap.append(renderGroup(key, tasks)));
  host.append(wrap);
}

function weekHint() {
  const start = startOfWeek(new Date());
  const end = addDays(start, 6);
  const fmt = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Not done, due ${fmt(start)}–${fmt(end)}`;
}

function renderSummary() {
  const host = document.getElementById("summary");
  if (!host) return;
  const counts = summarize(state.data.tasks);
  const items = [
    ["open", counts.open, "Open tasks", "Every task that is not done"],
    ["overdue", counts.overdue, "Overdue", "Due before today and not done"],
    ["week", counts.week, "Due this week", weekHint()],
    ["waiting", counts.waiting, "Waiting on others", "Status is waiting"],
  ];
  host.replaceChildren();
  items.forEach(([key, num, label, hint]) => {
    const chip = el("div", { class: `chip chip-${key}`, title: hint });
    chip.append(el("div", { class: "chip-num", text: String(num) }));
    chip.append(el("div", { class: "chip-label", text: label }));
    host.append(chip);
  });
}

function subtaskSection(task) {
  const ids = boardLinks().children[task.id] || [];
  if (!ids.length) return null;
  const wrap = el("div", { class: "subtask-panel" });
  const progress = progressChip(task);
  if (progress) wrap.append(progress);
  const list = el("ul", { class: "subtask-list" });
  const children = ids.map((id) => state.data.tasks.find((item) => item.id === id)).filter(Boolean).sort(compareTasks);
  children.forEach((child) => {
    const li = el("li");
    const button = el("button", {
      type: "button",
      class: "subtask-link",
      "data-action": "open-task",
      "data-id": child.id,
    });
    button.append(doneCheck(child));
    button.append(el("span", { class: "subtask-link-title", dir: "auto", text: child.title }));
    button.append(statusPill(child.status));
    li.append(button);
    list.append(li);
  });
  wrap.append(list);
  return wrap;
}

function panelField(label, value) {
  const wrap = el("div", { class: "panel-field" });
  wrap.append(el("div", { class: "field-label", text: label }));
  const body = el("div", { class: "field-value" });
  body.append(value);
  wrap.append(body);
  return wrap;
}

function formatAgendaHeading(agenda) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(agenda.date || "");
  let dateText = agenda.date;
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    dateText = date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }
  return `${dateText} · ${agenda.workday.start}–${agenda.workday.end} · ${agenda.timezone}`;
}

function renderAgendaItem(item) {
  const row = el("div", { class: item.kind === "meeting" ? "agenda-item is-meeting" : "agenda-item" });
  row.append(el("div", { class: "agenda-time", text: `${item.startLabel}–${item.endLabel}` }));
  const body = el("div", { class: "agenda-body" });
  if (item.kind === "meeting") {
    body.append(el("div", { class: "agenda-item-title", text: item.title }));
    body.append(el("div", { class: "agenda-kind", text: "Meeting" }));
  } else {
    const heading = el("div", { class: "title-row" });
    heading.append(el("div", { class: "agenda-item-title", dir: "auto", text: item.task.title }));
    const progress = progressChip(item.task);
    if (progress) heading.append(progress);
    body.append(heading);
    const summary = taskTldr(item.task);
    if (summary) body.append(el("p", { class: "tldr", dir: "auto", text: summary }));
    const meta = el("div", { class: "agenda-meta" });
    if (item.pinned) meta.append(el("span", { class: "due-tag", text: "Scheduled" }));
    meta.append(quadrantBadge(item.task), priorityPill(item.task.priority), projectTag(item.task.project));
    const chips = relationChips(item.task);
    if (chips) meta.append(chips);
    body.append(meta);
  }
  row.append(body);
  return row;
}

function renderAgenda() {
  const host = document.getElementById("agenda-root");
  if (!host || !globalThis.ItayBoard) return;
  if (!state.agendaOpen || !state.data) {
    host.replaceChildren();
    delete host.dataset.open;
    return;
  }
  if (host.dataset.open === "1" && host.dataset.version === String(state.dataVersion)) return;
  const logic = globalThis.ItayBoard;
  const agenda = logic.buildAgenda({
    tasks: state.data.tasks,
    priorities: state.data.priorities,
    now: new Date(),
    calendar: state.calendar,
  });
  state.agendaText = logic.formatAgendaText(agenda);
  host.replaceChildren();
  host.dataset.open = "1";
  host.dataset.version = String(state.dataVersion);
  const backdrop = el("div", { class: "backdrop", "data-action": "close-agenda" });
  const panel = el("aside", {
    class: "panel agenda-panel",
    id: "agenda",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "agenda-title",
    tabindex: "-1",
    "data-action": "noop",
  });
  const head = el("div", { class: "agenda-head" });
  const titles = el("div");
  titles.append(el("h2", { id: "agenda-title", class: "agenda-title", text: "Daily agenda" }));
  titles.append(el("p", { class: "agenda-sub", text: formatAgendaHeading(agenda) }));
  const actions = el("div", { class: "agenda-actions" });
  actions.append(el("button", {
    type: "button",
    id: "copy-agenda",
    class: "btn btn-primary btn-small",
    "data-action": "copy-agenda",
    text: "Copy agenda",
  }));
  const close = el("button", { type: "button", class: "icon-btn", "data-action": "close-agenda", "aria-label": "Close agenda" });
  close.append(icon("close"));
  actions.append(close);
  head.append(titles, actions);
  panel.append(head);
  if (agenda.notWorkdayNote) panel.append(el("p", { class: "agenda-note", text: agenda.notWorkdayNote }));
  if (agenda.calendarNote) panel.append(el("p", { class: "agenda-note is-warn", text: agenda.calendarNote }));
  const list = el("div", { class: "agenda-list" });
  if (!agenda.items.length) list.append(el("p", { class: "muted", text: "Nothing scheduled." }));
  agenda.items.forEach((item) => list.append(renderAgendaItem(item)));
  panel.append(list);
  const overflow = el("section", { class: "agenda-overflow" });
  overflow.append(el("h3", { text: "Didn't fit today" }));
  if (!agenda.overflow.length) {
    overflow.append(el("p", { class: "muted", text: "Everything open fit in the workday." }));
  } else {
    const items = el("ul", { class: "overflow-list" });
    agenda.overflow.forEach((task) => {
      const li = el("li");
      const button = el("button", {
        type: "button",
        class: "overflow-task",
        "data-action": "open-task",
        "data-id": task.id,
      });
      button.append(el("span", { class: "overflow-title", dir: "auto", text: task.title }));
      const progress = progressChip(task);
      if (progress) button.append(progress);
      const info = quadrantInfo(task.quadrant);
      const meta = [info ? `${info.key} ${info.name}` : "Unsorted", task.project, priorityMeta(task.priority).label].filter(Boolean).join(" · ");
      if (meta) button.append(el("span", { class: "overflow-meta", text: meta }));
      li.append(button);
      const parent = parentChip(task);
      if (parent) li.append(parent);
      items.append(li);
    });
    overflow.append(items);
  }
  panel.append(overflow);
  backdrop.append(panel);
  host.append(backdrop);
}

function renderPanel() {
  const host = document.getElementById("panel-root");
  if (!host) return;
  host.replaceChildren();
  document.body.classList.toggle("panel-open", Boolean(state.openTaskId || state.agendaOpen));
  if (!state.openTaskId) return;
  const task = state.data.tasks.find((item) => item.id === state.openTaskId);
  if (!task) return;
  const backdrop = el("div", { class: "backdrop", "data-action": "close-panel" });
  const panel = el("aside", {
    class: "panel",
    id: "panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "panel-title",
    tabindex: "-1",
    "data-action": "noop",
  });
  const head = el("div", { class: "panel-head" });
  const close = el("button", { type: "button", class: "icon-btn", "data-action": "close-panel", "aria-label": "Close details" });
  close.append(icon("close"));
  head.append(close);
  const tags = el("div", { class: "card-tags" });
  tags.append(statusPill(task.status), priorityPill(task.priority), quadrantBadge(task));
  panel.append(head, tags, el("h2", { id: "panel-title", class: "panel-title", dir: "auto", text: task.title }));
  const summary = taskTldr(task);
  if (summary) panel.append(el("p", { class: "tldr panel-tldr", dir: "auto", text: summary }));
  const parent = parentChip(task);
  if (parent) panel.append(panelField("Parent", parent));
  const subs = subtaskSection(task);
  if (subs) panel.append(panelField("Subtasks", subs));
  const chips = linearChips(task);
  if (chips) panel.append(panelField("Linear", chips));
  if (task.scheduled && task.scheduled.start) {
    const when = task.scheduled.end
      ? `${formatTimestamp(task.scheduled.start)} – ${formatTimestamp(task.scheduled.end)}`
      : formatTimestamp(task.scheduled.start);
    panel.append(panelField("Scheduled", el("p", { class: "prose", text: when })));
  }
  panel.append(panelField("Project", projectTag(task.project)));
  panel.append(panelField("Due", dueNode(task)));
  panel.append(panelField("Waiting on", task.waiting_on ? waitChip(task.waiting_on, true) : el("span", { class: "muted", text: "—" })));
  panel.append(panelField("Source", task.source ? el("p", { class: "prose", dir: "auto", text: task.source }) : el("span", { class: "muted", text: "—" })));
  panel.append(panelField("Notes", task.notes ? el("p", { class: "prose", dir: "auto", text: task.notes }) : el("span", { class: "muted", text: "No notes yet." })));
  const meta = el("dl", { class: "meta-list" });
  [
    ["Created", task.created ? formatTimestamp(task.created) : "—"],
    ["Updated", task.updated ? formatTimestamp(task.updated) : "—"],
    ["Id", task.id],
  ].forEach(([label, value]) => {
    meta.append(el("dt", { text: label }), el("dd", { dir: "auto", text: value }));
  });
  panel.append(meta, el("p", { class: "panel-foot", text: "Read-only. Edit this task in the private data repository." }));
  backdrop.append(panel);
  host.append(backdrop);
}

function fillSelect(id, options, current) {
  const select = document.getElementById(id);
  if (!select) return;
  const signature = options.map((option) => `${option.value}\t${option.label}`).join("\n");
  if (select.dataset.sig !== signature) {
    select.dataset.sig = signature;
    select.replaceChildren();
    options.forEach((option) => select.append(el("option", { value: option.value, text: option.label })));
  }
  if (select.value !== current) select.value = current;
}

function renderProjectMenu() {
  const menu = document.getElementById("project-menu");
  const button = document.getElementById("project-btn");
  if (!menu || !button) return;
  const count = state.filters.projects.length;
  const label = document.getElementById("project-btn-label");
  if (label) label.textContent = count ? `Projects · ${count}` : "Projects";
  button.setAttribute("aria-expanded", String(state.projectMenuOpen));
  menu.hidden = !state.projectMenuOpen;
  if (!state.projectMenuOpen) return;
  const names = projectOptions();
  const signature = names.join("\n");
  if (menu.dataset.sig !== signature) {
    menu.dataset.sig = signature;
    menu.replaceChildren();
    const all = el("button", { type: "button", class: "menu-item", "data-action": "projects-clear", text: "All projects" });
    menu.append(all);
    names.forEach((name) => {
      const item = el("label", { class: "menu-check" });
      const input = el("input", { type: "checkbox", value: name });
      input.addEventListener("change", () => {
        const selected = new Set(state.filters.projects);
        if (input.checked) selected.add(name);
        else selected.delete(name);
        state.filters.projects = names.filter((project) => selected.has(project));
        syncUrl();
        updateBoard();
      });
      const dot = el("span", { class: "dot" });
      dot.style.background = paletteColor(name);
      item.append(input, dot, el("span", { dir: "auto", text: name }));
      menu.append(item);
    });
  }
  const all = menu.querySelector('[data-action="projects-clear"]');
  if (all) all.setAttribute("aria-current", count ? "false" : "true");
  menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = state.filters.projects.includes(input.value);
  });
}

function renderWarnings() {
  const host = document.getElementById("warnings");
  if (!host) return;
  const messages = [...(state.data.warnings || [])];
  if (state.storageWarning) messages.push(state.storageWarning);
  host.replaceChildren();
  if (!messages.length) return;
  const banner = el("div", { class: "warn-banner", role: "status" });
  banner.append(el("p", { text: messages.join(" ") }));
  host.append(banner);
}

function renderInlineError() {
  const host = document.getElementById("inline-error");
  if (!host) return;
  if (!state.inlineError) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  host.replaceChildren();
  host.append(el("p", { text: state.inlineError.message }));
  const retry = el("button", { type: "button", class: "btn btn-small", "data-action": "retry", text: "Try again" });
  const dismiss = el("button", { type: "button", class: "btn btn-small", "data-action": "dismiss-error", text: "Dismiss" });
  const actions = el("div", { class: "setup-actions" });
  actions.append(retry, dismiss);
  host.append(actions);
}

function syncPressed(action, value) {
  document.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
    if (!button.dataset.value) return;
    button.setAttribute("aria-pressed", String(button.dataset.value === value));
  });
}

function updateThemeButton() {
  const button = document.getElementById("theme-btn");
  if (!button) return;
  const dark = state.theme === "dark";
  button.setAttribute("aria-pressed", String(dark));
  button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  button.replaceChildren(icon(dark ? "sun" : "moon"));
}

function showingLabel() {
  const total = state.data.tasks.length;
  const shown = state.data.tasks.filter(matchesFilter).length;
  if (shown === total && !filtersActive()) return `${total} task${total === 1 ? "" : "s"}`;
  return `Showing ${shown} of ${total}`;
}

function updateBoard() {
  if (state.mode !== "board" || !state.data) return;
  const updated = document.getElementById("last-updated");
  if (updated) {
    const stamp = state.data.updated ? formatTimestamp(state.data.updated) : "";
    updated.textContent = stamp ? `Last updated ${stamp}` : "Last updated —";
  }
  const banner = document.getElementById("demo-banner");
  if (banner) banner.hidden = !state.demo;
  const search = document.getElementById("search");
  if (search && document.activeElement !== search && search.value !== state.filters.q) search.value = state.filters.q;
  const clearSearch = document.getElementById("clear-search");
  if (clearSearch) clearSearch.hidden = !state.filters.q;
  const hide = document.getElementById("hide-done");
  if (hide) {
    hide.setAttribute("aria-pressed", String(state.filters.hideDone));
    hide.textContent = state.filters.hideDone ? "Show done" : "Hide done";
    hide.title = state.filters.hideDone ? "Done tasks are hidden" : "Done tasks are visible";
  }
  const clearFilters = document.getElementById("clear-filters");
  if (clearFilters) clearFilters.hidden = !filtersActive();
  const showing = document.getElementById("showing");
  if (showing) showing.textContent = showingLabel();
  const forget = document.getElementById("forget-btn");
  if (forget) {
    const hasToken = Boolean(state.token || storage.get(TOKEN_KEY));
    forget.hidden = !hasToken;
    forget.textContent = state.forgetArmed ? "Confirm forget" : "Forget token";
    forget.classList.toggle("is-armed", state.forgetArmed);
  }
  const refresh = document.getElementById("refresh-btn");
  if (refresh) {
    refresh.disabled = state.refreshing;
    refresh.classList.toggle("is-busy", state.refreshing);
    refresh.setAttribute("aria-label", state.refreshing ? "Refreshing tasks" : "Refresh tasks");
  }
  fillSelect("status-filter", statusOptions(), state.filters.status);
  fillSelect("priority-filter", priorityOptions(), state.filters.priority);
  fillSelect("quadrant-filter", quadrantOptions(), state.filters.quadrant);
  syncPressed("view", state.view);
  syncPressed("group", state.groupBy);
  const groupBy = document.getElementById("group-by");
  if (groupBy) groupBy.hidden = state.view === "manager" || state.view === "eisenhower";
  const managerLabel = document.getElementById("manager-group-label");
  if (managerLabel) managerLabel.hidden = state.view !== "manager";
  updateThemeButton();
  renderWarnings();
  renderInlineError();
  renderSummary();
  renderProjectMenu();
  renderBoardList();
  renderPanel();
  renderAgenda();
}

function segment(action, options, current, label) {
  const wrap = el("div", { class: "segment-wrap" });
  if (label) wrap.append(el("span", { class: "segment-label", text: label }));
  const group = el("div", { class: "segment", role: "group", "aria-label": label || action });
  options.forEach(([value, text]) => {
    group.append(el("button", {
      type: "button",
      "data-action": action,
      "data-value": value,
      "aria-pressed": String(current === value),
      text,
    }));
  });
  wrap.append(group);
  return wrap;
}

function renderToolbar() {
  const bar = el("div", { class: "toolbar" });
  const search = el("div", { class: "search" });
  search.append(icon("search"));
  const input = el("input", {
    id: "search",
    type: "search",
    placeholder: "Search title, notes, person, source",
    "aria-label": "Search tasks",
    autocomplete: "off",
  });
  input.value = state.filters.q;
  const clear = el("button", {
    type: "button",
    id: "clear-search",
    class: "text-btn",
    "data-action": "clear-search",
    "aria-label": "Clear search",
    text: "×",
  });
  if (!state.filters.q) clear.hidden = true;
  search.append(input, clear);
  bar.append(search);

  const menuWrap = el("div", { class: "menu-wrap" });
  const projectButton = el("button", {
    type: "button",
    id: "project-btn",
    class: "btn",
    "data-action": "toggle-projects",
    "aria-haspopup": "true",
    "aria-expanded": "false",
  });
  projectButton.append(el("span", { id: "project-btn-label", text: "Projects" }));
  menuWrap.append(projectButton, el("div", { id: "project-menu", class: "menu", hidden: "hidden" }));
  bar.append(menuWrap);

  [
    ["status-filter", "Status"],
    ["priority-filter", "Priority"],
    ["quadrant-filter", "Quadrant"],
  ].forEach(([id, label]) => {
    const wrap = el("label", { class: "select-wrap" });
    wrap.append(el("span", { class: "sr-only", text: label }));
    wrap.append(el("select", { id, "aria-label": label }));
    bar.append(wrap);
  });

  bar.append(el("button", {
    type: "button",
    id: "hide-done",
    class: "btn",
    "data-action": "hide-done",
    "aria-pressed": String(state.filters.hideDone),
    title: state.filters.hideDone ? "Done tasks are hidden" : "Done tasks are visible",
    text: state.filters.hideDone ? "Show done" : "Hide done",
  }));
  const clearFilters = el("button", { type: "button", id: "clear-filters", class: "text-btn", "data-action": "clear-filters", text: "Clear filters" });
  if (!filtersActive()) clearFilters.hidden = true;
  bar.append(clearFilters, el("span", { id: "showing", class: "showing" }));
  return bar;
}

function renderBoardShell() {
  const page = el("div", { class: "page" });
  const sticky = el("div", { class: "sticky-stack" });
  const top = el("header", { class: "topbar" });
  const left = el("div", { class: "top-left" });
  left.append(brandLockup(), el("p", { id: "last-updated", class: "updated", text: "Last updated —" }));
  const actions = el("div", { class: "top-actions" });
  actions.append(segment("view", [["table", "Table"], ["kanban", "Kanban"], ["manager", "Manager"], ["eisenhower", "Eisenhower"]], state.view));
  const groupSeg = segment("group", [["status", "Status"], ["project", "Project"]], state.groupBy, "Group by");
  groupSeg.id = "group-by";
  if (state.view === "manager" || state.view === "eisenhower") groupSeg.hidden = true;
  const managerLabel = el("span", { id: "manager-group-label", class: "segment-label", text: "Grouped by project" });
  if (state.view !== "manager") managerLabel.hidden = true;
  actions.append(groupSeg, managerLabel);
  actions.append(el("button", { type: "button", id: "agenda-btn", class: "btn", "data-action": "open-agenda", text: "Daily agenda" }));
  actions.append(el("button", { type: "button", id: "theme-btn", class: "icon-btn", "data-action": "theme" }));
  const refresh = el("button", { type: "button", id: "refresh-btn", class: "btn", "data-action": "refresh" });
  refresh.append(icon("refresh"), document.createTextNode("Refresh"));
  const forget = el("button", {
    type: "button",
    id: "forget-btn",
    class: "btn btn-ghost",
    "data-action": "forget",
    title: "Remove the token from this browser",
    text: "Forget token",
  });
  actions.append(refresh, forget);
  top.append(left, actions);

  const banner = el("div", { id: "demo-banner", class: "banner" });
  const bannerText = el("p");
  bannerText.append(el("strong", { text: "Demo mode. " }));
  bannerText.append(document.createTextNode("These tasks are fictional and live in this public repo so the layout can be reviewed. Nothing here is real work."));
  banner.append(
    bannerText,
    el("button", { type: "button", class: "btn btn-small", "data-action": "leave-demo", text: "Leave demo" }),
  );
  if (!state.demo) banner.hidden = true;
  sticky.append(top, banner, el("section", { id: "summary", class: "summary", "aria-label": "Summary" }));

  const main = el("main");
  main.append(
    el("div", { id: "warnings" }),
    el("div", { id: "inline-error", class: "inline-error", hidden: "hidden" }),
    renderToolbar(),
    el("div", { id: "board-list" }),
    el("p", { class: "footnote", text: "Read-only. Edit tasks in the private data repository." }),
  );
  page.append(sticky, main, el("div", { id: "panel-root" }), el("div", { id: "agenda-root" }));
  return page;
}

function step(number, content) {
  const item = el("li");
  item.append(el("span", { class: "step-num", text: String(number) }));
  const body = el("div");
  if (typeof content === "string") body.textContent = content;
  else body.append(content);
  item.append(body);
  return item;
}

function setupStepLink() {
  const fragment = document.createDocumentFragment();
  fragment.append(document.createTextNode("Create a fine-grained personal access token. "));
  fragment.append(el("a", {
    href: TOKEN_URL,
    target: "_blank",
    rel: "noopener noreferrer",
    text: "Open the GitHub token page",
  }));
  fragment.append(document.createTextNode("."));
  return fragment;
}

function renderSetup() {
  const wrap = el("div", { class: "setup-wrap" });
  const card = el("div", { class: "setup-card" });
  const mark = el("div", { class: "setup-mark" });
  mark.append(logoMark());
  card.append(mark, el("h1", { text: "Itay's tasks" }));
  card.append(el("p", {
    class: "lede",
    text: "This board reads a private task file in your browser. The token stays in local storage on this device and is never saved in the public repository.",
  }));
  if (state.setupMessage) card.append(el("p", { class: "callout", role: "status", text: state.setupMessage }));
  const steps = el("ol", { class: "steps" });
  steps.append(step(1, setupStepLink()));
  steps.append(step(2, 'Set the resource owner to ITAY3PO. Choose "Only select repositories" and select itay-tasks.'));
  steps.append(step(3, "Under repository permissions, set Contents to Read-only. Generate the token and paste it below."));
  card.append(steps);

  const form = el("form", { id: "token-form" });
  form.append(el("label", { class: "field-label", for: "token", text: "Personal access token" }));
  const row = el("div", { class: "token-row" });
  const input = el("input", {
    id: "token",
    name: "token",
    type: "password",
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    placeholder: "github_pat_…",
    "aria-describedby": "token-help",
  });
  input.required = true;
  row.append(input, el("button", { type: "button", class: "btn", "data-action": "reveal-token", text: "Show" }));
  const error = el("p", { id: "token-error", class: "field-error", role: "alert", hidden: "hidden" });
  const actions = el("div", { class: "setup-actions" });
  actions.append(
    el("button", { type: "submit", class: "btn btn-primary", text: "Save and load tasks" }),
    el("a", { href: "?demo=1", text: "Preview with demo data" }),
  );
  form.append(
    row,
    el("p", { id: "token-help", class: "help", text: "A fine-grained token usually starts with github_pat_. A 30- or 90-day expiration is enough." }),
    error,
    actions,
  );
  card.append(form);
  wrap.append(card);
  return wrap;
}

function renderLoading() {
  const wrap = el("div", { class: "setup-wrap" });
  const card = el("div", { class: "setup-card loading-card" });
  card.append(el("div", { class: "spinner", "aria-hidden": "true" }));
  card.append(el("p", { text: state.demo ? "Loading demo tasks…" : "Loading tasks…" }));
  wrap.append(card);
  return wrap;
}

function renderError() {
  const info = state.error || { message: "Something went wrong." };
  const wrap = el("div", { class: "setup-wrap" });
  const card = el("div", { class: "setup-card" });
  const mark = el("div", { class: "setup-mark" });
  mark.append(logoMark());
  const title = info.kind === "auth" ? "Token invalid or lacks access" : "Couldn't load tasks";
  card.append(mark, el("h1", { text: title }));
  card.append(el("p", { class: "lede", text: info.message || "The token is invalid or lacks access." }));
  if (info.hint) card.append(el("p", { text: info.hint }));
  if (info.status) card.append(el("p", { class: "help", text: `GitHub responded with HTTP ${info.status}.` }));
  const actions = el("div", { class: "setup-actions" });
  actions.append(el("button", { type: "button", class: "btn btn-primary", "data-action": "retry", text: "Try again" }));
  if (!state.demo && info.kind !== "parse") {
    actions.append(el("button", { type: "button", class: "btn", "data-action": "reset-token", text: "Enter a different token" }));
  }
  if (!state.demo) actions.append(el("a", { href: "?demo=1", text: "Preview with demo data" }));
  card.append(actions);
  wrap.append(card);
  return wrap;
}

function render() {
  applyTheme();
  setTitle();
  const root = document.getElementById("app");
  if (state.mode !== "board") {
    root.dataset.mode = state.mode;
    const view = state.mode === "setup" ? renderSetup() : state.mode === "error" ? renderError() : renderLoading();
    root.replaceChildren(view);
  } else if (root.dataset.mode !== "board") {
    root.dataset.mode = "board";
    root.replaceChildren(renderBoardShell());
    updateBoard();
  } else {
    updateBoard();
  }
  if (state.liveMessage) {
    const live = document.getElementById("live");
    if (live) live.textContent = state.liveMessage;
    state.liveMessage = "";
  }
}

async function loadRemote() {
  const id = ++requestId;
  const token = state.token || storage.get(TOKEN_KEY) || "";
  state.token = token;
  if (!token) {
    state.mode = "setup";
    render();
    return;
  }
  const hadData = Boolean(state.data) && state.mode === "board";
  if (!hadData) {
    state.mode = "loading";
    render();
  } else {
    state.refreshing = true;
    state.inlineError = null;
    updateBoard();
  }
  try {
    const [data, calendar] = await Promise.all([fetchRemote(token), fetchCalendar(token)]);
    if (id !== requestId) return;
    state.data = data;
    state.calendar = calendar;
    state.dataVersion += 1;
    state.error = null;
    state.inlineError = null;
    state.mode = "board";
    state.refreshing = false;
    state.liveMessage = `Loaded ${data.tasks.length} tasks.`;
    render();
  } catch (error) {
    if (id !== requestId) return;
    state.refreshing = false;
    const info = classify(error);
    if (hadData && info.kind !== "auth") {
      state.inlineError = info;
      state.mode = "board";
      render();
      return;
    }
    state.error = info;
    state.mode = "error";
    render();
  }
}

async function loadDemo() {
  const id = ++requestId;
  const hadData = Boolean(state.data) && state.mode === "board";
  if (!hadData) {
    state.mode = "loading";
    render();
  } else {
    state.refreshing = true;
    state.inlineError = null;
    updateBoard();
  }
  try {
    const response = await fetch("demo-tasks.json", { cache: "no-store" });
    if (!response.ok) {
      const error = new Error("demo missing");
      error.kind = "parse";
      throw error;
    }
    const data = parsePayload(await response.text());
    let calendar = null;
    try {
      const calResponse = await fetch("demo-calendar.json", { cache: "no-store" });
      if (calResponse.ok) calendar = parseCalendar(await calResponse.text());
    } catch {
      calendar = null;
    }
    const aligned = alignDemoBoard(data, calendar);
    if (id !== requestId) return;
    state.data = aligned.data;
    state.calendar = aligned.calendar;
    state.dataVersion += 1;
    state.error = null;
    state.inlineError = null;
    state.mode = "board";
    state.refreshing = false;
    state.liveMessage = `Loaded ${data.tasks.length} demo tasks.`;
    render();
  } catch (error) {
    if (id !== requestId) return;
    state.refreshing = false;
    state.error = {
      kind: "parse",
      message: "The demo file couldn't be loaded. Serve this folder over HTTP and open ?demo=1.",
    };
    state.mode = "error";
    render();
  }
}

function forgetToken(options = {}) {
  clearTimeout(state.forgetTimer);
  state.forgetArmed = false;
  state.token = "";
  storage.remove(TOKEN_KEY);
  state.openTaskId = null;
  state.error = null;
  state.inlineError = null;
  state.setupMessage = options.message || "";
  if (state.demo) {
    state.liveMessage = "Token removed from this browser.";
    if (state.mode === "board") updateBoard();
    else render();
    return;
  }
  state.data = null;
  state.mode = "setup";
  render();
}

function leaveDemo() {
  state.demo = false;
  state.data = null;
  state.openTaskId = null;
  state.inlineError = null;
  const params = new URLSearchParams(location.search);
  params.delete("demo");
  const qs = params.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
  if (state.token || storage.get(TOKEN_KEY)) {
    state.token = state.token || storage.get(TOKEN_KEY);
    loadRemote();
  } else {
    state.mode = "setup";
    render();
  }
}

function openTask(id) {
  state.openTaskId = id;
  state.returnFocusId = id;
  updateBoard();
  document.querySelector("#panel [data-action='close-panel']")?.focus();
}

function closePanel() {
  const id = state.returnFocusId;
  state.openTaskId = null;
  updateBoard();
  if (id) document.querySelector(`[data-task-id="${cssEscape(id)}"]`)?.focus();
}

function openAgenda() {
  state.openTaskId = null;
  state.agendaOpen = true;
  const host = document.getElementById("agenda-root");
  if (host) delete host.dataset.open;
  updateBoard();
  document.querySelector("#agenda [data-action='close-agenda']")?.focus();
}

function closeAgenda() {
  state.agendaOpen = false;
  const host = document.getElementById("agenda-root");
  if (host) {
    delete host.dataset.open;
    host.replaceChildren();
  }
  document.body.classList.toggle("panel-open", Boolean(state.openTaskId));
  document.getElementById("agenda-btn")?.focus();
}

async function copyAgenda() {
  const text = state.agendaText || "";
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
  }
  const button = document.getElementById("copy-agenda");
  if (button) button.textContent = ok ? "Copied" : "Copy failed";
  const live = document.getElementById("live");
  if (live) live.textContent = ok ? "Agenda copied." : "Couldn't copy the agenda.";
  window.setTimeout(() => {
    if (button && button.isConnected) button.textContent = "Copy agenda";
  }, 2000);
}

function trapFocus(event, container) {
  const focusable = [...container.querySelectorAll("button, a[href], input, select, textarea")].filter((node) => !node.disabled);
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function onClick(event) {
  if (event.target.closest("a")) return;
  const button = event.target.closest("[data-action]");
  if (!button || !document.getElementById("app").contains(button)) return;
  const action = button.dataset.action;
  if (action === "noop") return;
  if (action === "refresh") {
    if (state.demo) loadDemo();
    else loadRemote();
  } else if (action === "forget") {
    if (!state.forgetArmed) {
      state.forgetArmed = true;
      updateBoard();
      clearTimeout(state.forgetTimer);
      state.forgetTimer = setTimeout(() => {
        state.forgetArmed = false;
        if (state.mode === "board") updateBoard();
      }, 3500);
    } else {
      forgetToken();
    }
  } else if (action === "theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    syncUrl();
    updateThemeButton();
  } else if (action === "view") {
    const nextView = normalizeView(button.dataset.value);
    if (nextView === state.view) return;
    const prevGroup = currentGroupBy();
    state.view = nextView;
    const nextGroup = currentGroupBy();
    if (prevGroup !== nextGroup) {
      const stored = readUI();
      const saved = stored.collapsed && Array.isArray(stored.collapsed[nextGroup]) ? stored.collapsed[nextGroup] : null;
      state.collapsed = new Set(saved || (nextGroup === "status" ? ["done"] : []));
    }
    syncUrl();
    updateBoard();
  } else if (action === "group") {
    const next = button.dataset.value === "project" ? "project" : "status";
    if (next !== state.groupBy) {
      state.groupBy = next;
      const stored = readUI();
      const saved = stored.collapsed && Array.isArray(stored.collapsed[next]) ? stored.collapsed[next] : null;
      state.collapsed = new Set(saved || (next === "status" ? ["done"] : []));
      syncUrl();
      updateBoard();
    }
  } else if (action === "toggle-group") {
    const key = button.dataset.key;
    if (state.collapsed.has(key)) state.collapsed.delete(key);
    else state.collapsed.add(key);
    syncUrl();
    updateBoard();
  } else if (action === "open-task") {
    if (state.agendaOpen) closeAgenda();
    openTask(button.dataset.id);
  } else if (action === "open-agenda") {
    openAgenda();
  } else if (action === "close-agenda") {
    closeAgenda();
  } else if (action === "copy-agenda") {
    copyAgenda();
  } else if (action === "close-panel") {
    closePanel();
  } else if (action === "sort") {
    const key = button.dataset.key;
    if (!TABLE_COLUMNS.some((column) => column.key === key)) return;
    if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
    else state.sort = { key, dir: "asc" };
    updateBoard();
    document.querySelector(`.sort-btn[data-key="${cssEscape(key)}"]`)?.focus();
  } else if (action === "clear-filters") {
    state.filters = { q: "", projects: [], status: "", priority: "", quadrant: "", hideDone: state.filters.hideDone };
    state.projectMenuOpen = false;
    syncUrl();
    updateBoard();
  } else if (action === "toggle-projects") {
    state.projectMenuOpen = !state.projectMenuOpen;
    renderProjectMenu();
  } else if (action === "projects-clear") {
    state.filters.projects = [];
    syncUrl();
    updateBoard();
  } else if (action === "hide-done") {
    state.filters.hideDone = !state.filters.hideDone;
    syncUrl();
    updateBoard();
  } else if (action === "retry") {
    if (state.demo) loadDemo();
    else loadRemote();
  } else if (action === "reset-token") {
    forgetToken({ message: "Paste a new token to continue." });
  } else if (action === "leave-demo") {
    leaveDemo();
  } else if (action === "reveal-token") {
    const input = document.getElementById("token");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(show));
    input.focus();
  } else if (action === "clear-search") {
    state.filters.q = "";
    syncUrl();
    updateBoard();
    document.getElementById("search")?.focus();
  } else if (action === "dismiss-error") {
    state.inlineError = null;
    renderInlineError();
  }
}

function onInput(event) {
  if (event.target.id !== "search") return;
  state.filters.q = event.target.value;
  syncUrl();
  updateBoard();
}

function onChange(event) {
  if (event.target.id === "status-filter") state.filters.status = event.target.value;
  else if (event.target.id === "priority-filter") state.filters.priority = event.target.value;
  else if (event.target.id === "quadrant-filter") state.filters.quadrant = cleanQuadrantFilter(event.target.value);
  else return;
  syncUrl();
  updateBoard();
}

function onSubmit(event) {
  if (event.target.id !== "token-form") return;
  event.preventDefault();
  const token = String(new FormData(event.target).get("token") || "").replace(/^Bearer\s+/i, "").trim();
  const error = document.getElementById("token-error");
  if (!token) {
    if (error) {
      error.hidden = false;
      error.textContent = "Paste a token to continue.";
    }
    return;
  }
  const saved = storage.set(TOKEN_KEY, token);
  state.token = token;
  state.storageWarning = saved ? "" : "This browser blocked local storage, so the token lasts only until you close the tab.";
  state.setupMessage = "";
  loadRemote();
}

function onKeydown(event) {
  if (event.key === "Escape") {
    if (state.agendaOpen) {
      closeAgenda();
      return;
    }
    if (state.projectMenuOpen) {
      state.projectMenuOpen = false;
      renderProjectMenu();
      document.getElementById("project-btn")?.focus();
      return;
    }
    if (state.openTaskId) closePanel();
    return;
  }
  if (event.key === "Tab") {
    const container = state.agendaOpen ? document.getElementById("agenda") : state.openTaskId ? document.getElementById("panel") : null;
    if (container) trapFocus(event, container);
    if (container) return;
  }
  if (event.target.closest && event.target.closest("a")) return;
  const row = event.target.closest && event.target.closest('[data-action="open-task"]');
  if (row && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openTask(row.dataset.id);
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  if (params.has("token")) {
    params.delete("token");
    const qs = params.toString();
    history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
  }
  loadPrefs();
  applyTheme();
  const app = document.getElementById("app");
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("change", onChange);
  app.addEventListener("submit", onSubmit);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("click", (event) => {
    if (!state.projectMenuOpen) return;
    if (event.target.closest("#project-menu") || event.target.closest("#project-btn")) return;
    state.projectMenuOpen = false;
    renderProjectMenu();
  });
  if (state.demo) loadDemo();
  else if (state.token) loadRemote();
  else {
    state.mode = "setup";
    render();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
