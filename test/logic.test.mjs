/**
 * Focused functional test for dsh-file-drop v2's browser half.
 *
 * Scope: the pure decision logic — directory detection/gating and the bounded
 * recursive walk — plus the module contract. This is NOT a substitute for the
 * real-browser check; it exists to catch logic errors before asking for one.
 *
 * Runs the shipped lib/client.js in a stubbed global environment, so the test
 * exercises the artifact that actually gets loaded rather than a copy.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import assert from "node:assert/strict"

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8")

let registered = null
const consoleInfo = []
const listeners = []

// Minimal window/document surface the factory touches at load + apply time.
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      registered = { id, exports: factory(() => { throw new Error("no requires expected") }) }
    },
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  setTimeout,
  clearTimeout,
}
globalThis.document = {
  querySelector: () => null,
  addEventListener: (type, handler) => listeners.push({ type, handler }),
  removeEventListener: () => {},
  body: { dispatchEvent: () => true },
}
globalThis.console = { ...console, info: (m) => consoleInfo.push(m) }

// Load the real artifact.
new Function(source)()

assert.ok(registered !== null, "client.js must register a module factory")
assert.equal(registered.id, "dsh-file-drop", "module id must match the package name")
assert.equal(typeof registered.exports.apply, "function", "must export apply")
assert.deepEqual(registered.exports.inject, [], "must inject nothing")

// Capture the drop handler that apply() installs.
const ctx = { effect: (fn) => fn() }
registered.exports.apply(ctx)
const dropListener = listeners.find((l) => l.type === "drop")
assert.ok(dropListener !== undefined, "apply() must register a drop listener")

// ---- fake DataTransfer / entry graph -------------------------------------
function makeFileEntry(name, size = 10) {
  return {
    isFile: true,
    isDirectory: false,
    file: (resolve) => resolve({ name, size, type: "application/octet-stream" }),
  }
}
/** Directory whose reader yields `children` in the given batch sizes. */
function makeDirEntry(name, children, batchSize = 2) {
  return {
    isFile: false,
    isDirectory: true,
    createReader() {
      let cursor = 0
      return {
        readEntries(resolve) {
          const batch = children.slice(cursor, cursor + batchSize)
          cursor += batch.length
          resolve(batch)
        },
      }
    },
  }
}
function makeTransfer(items) {
  return {
    items: items.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
    })),
    files: items.filter((e) => e.isFile).map((e) => e),
  }
}
/** A drop the handler must decline (plain files, or no entry API). */
function makePlainTransfer(files) {
  return {
    items: files.map(() => ({ kind: "file", webkitGetAsEntry: () => null })),
    files,
  }
}

const calls = []
function invokeDrop(transfer) {
  const event = {
    dataTransfer: transfer,
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
  }
  dropListener.handler(event)
  return event
}

// ---- 1. plain-file drop must be left entirely to the core -----------------
calls.length = 0
invokeDrop(makePlainTransfer([{ name: "a.txt", size: 1 }]))
assert.equal(calls.length, 0, "a plain-file drop must not be intercepted")

// ---- 2. no entry API must be left to the core ----------------------------
calls.length = 0
invokeDrop({ items: [{ kind: "file" }], files: [] })
assert.equal(calls.length, 0, "a drop without the entry API must not be intercepted")

// ---- 3. a folder drop with no composer mounted must be left alone --------
calls.length = 0
invokeDrop(makeTransfer([makeDirEntry("d", [makeFileEntry("x.txt")])]))
assert.equal(
  calls.length,
  0,
  "with no composer mounted the drop must not be intercepted",
)

console.log("PASS: gating (plain files / no entry API / no composer)")

// ---- 4. a folder drop IS expanded and re-dispatched as plain files -------
// Mount a composer so the handler may take over, and capture both the
// synthetic drop and the dragend the handler dispatches.
const dispatched = []
globalThis.document.querySelector = (sel) =>
  sel === '[data-composer-card] input[type="file"]' ? {} : null
globalThis.document.body.dispatchEvent = (event) => {
  dispatched.push({ target: "body", type: event.type, files: [...(event.dataTransfer?.files ?? [])] })
  return true
}
globalThis.DragEvent = class {
  constructor(type, init = {}) {
    this.type = type
    this.dataTransfer = init.dataTransfer
  }
}
globalThis.DataTransfer = class {
  constructor() {
    this.items = { add: (file) => this._files.push(file) }
    this._files = []
  }
  get files() {
    return this._files
  }
}
globalThis.window.dispatchEvent = (event) => {
  dispatched.push({ target: "window", type: event.type })
  return true
}

// Folder: a/ (one file) + b/ (nested dir with one file) + top.txt — exercises
// batching (batchSize 1) and recursion.
const nested = makeDirEntry("b", [makeFileEntry("deep.txt")], 1)
const root = makeDirEntry(
  "root",
  [makeFileEntry("top.txt"), nested],
  1,
)
calls.length = 0
invokeDrop(makeTransfer([root]))
await new Promise((r) => setTimeout(r, 50))

assert.ok(calls.includes("preventDefault"), "a folder drop must be intercepted")
assert.ok(calls.includes("stopPropagation"), "a folder drop must not reach the core")
const syntheticDrop = dispatched.find((d) => d.type === "drop")
assert.ok(syntheticDrop !== undefined, "expanded files must be re-dispatched as a drop")
assert.deepEqual(
  syntheticDrop.files.map((f) => f.name).sort(),
  ["deep.txt", "top.txt"],
  "every readable file below the folder must be collected, recursively",
)
assert.ok(
  dispatched.some((d) => d.type === "dragend"),
  "a dragend must be dispatched so the core clears its drop overlay",
)
console.log("PASS: folder expansion (recursive, batched) + dragend reset")

// ---- 5. an unreadable folder must still reset the drag -------------------
dispatched.length = 0
const brokenDir = {
  isFile: false,
  isDirectory: true,
  createReader: () => ({
    readEntries: (_ok, reject) => reject(new Error("permission denied")),
  }),
}
invokeDrop(makeTransfer([brokenDir]))
await new Promise((r) => setTimeout(r, 50))
assert.equal(
  dispatched.filter((d) => d.type === "drop").length,
  0,
  "no synthetic drop when nothing could be read",
)
assert.ok(
  dispatched.some((d) => d.type === "dragend"),
  "the overlay must still be reset when a folder cannot be read",
)
console.log("PASS: unreadable folder resets the overlay without dispatching")

console.log("PASS: module contract and listener registration")
console.log("info log:", consoleInfo[0])
