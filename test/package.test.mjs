/**
 * Contract validation for the dsh-file-drop package.
 *
 * Checks the two artifact-shape rules the DSH loader relies on, so a packaging
 * mistake fails here instead of at profile boot:
 *   - the Host half is a real ESM module exporting { name, inject, apply }
 *   - the browser half is a __ModuleLoader__ bundle script, not an ESM module,
 *     whose factory id equals the package name
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import assert from "node:assert/strict"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

// ---- manifest ------------------------------------------------------------
assert.equal(pkg.name, "dsh-file-drop")
assert.equal(pkg.type, "module")
assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml")
assert.equal(pkg.dsh.client.platform, "web")
assert.equal(pkg.exports["."].default, "./lib/index.js")
assert.equal(pkg.exports["./client"].default, "./lib/client.js")

// ---- Host half -----------------------------------------------------------
const host = await import(
  new URL(`file://${join(root, "lib", "index.js").replace(/\\/g, "/")}`).href
)
assert.equal(typeof host.apply, "function", "Host half must export apply")
assert.equal(typeof host.name, "string", "Host half must export name")
assert.ok(Array.isArray(host.inject), "Host half must export an inject array")
assert.deepEqual(host.inject, [], "Host half must require no services")
assert.equal(host.default.name, host.name, "default export must mirror named exports")
host.apply() // must be safe with no context and no services

// ---- browser half --------------------------------------------------------
const client = readFileSync(join(root, "lib", "client.js"), "utf8")
// Strip a leading comment block: shipped bundles open with the loader call, but
// a maintenance comment above it is still a valid plain script.
const code = client.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")
assert.ok(
  code.startsWith("window.__ModuleLoader__.load({"),
  "browser half must be a __ModuleLoader__ bundle, not an ESM module",
)
assert.ok(
  client.includes('id: "dsh-file-drop"'),
  "bundle factory id must equal the package name",
)
assert.ok(
  !/^\s*(import|export)\s/m.test(code),
  "browser half must not use ESM import/export syntax",
)

console.log("PASS: manifest (name, bundle patch, client entry)")
console.log("PASS: Host half shape + no-op apply()")
console.log("PASS: browser half bundle shape and factory id")
