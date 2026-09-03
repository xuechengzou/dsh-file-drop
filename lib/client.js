window.__ModuleLoader__.load({
  id: "dsh-file-drop",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const MAX_FILE_BYTES = 20 * 1024 * 1024;
    const MAX_FILES = 20;

    const chipsBySession = new Map();

    const encodeBase64 = (bytes) => {
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    };

    const extOf = (name) => {
      const base = String(name || "").split(/[\\/]/).pop() || "";
      const dot = base.lastIndexOf(".");
      if (dot <= 0 || dot === base.length - 1) return "";
      const ext = base.slice(dot + 1).toUpperCase();
      return ext.length > 4 ? ext.slice(0, 4) : ext;
    };

    const colorOf = (name) => {
      const ext = extOf(name);
      if (["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG", "BMP", "ICO"].indexOf(ext) !== -1) return "#8b5cf6";
      if (["ZIP", "RAR", "7Z", "TAR", "GZ", "TGZ"].indexOf(ext) !== -1) return "#f59e0b";
      if (["PDF", "DOC", "DOCX", "XLS", "XLSX", "PPT", "PPTX"].indexOf(ext) !== -1) return "#ef4444";
      if (["JS", "TS", "TSX", "JSX", "PY", "GO", "RS", "JAVA", "C", "H", "CPP", "CS", "RB", "PHP", "HTML", "CSS", "JSON", "YAML", "YML", "TOML", "SH", "PS1", "BAT", "CMD"].indexOf(ext) !== -1) return "#3b82f6";
      if (["MD", "TXT", "LOG", "CSV", "SQL", "XML"].indexOf(ext) !== -1) return "#22c55e";
      return "#6b7280";
    };

    const formatSize = (bytes) => {
      const n = Number(bytes) || 0;
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      return (n / 1024 / 1024).toFixed(1) + " MB";
    };

    const api = async (method, payload) => {
      let response;
      try {
        response = await fetch("/file-drop/" + method, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        return { ok: false, message: "无法连接文件服务：" + String(error && error.message !== undefined ? error.message : error) };
      }
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (error) {
        return { ok: false, message: text === "" ? String(response.status) : text };
      }
    };

    function FileDropDock(props) {
      const sessionId = props.sessionId;
      const useInput = props.useInput;
      const useSession = props.useSession;

      const phase = useInput ? useInput((s) => (s === undefined ? "plain" : s.phase)) : "plain";
      const pendingSubmissions = useSession ? useSession((s) => (s === undefined ? [] : s.pendingSubmissions || [])) : [];

      const [chips, setChips] = react.useState(sessionId === undefined ? [] : chipsBySession.get(sessionId) || []);
      const [dragActive, setDragActive] = react.useState(false);
      const [status, setStatus] = react.useState(null);
      const dragDepth = react.useRef(0);
      const sessionRef = react.useRef(sessionId);
      sessionRef.current = sessionId;
      const chipsRef = react.useRef(chips);
      chipsRef.current = chips;
      const prevPhaseRef = react.useRef(phase);
      const seenRequestsRef = react.useRef(new Set());

      react.useEffect(() => {
        if (sessionRef.current === undefined) return;
        if (chipsBySession.get(sessionRef.current) !== chips) chipsBySession.set(sessionRef.current, chips);
      }, [chips]);

      react.useEffect(() => {
        if (sessionRef.current === sessionId) return;
        sessionRef.current = sessionId;
        seenRequestsRef.current = new Set();
        setChips(sessionId === undefined ? [] : chipsBySession.get(sessionId) || []);
      }, [sessionId]);

      const syncPending = (list) => {
        if (sessionRef.current === undefined) return;
        void api("pending", {
          sessionId: sessionRef.current,
          files: list.map((chip) => ({ name: chip.name, relPath: chip.relPath })),
        }).catch(() => {});
      };

      react.useEffect(() => {
        const next = new Set();
        let fresh = false;
        for (const submission of pendingSubmissions) {
          if (submission === null || typeof submission !== "object") continue;
          const requestId = typeof submission.requestId === "string" ? submission.requestId : null;
          if (requestId === null) continue;
          next.add(requestId);
          if (!seenRequestsRef.current.has(requestId)) fresh = true;
        }
        seenRequestsRef.current = next;
        if (fresh && pendingSubmissions.length > 0 && chipsRef.current.length > 0) {
          setChips([]);
        }
      }, [pendingSubmissions]);

      react.useEffect(() => {
        const prev = prevPhaseRef.current;
        prevPhaseRef.current = phase;
        if (phase === "claimed" && prev !== "claimed") {
          setChips([]);
          syncPending([]);
        }
      }, [phase]);

      const removeChip = (id) => {
        const next = chipsRef.current.filter((chip) => chip.id !== id);
        setChips(next);
        syncPending(next);
      };

      const clearChips = () => {
        setChips([]);
        syncPending([]);
      };

      const saveFiles = async (files) => {
        if (files.length === 0) return;
        setStatus({ level: "busy", text: "正在保存 " + files.length + " 个文件…" });
        const payload = [];
        const skipped = [];
        for (const file of files.slice(0, MAX_FILES)) {
          if (file.size > MAX_FILE_BYTES) {
            skipped.push(file.name || "文件（超过 20MB）");
            continue;
          }
          try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let text = null;
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) { text = null; }
            if (text === null) {
              payload.push({ name: file.name || "file", size: file.size, type: file.type || "", binary: true, data: encodeBase64(bytes) });
            } else {
              payload.push({ name: file.name || "file", size: file.size, type: file.type || "", binary: false, text });
            }
          } catch (error) {
            skipped.push(file.name || "file");
          }
        }
        if (payload.length === 0) {
          setStatus({ level: "error", text: "没有可写入的文件" + (skipped.length > 0 ? "：" + skipped.join("、") : "") });
          return;
        }
        try {
          const result = await api("save", { sessionId: sessionRef.current, files: payload });
          if (result === null || result.ok !== true) throw new Error(result === null || result.message === undefined ? "保存失败" : result.message);
          const saved = result.saved || [];
          const errors = result.errors || [];
          const newChips = saved.map((item) => ({
            id: item.absPath,
            name: item.name,
            relPath: item.relPath,
            absPath: item.absPath,
            size: Number(item.size) || 0,
          }));
          const next = [...chipsRef.current, ...newChips];
          setChips(next);
          syncPending(next);
          let text = "已保存 " + saved.length + " 个文件，发送后会作为附件显示在消息中";
          if (errors.length > 0) text += "；失败 " + errors.length + " 个：" + errors.map((item) => item.name).join("、");
          setStatus({ level: errors.length > 0 && saved.length === 0 ? "error" : "ok", text });
        } catch (error) {
          setStatus({ level: "error", text: "保存失败：" + String(error && error.message !== undefined ? error.message : error) });
        }
      };

      react.useEffect(() => {
        const native = (event) => {
          const dt = event.dataTransfer;
          if (dt === null || dt === undefined) return null;
          const types = dt.types === undefined ? [] : Array.from(dt.types);
          return types.indexOf("Files") === -1 ? null : dt;
        };
        const onEnter = (event) => {
          if (native(event) === null) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current += 1;
          setDragActive(true);
        };
        const onOver = (event) => {
          if (native(event) === null) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
        };
        const onLeave = (event) => {
          if (native(event) === null) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragActive(false);
        };
        const onDrop = (event) => {
          if (native(event) === null) return;
          dragDepth.current = 0;
          setDragActive(false);
          const files = Array.from(event.dataTransfer === null ? [] : event.dataTransfer.files || []);
          if (files.length === 0) return;
          event.preventDefault();
          const onlyImages = files.every((f) => IMAGE_TYPES.indexOf((f.type || "").toLowerCase()) !== -1);
          if (onlyImages) return;
          event.stopPropagation();
          void saveFiles(files);
        };
        const onEnd = () => {
          dragDepth.current = 0;
          setDragActive(false);
        };
        document.addEventListener("dragenter", onEnter, true);
        document.addEventListener("dragover", onOver, true);
        document.addEventListener("dragleave", onLeave, true);
        document.addEventListener("drop", onDrop, true);
        window.addEventListener("dragend", onEnd);
        return () => {
          document.removeEventListener("dragenter", onEnter, true);
          document.removeEventListener("dragover", onOver, true);
          document.removeEventListener("dragleave", onLeave, true);
          document.removeEventListener("drop", onDrop, true);
          window.removeEventListener("dragend", onEnd);
        };
      }, [sessionId]);

      react.useEffect(() => {
        if (status === null) return;
        const handle = window.setTimeout(() => setStatus(null), 9000);
        return () => window.clearTimeout(handle);
      }, [status]);

      const chipRow = chips.length === 0 ? null : react.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "0 16px 8px",
        },
      }, [
        ...chips.map((chip) => {
          const ext = extOf(chip.name);
          const color = colorOf(chip.name);
          return react.createElement("div", {
            key: chip.id,
            title: chip.absPath,
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              maxWidth: 260,
              padding: "5px 6px 5px 6px",
              borderRadius: 10,
              border: "1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(255,255,255,0.14))",
              background: "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))",
              color: "var(--dsw-alias-label-primary, #eee)",
              fontSize: 12,
              lineHeight: "18px",
            },
          }, [
            react.createElement("span", {
              key: "badge",
              style: {
                flex: "none",
                minWidth: 26,
                padding: "0 5px",
                borderRadius: 6,
                background: color,
                color: "#fff",
                fontSize: 10,
                fontWeight: 600,
                lineHeight: "18px",
                textAlign: "center",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              },
            }, ext === "" ? "FILE" : ext),
            react.createElement("span", {
              key: "name",
              style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            }, chip.name),
            react.createElement("span", {
              key: "size",
              style: { flex: "none", opacity: 0.55, fontSize: 11 },
            }, formatSize(chip.size)),
            react.createElement("button", {
              key: "x",
              type: "button",
              "aria-label": "移除 " + chip.name,
              title: "移除",
              onClick: () => removeChip(chip.id),
              style: {
                flex: "none",
                width: 18,
                height: 18,
                padding: 0,
                border: "none",
                borderRadius: 999,
                background: "transparent",
                color: "var(--dsw-alias-label-tertiary, #999)",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: "18px",
              },
            }, "×"),
          ]);
        }),
        react.createElement("button", {
          key: "clear",
          type: "button",
          onClick: clearChips,
          title: "清除全部",
          style: {
            alignSelf: "center",
            padding: "4px 10px",
            borderRadius: 8,
            border: "1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(255,255,255,0.14))",
            background: "transparent",
            color: "var(--dsw-alias-label-tertiary, #999)",
            cursor: "pointer",
            fontSize: 12,
            lineHeight: "18px",
          },
        }, "清除"),
      ]);

      const statusRow = status === null ? null : react.createElement("div", {
        style: {
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: "112px",
          zIndex: 1002,
          maxWidth: "76vw",
          background: "var(--dsw-specific-input-major, #1c1c1e)",
          color: "var(--dsw-alias-label-primary, #eee)",
          border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))",
          borderRadius: 999,
          padding: "8px 18px",
          fontSize: 13,
          lineHeight: "18px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
          pointerEvents: "none",
          textAlign: "center",
        },
      }, status.text);

      const mask = dragActive ? react.createElement("div", {
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 1001,
          pointerEvents: "none",
          background: "rgba(0,0,0,0.28)",
          backdropFilter: "blur(2px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      }, react.createElement("div", {
        style: {
          background: "var(--dsw-specific-input-major, #1c1c1e)",
          color: "var(--dsw-alias-label-primary, #eee)",
          border: "2px dashed var(--dsw-state-business-primary, #4f8cff)",
          borderRadius: 16,
          padding: "28px 44px",
          textAlign: "center",
        },
      }, [
        react.createElement("div", { key: "t", style: { fontSize: 18, fontWeight: 600 } }, "松开鼠标，添加文件到会话"),
        react.createElement("div", { key: "d", style: { marginTop: 8, fontSize: 13, opacity: 0.75 } }, "文件将保存到工作区，并作为附件显示在你发送的消息上"),
      ])) : null;

      return react.createElement(react.Fragment, null, chipRow, mask, statusRow);
    }

    const inject = ["slots"];
    function apply(ctx) {
      ctx.slots.inject("conversation.input.dock", () => ctx.slots.register(
        { name: "conversation.input.dock", id: "file-drop-chips", order: 30, label: "文件拖放" },
        FileDropDock,
      ));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
