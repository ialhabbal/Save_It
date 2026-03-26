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

            // ── Helper getters ─────────────────────────────────────────────
            const getWidget = (name) => self.widgets?.find(w => w.name === name);
            const isAutoSave = () => getWidget("autosave")?.value ?? false;
            const getPrefix = () => getWidget("filename_prefix")?.value ?? "ComfyUI";
            const getFormat = () => getWidget("format")?.value ?? "PNG";
            const getQuality = () => getWidget("quality")?.value ?? 95;
            const getTimestamp = () => getWidget("use_timestamp")?.value ?? false;

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

                const listEl    = dialog.querySelector("#save_it_fav_list");
                const input     = dialog.querySelector("#save_it_fav_input");
                const searchEl  = dialog.querySelector("#save_it_fav_search");
                const clearBtn  = dialog.querySelector("#save_it_fav_search_clear");
                const resizeHandle = dialog.querySelector("#save_it_fav_resize");

                // ── Resize logic ───────────────────────────────────────────
                let isResizing = false, startX, startY, startW, startH;

                resizeHandle.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    isResizing = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    startW = dialog.offsetWidth;
                    startH = dialog.offsetHeight;
                    document.body.style.userSelect = "none";
                });

                document.addEventListener("mousemove", (e) => {
                    if (!isResizing) return;
                    const newW = Math.max(320, startW + (e.clientX - startX));
                    const newH = Math.max(260, startH + (e.clientY - startY));
                    const maxW = window.innerWidth * 0.95;
                    const maxH = window.innerHeight * 0.90;
                    dialog.style.width  = Math.min(newW, maxW) + "px";
                    dialog.style.height = Math.min(newH, maxH) + "px";
                });

                document.addEventListener("mouseup", () => {
                    if (isResizing) {
                        isResizing = false;
                        document.body.style.userSelect = "";
                    }
                });

                // ── Search logic ───────────────────────────────────────────
                let currentQuery = "";

                searchEl.addEventListener("input", () => {
                    currentQuery = searchEl.value.trim().toLowerCase();
                    clearBtn.style.display = currentQuery ? "block" : "none";
                    applySearch();
                });

                clearBtn.addEventListener("click", () => {
                    searchEl.value = "";
                    currentQuery = "";
                    clearBtn.style.display = "none";
                    applySearch();
                    searchEl.focus();
                });

                function applySearch() {
                    const rows = listEl.querySelectorAll(".fav-row");
                    let firstMatch = null;

                    rows.forEach((row) => {
                        const favText = row.dataset.fav.toLowerCase();
                        const spanEl  = row.querySelector(".fav-label");

                        if (!currentQuery) {
                            // Reset: show all, remove highlights
                            row.style.display = "flex";
                            spanEl.style.border = "1px solid #333";
                            spanEl.style.background = "#0d1f1f";
                            return;
                        }

                        const matches = favText.includes(currentQuery);
                        row.style.display = matches ? "flex" : "none";

                        if (matches) {
                            spanEl.style.border = "1px solid #2a9d8f";
                            spanEl.style.background = "#0d2e2a";
                            if (!firstMatch) firstMatch = row;
                        } else {
                            spanEl.style.border = "1px solid #333";
                            spanEl.style.background = "#0d1f1f";
                        }
                    });

                    // Scroll first match into view
                    if (firstMatch) {
                        firstMatch.scrollIntoView({ block: "nearest", behavior: "smooth" });
                    }
                }

                // ── Render list ────────────────────────────────────────────
                async function renderList() {
                    const favs = await loadFavorites();
                    listEl.innerHTML = "";
                    if (favs.length === 0) {
                        listEl.innerHTML = `<p style="color:#888;font-size:12px;">No favorites yet.</p>`;
                        return;
                    }
                    favs.forEach((fav, i) => {
                        const row = document.createElement("div");
                        row.className = "fav-row";
                        row.dataset.fav = fav;
                        row.style.cssText = `display:flex;align-items:center;gap:8px;margin-bottom:6px;`;
                        row.innerHTML = `
                            <span class="fav-label"
                                style="flex:1;font-size:13px;background:#0d1f1f;
                                    padding:6px 10px;border-radius:6px;border:1px solid #333;
                                    cursor:pointer;color:#ccc;white-space:nowrap;
                                    overflow:hidden;text-overflow:ellipsis;"
                                title="${fav}">📁 ${fav}</span>
                            <button data-i="${i}" class="fav-del"
                                style="flex-shrink:0;padding:5px 10px;background:#c0392b;color:white;
                                border:none;border-radius:6px;cursor:pointer;font-size:12px;">✕</button>
                        `;
                        row.querySelector(".fav-label").addEventListener("click", () => {
                            const pw = getWidget("filename_prefix");
                            if (pw) pw.value = fav;
                            overlay.remove();
                            showToast(`📁 Switched to: ${fav}`);
                        });
                        row.querySelector(".fav-del").addEventListener("click", async () => {
                            const favs2 = await loadFavorites();
                            favs2.splice(i, 1);
                            await saveFavorites(favs2);
                            renderList();
                        });
                        listEl.appendChild(row);
                    });

                    // Re-apply search filter after re-render
                    if (currentQuery) applySearch();
                }

                renderList();

                dialog.querySelector("#save_it_fav_add").addEventListener("click", async () => {
                    let val = input.value.trim();
                    if (!val) return;
                    // Automatically ensure path ends with /
                    if (!val.endsWith("/") && !val.endsWith("\\")) {
                        val = val + "/";
                    }
                    const favs = await loadFavorites();
                    if (!favs.includes(val)) {
                        favs.push(val);
                        await saveFavorites(favs);
                    }
                    input.value = "";
                    renderList();
                });

                dialog.querySelector("#save_it_fav_close").addEventListener("click", () => overlay.remove());
                overlay.addEventListener("mousedown", (e) => {
                    if (e.target === overlay && !isResizing) overlay.remove();
                });
            }

            // ── Save History Dialog ────────────────────────────────────────
            function showHistoryDialog() {
                const existing = document.getElementById("save_it_history_dialog");
                if (existing) { existing.remove(); return; }

                const history = loadHistory();

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
                    max-height: 80vh;
                    overflow-y: auto;
                    color: white;
                    font-family: sans-serif;
                `;

                let rows = "";
                if (history.length === 0) {
                    rows = `<p style="color:#888;font-size:13px;">No saves yet.</p>`;
                } else {
                    rows = history.map(h => `
                        <div style="border-bottom:1px solid #2a3a3a;padding:8px 0;font-size:12px;">
                            <div style="color:#2a9d8f;font-weight:bold;">📄 ${h.filename}</div>
                            <div style="color:#aaa;margin-top:2px;">📁 ${h.path}</div>
                            <div style="color:#666;margin-top:2px;">🕐 ${h.time}</div>
                        </div>
                    `).join("");
                }

                dialog.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h3 style="margin:0;color:#2a9d8f;">📋 Save History</h3>
                        <div style="display:flex;gap:8px;">
                            <button id="save_it_hist_clear"
                                style="padding:5px 12px;background:#c0392b;color:white;border:none;
                                border-radius:6px;cursor:pointer;font-size:12px;">Clear</button>
                            <button id="save_it_hist_close"
                                style="padding:5px 12px;background:#555;color:white;border:none;
                                border-radius:6px;cursor:pointer;font-size:12px;">Close</button>
                        </div>
                    </div>
                    <div>${rows}</div>
                `;

                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                dialog.querySelector("#save_it_hist_close").addEventListener("click", () => overlay.remove());
                dialog.querySelector("#save_it_hist_clear").addEventListener("click", () => {
                    localStorage.removeItem(HISTORY_KEY);
                    overlay.remove();
                    showToast("History cleared.");
                });
                overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
            }

            // ── Core save logic ────────────────────────────────────────────
            async function doSaveImgs(images) {
                const filename_prefix = getPrefix();
                const format = getFormat();
                const quality = getQuality();
                const use_timestamp = getTimestamp();

                for (const img of images) {
                    const url = new URL(img.src, window.location.origin);
                    const filename = url.searchParams.get("filename");
                    const subfolder = url.searchParams.get("subfolder") || "";
                    const type = url.searchParams.get("type") || "temp";

                    if (!filename) continue;

                    try {
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
                const images = self.imgs;
                if (!images || images.length === 0) {
                    showToast("No image to save. Please run the workflow first.", true);
                    return;
                }
                await doSaveImgs(images);
            }

            // ── Browse & Set Path button ───────────────────────────────────
            const browseBtn = this.addWidget("button", "📁  Browse & Set Save Path", null, async () => {
                try {
                    const response = await api.fetchApi("/save_it/browse_folder", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({})
                    });

                    if (response.status === 204) return; // user cancelled

                    if (!response.ok) {
                        const err = await response.text();
                        showToast(`❌ Browse failed: ${err}`, true);
                        return;
                    }

                    const data = await response.json();
                    const selectedPath = data.path;
                    if (!selectedPath) return;

                    // Set the filename_prefix widget to the selected path
                    const pw = getWidget("filename_prefix");
                    if (pw) pw.value = selectedPath;

                    showToast(`📁 Path set: ${selectedPath}`);

                    // Offer to add to favorites
                    showAddToFavoritesPrompt(selectedPath);

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
                        showToast(`Already in favorites.`);
                    }
                    dismiss();
                });

                prompt.querySelector("#save_it_addfav_no").addEventListener("click", dismiss);

                // Auto-dismiss after 8 seconds
                setTimeout(dismiss, 15000);
            }

            // ── Save Image button ──────────────────────────────────────────
            const saveBtn = this.addWidget("button", "💾  Save Image", null, async () => {
                if (isAutoSave()) return;
                await doSave();
            });
            saveBtn.serialize = false;

            // ── Open Folder button ─────────────────────────────────────────
            const folderBtn = this.addWidget("button", "📂  Open Output Folder", null, async () => {
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
                autosaveWidget.callback = function(value) {
                    originalCallback?.call(this, value);
                    saveBtn.disabled = value;
                };
                saveBtn.disabled = autosaveWidget.value;
            }

			// ── AutoSave: only save newly generated images ─────────────────
			let lastSavedSrc = null;

			this.onExecuted = function(output) {
				if (isAutoSave()) {
					setTimeout(() => {
						const images = self.imgs;
						if (!images || images.length === 0) return;

						// Only save the first image and only if its src is new
						const img = images[0];
						if (!img || img.src === lastSavedSrc) return;

						// Check it's actually a fresh temp image not a previously saved output
						const url = new URL(img.src, window.location.origin);
						const type = url.searchParams.get("type") || "";
						if (type !== "temp") return;

						lastSavedSrc = img.src;
						doSaveImgs([img]);
					}, 300);
				}
			};
        };
    }
});