# dsh-file-drop

A **gap-only** extension for the DSH web composer's file intake.

## What changed in 2.0.0

DSH core now ships the complete attachment pipeline:

| Concern | Owner |
|---|---|
| Composer, intake validation, image limits, notices | `@deepseek-ai/dsh-client-ui-conversation` |
| Streaming upload, progress, cancel, retry | `@deepseek-ai/dsh-client-file-upload` |
| Draft attachment rail, file cards, drop overlay, lightbox | `@deepseek-ai/dsh-client-ui-attachment` |
| Verbatim storage, receipt admission, model-facing handle text | `@deepseek-ai/dsh-attachment*`, `ctx.fileUploads` |

Version 1 of this plugin predated all of that. It duplicated the feature — its
own chip rail, its own full-screen drop mask, its own toast, plus a `drops/`
directory and an `agent/pre-step` middleware that injected `@drops/...`
references — and it registered its document `drop` listener in the **capture**
phase with `stopPropagation()`. Because capture runs before the core's
bubble-phase listener, the core never received a drop: enabling the plugin
disabled the built-in drag & drop. That is why the profile carried
`- id: dsh-file-drop` / `disabled: true`.

## What this plugin still contributes

Exactly one thing the core does not do: **expanding a dropped folder into its
individual files.**

A dropped folder is walked with `webkitGetAsEntry()` (bounded to 2000 files /
16 levels), and the collected files are re-dispatched as an ordinary file-only
`drop` event — so the core's validation, limits, notices, rail, upload path and
progress all run exactly as if those files had been dropped directly.

## Deliberate policy override (DSH 0.1.7+)

DSH 0.1.7 added folder *detection* but made folders a desktop-only feature. In
`ui-conversation`'s `addFiles()`:

```js
if (bridge === void 0 && directory) return t("attachment.directoryDesktopOnly")
```

where `bridge` is `globalThis.__DSH_HOST_PATHS__`. In a browser that global is
**never set** — no shipped package assigns it — so a dropped folder is rejected
with the notice *"folders can only be added in the desktop app; add individual
files in the browser"*. On desktop the folder becomes an `@path/` **reference
chip**, not expanded files.

This plugin intentionally overrides that browser policy. That is a product
decision, not an oversight:

- **While the plugin is enabled, the browser accepts a dropped folder** and adds
  its files individually.
- **Disable or remove the plugin** to get stock 0.1.7 behaviour back (folder
  rejected in the browser, reference chip on desktop).

The override is safe because the hand-off is a synthetic file-only drop:
`droppedDirectories()` calls `item.webkitGetAsEntry()` and skips anything that
is not `isDirectory === true`, so the expanded files take the core's ordinary
upload path with no directory semantics attached.

## Non-interference guarantees

1. **Plain-file drops are never touched.** The capture-phase handler returns
   immediately unless a directory entry is actually present.
2. **No UI is rendered.** There is no rail, mask, toast or chip row, so nothing
   can diverge from the native presentation. The core's drop overlay and
   attachment rail remain the only presentation.
3. **No Host behaviour.** `lib/index.js` is an intentional no-op with an empty
   `inject` list, so this plugin cannot break profile boot or interfere with
   `ctx.fileUploads` / `ctx.attachments`.
4. **No parallel storage.** Nothing is written to `drops/` and no
   `@drops/...` references are injected. Natively attached files already reach
   the model as a read-only host path handle, which is the core's own contract.
5. **Fail-safe.** If the composer is not mounted, or the browser does not expose
   the directory-entry API, the plugin stays out of the way and the core's
   pre-existing behaviour applies.

## Compatibility

Developed and verified against **DSH 0.1.6-alpha.2** and re-checked against
**0.1.7-alpha.1**, where the folder contract changed as described above. The
plugin touches only two 0.1.7 surfaces, both stable:

- the composer's hidden file input, used purely as a presence probe
  (`[data-composer-card] input[type="file"]`)
- the document `drop` event, and the core's own bubble-phase listener that
  receives the re-dispatched hand-off

## Install

```powershell
dsh plugin --profile web add <path-to-this-directory>
```

Two profile-level facts must hold for the plugin to activate:

1. `~/.dsh/profiles/web/cordis.patch.yml` must carry the force-enable row:
   `- id: dsh-file-drop` / `disabled: false`.
2. `~/.dsh/profiles/web/.dsh-market/state.json` must not list
   `dsh-file-drop` in its `disabled` array. The plugin market keeps its own
   disable list there and re-asserts it on **every boot**, so a stale entry
   holds the row down even when the patch layer enables it.

Keep the force-enable row **outside** any `# <plugin>: begin/end` marker block —
those blocks are rewritten by the plugin that owns them.

Because the browser half is only served for a loader row with a live fiber, a
**restart** (or a toggle from the plugin market panel plus a page refresh) is
required after changing enablement.

## Tests

```powershell
node test/package.test.mjs   # manifest + both artifact shapes
node test/logic.test.mjs     # drop gating and the bounded folder walk
```
