# dsh-file-drop

A **gap-only** extension for the DSH web composer's file intake.

Drag a **folder** into the composer and its files are added individually
through DSH's own attachment intake — so the native rail, upload progress,
limits and notices are used unchanged.

## Why 2.0.0 is a rewrite

DSH core now ships the complete attachment pipeline:

| Concern | Owner |
|---|---|
| Composer, intake validation, image limits, notices | `@deepseek-ai/dsh-client-ui-conversation` |
| Streaming upload, progress, cancel, retry | `@deepseek-ai/dsh-client-file-upload` |
| Draft attachment rail, file cards, drop overlay, lightbox | `@deepseek-ai/dsh-client-ui-attachment` |
| Verbatim storage, receipt admission, model-facing handle text | `@deepseek-ai/dsh-attachment*`, `ctx.fileUploads` |

Version 1 predated all of that. It duplicated the feature — its own chip rail,
its own full-screen drop mask, its own toast, plus a `drops/` directory and an
`agent/pre-step` middleware injecting `@drops/...` references — **and it
registered its document `drop` listener in the capture phase with
`stopPropagation()`**. Capture runs before the core's bubble-phase listener, so
the core never received a drop at all: enabling v1 disabled the built-in drag &
drop. That is why profiles ended up carrying
`- id: dsh-file-drop` / `disabled: true`.

2.0.0 keeps only the part the core genuinely lacks.

## What it contributes

**Folder expansion.** The core reads `dataTransfer.files`, where a dropped
directory surfaces as a single phantom 0-byte entry. This plugin detects the
directory case with `webkitGetAsEntry()`, walks it (bounded to 2000 files /
16 levels), and re-dispatches the collected files as an ordinary file-only
`drop` event — so the core's validation, limits, notices, rail, upload path and
progress all run exactly as if those files had been dropped directly.

## Non-interference guarantees

1. **Plain-file drops are never touched.** The capture-phase handler returns
   immediately unless a directory entry is actually present.
2. **No UI is rendered.** No rail, mask, toast or chip row, so nothing can
   diverge from the native presentation. The core's drop overlay and attachment
   rail remain the only presentation.
3. **No Host behaviour.** `lib/index.js` is an intentional no-op with an empty
   `inject` list, so the plugin cannot break profile boot or interfere with
   `ctx.fileUploads` / `ctx.attachments`.
4. **No parallel storage.** Nothing is written to `drops/`, and no
   `@drops/...` references are injected. Natively attached files already reach
   the model as a read-only host-path handle, which is the core's own contract.
5. **Fail-safe.** If the composer is not mounted, or the browser exposes no
   directory-entry API, the plugin stays out of the way and the core's
   pre-existing behaviour applies.

## Install

```powershell
dsh plugin --profile <profile> add <path-to-this-directory>
```

Then make sure both enablement layers agree:

1. The profile patch (`~/.dsh/profiles/<profile>/cordis.patch.yml`) must carry
   the force-enable row `- id: dsh-file-drop` / `disabled: false`.
2. The plugin market's state (`~/.dsh/profiles/<profile>/.dsh-market/state.json`)
   must not list `dsh-file-drop` in its `disabled` array. The market keeps its
   own disable list there and re-asserts it on **every boot**, so a stale entry
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

`logic.test.mjs` runs the shipped `lib/client.js` in a stubbed environment, so
it exercises the artifact that actually loads rather than a copy.

## License

MIT
