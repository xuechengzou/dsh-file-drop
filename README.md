# dsh-file-drop

Drag files into the DSH web composer. Files are saved below the active session
workspace in `drops/`; the next user message receives `@drops/...` references.

## Install

```powershell
dsh plugin --profile web add --save-exact <path-to-dsh-file-drop>
```

The package is a standard DSH bundle and does not require a hand-written
`cordis.patch.yml` entry in the profile. It targets DSH `0.1.2-alpha.2`.
