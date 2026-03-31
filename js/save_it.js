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

                // Resize functionality
                const resizeHandle = dialog.querySelector("#save_it_fav_resize");
                let isResizing = false;

                resizeHandle.addEventListener("mousedown", (e) => {
                    isResizing = true;
                    e.preventDefault();
                    e.stopPropagation();
                });

                document.addEventListener("mousemove", (e) => {
                    if (!isResizing) return;
                    const rect = dialog.getBoundingClientRect();
                    const newWidth = e.clientX - rect.left;
                    const newHeight = e.clientY - rect.top;
                    if (newWidth > 320) dialog.style.width = `${newWidth}px`;
                    if (newHeight > 260) dialog.style.minHeight = `${newHeight}px`;
                });

                document.addEventListener("mouseup", () => {
                    isResizing = false;
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
                    filtered.forEach((folder, idx) => {
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

                    // Set folder
                    listDiv.querySelectorAll(".save_it_fav_set").forEach(btn => {
                        btn.addEventListener("click", () => {
                            const folder = btn.getAttribute("data-folder");
                            const pw = getWidget("filename_prefix");
                            if (pw) pw.value = folder;
                            showToast(`📁 Path set: ${folder}`);
                            overlay.remove();
                        });
                    });

                    // Delete folder
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

                // Add favorite
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

                // Enter key to add
                dialog.querySelector("#save_it_fav_input").addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        dialog.querySelector("#save_it_fav_add").click();
                    }
                });

                // Search functionality
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

                // Close
                dialog.querySelector("#save_it_fav_close").addEventListener("click", () => overlay.remove());
                overlay.addEventListener("click", (e) => {
                    if (e.target === overlay) overlay.remove();
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
                    : history.map((h, idx) => `
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

                        // Skip saving original comparison images (those with a 'b.' prefix)
                        // so only the generated image (a.) is saved when Compare mode
                        // is active.
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
                    if (!data || typeof data !== 'object') {
                        showToast("❌ Invalid response from server", true);
                        return;
                    }
                    const selectedPath = data.path;
                    if (!selectedPath) return;

                    // Set the filename_prefix widget to the selected path
                    const pw = getWidget("filename_prefix");
                    if (pw) {
                        try {
                            pw.value = selectedPath;
                            // Trigger callback if it exists to update the node
                            if (pw.callback && typeof pw.callback === 'function') {
                                pw.callback(selectedPath);
                            }
                        } catch (callbackError) {
                            console.warn("Widget callback error:", callbackError);
                        }
                        
                        // Force the node to be marked as modified
                        try {
                            if (self.onWidgetChanged && typeof self.onWidgetChanged === 'function') {
                                self.onWidgetChanged("filename_prefix", selectedPath);
                            }
                        } catch (widgetError) {
                            console.warn("onWidgetChanged error:", widgetError);
                        }
                        
                        // Mark the graph as dirty so changes are saved
                        try {
                            if (app.graph && typeof app.graph.setDirtyCanvas === 'function') {
                                app.graph.setDirtyCanvas(true, true);
                            }
                        } catch (graphError) {
                            console.warn("setDirtyCanvas error:", graphError);
                        }
                    }

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
                    // When autosave is turned ON, mark the current image as already saved
                    // to prevent re-saving old temp images from before autosave was enabled
                    if (value && self.imgs && self.imgs.length > 0) {
                        lastSavedSrc = self.imgs[0].src;
                    }
                };
                saveBtn.disabled = autosaveWidget.value;
            }

			// ── AutoSave: only save newly generated images ─────────────────
			let lastSavedSrc = null;

            // ── NEW: Image Comparison State ────────────────────────────────
            self.compareData = {
                originalImage: null,
                mouseX: null,
                isHovering: false
            };

			this.onExecuted = function(output) {
                // NEW: Store original image data if provided
                if (output.original_image && output.original_image.filename) {
                    self.compareData.originalImage = output.original_image;
                } else {
                    self.compareData.originalImage = null;
                }

                // Autosave logic
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
						const filename = url.searchParams.get("filename") || "";
						
						// Skip if already saved to output by Python autosave
						// Only proceed if it's a temp file AND hasn't been saved yet
						if (type !== "temp") return;
						
						// Additional check: skip if filename doesn't look like a temp preview file
						const tempPrefix = "save_it_preview";
						if (!filename.includes(tempPrefix)) return;

						lastSavedSrc = img.src;
						doSaveImgs([img]);
					}, 300);
				}
			};

            // NEW: Hook into mouse events for comparison
            const originalOnMouseMove = this.onMouseMove;
            this.onMouseMove = function(e, localPos, graphCanvas) {
                if (originalOnMouseMove) {
                    originalOnMouseMove.call(this, e, localPos, graphCanvas);
                }

                // Only track if we have an original image
                if (self.compareData.originalImage && self.imgs && self.imgs.length > 0) {
                    // Check if mouse is over the image area
                    const imageY = this.size[1] - 220; // Approximate image position
                    if (localPos[1] > imageY) {
                        self.compareData.isHovering = true;
                        self.compareData.mouseX = localPos[0];
                        this.setDirtyCanvas(true, false);
                    } else if (self.compareData.isHovering) {
                        self.compareData.isHovering = false;
                        this.setDirtyCanvas(true, false);
                    }
                }
            };

            const originalOnMouseLeave = this.onMouseLeave;
            this.onMouseLeave = function(e) {
                if (originalOnMouseLeave) {
                    originalOnMouseLeave.call(this, e);
                }
                if (self.compareData.isHovering) {
                    self.compareData.isHovering = false;
                    this.setDirtyCanvas(true, false);
                }
            };

            // NEW: Draw comparison overlay using onDrawForeground
            const originalOnDrawForeground = this.onDrawForeground;
            this.onDrawForeground = function(ctx) {
                if (originalOnDrawForeground) {
                    originalOnDrawForeground.call(this, ctx);
                }

                // Only draw if we have both images and mouse is hovering
                if (!self.compareData.originalImage || !self.compareData.isHovering || !self.imgs || self.imgs.length === 0) {
                    return;
                }

                const editedImg = self.imgs[0];
                if (!editedImg || !editedImg.currentSrc) return;

                // Build original image URL
                const origData = self.compareData.originalImage;
                const origUrl = api.apiURL(
                    `/view?filename=${encodeURIComponent(origData.filename)}&type=${origData.type}&subfolder=${encodeURIComponent(origData.subfolder || '')}`
                );

                // Load original image if not already loaded
                if (!self.compareData.originalImgElement) {
                    self.compareData.originalImgElement = new Image();
                    self.compareData.originalImgElement.src = origUrl;
                }

                const originalImgEl = self.compareData.originalImgElement;
                if (!originalImgEl.complete) return;

                // Calculate image display area (similar to how ComfyUI displays images)
                const imageY = this.size[1] - 220;
                const imageH = 220;
                const imageW = this.size[0];

                // Draw original image (full)
                ctx.save();
                ctx.globalAlpha = 1.0;
                ctx.drawImage(originalImgEl, 0, imageY, imageW, imageH);

                // Draw edited image (clipped based on mouse X position)
                if (self.compareData.mouseX !== null) {
                    ctx.beginPath();
                    ctx.rect(self.compareData.mouseX, imageY, imageW - self.compareData.mouseX, imageH);
                    ctx.clip();
                    ctx.drawImage(editedImg, 0, imageY, imageW, imageH);
                }

                // Draw divider line
                if (self.compareData.mouseX !== null) {
                    ctx.beginPath();
                    ctx.moveTo(self.compareData.mouseX, imageY);
                    ctx.lineTo(self.compareData.mouseX, imageY + imageH);
                    ctx.strokeStyle = "#2a9d8f";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                ctx.restore();
            };
        };
    }
});
