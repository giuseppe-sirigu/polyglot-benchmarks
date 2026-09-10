// The 6 benchmark tasks — a faithful transcription of Polyglot's own scenario suite
// (packages/core/src/testing/scenarios.ts) so every agent under test runs identical
// work. `done(files, finalText)` is a formatting-tolerant success check; when a task
// ends in "verify it runs", `verify` also executes the entry point and checks output,
// so a semantically-correct solution in a different style still counts.

export const SCENARIOS = [
  {
    name: "add-count-command",
    files: {
      "todo.mjs":
        'import { readFileSync, writeFileSync } from "node:fs";\n\nconst FILE = "todos.json";\nconst todos = JSON.parse(readFileSync(FILE, "utf8"));\nconst [cmd, ...rest] = process.argv.slice(2);\n\nswitch (cmd) {\n  case "add":\n    todos.push({ text: rest.join(" "), done: false });\n    writeFileSync(FILE, JSON.stringify(todos, null, 2));\n    break;\n  case "done":\n    todos[Number(rest[0])].done = true;\n    writeFileSync(FILE, JSON.stringify(todos, null, 2));\n    break;\n  case "list":\n    todos.forEach((t, i) => console.log(`${i}. [${t.done ? "x" : " "}] ${t.text}`));\n    break;\n  default:\n    console.log("usage: todo <add|done|list>");\n}\n',
      "todos.json": '[\n  { "text": "buy milk", "done": false },\n  { "text": "write tests", "done": true }\n]\n',
    },
    prompt:
      'Read todo.mjs, then add a "count" command to the switch that prints the number of todos. Match the existing code style.',
    done: (f) => /case\s+["']count["']/.test(f["todo.mjs"] || "") && /\.length/.test(f["todo.mjs"] || ""),
    verify: { cmd: ["node", "todo.mjs", "count"], expect: /(^|\D)2(\D|$)/ },
  },
  {
    name: "fix-bug",
    files: {
      "sum.mjs":
        "export function sum(nums) {\n  let total = 0;\n  for (let i = 1; i < nums.length; i++) {\n    total += nums[i];\n  }\n  return total;\n}\n\nconsole.log(sum([10, 20, 30]));\n",
    },
    prompt:
      "sum.mjs prints 50 for [10, 20, 30] but should print 60. Find and fix the bug, then verify.",
    done: () => true, // decided by verify
    verify: { cmd: ["node", "sum.mjs"], expect: /(^|\D)60(\D|$)/ },
  },
  {
    name: "read-and-report",
    files: { "service.json": '{\n  "name": "api",\n  "port": 8443,\n  "replicas": 3\n}\n' },
    prompt: "What port does service.json configure? Just tell me the number.",
    done: (f, finalText) => /8443/.test(finalText || ""),
    readOnly: true,
  },
  {
    name: "delete-dead-code",
    files: {
      "util.mjs":
        "export function used(x) {\n  return x * 2;\n}\n\nexport function unused(x) {\n  // legacy, nothing calls this\n  return x + 1;\n}\n\nconsole.log(used(21));\n",
    },
    prompt: "Remove the unused() function from util.mjs. Nothing imports it.",
    done: (f) => !/\bunused\b/.test(f["util.mjs"] || "") && /\bused\b/.test(f["util.mjs"] || ""),
    verify: { cmd: ["node", "util.mjs"], expect: /(^|\D)42(\D|$)/ },
  },
  {
    name: "rename-across-files",
    files: {
      "math.mjs": "export function add(a, b) {\n  return a + b;\n}\n",
      "main.mjs": 'import { add } from "./math.mjs";\n\nconsole.log(add(2, 3));\n',
    },
    prompt:
      'Rename the exported "add" function in math.mjs to "sum" and update main.mjs to match, then run main.mjs to check it still works.',
    done: (f) =>
      /\bsum\b/.test(f["math.mjs"] || "") &&
      !/\badd\b/.test(f["math.mjs"] || "") &&
      /\bsum\b/.test(f["main.mjs"] || "") &&
      !/\badd\b/.test(f["main.mjs"] || ""),
    verify: { cmd: ["node", "main.mjs"], expect: /(^|\D)5(\D|$)/ },
  },
  {
    name: "locate-and-fix",
    files: {
      "utils.mjs": "export function formatName(first, last) {\n  return `${last}, ${first}`;\n}\n",
      "greet.mjs":
        'import { formatName } from "./utils.mjs";\n\nexport function greet(first, last) {\n  return `Hello, ${fmtName(first, last)}!`;\n}\n',
      "main.mjs": 'import { greet } from "./greet.mjs";\n\nconsole.log(greet("Ada", "Lovelace"));\n',
    },
    prompt: "`node main.mjs` throws a ReferenceError. Find the cause and fix it, then verify it runs.",
    done: (f) => !/fmtName/.test(f["greet.mjs"] || ""),
    verify: { cmd: ["node", "main.mjs"], expect: /Hello, Lovelace, Ada!/ },
  },
];
