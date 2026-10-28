"use strict";

// Pure task-edit helpers. No DOM and no network.
// Loaded as a classic script in the browser and as CommonJS in unit tests.
//
// Writes are per-task patches applied to the latest tasks.json text. The
// patcher splices one task object and leaves every other byte (indent, key
// order, trailing newline) alone so a concurrent edit of a different task
// is not overwritten.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ItayEdit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STATUSES = ["todo", "in_progress", "waiting", "done"];
  const PRIORITIES = ["urgent", "high", "medium", "low"];
  const QUADRANTS = ["Q1", "Q2", "Q3", "Q4"];
  const FIELD_ORDER = ["title", "notes", "due", "status", "quadrant", "project", "parent", "priority"];
  const CREATE_ORDER = [
    "id",
    "title",
    "status",
    "priority",
    "quadrant",
    "due",
    "project",
    "waiting_on",
    "source",
    "notes",
    "tldr",
    "created",
    "updated",
    "parent",
  ];
  const REQUIRED_KEYS = ["id", "title", "status", "priority", "due", "project", "waiting_on", "source", "notes", "created", "updated"];
  const MAX_ATTEMPTS = 3;

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function fileNewline(text) {
    return text.includes("\r\n") ? "\r\n" : "\n";
  }

  function skipWs(text, index) {
    let i = index;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    return i;
  }

  function skipString(text, index) {
    if (text[index] !== '"') throw new Error("Expected a string");
    let i = index + 1;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === '"') return i + 1;
      i += 1;
    }
    throw new Error("Unterminated string in tasks.json");
  }

  function skipValue(text, index) {
    const i = skipWs(text, index);
    const ch = text[i];
    if (ch === '"') return skipString(text, i);
    if (ch === "{" || ch === "[") return skipContainer(text, i).end;
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9eE+.\-]/.test(text[j])) j += 1;
      return j;
    }
    if (text.startsWith("true", i) || text.startsWith("null", i)) return i + 4;
    if (text.startsWith("false", i)) return i + 5;
    throw new Error("Couldn't read a JSON value in tasks.json");
  }

  function skipContainer(text, index) {
    const open = text[index];
    const close = open === "{" ? "}" : "]";
    let i = index + 1;
    while (i < text.length) {
      i = skipWs(text, i);
      if (text[i] === close) return { start: index, end: i + 1 };
      if (open === "{") {
        const keyEnd = skipString(text, i);
        i = skipWs(text, keyEnd);
        if (text[i] !== ":") throw new Error("Expected a colon in tasks.json");
        i = skipValue(text, i + 1);
      } else {
        i = skipValue(text, i);
      }
      i = skipWs(text, i);
      if (text[i] === ",") i += 1;
    }
    throw new Error("Unterminated JSON in tasks.json");
  }

  function listObjectProperties(text, objStart) {
    if (text[objStart] !== "{") throw new Error("Expected an object");
    const props = [];
    let i = objStart + 1;
    while (i < text.length) {
      i = skipWs(text, i);
      if (text[i] === "}") return { props, close: i, end: i + 1 };
      const keyStart = i;
      const keyEnd = skipString(text, i);
      let key = "";
      try {
        key = JSON.parse(text.slice(keyStart, keyEnd));
      } catch {
        throw new Error("Couldn't read an object key in tasks.json");
      }
      i = skipWs(text, keyEnd);
      if (text[i] !== ":") throw new Error("Expected a colon in tasks.json");
      const colon = i;
      const valueStart = skipWs(text, i + 1);
      const valueEnd = skipValue(text, valueStart);
      const prop = { key, keyStart, keyEnd, colon, valueStart, valueEnd, comma: null };
      i = skipWs(text, valueEnd);
      if (text[i] === ",") {
        prop.comma = i;
        i += 1;
      }
      props.push(prop);
    }
    throw new Error("Unterminated object in tasks.json");
  }

  function listArrayElements(text, arrayStart) {
    if (text[arrayStart] !== "[") throw new Error("Expected an array");
    const elements = [];
    let i = arrayStart + 1;
    while (i < text.length) {
      i = skipWs(text, i);
      if (text[i] === "]") return { elements, close: i, end: i + 1 };
      const start = i;
      const end = skipValue(text, i);
      elements.push({ start, end });
      i = skipWs(text, end);
      if (text[i] === ",") i += 1;
    }
    throw new Error("Unterminated array in tasks.json");
  }

  function findRootProperty(text, name) {
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    i = skipWs(text, i);
    if (text[i] !== "{") throw new Error("tasks.json must be a JSON object");
    const { props } = listObjectProperties(text, i);
    return props.find((prop) => prop.key === name) || null;
  }

  function findTaskSpan(text, id) {
    const tasksProp = findRootProperty(text, "tasks");
    if (!tasksProp) throw new Error("tasks.json has no tasks array");
    const arrayStart = tasksProp.valueStart;
    if (text[arrayStart] !== "[") throw new Error("tasks.json tasks field is not an array");
    const { elements } = listArrayElements(text, arrayStart);
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (text[element.start] !== "{") continue;
      const { props } = listObjectProperties(text, element.start);
      const idProp = props.find((prop) => prop.key === "id");
      if (!idProp) continue;
      let value;
      try {
        value = JSON.parse(text.slice(idProp.valueStart, idProp.valueEnd));
      } catch {
        continue;
      }
      if (value === id) return { start: element.start, end: element.end, arrayStart };
    }
    return null;
  }

  function lineBounds(text, index) {
    const start = text.lastIndexOf("\n", index - 1) + 1;
    let end = text.indexOf("\n", index);
    if (end === -1) end = text.length;
    else end += 1;
    return { start, end };
  }

  function indentAt(text, index) {
    const start = text.lastIndexOf("\n", index - 1) + 1;
    let i = start;
    while (i < index && (text[i] === " " || text[i] === "\t")) i += 1;
    if (i < index) return "";
    return text.slice(start, index);
  }

  function propertyOwnsLine(text, prop) {
    const line = lineBounds(text, prop.keyStart);
    const before = text.slice(line.start, prop.keyStart);
    if (!/^[\t ]*$/.test(before)) return false;
    const after = text.slice(prop.valueEnd, line.end).replace(/\r?\n$/, "");
    return /^,?\s*$/.test(after);
  }

  function removeProperty(text, objStart, key) {
    const { props } = listObjectProperties(text, objStart);
    const index = props.findIndex((prop) => prop.key === key);
    if (index < 0) return text;
    const prop = props[index];
    const prev = index > 0 ? props[index - 1] : null;
    const next = index < props.length - 1 ? props[index + 1] : null;
    if (propertyOwnsLine(text, prop)) {
      const line = lineBounds(text, prop.keyStart);
      let nextText = text.slice(0, line.start) + text.slice(line.end);
      if (!next && prev && prev.comma != null && prev.comma < line.start) {
        nextText = nextText.slice(0, prev.comma) + nextText.slice(prev.comma + 1);
      }
      return nextText;
    }
    if (!next && prev && prev.comma != null) {
      return text.slice(0, prev.comma) + text.slice(prop.valueEnd);
    }
    if (prop.comma != null) return text.slice(0, prop.keyStart) + text.slice(prop.comma + 1);
    return text.slice(0, prop.keyStart) + text.slice(prop.valueEnd);
  }

  function addProperty(text, objStart, key, value) {
    const located = listObjectProperties(text, objStart);
    const rendered = `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    const nl = fileNewline(text);
    if (!located.props.length) {
      const insert = `${nl}  ${rendered}${nl}`;
      return text.slice(0, located.close) + insert + text.slice(located.close);
    }
    const multiline = text.slice(objStart, located.end).includes("\n");
    if (!multiline) {
      return `${text.slice(0, located.close)}, ${rendered}${text.slice(located.close)}`;
    }
    const last = located.props[located.props.length - 1];
    const propIndent = indentAt(text, last.keyStart) || "  ";
    const insertAt = last.comma != null ? last.comma + 1 : last.valueEnd;
    const needsComma = last.comma == null;
    const addition = `${needsComma ? "," : ""}${nl}${propIndent}${rendered}`;
    return text.slice(0, insertAt) + addition + text.slice(insertAt);
  }

  function setProperty(text, objStart, key, value) {
    const { props } = listObjectProperties(text, objStart);
    const existing = props.find((prop) => prop.key === key);
    if (!existing) return addProperty(text, objStart, key, value);
    const rendered = JSON.stringify(value);
    return text.slice(0, existing.valueStart) + rendered + text.slice(existing.valueEnd);
  }

  function unitFrom(indent) {
    if (!indent) return "  ";
    return indent.includes("\t") ? "\t" : "  ";
  }

  function indentsForNewTask(text, arrayStart, sampleStart) {
    if (sampleStart != null) {
      const { props, close } = listObjectProperties(text, sampleStart);
      const braceIndent = indentAt(text, sampleStart);
      const propIndent = props.length ? indentAt(text, props[0].keyStart) : `${braceIndent}${unitFrom(braceIndent)}`;
      return { braceIndent, propIndent, closeIndent: indentAt(text, close) };
    }
    const { close } = listArrayElements(text, arrayStart);
    const closeIndent = indentAt(text, close);
    const unit = unitFrom(closeIndent || "  ");
    const braceIndent = `${closeIndent}${unit}`;
    return { braceIndent, propIndent: `${braceIndent}${unit}`, closeIndent };
  }

  function taskEntries(task) {
    const entries = [];
    CREATE_ORDER.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(task, key)) return;
      if (task[key] === undefined) return;
      if ((key === "quadrant" || key === "parent" || key === "tldr") && (task[key] == null || task[key] === "")) return;
      entries.push([key, task[key]]);
    });
    Object.keys(task).forEach((key) => {
      if (CREATE_ORDER.includes(key) || task[key] === undefined) return;
      entries.push([key, task[key]]);
    });
    return entries;
  }

  function formatTaskBlock(text, arrayStart, sampleStart, task) {
    const nl = fileNewline(text);
    const { braceIndent, propIndent } = indentsForNewTask(text, arrayStart, sampleStart);
    const lines = taskEntries(task).map(([key, value]) => `${propIndent}${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    return `${nl}${braceIndent}{${nl}${lines.join(`,${nl}`)}${nl}${braceIndent}}`;
  }

  function insertTask(text, task) {
    const tasksProp = findRootProperty(text, "tasks");
    if (!tasksProp || text[tasksProp.valueStart] !== "[") throw new Error("tasks.json has no tasks array");
    const { elements } = listArrayElements(text, tasksProp.valueStart);
    let sampleStart = null;
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      if (text[elements[i].start] === "{") {
        sampleStart = elements[i].start;
        break;
      }
    }
    const block = formatTaskBlock(text, tasksProp.valueStart, sampleStart, task);
    if (!elements.length) return text.slice(0, tasksProp.valueStart + 1) + block + text.slice(tasksProp.valueStart + 1);
    const last = elements[elements.length - 1];
    return text.slice(0, last.end) + "," + block + text.slice(last.end);
  }

  function applyTaskPatch(text, patch) {
    if (typeof text !== "string") throw new Error("tasks.json must be text");
    const spec = patch || {};
    const trailing = text.endsWith("\n") || text.endsWith("\r\n");
    let next = text;
    if (spec.op === "create") {
      if (!spec.task || typeof spec.task !== "object") throw new Error("A new task needs a task object");
      const id = spec.task.id;
      if (findTaskSpan(next, id)) {
        const error = new Error(`Task ${id} already exists`);
        error.kind = "apply";
        throw error;
      }
      next = insertTask(next, spec.task);
    } else if (spec.op === "update") {
      const id = spec.id;
      const remove = Array.isArray(spec.remove) ? spec.remove : [];
      const changes = spec.changes && typeof spec.changes === "object" ? spec.changes : {};
      remove.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(changes, key)) return;
        const span = findTaskSpan(next, id);
        if (!span) {
          const error = new Error(`Task ${id} was not found in tasks.json`);
          error.kind = "apply";
          throw error;
        }
        next = removeProperty(next, span.start, key);
      });
      Object.keys(changes).forEach((key) => {
        const span = findTaskSpan(next, id);
        if (!span) {
          const error = new Error(`Task ${id} was not found in tasks.json`);
          error.kind = "apply";
          throw error;
        }
        next = setProperty(next, span.start, key, changes[key]);
      });
    } else {
      throw new Error("Unknown task patch");
    }
    const endsWithNewline = next.endsWith("\n");
    if (trailing && !endsWithNewline) next += fileNewline(text);
    if (!trailing && endsWithNewline) next = next.replace(/(?:\r\n|\n)$/, "");
    return next;
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function allowedList(listed, canonical) {
    if (!Array.isArray(listed) || !listed.length) return canonical.slice();
    return listed.filter((item) => typeof item === "string" && canonical.includes(item));
  }

  function push(errors, message) {
    if (!errors.includes(message)) errors.push(message);
  }

  function schemaErrors(task, doc, options) {
    const errors = [];
    const creating = Boolean(options && options.creating);
    if (!isObject(task)) {
      push(errors, "A task must be an object");
      return errors;
    }
    const id = task.id;
    if (typeof id !== "string" || !id.trim()) push(errors, "Task id is required");
    else if (creating && !/^t\d{3,}$/.test(id)) push(errors, `New task id ${id} must look like tNNN`);
    REQUIRED_KEYS.forEach((key) => {
      if (key === "id") return;
      if (!Object.prototype.hasOwnProperty.call(task, key)) push(errors, `${id || "Task"} is missing ${key}`);
    });
    if (typeof task.title !== "string" || !task.title.trim()) push(errors, `${id || "Task"} needs a title`);
    const statuses = allowedList(doc && doc.statuses, STATUSES);
    if (Object.prototype.hasOwnProperty.call(task, "status") && !statuses.includes(task.status)) {
      push(errors, `${id || "Task"} has status ${JSON.stringify(task.status)}, expected ${statuses.join(", ")}`);
    }
    const priorities = allowedList(doc && doc.priorities, PRIORITIES);
    if (Object.prototype.hasOwnProperty.call(task, "priority") && !priorities.includes(task.priority)) {
      push(errors, `${id || "Task"} has priority ${JSON.stringify(task.priority)}, expected ${priorities.join(", ")}`);
    }
    if (Object.prototype.hasOwnProperty.call(task, "due") && task.due != null && !isValidDate(task.due)) {
      push(errors, `${id || "Task"} due must be YYYY-MM-DD or null`);
    }
    const projects = doc && Array.isArray(doc.projects) ? doc.projects : [];
    if (Object.prototype.hasOwnProperty.call(task, "project")) {
      if (typeof task.project !== "string" || !projects.includes(task.project)) {
        push(errors, `${id || "Task"} project ${JSON.stringify(task.project)} is not a known project`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(task, "waiting_on") && task.waiting_on != null && typeof task.waiting_on !== "string") {
      push(errors, `${id || "Task"} waiting_on must be a string or null`);
    }
    ["source", "notes", "created", "updated", "tldr"].forEach((key) => {
      if (task[key] != null && typeof task[key] !== "string") push(errors, `${id || "Task"} ${key} must be a string`);
    });
    if (Object.prototype.hasOwnProperty.call(task, "quadrant") && task.quadrant != null && task.quadrant !== "" && !QUADRANTS.includes(task.quadrant)) {
      push(errors, `${id || "Task"} quadrant must be Q1, Q2, Q3, Q4, or omitted`);
    }
    if (task.parent != null && task.parent !== "" && typeof task.parent !== "string") {
      push(errors, `${id || "Task"} parent must be a task id`);
    }
    if (task.linear != null) {
      if (!Array.isArray(task.linear)) push(errors, `${id || "Task"} linear must be a list`);
      else {
        task.linear.forEach((item) => {
          if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) {
            push(errors, `${id || "Task"} linear entries need an id`);
          }
        });
      }
    }
    if (task.scheduled != null) {
      if (!isObject(task.scheduled) || typeof task.scheduled.start !== "string" || !task.scheduled.start) {
        push(errors, `${id || "Task"} scheduled needs a start`);
      }
    }
    return errors;
  }

  function parentGraphErrors(tasks, focusId) {
    const errors = [];
    const list = Array.isArray(tasks) ? tasks : [];
    const byId = new Map();
    const seen = new Set();
    list.forEach((task) => {
      if (!isObject(task) || typeof task.id !== "string" || !task.id) return;
      if (seen.has(task.id)) push(errors, `Duplicate id ${task.id}`);
      else {
        seen.add(task.id);
        byId.set(task.id, task);
      }
    });

    function checkParent(task) {
      const parent = task.parent;
      if (parent == null || parent === "") return;
      if (typeof parent !== "string") return;
      if (parent === task.id) {
        push(errors, `${task.id} cannot be its own parent`);
        return;
      }
      if (!byId.has(parent)) push(errors, `${task.id} parent ${parent} does not exist`);
    }

    if (focusId) {
      const focused = list.find((task) => task && task.id === focusId);
      if (focused) checkParent(focused);
    } else {
      list.forEach((task) => {
        if (isObject(task)) checkParent(task);
      });
    }

    const color = new Map();
    const reported = new Set();
    function visit(id, stack) {
      if (color.get(id) === 2) return;
      if (color.get(id) === 1) {
        const start = stack.indexOf(id);
        const cycle = [...stack.slice(start), id];
        const key = cycle.slice(0, -1).slice().sort().join("|");
        if (!reported.has(key)) {
          reported.add(key);
          push(errors, `Parent cycle: ${cycle.join(" -> ")}`);
        }
        return;
      }
      color.set(id, 1);
      const task = byId.get(id);
      const parent = task && task.parent;
      if (typeof parent === "string" && parent && parent !== id && byId.has(parent)) visit(parent, [...stack, id]);
      color.set(id, 2);
    }
    byId.forEach((_task, id) => visit(id, []));
    return errors;
  }

  function validateDocument(doc, options) {
    const errors = [];
    if (!isObject(doc) || !Array.isArray(doc.tasks)) {
      return ["tasks.json must be an object with a tasks array"];
    }
    const focusId = options && options.focusId;
    const creating = Boolean(options && options.creating);
    if (focusId) {
      const task = doc.tasks.find((item) => item && item.id === focusId);
      if (!task) push(errors, `Task ${focusId} was not found in tasks.json`);
      else schemaErrors(task, doc, { creating }).forEach((message) => push(errors, message));
    } else {
      doc.tasks.forEach((task) => {
        schemaErrors(task, doc, { creating: false }).forEach((message) => push(errors, message));
      });
    }
    parentGraphErrors(doc.tasks, focusId || "").forEach((message) => push(errors, message));
    return errors;
  }

  function nextTaskId(tasks) {
    const used = new Set();
    let max = 0;
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
      const id = task && task.id != null ? String(task.id).trim() : "";
      const match = /^t(\d+)$/.exec(id);
      if (!match) return;
      const n = Number(match[1]);
      if (!n) return;
      used.add(n);
      if (n > max) max = n;
    });
    let n = max + 1;
    while (used.has(n)) n += 1;
    return `t${String(n).padStart(3, "0")}`;
  }

  function quadrantForDrop(target) {
    const text = String(target == null ? "" : target).trim();
    if (!text || text.toLowerCase() === "unsorted") return null;
    const key = text.toUpperCase();
    if (QUADRANTS.includes(key)) return key;
    return undefined;
  }

  function statusForDrop(target, statuses) {
    const allowed = allowedList(statuses, STATUSES);
    const text = String(target == null ? "" : target).trim();
    if (allowed.includes(text)) return text;
    return undefined;
  }

  function currentQuadrant(task) {
    const value = task && typeof task.quadrant === "string" ? task.quadrant.trim().toUpperCase() : "";
    return QUADRANTS.includes(value) ? value : "";
  }

  function patchFromDrop(task, drop) {
    const spec = drop || {};
    if (spec.kind === "quadrant") {
      const next = quadrantForDrop(spec.target);
      if (next === undefined) return { error: `Unknown quadrant ${spec.target}` };
      const current = currentQuadrant(task);
      if ((current || null) === next) return { noop: true, changes: {}, remove: [] };
      if (next == null) return { noop: false, changes: {}, remove: ["quadrant"] };
      return { noop: false, changes: { quadrant: next }, remove: [] };
    }
    if (spec.kind === "status") {
      const next = statusForDrop(spec.target, spec.statuses);
      if (next === undefined) return { error: `Unknown status ${spec.target}` };
      const current = task && task.status;
      if (current === next) return { noop: true, changes: {}, remove: [] };
      return { noop: false, changes: { status: next }, remove: [] };
    }
    return { error: "Unknown drop" };
  }

  function clip(value) {
    const text = String(value).replace(/\s+/g, " ").trim();
    if (text.length <= 60) return text;
    return `${text.slice(0, 57)}...`;
  }

  function displayChangeValue(key, value) {
    if (key === "quadrant" && (value == null || value === "")) return "unsorted";
    if (value == null || value === "") return "none";
    return clip(value);
  }

  function formatCommitMessage(patch) {
    const spec = patch || {};
    const id = spec.op === "create" && spec.task ? spec.task.id : spec.id;
    if (spec.op === "create") {
      const parent = spec.task && spec.task.parent;
      if (parent) return `board: ${id} create subtask of ${parent}`;
      return `board: ${id} create`;
    }
    const changes = spec.changes && typeof spec.changes === "object" ? spec.changes : {};
    const remove = Array.isArray(spec.remove) ? spec.remove.filter((key) => !Object.prototype.hasOwnProperty.call(changes, key)) : [];
    const keys = [];
    FIELD_ORDER.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(changes, key) || remove.includes(key)) keys.push(key);
    });
    Object.keys(changes).forEach((key) => {
      if (!keys.includes(key)) keys.push(key);
    });
    remove.forEach((key) => {
      if (!keys.includes(key)) keys.push(key);
    });
    if (keys.length === 1) {
      const key = keys[0];
      const before = spec.before && typeof spec.before === "object" ? spec.before : {};
      const from = displayChangeValue(key, before[key]);
      const to = remove.includes(key) ? displayChangeValue(key, key === "quadrant" ? "" : null) : displayChangeValue(key, changes[key]);
      return `board: ${id} ${key} ${from} -> ${to}`;
    }
    if (!keys.length) return `board: ${id} update`;
    return `board: ${id} update ${keys.join(", ")}`;
  }

  function retargetCreate(patch, doc) {
    if (!patch || patch.op !== "create" || !patch.task) return patch;
    const ids = new Set((doc.tasks || []).map((task) => task && task.id));
    if (!ids.has(patch.task.id)) return patch;
    const id = nextTaskId(doc.tasks);
    return { ...patch, id, task: { ...patch.task, id } };
  }

  async function commitWithRetry(options) {
    const source = options || {};
    const maxAttempts = Number(source.maxAttempts) > 0 ? Math.round(Number(source.maxAttempts)) : MAX_ATTEMPTS;
    if (typeof source.readFile !== "function" || typeof source.writeFile !== "function") {
      throw new Error("commitWithRetry needs readFile and writeFile");
    }
    let patch = source.patch;
    let message = source.message || formatCommitMessage(patch);
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const file = await source.readFile();
      if (!file || typeof file.text !== "string" || typeof file.sha !== "string" || !file.sha) {
        const error = new Error("Couldn't read tasks.json");
        error.kind = "read";
        throw error;
      }
      let fresh;
      try {
        fresh = JSON.parse(file.text.replace(/^\uFEFF/, ""));
      } catch {
        const error = new Error("tasks.json is not valid JSON");
        error.kind = "parse";
        throw error;
      }
      const working = retargetCreate(patch, fresh);
      if (working !== patch && working.task && patch.task && working.task.id !== patch.task.id) {
        message = String(message).split(patch.task.id).join(working.task.id);
        patch = working;
      }
      let nextText;
      try {
        nextText = applyTaskPatch(file.text, working);
      } catch (error) {
        if (error && !error.kind) error.kind = "apply";
        throw error;
      }
      let doc;
      try {
        doc = JSON.parse(nextText.replace(/^\uFEFF/, ""));
      } catch {
        const error = new Error("Patched tasks.json is not valid JSON");
        error.kind = "apply";
        throw error;
      }
      const focusId = working.op === "create" ? working.task.id : working.id;
      const errors = validateDocument(doc, { focusId, creating: working.op === "create" });
      if (errors.length) {
        const error = new Error(errors[0]);
        error.kind = "validation";
        error.errors = errors;
        throw error;
      }
      try {
        const written = await source.writeFile({ sha: file.sha, text: nextText, message });
        return {
          text: nextText,
          sha: written && written.sha,
          attempts: attempt,
          id: focusId,
          message,
        };
      } catch (error) {
        lastError = error;
        const status = error && error.status;
        if ((status === 409 || status === 422) && attempt < maxAttempts) continue;
        throw error;
      }
    }
    throw lastError || new Error("Couldn't save tasks.json");
  }

  function encodeBase64Utf8(text) {
    const bytes = new TextEncoder().encode(String(text));
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function decodeBase64Utf8(b64) {
    const binary = atob(String(b64 || "").replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  return {
    STATUSES,
    PRIORITIES,
    QUADRANTS,
    MAX_ATTEMPTS,
    applyTaskPatch,
    validateDocument,
    parentGraphErrors,
    nextTaskId,
    quadrantForDrop,
    statusForDrop,
    patchFromDrop,
    formatCommitMessage,
    commitWithRetry,
    retargetCreate,
    isValidDate,
    encodeBase64Utf8,
    decodeBase64Utf8,
  };
});
