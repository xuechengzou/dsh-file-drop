/**
 * dsh-file-drop — Host half.
 *
 * This plugin is intentionally a no-op on the Host. The DSH core already owns
 * the complete server-side attachment path (`ctx.fileUploads` staging routes,
 * `ctx.attachments` verbatim storage, prompt receipt admission, and the
 * read-only handle text the model receives). Re-implementing any of that here
 * is exactly what made version 1 conflict with the built-in feature: it wrote
 * a parallel copy under `drops/` and injected `@`-references through an
 * `agent/pre-step` middleware.
 *
 * Everything this plugin contributes now happens in the browser half
 * (`lib/client.js`), which only fills gaps the core does not handle and routes
 * its results back through the core's own intake callback.
 */

const name = "file-drop"

/**
 * Mount the browser half without requiring any Host service. Keeping the
 * injection list empty is what guarantees this plugin cannot break profile
 * boot when a Host service is missing or reordered.
 */
const inject = []

function apply() {
  // No Host behaviour by design.
}

export { name, inject, apply }
export default { name, inject, apply }
