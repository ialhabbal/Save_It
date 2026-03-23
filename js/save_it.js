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

            // Hide the save_trigger number widget
            const triggerWidget = this.widgets?.find(w => w.name === "save_trigger");
            if (triggerWidget) {
                triggerWidget.type = "hidden";
                triggerWidget.computeSize = () => [0, -4];
            }

            // Save Image button
            const btn = this.addWidget("button", "💾  Save Image", null, async () => {

                const images = self.imgs;
                if (!images || images.length === 0) {
                    alert("No image to save. Please run the workflow first.");
                    return;
                }

                const prefixWidget = self.widgets?.find(w => w.name === "filename_prefix");
                const filename_prefix = prefixWidget ? prefixWidget.value : "ComfyUI";

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
                            body: JSON.stringify({ filename, subfolder, type, filename_prefix })
                        });

                        if (response.ok) {
                            const msg = await response.text();
                            console.log(`Save_It: ${msg}`);
                        } else {
                            const err = await response.text();
                            alert(`Save failed: ${err}`);
                        }
                    } catch (e) {
                        alert(`Save error: ${e.message}`);
                    }
                }
            });

            btn.serialize = false;

            // Open Folder button
            const folderBtn = this.addWidget("button", "📂  Open Output Folder", null, async () => {

                const prefixWidget = self.widgets?.find(w => w.name === "filename_prefix");
                const filename_prefix = prefixWidget ? prefixWidget.value : "ComfyUI";

                try {
                    const response = await api.fetchApi("/save_it/open_folder", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ filename_prefix })
                    });

                    if (!response.ok) {
                        const err = await response.text();
                        alert(`Could not open folder: ${err}`);
                    }
                } catch (e) {
                    alert(`Error: ${e.message}`);
                }
            });

            folderBtn.serialize = false;
        };
    }
});