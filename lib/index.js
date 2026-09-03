const name = "file-drop"
// Wait for every service used by the routes and the pre-step middleware.
// This prevents a partially initialized plugin from capturing undefined
// session/filesystem services during profile boot.
const inject = ["webServer", "sessions", "fs", "sandboxPolicy", "shell"]
const pendingBySession = new Map()

function sanitizeName(raw) {
  const cleaned = String(raw === undefined || raw === null ? "file" : raw)
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
    .replace(/^\.+/, "")
    .trim()
  let out = cleaned === "" || cleaned === "." || cleaned === ".." ? "dropped-file" : cleaned
  if (out.length > 100) {
    const dot = out.lastIndexOf(".")
    if (dot > 20 && out.length - dot <= 20) out = out.slice(0, 75) + out.slice(dot)
    else out = out.slice(0, 100)
  }
  return out
}

async function mkdirViaShell(shell, dirAbs, cwd, policy) {
  if (shell === undefined) return false
  const commands = [
    `New-Item -ItemType Directory -Force -Path '${dirAbs.replace(/'/g, "''")}' | Out-Null`,
    `mkdir -p '${dirAbs.replace(/'/g, `'\\''`)}'`
  ]
  for (const command of commands) {
    try {
      const spec = shell.resolve({ command, workdir: cwd, timeoutMs: 15000, sandboxPolicy: policy })
      const result = await shell.run(spec)
      if (result.exitCode === 0) return true
    } catch (error) {
      // try the next dialect
    }
  }
  return false
}

async function decodeBinaryViaShell(shell, abs, base64, cwd, policy) {
  if (shell === undefined || typeof base64 !== "string") return false
  const commands = [
    `$p='${abs.replace(/'/g, "''")}';$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());[IO.File]::WriteAllBytes($p,$b)`,
    `base64 -d > '${abs.replace(/'/g, `'\\''`)}'`
  ]
  for (const command of commands) {
    try {
      const spec = shell.resolve({ command, workdir: cwd, timeoutMs: 120000, stdin: base64, sandboxPolicy: policy })
      const result = await shell.run(spec)
      if (result.exitCode === 0) return true
    } catch (error) {
      // try the next dialect
    }
  }
  return false
}

async function readJsonBody(req) {
  let raw = ""
  for await (const chunk of req) raw += typeof chunk === "string" ? chunk : chunk.toString("utf8")
  if (raw.trim() === "") return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" ? parsed : {}
  } catch (error) {
    return {}
  }
}

function sendJson(res, code, value) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(value))
}

function apply(ctx) {
  const sessions = ctx.get("sessions")
  const fs = ctx.get("fs")
  const sandboxPolicy = ctx.get("sandboxPolicy")
  const shell = ctx.get("shell")

  ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    let decision
    try {
      decision = await next()
    } catch (error) {
      throw error
    }
    if (decision === null || typeof decision !== "object" || decision.kind === "reject") return decision
    if (signal !== undefined && signal.aborted === true) return decision
    try {
      const sessionId = agent !== undefined && agent !== null && agent.session !== undefined ? agent.session.id : undefined
      if (sessionId === undefined) return decision
      const pending = pendingBySession.get(sessionId)
      if (pending === undefined || pending.length === 0) return decision
      const messages = Array.isArray(decision.messages) ? decision.messages : []
      let targetIndex = -1
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index]
        if (message !== null && typeof message === "object" && message.source !== undefined && message.source !== null && message.source.kind === "user") {
          targetIndex = index
          break
        }
      }
      if (targetIndex === -1) return decision
      const mention = (rel) => (typeof rel === "string" && rel !== "" && /\s/.test(rel) ? '@"' + rel + '"' : "@" + rel)
      const parts = pending.map((file) => mention(file.relPath)).filter((part) => part !== "@")
      const text = "\n" + parts.join(" ")
      const target = messages[targetIndex]
      const content = Array.isArray(target.content) ? [...target.content, { type: "text", text }] : [{ type: "text", text }]
      const nextMessages = messages.map((message, index) => (index === targetIndex ? { ...message, content } : message))
      pendingBySession.delete(sessionId)
      return { ...decision, messages: nextMessages }
    } catch (error) {
      return decision
    }
  }, { prepend: true })

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/file-drop/save",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, message: "method not allowed" })
        return
      }
      const args = await readJsonBody(req)
      const files = Array.isArray(args.files) ? args.files : []
      if (files.length === 0) {
        sendJson(res, 200, { ok: false, message: "没有收到文件" })
        return
      }
      if (fs === undefined || sandboxPolicy === undefined || sessions === undefined) {
        sendJson(res, 200, { ok: false, message: "文件服务不可用" })
        return
      }
      const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined
      const session = sessionId === undefined ? undefined : sessions.get(sessionId)
      const cwd = session !== undefined && session.header !== undefined && typeof session.header.cwd === "string" && session.header.cwd !== ""
        ? session.header.cwd
        : sandboxPolicy.workspaceRoot
      const policy = sandboxPolicy.resolve({ session })

      const now = new Date()
      const pad = (n) => (n < 10 ? "0" + n : String(n))
      const stamp = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())

      let dirRel = ""
      try {
        const dropsTarget = await fs.resolve("drops", { cwd })
        const info = await fs.stat(dropsTarget)
        if (info !== undefined && info.type === "directory") {
          dirRel = "drops"
        } else if (shell !== undefined) {
          const dirAbs = fs.processPath(dropsTarget)
          if (await mkdirViaShell(shell, dirAbs, cwd, policy)) {
            const after = await fs.stat(dropsTarget)
            if (after !== undefined && after.type === "directory") dirRel = "drops"
          }
        }
      } catch (error) {
        dirRel = ""
      }

      const saved = []
      const errors = []
      for (const file of files.slice(0, 50)) {
        const displayName = typeof file.name === "string" && file.name !== "" ? file.name : "file"
        const name = sanitizeName(displayName)
        let rel = ""
        try {
          let target = null
          let ok = false
          for (let attempt = 0; attempt <= 6; attempt += 1) {
            const candidate = attempt === 0 ? "drop-" + stamp + "-" + name : "drop-" + stamp + "-" + attempt + "-" + name
            rel = dirRel === "" ? candidate : dirRel + "/" + candidate
            target = await fs.resolve(rel, { cwd })
            if (typeof file.text === "string") {
              try {
                await fs.writeText(target, file.text, { kind: "createIfAbsent" }, undefined, policy)
                ok = true
                break
              } catch (error) {
                if (attempt === 6) throw error
                continue
              }
            } else {
              ok = await decodeBinaryViaShell(shell, fs.processPath(target), file.data, cwd, policy)
              if (ok) break
              if (attempt === 6) throw new Error("二进制写入失败")
            }
          }
          if (!ok) throw new Error("写入失败")
          saved.push({ name: displayName, relPath: rel, absPath: fs.processPath(target), size: Number(file.size) || 0 })
        } catch (error) {
          const message = error !== null && error !== undefined && typeof error.message === "string" ? error.message : String(error)
          errors.push({ name: displayName, message })
        }
      }
      sendJson(res, 200, { ok: true, dir: dirRel, saved, errors })
    }
  }), "file-drop save route")

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/file-drop/pending",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, message: "method not allowed" })
        return
      }
      const args = await readJsonBody(req)
      const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined
      if (sessionId === undefined) {
        sendJson(res, 200, { ok: false, message: "缺少会话" })
        return
      }
      const files = Array.isArray(args.files) ? args.files.filter((file) => file !== null && typeof file === "object" && typeof file.relPath === "string" && file.relPath !== "") : []
      pendingBySession.set(sessionId, files.map((file) => ({ name: typeof file.name === "string" ? file.name : "file", relPath: file.relPath })))
      sendJson(res, 200, { ok: true, pending: files.length })
    }
  }), "file-drop pending route")
}

export { name, inject, apply }
export default { name, inject, apply }
