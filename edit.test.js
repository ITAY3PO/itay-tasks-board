"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  applyTaskPatch,
  validateDocument,
  nextTaskId,
  quadrantForDrop,
  patchFromDrop,
  formatCommitMessage,
  commitWithRetry,
  encodeBase64Utf8,
  decodeBase64Utf8,
} = require("./edit.js");

const PROJECTS = ["Moon Active", "Travel Town", "UMI", "Personal"];
const STATUSES = ["todo", "in_progress", "waiting", "done"];
const PRIORITIES = ["urgent", "high", "medium", "low"];

function task(partial) {
  return {
    id: partial.id,
    title: partial.title || "Task",
    status: partial.status || "todo",
    priority: partial.priority || "medium",
    due: Object.prototype.hasOwnProperty.call(partial, "due") ? partial.due : null,
    project: partial.project || "Personal",
    waiting_on: Object.prototype.hasOwnProperty.call(partial, "waiting_on") ? partial.waiting_on : null,
    source: partial.source || "notes",
    notes: partial.notes || "",
    created: partial.created || "2026-10-01",
    updated: partial.updated || "2026-10-02",
    ...("quadrant" in partial ? { quadrant: partial.quadrant } : {}),
    ...("parent" in partial ? { parent: partial.parent } : {}),
  };
}

function doc(tasks, extra) {
  return {
    updated: "2026-10-21T09:15:00Z",
    projects: PROJECTS,
    statuses: STATUSES,
    priorities: PRIORITIES,
    tasks,
    ...(extra || {}),
  };
}

function fileWith(tasks) {
  return `${JSON.stringify(doc(tasks), null, 2)}\n`;
}

test("a quadrant patch changes one token and keeps the rest of the file", () => {
  const original = fs.readFileSync(`${__dirname}/demo-tasks.json`, "utf8");
  assert.equal(original.endsWith("\n"), true);
  const patched = applyTaskPatch(original, {
    op: "update",
    id: "d01",
    changes: { quadrant: "Q2" },
    remove: [],
  });
  assert.equal(patched.endsWith("\n"), true);
  let diffs = 0;
  const length = Math.max(original.length, patched.length);
  for (let i = 0; i < length; i += 1) if (original[i] !== patched[i]) diffs += 1;
  assert.equal(diffs, 1);
  assert.equal(JSON.parse(patched).tasks.find((item) => item.id === "d01").quadrant, "Q2");
  assert.equal(JSON.parse(patched).updated, JSON.parse(original).updated);
  const marker = '"title": "Draft a haiku about the printer jam DEMO-2516"';
  const slice = (text) => text.slice(text.indexOf(marker) - 40, text.indexOf(marker) + 220);
  assert.equal(slice(patched), slice(original));
});

test("removing a quadrant deletes that key and keeps key order and the trailing newline", () => {
  const original = `{
  "updated": "2026-10-21T09:15:00Z",
  "tasks": [
    {
      "id": "t034",
      "title": "Write the brief",
      "quadrant": "Q2",
      "notes": "keep me"
    }
  ]
}
`;
  const patched = applyTaskPatch(original, {
    op: "update",
    id: "t034",
    changes: {},
    remove: ["quadrant"],
  });
  assert.equal(patched, `{
  "updated": "2026-10-21T09:15:00Z",
  "tasks": [
    {
      "id": "t034",
      "title": "Write the brief",
      "notes": "keep me"
    }
  ]
}
`);
  assert.equal(JSON.parse(patched).tasks[0].quadrant, undefined);
});

test("adding a quadrant appends the key without reordering existing keys", () => {
  const original = [
    "{",
    "    \"tasks\": [",
    "        {",
    "            \"title\": \"Hi\",",
    "            \"id\": \"t001\"",
    "        }",
    "    ]",
    "}",
    "",
  ].join("\n");
  const patched = applyTaskPatch(original, {
    op: "update",
    id: "t001",
    changes: { quadrant: "Q4" },
    remove: [],
  });
  assert.ok(patched.indexOf('"title"') < patched.indexOf('"id"'));
  assert.ok(patched.indexOf('"id"') < patched.indexOf('"quadrant"'));
  assert.match(patched, /\n            "quadrant": "Q4"\n/);
  assert.equal(patched.endsWith("\n"), true);
  assert.equal(JSON.parse(patched).tasks[0].quadrant, "Q4");
});

test("a patch keeps another task's bytes while editing notes, due, and a cleared parent", () => {
  const original = fileWith([
    task({ id: "t034", title: "Write the brief", quadrant: "Q2", notes: "old", parent: "t001" }),
    task({ id: "t035", title: "Other", notes: "tuesday" }),
  ]);
  const other = original.slice(original.indexOf('"id": "t035"') - 8, original.indexOf('"id": "t035"') + 180);
  const patched = applyTaskPatch(original, {
    op: "update",
    id: "t034",
    changes: { notes: "He said \"hello\"\nשלום", due: null },
    remove: ["parent"],
  });
  const parsed = JSON.parse(patched);
  assert.equal(parsed.tasks[0].notes, "He said \"hello\"\nשלום");
  assert.equal(parsed.tasks[0].due, null);
  assert.equal(parsed.tasks[0].parent, undefined);
  assert.equal(parsed.tasks[0].quadrant, "Q2");
  assert.equal(parsed.tasks[1].title, "Other");
  assert.ok(patched.includes(other.trim().slice(0, 40)));
  assert.equal(patched.endsWith("\n"), true);
});

test("creating a task appends one object and does not rewrite earlier tasks", () => {
  const original = fileWith([task({ id: "t034", title: "Stay" })]);
  const stay = original.slice(original.indexOf('"id": "t034"'), original.indexOf('"updated": "2026-10-02"') + 24);
  const patched = applyTaskPatch(original, {
    op: "create",
    task: task({ id: "t035", title: "New card", parent: "t034", quadrant: "Q1" }),
  });
  assert.ok(patched.includes(stay));
  const parsed = JSON.parse(patched);
  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.tasks[1].id, "t035");
  assert.equal(parsed.tasks[1].parent, "t034");
  assert.equal(parsed.tasks[1].quadrant, "Q1");
  assert.equal(patched.endsWith("\n"), true);
  assert.ok(patched.indexOf('"id": "t034"') < patched.indexOf('"id": "t035"'));
});

test("commit message names a single field change, a cleared quadrant, and a new subtask", () => {
  assert.equal(
    formatCommitMessage({
      op: "update",
      id: "t034",
      changes: { quadrant: "Q1" },
      remove: [],
      before: { quadrant: "Q2" },
    }),
    "board: t034 quadrant Q2 -> Q1",
  );
  assert.equal(
    formatCommitMessage({
      op: "update",
      id: "t034",
      changes: {},
      remove: ["quadrant"],
      before: { quadrant: "Q2" },
    }),
    "board: t034 quadrant Q2 -> unsorted",
  );
  assert.equal(
    formatCommitMessage({
      op: "update",
      id: "t034",
      changes: { title: "New title", due: "2026-10-28" },
      remove: [],
      before: { title: "Old", due: null },
    }),
    "board: t034 update title, due",
  );
  assert.equal(
    formatCommitMessage({ op: "create", task: task({ id: "t084", parent: "t071", title: "Step" }) }),
    "board: t084 create subtask of t071",
  );
});

test("drag targets map onto Q1-Q4 or a removed quadrant, and unknown targets are rejected", () => {
  assert.equal(quadrantForDrop("Q1"), "Q1");
  assert.equal(quadrantForDrop("q2"), "Q2");
  assert.equal(quadrantForDrop("Q3"), "Q3");
  assert.equal(quadrantForDrop("Q4"), "Q4");
  assert.equal(quadrantForDrop("unsorted"), null);
  assert.equal(quadrantForDrop(""), null);
  assert.equal(quadrantForDrop("nope"), undefined);

  const card = task({ id: "t034", quadrant: "Q2", status: "todo" });
  assert.deepEqual(patchFromDrop(card, { kind: "quadrant", target: "Q1" }), {
    noop: false,
    changes: { quadrant: "Q1" },
    remove: [],
  });
  assert.deepEqual(patchFromDrop(card, { kind: "quadrant", target: "unsorted" }), {
    noop: false,
    changes: {},
    remove: ["quadrant"],
  });
  assert.equal(patchFromDrop(card, { kind: "quadrant", target: "Q2" }).noop, true);
  assert.equal(patchFromDrop(card, { kind: "quadrant", target: "Q9" }).error.includes("Unknown quadrant"), true);
  assert.deepEqual(patchFromDrop(card, { kind: "status", target: "done", statuses: STATUSES }), {
    noop: false,
    changes: { status: "done" },
    remove: [],
  });
  assert.equal(patchFromDrop(card, { kind: "status", target: "todo", statuses: STATUSES }).noop, true);
  assert.equal(patchFromDrop(card, { kind: "status", target: "mystery", statuses: STATUSES }).error.includes("Unknown status"), true);
});

test("next free id is the number after the highest tNNN", () => {
  assert.equal(nextTaskId([]), "t001");
  assert.equal(nextTaskId([task({ id: "d01" }), task({ id: "t034" })]), "t035");
  assert.equal(nextTaskId([task({ id: "t001" }), task({ id: "t003" })]), "t004");
  assert.equal(nextTaskId([task({ id: "t099" })]), "t100");
  assert.equal(nextTaskId([task({ id: "t999" })]), "t1000");
});

function validTask(id, extra) {
  return task({ id, title: `Task ${id}`, ...(extra || {}) });
}

test("validation accepts a consistent document and rejects schema, project, and id problems", () => {
  const good = doc([
    validTask("t001", { quadrant: "Q1" }),
    validTask("t002", { parent: "t001", status: "done", priority: "high" }),
  ]);
  assert.deepEqual(validateDocument(good), []);

  const duplicate = doc([validTask("t001"), validTask("t001")]);
  assert.equal(validateDocument(duplicate).some((message) => message.includes("Duplicate id t001")), true);

  const unknownProject = doc([validTask("t001", { project: "Side Quest" })]);
  assert.equal(
    validateDocument(unknownProject).some((message) => message.includes("not a known project")),
    true,
  );

  const badStatus = doc([validTask("t001", { status: "mystery" })]);
  assert.equal(badStatus.tasks[0].status, "mystery");
  assert.equal(validateDocument(badStatus).some((message) => message.includes("status")), true);

  const badQuadrant = doc([validTask("t001", { quadrant: "Q5" })]);
  assert.equal(validateDocument(badQuadrant).some((message) => message.includes("quadrant")), true);

  const badDue = doc([validTask("t001", { due: "soon" })]);
  assert.equal(validateDocument(badDue).some((message) => message.includes("due")), true);
  const impossible = doc([validTask("t001", { due: "2026-02-31" })]);
  assert.equal(validateDocument(impossible).some((message) => message.includes("due")), true);

  const blankTitle = doc([validTask("t001", { title: "   " })]);
  assert.equal(validateDocument(blankTitle).some((message) => message.includes("title")), true);

  const created = doc([validTask("nope", { title: "New" })]);
  assert.equal(
    validateDocument(created, { focusId: "nope", creating: true }).some((message) => message.includes("tNNN")),
    true,
  );
});

test("validation rejects a missing parent, a self parent, and a cycle, and allows a real parent", () => {
  const missing = doc([validTask("t001", { parent: "t999" })]);
  assert.deepEqual(validateDocument(missing).filter((message) => message.includes("parent")), [
    "t001 parent t999 does not exist",
  ]);

  const self = doc([validTask("t001", { parent: "t001" })]);
  assert.equal(validateDocument(self).some((message) => message.includes("cannot be its own parent")), true);

  const cycle = doc([
    validTask("t001", { parent: "t003" }),
    validTask("t002", { parent: "t001" }),
    validTask("t003", { parent: "t002" }),
  ]);
  const cycleErrors = validateDocument(cycle);
  assert.equal(cycleErrors.some((message) => message.startsWith("Parent cycle:")), true);
  assert.match(cycleErrors.find((message) => message.startsWith("Parent cycle:")), /t001 -> t003 -> t002 -> t001|t002 -> t001 -> t003 -> t002|t003 -> t002 -> t001 -> t003/);

  const chain = doc([
    validTask("t001"),
    validTask("t002", { parent: "t001" }),
    validTask("t003", { parent: "t002" }),
  ]);
  assert.deepEqual(validateDocument(chain), []);

  const focused = doc([
    validTask("t001", { quadrant: "Q2" }),
    validTask("d23", { parent: "t000", project: "Personal" }),
  ]);
  assert.deepEqual(validateDocument(focused, { focusId: "t001" }), []);
  assert.equal(
    validateDocument(focused, { focusId: "d23" }).some((message) => message.includes("parent t000 does not exist")),
    true,
  );
});

test("a sha conflict reapplies the patch to the fresh file instead of the stale copy", async () => {
  const base = fileWith([
    task({ id: "t034", quadrant: "Q2", notes: "old" }),
    task({ id: "t035", title: "Other", notes: "original" }),
  ]);
  let remote = base;
  const writes = [];
  const patch = {
    op: "update",
    id: "t034",
    changes: { quadrant: "Q1" },
    remove: [],
    before: { quadrant: "Q2" },
  };
  const result = await commitWithRetry({
    readFile: async () => ({ sha: writes.length === 0 ? "sha-old" : "sha-new", text: remote }),
    writeFile: async ({ sha, text, message }) => {
      writes.push({ sha, text, message });
      if (sha === "sha-old") {
        remote = applyTaskPatch(base, {
          op: "update",
          id: "t035",
          changes: { title: "Tuesday edit" },
          remove: [],
        });
        remote = applyTaskPatch(remote, {
          op: "update",
          id: "t034",
          changes: { notes: "fresh notes" },
          remove: [],
        });
        const error = new Error("conflict");
        error.status = 409;
        throw error;
      }
      remote = text;
      return { sha: "sha-written" };
    },
    patch,
    message: "board: t034 quadrant Q2 -> Q1",
  });

  assert.equal(writes.length, 2);
  assert.equal(writes[0].sha, "sha-old");
  assert.equal(writes[1].sha, "sha-new");
  assert.equal(writes[1].message, "board: t034 quadrant Q2 -> Q1");
  const saved = JSON.parse(result.text);
  assert.equal(saved.tasks[0].quadrant, "Q1");
  assert.equal(saved.tasks[0].notes, "fresh notes");
  assert.equal(saved.tasks[1].title, "Tuesday edit");
  assert.equal(result.attempts, 2);
  assert.equal(result.text.includes('"title": "Other"'), false);
});

test("422 conflicts retry and a third failure stops", async () => {
  let puts = 0;
  const patch = { op: "update", id: "t034", changes: { status: "done" }, remove: [], before: { status: "todo" } };
  const base = fileWith([task({ id: "t034", status: "todo" })]);
  await assert.rejects(
    () => commitWithRetry({
      readFile: async () => ({ sha: `sha-${puts}`, text: base }),
      writeFile: async () => {
        puts += 1;
        const error = new Error("conflict");
        error.status = 422;
        throw error;
      },
      patch,
      message: "board: t034 status todo -> done",
    }),
    (error) => error.status === 422,
  );
  assert.equal(puts, 3);
});

test("validation and missing tasks do not write, and other errors are not retried", async () => {
  const base = fileWith([task({ id: "t034", project: "Personal" })]);
  let puts = 0;
  await assert.rejects(
    () => commitWithRetry({
      readFile: async () => ({ sha: "sha", text: base }),
      writeFile: async () => {
        puts += 1;
        return { sha: "nope" };
      },
      patch: { op: "update", id: "t034", changes: { project: "Side Quest" }, remove: [] },
      message: "board: t034 project Personal -> Side Quest",
    }),
    (error) => error.kind === "validation",
  );
  assert.equal(puts, 0);

  await assert.rejects(
    () => commitWithRetry({
      readFile: async () => ({ sha: "sha", text: base }),
      writeFile: async () => {
        puts += 1;
        return { sha: "nope" };
      },
      patch: { op: "update", id: "t999", changes: { title: "Missing" }, remove: [] },
      message: "board: t999 title none -> Missing",
    }),
    (error) => error.kind === "apply",
  );
  assert.equal(puts, 0);

  await assert.rejects(
    () => commitWithRetry({
      readFile: async () => ({ sha: "sha", text: base }),
      writeFile: async () => {
        puts += 1;
        const error = new Error("nope");
        error.status = 401;
        throw error;
      },
      patch: { op: "update", id: "t034", changes: { title: "Renamed" }, remove: [], before: { title: "Task" } },
      message: "board: t034 title Task -> Renamed",
    }),
    (error) => error.status === 401,
  );
  assert.equal(puts, 1);
});

test("a create id collision picks the next free id from the fresh file", async () => {
  const base = fileWith([task({ id: "t034" })]);
  let remote = base;
  const writes = [];
  const result = await commitWithRetry({
    readFile: async () => ({ sha: writes.length ? "sha-2" : "sha-1", text: remote }),
    writeFile: async ({ sha, text }) => {
      writes.push(sha);
      if (sha === "sha-1") {
        remote = applyTaskPatch(base, { op: "create", task: task({ id: "t035", title: "Tuesday" }) });
        const error = new Error("conflict");
        error.status = 409;
        throw error;
      }
      remote = text;
      return { sha: "sha-3" };
    },
    patch: { op: "create", task: task({ id: "t035", title: "Mine", parent: "t034" }) },
    message: "board: t035 create subtask of t034",
  });
  assert.equal(result.id, "t036");
  assert.equal(result.message, "board: t036 create subtask of t034");
  const saved = JSON.parse(result.text);
  assert.deepEqual(saved.tasks.map((item) => item.id), ["t034", "t035", "t036"]);
  assert.equal(saved.tasks[2].title, "Mine");
  assert.equal(saved.tasks[1].title, "Tuesday");
});

test("base64 round-trips unicode task text", () => {
  const text = "{\n  \"notes\": \"שלום\"\n}\n";
  assert.equal(decodeBase64Utf8(encodeBase64Utf8(text)), text);
});
