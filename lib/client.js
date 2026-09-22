/**
 * dsh-file-drop — browser half (v2).
 *
 * WHY THIS FILE IS THIS SMALL
 * ---------------------------------------------------------------------------
 * DSH core already ships the complete composer attachment intake:
 *   @deepseek-ai/dsh-client-ui-conversation  composer, intake validation,
 *       image limits, notices, and `dataTransfer.files` intake on document drop
 *   @deepseek-ai/dsh-client-file-upload      streaming upload + progress
 *   @deepseek-ai/dsh-client-ui-attachment    draft rail, file cards, drop
 *       overlay, image lightbox
 *
 * Version 1 of this plugin duplicated all of it — its own chip rail, its own
 * full-screen mask, its own toast, plus a `drops/` directory and an
 * `agent/pre-step` middleware injecting `@drops/...` references — and it
 * registered its document `drop` listener in the CAPTURE phase with
 * `stopPropagation()`. Capture runs before the core's bubble-phase listener,
 * so the core never received a drop at all: enabling this plugin killed the
 * built-in drag & drop.
 *
 * Version 2 contributes exactly one thing the core does not do — expanding a
 * dropped FOLDER into its individual files — and leaves everything else alone.
 *
 * DELIBERATE POLICY OVERRIDE (DSH 0.1.7 and later)
 * ---------------------------------------------------------------------------
 * 0.1.7 added `droppedDirectories()`, which DETECTS a dropped folder via the
 * entry API, and then makes it a desktop-only feature:
 *
 *   ui-conversation, addFiles():  if (bridge === void 0 && directory)
 *                                   return t("attachment.directoryDesktopOnly")
 *
 * where `bridge` is `globalThis.__DSH_HOST_PATHS__`. In a browser that global
 * is never set — no shipped package assigns it — so a folder drop is REJECTED
 * with the notice "folders can only be added in the desktop app; add
 * individual files in the browser". On desktop the folder becomes an `@path/`
 * reference chip rather than being expanded into its files.
 *
 * This plugin intentionally overrides that browser policy: it expands the
 * folder and hands the files to the core's normal intake. That is a product
 * decision, not an accident — it means the browser DOES accept a dropped
 * folder while this plugin is enabled. Remove the plugin to get the stock
 * "desktop only" behaviour back.
 *
 * The override stays safe because the hand-off is a synthetic file-only drop:
 * `droppedDirectories()` calls `item.webkitGetAsEntry()` and treats anything
 * that is not `isDirectory === true` as a plain file, so the expanded files
 * take the core's ordinary upload path with no directory semantics attached.
 *
 * INTERFERENCE RULES THIS FILE OBEYS
 * ---------------------------------------------------------------------------
 * 1. It never suppresses a plain-file drop; those are handled by the core,
 *    untouched.
 * 2. It only takes over when a directory entry is actually present, which is
 *    precisely the case the core refuses.
 * 3. It renders no UI, so there is nothing to diverge visually. The core's own
 *    drop overlay, attachment rail, file cards, progress and notices remain
 *    the single presentation.
 * 4. Its result is handed back by re-dispatching a clean file-only `drop`
 *    event, so the core's validation, limits, notices, rail and upload path
 *    run exactly as if the user had dropped those files directly.
 */

window.__ModuleLoader__.load({
  id: "dsh-file-drop",
  factory(require) {
    /** Ceiling on files expanded from one folder drop. */
    const MAX_FILES = 2000
    /** Ceiling on directory nesting walked from one drop. */
    const MAX_DEPTH = 16
    /**
     * The composer's own hidden file input. Used only as a presence probe:
     * folder expansion must not swallow a drop when no composer is mounted to
     * receive the result (for example while Settings is open).
     */
    const COMPOSER_FILE_INPUT = '[data-composer-card] input[type="file"]'

    /** Drain a directory reader; `readEntries` yields batches, not the whole list. */
    async function readAllEntries(reader) {
      const all = []
      for (;;) {
        const batch = await new Promise((resolve, reject) => {
          reader.readEntries(resolve, reject)
        })
        if (batch.length === 0) return all
        for (const entry of batch) all.push(entry)
      }
    }

    /** Depth-first collect every readable file below one entry. */
    async function collectFiles(entry, out, depth) {
      if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
      if (entry.isFile) {
        try {
          const file = await new Promise((resolve, reject) => {
            entry.file(resolve, reject)
          })
          if (out.length < MAX_FILES) out.push(file)
        } catch (error) {
          // Unreadable leaf (permission, vanished): skip it, keep the rest.
        }
        return
      }
      if (entry.isDirectory !== true) return
      let children
      try {
        children = await readAllEntries(entry.createReader())
      } catch (error) {
        return
      }
      for (const child of children) {
        if (out.length >= MAX_FILES) return
        await collectFiles(child, out, depth + 1)
      }
    }

    /**
     * Read the drop's file-system entries, or null when this drop must be left
     * entirely to the core. `webkitGetAsEntry` is only valid synchronously
     * inside the drop handler, so this runs before any await.
     */
    function directoryEntries(dataTransfer) {
      const items =
        dataTransfer.items === undefined || dataTransfer.items === null
          ? []
          : Array.from(dataTransfer.items)
      if (items.length === 0) return null
      const entries = []
      let hasDirectory = false
      for (const item of items) {
        if (item.kind !== "file") continue
        const get =
          typeof item.webkitGetAsEntry === "function"
            ? item.webkitGetAsEntry
            : typeof item.getAsEntry === "function"
              ? item.getAsEntry
              : null
        // No entry API: leave the drop to the core rather than guess.
        if (get === null) return null
        let entry = null
        try {
          entry = get.call(item)
        } catch (error) {
          return null
        }
        if (entry === null || entry === undefined) return null
        if (entry.isDirectory) hasDirectory = true
        entries.push(entry)
      }
      // The only case worth taking over.
      return hasDirectory ? entries : null
    }

    /**
     * End the drag for the core. The core's own `onDrop` calls its `reset()`,
     * but we suppress that handler for the folder drop — and `dragend` is not
     * guaranteed to fire for a drop the browser considers handled. Dispatching
     * it ourselves is what clears the core's drop overlay, including the case
     * where a folder expanded to zero readable files. Best-effort: if the
     * runtime cannot construct a DragEvent, the overlay simply resets on the
     * next real drag, which is still better than throwing.
     */
    function endDrag() {
      try {
        window.dispatchEvent(new DragEvent("dragend", { bubbles: true }))
      } catch (error) {
        // Non-constructible DragEvent (or a hostile global): nothing to do.
      }
    }

    /** Hand expanded files to the core's own intake as an ordinary file drop. */
    function redispatchAsFiles(files) {
      const transfer = new DataTransfer()
      for (const file of files) transfer.items.add(file)
      document.body.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      )
    }

    const inject = []

    function apply(ctx) {
      /**
       * Set while our own synthetic file-only drop is being dispatched, so the
       * capture-phase handler below cannot re-enter on the event it created.
       * The synthetic event carries no directory entry, but this keeps the
       * hand-off explicit rather than relying on that.
       */
      let handingOff = false

      const onDrop = (event) => {
        try {
          if (handingOff) return
          const dataTransfer = event.dataTransfer
          if (dataTransfer === null || dataTransfer === undefined) return
          const entries = directoryEntries(dataTransfer)
          if (entries === null) return
          if (document.querySelector(COMPOSER_FILE_INPUT) === null) return
          // Suppress only this folder drop; the core would add a phantom entry.
          event.preventDefault()
          event.stopPropagation()
          void (async () => {
            try {
              const files = []
              for (const entry of entries) await collectFiles(entry, files, 0)
              if (files.length > 0) {
                handingOff = true
                try {
                  redispatchAsFiles(files)
                } finally {
                  handingOff = false
                }
              }
            } catch (error) {
              // The hand-off itself failed (e.g. a runtime that cannot
              // construct DataTransfer). The drop was already suppressed, so
              // surface it rather than rejecting silently — but still never
              // let it escape as an unhandled rejection.
              console.warn("[dsh-file-drop] folder expansion could not hand off files", error)
            } finally {
              endDrag()
            }
          })()
        } catch (error) {
          // A failure here must never break the page or the core intake.
        }
      }
      ctx.effect(() => {
        document.addEventListener("drop", onDrop, true)
        return () => document.removeEventListener("drop", onDrop, true)
      }, "dsh-file-drop: folder expansion")
      console.info(
        "[dsh-file-drop] loaded: dropped folders expand into their files; all other intake stays native",
      )
    }

    return { inject, apply }
  },
})
