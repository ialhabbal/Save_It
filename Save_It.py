import folder_paths
import json
import random
import os
import shutil
import string
import subprocess
import sys
import numpy as np
from aiohttp import web
from server import PromptServer

from PIL import Image
from PIL.PngImagePlugin import PngInfo


@PromptServer.instance.routes.post("/save_it/save")
async def save_it_handler(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        file_type = data.get("type", "temp")
        filename_prefix = data.get("filename_prefix", "ComfyUI")

        if not filename:
            return web.Response(status=400, text="Missing filename")

        if file_type == "temp":
            src_dir = folder_paths.get_temp_directory()
        else:
            src_dir = folder_paths.get_output_directory()

        src_path = os.path.join(src_dir, subfolder, filename) if subfolder else os.path.join(src_dir, filename)

        if not os.path.exists(src_path):
            return web.Response(status=404, text=f"File not found: {src_path}")

        out_base_dir = folder_paths.get_output_directory()

        prefix_parts = filename_prefix.replace("\\", "/").split("/")
        if len(prefix_parts) > 1:
            out_subfolder = "/".join(prefix_parts[:-1])
            base_name = prefix_parts[-1].strip("_").strip()
        else:
            out_subfolder = ""
            base_name = prefix_parts[0].strip("_").strip()

        out_dir = os.path.join(out_base_dir, out_subfolder) if out_subfolder else out_base_dir
        os.makedirs(out_dir, exist_ok=True)

        counter = 1
        while True:
            if base_name:
                new_filename = f"{base_name}_{counter:05}.png"
            else:
                new_filename = f"{counter:05}.png"
            dst_path = os.path.join(out_dir, new_filename)
            if not os.path.exists(dst_path):
                break
            counter += 1

        shutil.copy2(src_path, dst_path)
        return web.Response(status=200, text=f"Saved to {dst_path}")

    except Exception as e:
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/save_it/open_folder")
async def open_folder_handler(request):
    try:
        data = await request.json()
        filename_prefix = data.get("filename_prefix", "ComfyUI")

        out_base_dir = folder_paths.get_output_directory()

        prefix_parts = filename_prefix.replace("\\", "/").split("/")
        if len(prefix_parts) > 1:
            out_subfolder = "/".join(prefix_parts[:-1])
        else:
            out_subfolder = ""

        out_dir = os.path.join(out_base_dir, out_subfolder) if out_subfolder else out_base_dir
        os.makedirs(out_dir, exist_ok=True)

        if sys.platform == "win32":
            os.startfile(out_dir)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", out_dir])
        else:
            subprocess.Popen(["xdg-open", out_dir])

        return web.Response(status=200, text=f"Opened {out_dir}")

    except Exception as e:
        return web.Response(status=500, text=str(e))


def save_images_with_metadata(images, output_dir, save_type="", prompt=None, extra_pnginfo=None, prefix="", compress_level=4):
    filename_prefix = prefix
    results = []

    first = images[0]
    arr0 = first.cpu().numpy()
    if arr0.ndim == 3 and arr0.shape[0] in (1, 3, 4):
        height, width = arr0.shape[1], arr0.shape[2]
    else:
        height, width = arr0.shape[0], arr0.shape[1]

    full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
        filename_prefix, output_dir, width, height
    )

    for batch_number, image in enumerate(images):
        arr = image.cpu().numpy()
        if arr.ndim == 3 and arr.shape[0] in (1, 3, 4):
            arr = np.transpose(arr, (1, 2, 0))
        if arr.dtype != np.uint8:
            arr = (255. * arr).clip(0, 255).astype('uint8')

        img = Image.fromarray(arr)
        metadata = PngInfo()

        if prompt:
            metadata.add_text("prompt", json.dumps(prompt))
        if extra_pnginfo:
            for key, value in extra_pnginfo.items():
                metadata.add_text(key, json.dumps(value))

        file = f"{filename.replace('%batch_num%', str(batch_number))}_{counter:05}_.png"
        img.save(os.path.join(full_output_folder, file), pnginfo=metadata, compress_level=compress_level)
        results.append({"filename": file, "subfolder": subfolder, "type": save_type})
        counter += 1

    return results


class Save_It:
    def __init__(self):
        self.prefix_append = "_save_" + ''.join(random.choice(string.ascii_lowercase) for _ in range(5))
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "The images to save."}),
                "autosave": ("BOOLEAN", {
                    "default": False,
                    "label_on": "AutoSave ON",
                    "label_off": "AutoSave OFF",
                    "tooltip": "When ON, images are saved automatically after each run. The Save button is disabled.",
                }),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI",
                    "tooltip": "The prefix for the file to save. Use subfolder/name to save into a subfolder, e.g. MyFolder/MyImage",
                }),
                "save_trigger": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 99999,
                    "step": 1,
                    "display": "number",
                    "tooltip": "Incremented by the Save button to trigger saving.",
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            },
        }

    @classmethod
    def IS_CHANGED(s, images, autosave=False, filename_prefix="ComfyUI", save_trigger=0, prompt=None, extra_pnginfo=None):
        return save_trigger

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "interactive"
    DISPLAY_NAME = "Save_It"
    DESCRIPTION = "Saves the input images to your ComfyUI output directory when you click the Save Image button."

    def save_images(self, images, autosave=False, filename_prefix="ComfyUI", save_trigger=0, prompt=None, extra_pnginfo=None):
        if images is None:
            return {"ui": {"images": list()}}

        if autosave:
            # AutoSave ON: save directly to output folder immediately
            out_base_dir = folder_paths.get_output_directory()

            prefix_parts = filename_prefix.replace("\\", "/").split("/")
            if len(prefix_parts) > 1:
                out_subfolder = "/".join(prefix_parts[:-1])
                base_name = prefix_parts[-1].strip("_").strip()
            else:
                out_subfolder = ""
                base_name = prefix_parts[0].strip("_").strip()

            out_dir = os.path.join(out_base_dir, out_subfolder) if out_subfolder else out_base_dir
            os.makedirs(out_dir, exist_ok=True)

            results = []
            for image in images:
                arr = image.cpu().numpy()
                if arr.ndim == 3 and arr.shape[0] in (1, 3, 4):
                    arr = np.transpose(arr, (1, 2, 0))
                if arr.dtype != np.uint8:
                    arr = (255. * arr).clip(0, 255).astype('uint8')

                img = Image.fromarray(arr)
                metadata = PngInfo()
                if prompt:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo:
                    for key, value in extra_pnginfo.items():
                        metadata.add_text(key, json.dumps(value))

                # Find next available counter
                counter = 1
                while True:
                    if base_name:
                        new_filename = f"{base_name}_{counter:05}.png"
                    else:
                        new_filename = f"{counter:05}.png"
                    dst_path = os.path.join(out_dir, new_filename)
                    if not os.path.exists(dst_path):
                        break
                    counter += 1

                img.save(dst_path, pnginfo=metadata, compress_level=self.compress_level)
                results.append({
                    "filename": new_filename,
                    "subfolder": out_subfolder,
                    "type": "output"
                })

            return {"ui": {"images": results}}

        else:
            # AutoSave OFF: save to temp for preview only
            output_dir = folder_paths.get_temp_directory()
            temp_prefix = "save_it_preview" + self.prefix_append

            results = save_images_with_metadata(
                images=images,
                output_dir=output_dir,
                save_type="temp",
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
                prefix=temp_prefix,
                compress_level=self.compress_level
            )

            return {"ui": {"images": results}}