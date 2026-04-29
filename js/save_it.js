import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "Save_It.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "Save_It") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            const self = this;

            // ── Hide internal save_trigger widget ──────────────────────────
            const triggerWidget = this.widgets?.find(w => w.name === "save_trigger");
            if (triggerWidget) {
                triggerWidget.type = "hidden";
                triggerWidget.computeSize = () => [0, -4];
            }

            // ── Hide enable_compare boolean widget ─────────────────────────
            // The Python backend still serialises it (so the toggle value is
            // round-tripped correctly). We just remove it from the visible
            // widget stack so it contributes 0 px to widgetHeight — that is
            // the root cause of the gap between Favorite Folders and the
            // compare canvas.
            const enableCmpWidget = this.widgets?.find(w => w.name === "enable_compare");
            if (enableCmpWidget) {
                enableCmpWidget.type = "hidden";
                enableCmpWidget.computeSize = () => [0, -4];
            }

            // ── Helper getters ─────────────────────────────────────────────
            const getWidget    = (name) => self.widgets?.find(w => w.name === name);
            const isAutoSave   = () => getWidget("autosave")?.value ?? false;
            const getPrefix    = () => getWidget("filename_prefix")?.value ?? "ComfyUI";
            const getFormat    = () => getWidget("format")?.value ?? "PNG";
            const getQuality   = () => getWidget("quality")?.value ?? 95;
            const getTimestamp = () => getWidget("use_timestamp")?.value ?? false;
            // Central getter for compare state — always reads the backend widget value
            const isCmpOn = () => getWidget("enable_compare")?.value ?? false;

            // ── Toast notification ─────────────────────────────────────────
            function showToast(message, isError = false) {
                const existing = document.getElementById("save_it_toast");
                if (existing) existing.remove();

                const toast = document.createElement("div");
                toast.id = "save_it_toast";
                toast.style.cssText = `
                    position: fixed;
                    bottom: 30px;
                    right: 30px;
                    background: ${isError ? "#c0392b" : "#1a6b4a"};
                    color: white;
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-family: sans-serif;
                    z-index: 99999;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    max-width: 400px;
                    word-break: break-all;
                    transition: opacity 0.4s ease;
                `;
                toast.textContent = message;
                document.body.appendChild(toast);
                setTimeout(() => {
                    toast.style.opacity = "0";
                    setTimeout(() => toast.remove(), 400);
                }, 3500);
            }

            // ── Save History ───────────────────────────────────────────────
            const HISTORY_KEY = "save_it_history";
            const MAX_HISTORY = 50;

            function loadHistory() {
                try {
                    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
                } catch { return []; }
            }

            function addToHistory(entry) {
                const history = loadHistory();
                history.unshift(entry);
                if (history.length > MAX_HISTORY) history.pop();
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
            }

            // ── Favorite Folders ───────────────────────────────────────────
            async function loadFavorites() {
                try {
                    const res = await api.fetchApi("/save_it/favorites");
                    return res.ok ? await res.json() : [];
                } catch { return []; }
            }

            async function saveFavorites(folders) {
                await api.fetchApi("/save_it/favorites", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folders })
                });
            }

            function showFavoritesDialog() {
                const existing = document.getElementById("save_it_favorites_dialog");
                if (existing) { existing.remove(); return; }

                const overlay = document.createElement("div");
                overlay.id = "save_it_favorites_dialog";
                overlay.style.cssText = `
                    position: fixed; inset: 0;
                    background: rgba(0,0,0,0.6);
                    z-index: 99998;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;

                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    background: #1e2a2a;
                    border: 1px solid #2a9d8f;
                    border-radius: 10px;
                    padding: 20px;
                    width: 460px;
                    min-width: 320px;
                    max-width: 95vw;
                    min-height: 260px;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    color: white;
                    font-family: sans-serif;
                    position: relative;
                    box-sizing: border-box;
                    overflow: hidden;
                `;

                dialog.innerHTML = `
                    <h3 style="margin:0 0 10px;color:#2a9d8f;flex-shrink:0;">⭐ Favorite Folders</h3>
                    <p style="font-size:12px;color:#aaa;margin:0 0 10px;flex-shrink:0;">
                        Add folder paths to quickly switch your save location.<br>
                        Format: <code style="color:#2a9d8f;">SubFolder/OptionalName</code> or just <code style="color:#2a9d8f;">SubFolder/_</code>
                    </p>

                    <div style="position:relative;margin-bottom:10px;flex-shrink:0;">
                        <input id="save_it_fav_search" type="text" placeholder="🔍 Search folders…"
                            style="width:100%;box-sizing:border-box;padding:7px 32px 7px 10px;
                                   border-radius:6px;border:1px solid #3a7d74;
                                   background:#0d1f1f;color:white;font-size:13px;outline:none;" />
                        <span id="save_it_fav_search_clear"
                            style="position:absolute;right:9px;top:50%;transform:translateY(-50%);
                                   cursor:pointer;color:#777;font-size:14px;display:none;
                                   line-height:1;user-select:none;" title="Clear search">✕</span>
                    </div>

                    <div id="save_it_fav_list"
                        style="flex:1;overflow-y:auto;margin-bottom:12px;min-height:60px;"></div>

                    <div style="display:flex;gap:8px;margin-bottom:14px;flex-shrink:0;">
                        <input id="save_it_fav_input" type="text" placeholder="e.g. Projects/Portraits/_"
                            style="flex:1;padding:7px 10px;border-radius:6px;border:1px solid #2a9d8f;
                                   background:#0d1f1f;color:white;font-size:13px;outline:none;" />
                        <button id="save_it_fav_add"
                            style="padding:7px 14px;background:#2a9d8f;color:white;border:none;
                                   border-radius:6px;cursor:pointer;font-size:13px;">Add</button>
                    </div>
                    <div style="display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
                        <button id="save_it_fav_close"
                            style="padding:5px 12px;background:#555;color:white;border:none;
                                   border-radius:6px;cursor:pointer;">Close</button>
                    </div>

                    <!-- Resize handle -->
                    <div id="save_it_fav_resize"
                        style="position:absolute;bottom:0;right:0;width:18px;height:18px;
                               cursor:se-resize;display:flex;align-items:flex-end;
                               justify-content:flex-end;padding:3px;box-sizing:border-box;
                               opacity:0.5;" title="Drag to resize">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="#2a9d8f">
                            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="#2a9d8f" stroke-width="1.5"
                                stroke-linecap="round"/>
                        </svg>
                    </div>
                `;

                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                // Resize functionality
                const resizeHandle = dialog.querySelector("#save_it_fav_resize");
                let isResizing = false;
                let suppressCloseDuringDrag = false;
                let startX, startY, startWidth, startHeight;

                resizeHandle.addEventListener("mousedown", (e) => {
                    isResizing = true;
                    suppressCloseDuringDrag = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    startWidth = dialog.offsetWidth;
                    startHeight = dialog.offsetHeight;
                    e.preventDefault();
                    e.stopPropagation();
                });

                document.addEventListener("mousemove", (e) => {
                    if (!isResizing) return;
                    const newWidth = startWidth + (e.clientX - startX);
                    const newHeight = startHeight + (e.clientY - startY);
                    if (newWidth > 320) dialog.style.width = `${newWidth}px`;
                    if (newHeight > 260) dialog.style.minHeight = `${newHeight}px`;
                });

                document.addEventListener("mouseup", () => {
                    isResizing = false;
                    setTimeout(() => { suppressCloseDuringDrag = false; }, 150);
                });

                // Load and render favorites
                async function renderFavorites(filterText = "") {
                    const favs = await loadFavorites();
                    const listDiv = dialog.querySelector("#save_it_fav_list");
                    const lowerFilter = filterText.toLowerCase();

                    const filtered = filterText
                        ? favs.filter(f => f.toLowerCase().includes(lowerFilter))
                        : favs;

                    if (filtered.length === 0) {
                        listDiv.innerHTML = `
                            <div style="text-align:center;color:#666;padding:20px;font-size:13px;">
                                ${filterText ? "No matching folders" : "No favorite folders yet"}
                            </div>
                        `;
                        return;
                    }

                    listDiv.innerHTML = "";
                    filtered.forEach((folder) => {
                        const row = document.createElement("div");
                        row.style.cssText = `
                            display:flex;align-items:center;gap:8px;padding:6px 8px;
                            background:#0d1f1f;border-radius:6px;margin-bottom:6px;
                            border:1px solid #2a5d54;
                        `;
                        row.innerHTML = `
                            <span style="flex:1;font-size:13px;color:#ccc;word-break:break-all;">${folder}</span>
                            <button class="save_it_fav_set" data-folder="${folder}"
                                style="padding:4px 10px;background:#2a9d8f;color:white;border:none;
                                       border-radius:4px;cursor:pointer;font-size:12px;">Set</button>
                            <button class="save_it_fav_del" data-folder="${folder}"
                                style="padding:4px 8px;background:#c0392b;color:white;border:none;
                                       border-radius:4px;cursor:pointer;font-size:12px;">✕</button>
                        `;
                        listDiv.appendChild(row);
                    });

                    listDiv.querySelectorAll(".save_it_fav_set").forEach(btn => {
                        btn.addEventListener("click", () => {
                            const folder = btn.getAttribute("data-folder");
                            const pw = getWidget("filename_prefix");
                            if (pw) pw.value = folder;
                            showToast(`📁 Path set: ${folder}`);
                            overlay.remove();
                        });
                    });

                    listDiv.querySelectorAll(".save_it_fav_del").forEach(btn => {
                        btn.addEventListener("click", async () => {
                            const folder = btn.getAttribute("data-folder");
                            const favs = await loadFavorites();
                            const newFavs = favs.filter(f => f !== folder);
                            await saveFavorites(newFavs);
                            renderFavorites(filterText);
                        });
                    });
                }

                renderFavorites();

                dialog.querySelector("#save_it_fav_add").addEventListener("click", async () => {
                    const input = dialog.querySelector("#save_it_fav_input");
                    const val = input.value.trim();
                    if (!val) return;
                    const favs = await loadFavorites();
                    if (favs.includes(val)) {
                        showToast("Already in favorites.");
                    } else {
                        favs.push(val);
                        await saveFavorites(favs);
                        showToast(`⭐ Added: ${val}`);
                        input.value = "";
                        renderFavorites();
                    }
                });

                dialog.querySelector("#save_it_fav_input").addEventListener("keydown", (e) => {
                    if (e.key === "Enter") dialog.querySelector("#save_it_fav_add").click();
                });

                const searchInput = dialog.querySelector("#save_it_fav_search");
                const searchClear = dialog.querySelector("#save_it_fav_search_clear");

                searchInput.addEventListener("input", (e) => {
                    const val = e.target.value;
                    searchClear.style.display = val ? "block" : "none";
                    renderFavorites(val);
                });

                searchClear.addEventListener("click", () => {
                    searchInput.value = "";
                    searchClear.style.display = "none";
                    renderFavorites("");
                });

                dialog.querySelector("#save_it_fav_close").addEventListener("click", () => overlay.remove());
                overlay.addEventListener("click", (e) => {
                    if (e.target === overlay && !suppressCloseDuringDrag) overlay.remove();
                });
            }

            // ── Save History Dialog ────────────────────────────────────────
            function showHistoryDialog() {
                const existing = document.getElementById("save_it_history_dialog");
                if (existing) { existing.remove(); return; }

                const overlay = document.createElement("div");
                overlay.id = "save_it_history_dialog";
                overlay.style.cssText = `
                    position: fixed; inset: 0;
                    background: rgba(0,0,0,0.6);
                    z-index: 99998;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;

                const dialog = document.createElement("div");
                dialog.style.cssText = `
                    background: #1e2a2a;
                    border: 1px solid #2a9d8f;
                    border-radius: 10px;
                    padding: 20px;
                    width: 500px;
                    max-width: 95vw;
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                    color: white;
                    font-family: sans-serif;
                `;

                const history = loadHistory();
                const items = history.length === 0
                    ? `<div style="text-align:center;color:#666;padding:20px;">No save history yet.</div>`
                    : history.map((h) => `
                        <div style="padding:8px;background:#0d1f1f;border-radius:6px;margin-bottom:6px;">
                            <div style="font-size:13px;color:#2a9d8f;font-weight:bold;">${h.filename}</div>
                            <div style="font-size:11px;color:#888;margin-top:2px;">${h.path}</div>
                            <div style="font-size:10px;color:#555;margin-top:2px;">${h.time}</div>
                        </div>
                    `).join("");

                dialog.innerHTML = `
                    <h3 style="margin:0 0 10px;color:#2a9d8f;">📋 Save History (Last ${Math.min(history.length, MAX_HISTORY)})</h3>
                    <div style="flex:1;overflow-y:auto;margin-bottom:12px;">
                        ${items}
                    </div>
                    <div style="display:flex;justify-content:space-between;gap:8px;">
                        <button id="save_it_hist_clear"
                            style="padding:5px 12px;background:#c0392b;color:white;border:none;
                                   border-radius:6px;cursor:pointer;">Clear History</button>
                        <button id="save_it_hist_close"
                            style="padding:5px 12px;background:#555;color:white;border:none;
                                   border-radius:6px;cursor:pointer;">Close</button>
                    </div>
                `;

                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                dialog.querySelector("#save_it_hist_clear").addEventListener("click", () => {
                    localStorage.removeItem(HISTORY_KEY);
                    showToast("History cleared.");
                    overlay.remove();
                });

                dialog.querySelector("#save_it_hist_close").addEventListener("click", () => overlay.remove());
                overlay.addEventListener("click", (e) => {
                    if (e.target === overlay) overlay.remove();
                });
            }

            // ── Save Image Logic ───────────────────────────────────────────
            async function doSaveImgs(images) {
                for (const img of images) {
                    try {
                        const url = new URL(img.src, window.location.origin);
                        const filename = url.searchParams.get("filename");
                        const subfolder = url.searchParams.get("subfolder") || "";
                        const type = url.searchParams.get("type") || "output";

                        if (!filename) continue;

                        try {
                            if (filename.includes("b.")) continue;
                        } catch (e) {}

                        const filename_prefix = getPrefix();
                        const format = getFormat();
                        const quality = getQuality();
                        const use_timestamp = getTimestamp();

                        const response = await api.fetchApi("/save_it/save", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ filename, subfolder, type, filename_prefix, format, quality, use_timestamp })
                        });

                        if (response.ok) {
                            const msg = await response.text();
                            const savedPath = msg.replace("Saved to ", "");
                            const savedFilename = savedPath.split(/[\\/]/).pop();
                            addToHistory({
                                filename: savedFilename,
                                path: savedPath,
                                time: new Date().toLocaleString()
                            });
                            showToast(`✅ Saved: ${savedFilename}`);
                            console.log(`Save_It: ${msg}`);
                        } else {
                            const err = await response.text();
                            showToast(`❌ Save failed: ${err}`, true);
                        }
                    } catch (e) {
                        showToast(`❌ Error: ${e.message}`, true);
                    }
                }
            }

            async function doSave() {
                const img = self.currentImageA || (self.imgs && self.imgs.length > 0 ? self.imgs[0] : null);
                if (!img) {
                    showToast("No image to save. Please run the workflow first.", true);
                    return;
                }
                await doSaveImgs([img]);
            }

            // ── Browse & Set Path button ───────────────────────────────────
            const browseBtn = this.addWidget("button", "📁  Browse & Set Save Path", null, async () => {
                bringAppToFront();
                await new Promise(resolve => setTimeout(resolve, 150));
                try {
                    const response = await api.fetchApi("/save_it/browse_folder", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({})
                    });
                    bringAppToFront();
                    if (response.status === 204) return;
                    if (!response.ok) {
                        const err = await response.text();
                        showToast(`❌ Browse failed: ${err}`, true);
                        return;
                    }
                    const data = await response.json();
                    if (!data || typeof data !== "object") {
                        showToast("❌ Invalid response from server", true);
                        return;
                    }
                    const selectedPath = data.path;
                    if (!selectedPath) return;
                    const pw = getWidget("filename_prefix");
                    if (pw) {
                        try {
                            pw.value = selectedPath;
                            if (pw.callback && typeof pw.callback === "function") pw.callback(selectedPath);
                        } catch (_) {}
                        try {
                            if (self.onWidgetChanged && typeof self.onWidgetChanged === "function")
                                self.onWidgetChanged("filename_prefix", selectedPath);
                        } catch (_) {}
                        try {
                            if (app.graph && typeof app.graph.setDirtyCanvas === "function")
                                app.graph.setDirtyCanvas(true, true);
                        } catch (_) {}
                    }
                    showToast(`📁 Path set: ${selectedPath}`);
                    showAddToFavoritesPrompt(selectedPath);
                    bringAppToFront();
                } catch (e) {
                    showToast(`❌ Error: ${e.message}`, true);
                }
            });
            browseBtn.serialize = false;

            // ── Add to Favorites prompt ────────────────────────────────────
            function showAddToFavoritesPrompt(path) {
                const existing = document.getElementById("save_it_addfav_prompt");
                if (existing) existing.remove();

                const prompt = document.createElement("div");
                prompt.id = "save_it_addfav_prompt";
                prompt.style.cssText = `
                    position: fixed;
                    bottom: 80px;
                    right: 30px;
                    background: #1e2a2a;
                    border: 1px solid #2a9d8f;
                    border-radius: 8px;
                    padding: 14px 18px;
                    font-size: 13px;
                    font-family: sans-serif;
                    color: white;
                    z-index: 99999;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                    max-width: 420px;
                    word-break: break-all;
                `;
                prompt.innerHTML = `
                    <div style="margin-bottom:10px;">
                        <span style="color:#2a9d8f;font-weight:bold;">⭐ Add to Favorites?</span><br>
                        <span style="color:#ccc;font-size:12px;">${path}</span>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button id="save_it_addfav_yes"
                            style="flex:1;padding:6px;background:#2a9d8f;color:white;border:none;
                                   border-radius:6px;cursor:pointer;font-size:13px;">
                            ⭐ Add to Favorites
                        </button>
                        <button id="save_it_addfav_no"
                            style="padding:6px 12px;background:#555;color:white;border:none;
                                   border-radius:6px;cursor:pointer;font-size:13px;">
                            Not now
                        </button>
                    </div>
                `;
                document.body.appendChild(prompt);

                const dismiss = () => prompt.remove();

                prompt.querySelector("#save_it_addfav_yes").addEventListener("click", async () => {
                    const favs = await loadFavorites();
                    if (!favs.includes(path)) {
                        favs.push(path);
                        await saveFavorites(favs);
                        showToast(`⭐ Added to favorites: ${path}`);
                    } else {
                        showToast("Already in favorites.");
                    }
                    dismiss();
                });

                prompt.querySelector("#save_it_addfav_no").addEventListener("click", dismiss);
                setTimeout(dismiss, 15000);
            }

            function bringAppToFront() {
                try {
                    if (typeof require === "function") {
                        const electron = require("electron");
                        const cw = (electron.remote && electron.remote.getCurrentWindow)
                            ? electron.remote.getCurrentWindow()
                            : (electron.getCurrentWindow ? electron.getCurrentWindow() : null);
                        if (cw && typeof cw.setAlwaysOnTop === "function") {
                            try {
                                cw.setAlwaysOnTop(true);
                                cw.focus && cw.focus();
                                setTimeout(() => { try { cw.setAlwaysOnTop(false); } catch (_) {} }, 120);
                                return;
                            } catch (_) {}
                        }
                    }
                } catch (_) {}
                try { window.focus(); } catch (_) {}
                try { if (window.parent && typeof window.parent.focus === "function") window.parent.focus(); } catch (_) {}
                let attempts = 0;
                const tid = setInterval(() => {
                    attempts++;
                    try { window.focus(); } catch (_) {}
                    try { if (window.parent && typeof window.parent.focus === "function") window.parent.focus(); } catch (_) {}
                    if (attempts >= 6) clearInterval(tid);
                }, 100);
            }

            // ── Save Image button ──────────────────────────────────────────
            const saveBtn = this.addWidget("button", "💾  Save Image", null, async () => {
                if (isAutoSave() && !isCmpOn()) return;
                await doSave();
            });
            saveBtn.serialize = false;

            // ── Open Folder button ─────────────────────────────────────────
            const folderBtn = this.addWidget("button", "📂  Open Output Folder", null, async () => {
                bringAppToFront();
                await new Promise(resolve => setTimeout(resolve, 100));
                try {
                    const response = await api.fetchApi("/save_it/open_folder", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ filename_prefix: getPrefix() })
                    });
                    if (!response.ok) {
                        const err = await response.text();
                        showToast(`❌ Could not open folder: ${err}`, true);
                    }
                    await new Promise(resolve => setTimeout(resolve, 300));
                    bringAppToFront();
                } catch (e) {
                    showToast(`❌ Error: ${e.message}`, true);
                }
            });
            folderBtn.serialize = false;

            // ── Save History button ────────────────────────────────────────
            const historyBtn = this.addWidget("button", "📋  Save History", null, () => {
                showHistoryDialog();
            });
            historyBtn.serialize = false;

            // ── Favorite Folders button ────────────────────────────────────
            const favBtn = this.addWidget("button", "⭐  Favorite Folders", null, () => {
                showFavoritesDialog();
            });
            favBtn.serialize = false;

            // ── Watch autosave toggle to dim/undim Save button ─────────────
            const autosaveWidget = getWidget("autosave");
            if (autosaveWidget) {
                const originalCallback = autosaveWidget.callback;
                autosaveWidget.callback = function (value) {
                    originalCallback?.call(this, value);
                    saveBtn.disabled = value && !isCmpOn();
                    if (value && !isCmpOn() && self.imgs && self.imgs.length > 0) {
                        lastSavedSrc = self.imgs[0].src;
                    }
                };
                saveBtn.disabled = autosaveWidget.value && !isCmpOn();
            }

            // ── Watch compare widget to react to external value changes ────
            // The backend widget is now hidden, so we intercept its callback
            // to keep the save-button state and canvas in sync whenever the
            // value is changed (e.g. on workflow load / connection change).
            if (enableCmpWidget) {
                const origCmpCb = enableCmpWidget.callback;
                enableCmpWidget.callback = function (value) {
                    origCmpCb?.call(this, value);
                    if (value) {
                        saveBtn.disabled = false;
                        try { if (autosaveWidget) { autosaveWidget.value = false; autosaveWidget.disabled = true; } } catch (_) {}
                    } else {
                        self._cmpImg1 = null; self._cmpImg2 = null;
                        self.currentImageA = null; self.currentImageB = null;
                        try { if (autosaveWidget) { autosaveWidget.disabled = false; } } catch (_) {}
                        saveBtn.disabled = (getWidget("autosave")?.value ?? false);
                        app.graph.setDirtyCanvas(true, true);
                    }
                };
            }

            // ── AutoSave: only save newly generated images ─────────────────
            let lastSavedSrc = null;

            // ── Compare constants & helpers ────────────────────────────────
            const BRAND      = "#2a9d8f";
            const MODES      = ["L ↔ R"];
            const SLIDER_PAD = 50;

            // Compare section widget layout constants
            // HEADER_H  : the "⬛ Compare  [ON]  ▲" bar
            // TABS_H    : mode tab row below the header (only drawn when ON)
            // GAP       : small gap between tabs and canvas
            const CMP_HEADER_H = 22;
            const CMP_TABS_H   = 22;
            const CMP_GAP      = 6;

            const BTN_GAP  = 3;
            const BTN_H    = 18;
            const BTN_W    = 56;
            const INIT_W   = 400;
            const MIN_W    = BTN_W * 4 + BTN_GAP * 3 + 20;

            function inside(pos, r) {
                return pos[0] >= r.x && pos[0] <= r.x + r.w &&
                       pos[1] >= r.y && pos[1] <= r.y + r.h;
            }

            // ── Initialize compare state ───────────────────────────────────
            this._cmpMode     = 0;  // L ↔ R is the only mode
            this._cmpSplitX   = 0;
            this._cmpSplitY   = 0;
            this._cmpOpacity  = 0.5;
            this._cmpImg1     = null;
            this._cmpImg2     = null;
            this.currentImageA = null;
            this.currentImageB = null;

            // ── Compare Section Widget ─────────────────────────────────────
            // This widget draws a header bar with "Compare" label + ON/OFF badge + chevron.
            // Compare is always displayed in Left ↔ Right split mode.
            //
            // Its computeSize() returns the exact height it will occupy, which
            // means onDrawForeground can place imgY = (sum of widget heights)
            // with NO extra padding needed.
            const cmpSectionWidget = this.addWidget(
                "button",           // closest built-in type; we override draw
                "cmp_section",      // internal name (not shown)
                null,
                () => {
                    // Click on the header row toggles compare on/off
                    const cw = getWidget("enable_compare");
                    if (!cw) return;
                    const newVal = !cw.value;
                    cw.value = newVal;
                    // Fire the callback so save-button state updates
                    if (cw.callback) cw.callback.call(cw, newVal);
                    app.graph.setDirtyCanvas(true, true);
                }
            );
            cmpSectionWidget.serialize = false;

            // Override computeSize so LiteGraph allocates the right height
            cmpSectionWidget.computeSize = function (width) {
                const on = isCmpOn();
                // Return header height plus a small gap so the canvas doesn't
                // overlap the widgets above when compare is enabled.
                const h = CMP_HEADER_H + CMP_GAP;
                return [width, h];
            };

            // Override draw to replace the default button appearance
            cmpSectionWidget.draw = function (ctx, node, widgetWidth, y, widgetHeight) {
                const on = isCmpOn();
                const w  = widgetWidth;

                // ── Header bar ─────────────────────────────────────────────
                const hh = CMP_HEADER_H;

                // Background
                ctx.fillStyle = on ? "#1e2a2a" : "#1e1e1e";
                ctx.strokeStyle = on ? BRAND : "#3a3a3a";
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(0, y, w, hh, 4);
                else ctx.rect(0, y, w, hh);
                ctx.fill(); ctx.stroke();

                // "▪ Compare" label
                ctx.fillStyle = on ? BRAND : "#888";
                ctx.font = "bold 10px 'Segoe UI',sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText("▪  Compare", 8, y + hh / 2);

                // ON / OFF badge
                const badge = on ? "ON" : "OFF";
                const badgeW = 28;
                const badgeX = w - badgeW - 22;
                const badgeY = y + (hh - 14) / 2;
                ctx.fillStyle = on ? BRAND : "#2e2e2e";
                ctx.strokeStyle = on ? BRAND : "#444";
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, 14, 3);
                else ctx.rect(badgeX, badgeY, badgeW, 14);
                ctx.fill(); ctx.stroke();
                ctx.fillStyle = on ? "#fff" : "#666";
                ctx.font = "bold 9px 'Segoe UI',sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(badge, badgeX + badgeW / 2, badgeY + 7);

                // Chevron
                ctx.fillStyle = "#666";
                ctx.font = "9px 'Segoe UI',sans-serif";
                ctx.textAlign = "right";
                ctx.textBaseline = "middle";
                ctx.fillText(on ? "▲" : "▼", w - 6, y + hh / 2);
                // Record header bottom for accurate canvas placement
                try { self._cmpHeaderBottom = y + hh + CMP_GAP; } catch (_) { this._cmpHeaderBottom = y + hh + CMP_GAP; }

                if (!on) return;
            };

            // ── onExecuted: autosave + compare image loading ───────────────
            const _origOnExecuted = this.onExecuted;
            this.onExecuted = function (output) {
                const cmpOn = isCmpOn();

                if (!cmpOn) {
                    _origOnExecuted?.call(this, output);
                    try {
                        if (output?.images && output.images.length > 0) {
                            const d = output.images[0];
                            const url = `/view?filename=${encodeURIComponent(d.filename)}&type=${encodeURIComponent(d.type)}&subfolder=${encodeURIComponent(d.subfolder || "")}&t=${Date.now()}`;
                            const img = new Image();
                            img.crossOrigin = "anonymous";
                            img.onload = () => {
                                this.currentImageA = img;
                                this.imgs = [img];
                                app.graph.setDirtyCanvas(true, true);
                            };
                            img.src = url;
                        } else {
                            if (this.imgs && this.imgs.length > 0) this.currentImageA = this.imgs[0];
                        }
                    } catch (_) {}

                    // AutoSave logic (unchanged)
                    if (isAutoSave() && this.currentImageA) {
                        const src = this.currentImageA.src;
                        if (src !== lastSavedSrc) {
                            lastSavedSrc = src;
                            doSave();
                        }
                    }
                    return;
                }

                // Compare mode
                this.imgs = null;

                if (!output?.images || output.images.length < 2) {
                    this._cmpImg1 = null; this._cmpImg2 = null;
                    this.currentImageA = null; this.currentImageB = null;
                    app.graph.setDirtyCanvas(true, true);
                    return;
                }

                const load = (d, idx) => {
                    const url = `/view?filename=${encodeURIComponent(d.filename)}&type=${encodeURIComponent(d.type)}&subfolder=${encodeURIComponent(d.subfolder || "")}&t=${Date.now()}`;
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => {
                        if (idx === 0) this._cmpImg1 = img; else this._cmpImg2 = img;
                        if (this._cmpImg1) this.currentImageA = this._cmpImg1;
                        if (this._cmpImg2) this.currentImageB = this._cmpImg2;
                        if (this._cmpImg1 && this._cmpImg2) this.imgs = [this._cmpImg1, this._cmpImg2];
                        app.graph.setDirtyCanvas(true, true);
                    };
                    img.src = url;
                };
                load(output.images[0], 0);
                load(output.images[1], 1);
            };

            // ── onDrawBackground ───────────────────────────────────────────
            const _origOnDrawBackground = this.onDrawBackground;
            this.onDrawBackground = function () {
                if (isCmpOn()) {
                    if (this.imgs) this.imgs = null;
                } else {
                    _origOnDrawBackground?.call(this);
                }
            };

            // ── onDrawForeground ───────────────────────────────────────────
            // Computes imgY by summing widget heights — no hardcoded gap.
            // The cmpSectionWidget already contributes CMP_HEADER_H + CMP_TABS_H
            // to widgetHeight, so imgY lands exactly below the tab row.
            const _origDraw = this.onDrawForeground;
            this.onDrawForeground = function (ctx) {
                if (!isCmpOn()) {
                    _origDraw?.call(this, ctx);
                    return;
                }

                // Let original draw run first (keeps node frame, title, etc.)
                _origDraw?.call(this, ctx);

                // Prefer the header-bottom recorded by the cmpSectionWidget.draw
                // (most accurate). Fall back to summing widget heights if missing.
                let imgY = this._cmpHeaderBottom;
                if (typeof imgY !== 'number') {
                    let widgetHeight = 0;
                    if (this.widgets && this.widgets.length) {
                        for (const wid of this.widgets) {
                            try {
                                const s = wid.computeSize ? wid.computeSize(this.size[0]) : [0, 18];
                                widgetHeight += Math.max(0, s[1]);
                            } catch (_) {}
                        }
                    }
                    imgY = widgetHeight;
                }

                // Store layout for mouse handlers
                this._cmpLayout = { IMG_Y: imgY };

                // Ensure node is tall enough for a square-ish preview
                if (this.size[0] < MIN_W) this.size[0] = MIN_W;
                const minH = imgY + this.size[0]; // square canvas below widgets
                if (this.size[1] < minH) this.size[1] = minH;

                const w = this.size[0];
                const imgH = this.size[1] - imgY;

                // Opacity slider geometry (Overlay mode)
                const sliderH    = 18;
                const sliderPadX = 8;
                const sliderAreaY = imgY + imgH - sliderH - 4;

                // Empty state
                if (!this._cmpImg1 && !this._cmpImg2) {
                    ctx.save();
                    ctx.fillStyle = "#171718";
                    ctx.fillRect(0, imgY, w, imgH);
                    ctx.fillStyle = "#555";
                    ctx.font = "12px 'Segoe UI',sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("Connect original_image and run to compare", w / 2, imgY + imgH / 2);
                    ctx.restore();
                    return;
                }

                const fit = (img) => {
                    if (!img) return { x: 0, y: imgY, w, h: imgH };
                    const a = img.naturalWidth / img.naturalHeight;
                    const fh = w / a;
                    if (fh <= imgH) return { x: 0, y: imgY + (imgH - fh) / 2, w, h: fh };
                    const fw = imgH * a;
                    return { x: (w - fw) / 2, y: imgY, w: fw, h: imgH };
                };
                const fr1 = fit(this._cmpImg1);
                const fr2 = fit(this._cmpImg2);

                ctx.save();
                ctx.beginPath(); ctx.rect(0, imgY, w, imgH); ctx.clip();
                ctx.fillStyle = "#111"; ctx.fillRect(0, imgY, w, imgH);

                const m = this._cmpMode;
                if (m === 0) {
                    // Left / Right split
                    const sx = w * this._cmpSplitX;
                    if (this._cmpImg1) { ctx.save(); ctx.beginPath(); ctx.rect(sx, imgY, w - sx, imgH); ctx.clip(); ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h); ctx.restore(); }
                    if (this._cmpImg2) { ctx.save(); ctx.beginPath(); ctx.rect(0, imgY, sx, imgH); ctx.clip(); ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.restore(); }
                    if (this._cmpSplitX > 0.01 && this._cmpSplitX < 0.99) {
                        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
                        ctx.beginPath(); ctx.moveTo(sx, imgY); ctx.lineTo(sx, imgY + imgH); ctx.stroke();
                    }
                } else if (m === 1) {
                    // Up / Down split
                    const sy = imgY + imgH * this._cmpSplitY;
                    if (this._cmpImg1) { ctx.save(); ctx.beginPath(); ctx.rect(0, sy, w, imgY + imgH - sy); ctx.clip(); ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h); ctx.restore(); }
                    if (this._cmpImg2) { ctx.save(); ctx.beginPath(); ctx.rect(0, imgY, w, sy - imgY); ctx.clip(); ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.restore(); }
                    if (this._cmpSplitY > 0.01 && this._cmpSplitY < 0.99) {
                        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
                        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
                    }
                } else if (m === 2) {
                    // Overlay
                    if (this._cmpImg1) ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
                    if (this._cmpImg2) { ctx.globalAlpha = this._cmpOpacity; ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.globalAlpha = 1; }
                } else {
                    // Difference
                    if (this._cmpImg1) ctx.drawImage(this._cmpImg1, fr1.x, fr1.y, fr1.w, fr1.h);
                    if (this._cmpImg2) { ctx.globalCompositeOperation = "difference"; ctx.drawImage(this._cmpImg2, fr2.x, fr2.y, fr2.w, fr2.h); ctx.globalCompositeOperation = "source-over"; }
                }
                ctx.restore();

                // ── Overlay opacity slider (drawn inside the image area) ───
                if (m === 2) {
                    ctx.save();
                    const trackX = sliderPadX + SLIDER_PAD;
                    const trackW = w - trackX - sliderPadX - 36;
                    const trackY = sliderAreaY + sliderH / 2 - 3;
                    const trackH = 6;
                    const pct    = this._cmpOpacity;
                    const thumbX = trackX + trackW * pct;

                    ctx.font = "9px 'Segoe UI',sans-serif";
                    ctx.fillStyle = "#ccc"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                    ctx.fillText("Opacity", sliderPadX, sliderAreaY + sliderH / 2);

                    ctx.fillStyle = "#2a2c2e";
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(trackX, trackY, trackW, trackH, 3);
                    else ctx.rect(trackX, trackY, trackW, trackH);
                    ctx.fill();

                    ctx.fillStyle = BRAND;
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(trackX, trackY, Math.max(0, trackW * pct), trackH, 3);
                    else ctx.rect(trackX, trackY, trackW * pct, trackH);
                    ctx.fill();

                    ctx.fillStyle = BRAND;
                    ctx.beginPath(); ctx.arc(thumbX, sliderAreaY + sliderH / 2, 6, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = "#fff";
                    ctx.beginPath(); ctx.arc(thumbX, sliderAreaY + sliderH / 2, 2.5, 0, Math.PI * 2); ctx.fill();

                    ctx.fillStyle = "#ccc"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                    ctx.fillText(`${Math.round(pct * 100)}%`, trackX + trackW + 6, sliderAreaY + sliderH / 2);

                    this._cmpSliderGeo = { x: trackX, y: sliderAreaY, w: trackW, h: sliderH };
                    ctx.restore();
                } else {
                    this._cmpSliderGeo = null;
                }
            };

            // ── Mouse handling ─────────────────────────────────────────────
            const _origDown = this.onMouseDown;
            this.onMouseDown = function (e, pos) {
                if (!isCmpOn()) return _origDown ? _origDown.call(this, e, pos) : undefined;

                const layout = this._cmpLayout || { IMG_Y: 200 };
                const imgY   = layout.IMG_Y;

                // Opacity slider drag start (inside image area, Overlay mode)
                if (this._cmpMode === 2 && this._cmpSliderGeo) {
                    const sg = this._cmpSliderGeo;
                    if (pos[0] >= sg.x - 8 && pos[0] <= sg.x + sg.w + 8 &&
                        pos[1] >= sg.y   && pos[1] <= sg.y + sg.h) {
                        this._cmpOpacity = Math.max(0, Math.min(1, (pos[0] - sg.x) / sg.w));
                        this._cmpDragging = true;
                        app.graph.setDirtyCanvas(true, true);
                        return true;
                    }
                }

                if (_origDown) return _origDown.call(this, e, pos);
            };

            const _origMove = this.onMouseMove;
            this.onMouseMove = function (e, pos) {
                if (!isCmpOn()) {
                    if (_origMove) return _origMove.call(this, e, pos);
                    return;
                }

                if (this._cmpDragging && this._cmpSliderGeo) {
                    const sg = this._cmpSliderGeo;
                    this._cmpOpacity = Math.max(0, Math.min(1, (pos[0] - sg.x) / sg.w));
                    app.graph.setDirtyCanvas(true, true);
                    return;
                }

                const layout = this._cmpLayout || { IMG_Y: 200 };
                const imgY   = layout.IMG_Y;

                if ((this._cmpMode === 0 || this._cmpMode === 1) && (this._cmpImg1 || this._cmpImg2)) {
                    const imgW = this.size[0];
                    const imgH = this.size[1] - imgY;
                    if (this._cmpMode === 0) this._cmpSplitX = Math.max(0, Math.min(1, pos[0] / imgW));
                    else this._cmpSplitY = Math.max(0, Math.min(1, (pos[1] - imgY) / imgH));
                    app.graph.setDirtyCanvas(true, true);
                }
                if (_origMove) return _origMove.call(this, e, pos);
            };

            const _origUp = this.onMouseUp;
            this.onMouseUp = function (e, pos) {
                this._cmpDragging = false;
                if (_origUp) return _origUp.call(this, e, pos);
            };

            const _origWheel = this.onMouseWheel;
            this.onMouseWheel = function (e, pos) {
                if (!isCmpOn()) return _origWheel ? _origWheel.call(this, e, pos) : undefined;
                // Overlay mode wheel control removed since Overlay mode is no longer available
                if (_origWheel) return _origWheel.call(this, e, pos);
            };

            const _origLeave = this.onMouseLeave;
            this.onMouseLeave = function (e) {
                this._cmpDragging = false;
                if (!isCmpOn()) return _origLeave ? _origLeave.call(this, e) : undefined;
                if (this._cmpMode === 0) { this._cmpSplitX = 0; app.graph.setDirtyCanvas(true, true); }
                else if (this._cmpMode === 1) { this._cmpSplitY = 0; app.graph.setDirtyCanvas(true, true); }
                if (_origLeave) return _origLeave.call(this, e);
            };

            // Set initial node size
            this.size[0] = INIT_W;
            this.size[1] = INIT_W + 200; // will auto-adjust on first draw
        };
    }
});
