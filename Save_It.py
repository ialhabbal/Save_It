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
from datetime import datetime

from PIL import Image
from PIL.PngImagePlugin import PngInfo


# ─── Helpers ─────────────────────────────────────────────────────────────────

def resolve_output_dir(filename_prefix, base_dir):
    """Parse filename_prefix into (out_dir, base_name)."""
    prefix_parts = filename_prefix.replace("\\", "/").split("/")
    if len(prefix_parts) > 1:
        out_subfolder = "/".join(prefix_parts[:-1])
        base_name = prefix_parts[-1].strip("_").strip()
    else:
        out_subfolder = ""
        base_name = prefix_parts[0].strip("_").strip()
    out_dir = os.path.join(base_dir, out_subfolder) if out_subfolder else base_dir
    os.makedirs(out_dir, exist_ok=True)
    return out_dir, base_name, out_subfolder


def next_available_path(out_dir, base_name, use_timestamp=False, ext=".png"):
    """Find the next available filename using counter or timestamp."""
    if use_timestamp:
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = f"{base_name}_{ts}{ext}" if base_name else f"{ts}{ext}"
        dst_path = os.path.join(out_dir, filename)
        # If somehow same second, append counter
        c = 1
        while os.path.exists(dst_path):
            filename = f"{base_name}_{ts}_{c}{ext}" if base_name else f"{ts}_{c}{ext}"
            dst_path = os.path.join(out_dir, filename)
            c += 1
        return dst_path, filename
    else:
        # Load persistent counter
        counter_file = os.path.join(out_dir, ".save_it_counter")
        counter = 1
        if os.path.exists(counter_file):
            try:
                with open(counter_file, "r") as f:
                    counter = int(f.read().strip())
            except Exception:
                counter = 1
        # Find next that doesn't exist
        while True:
            filename = f"{base_name}_{counter:05}{ext}" if base_name else f"{counter:05}{ext}"
            dst_path = os.path.join(out_dir, filename)
            if not os.path.exists(dst_path):
                break
            counter += 1
        # Save updated counter
        with open(counter_file, "w") as f:
            f.write(str(counter + 1))
        return dst_path, filename


def get_pil_format_and_ext(fmt):
    fmt = fmt.upper()
    if fmt == "JPEG":
        return "JPEG", ".jpg"
    elif fmt == "WEBP":
        return "WEBP", ".webp"
    else:
        return "PNG", ".png"


def save_pil_image(img, dst_path, fmt, quality, metadata=None, compress_level=4):
    pil_fmt, _ = get_pil_format_and_ext(fmt)
    if pil_fmt == "PNG":
        img.save(dst_path, pnginfo=metadata, compress_level=compress_level)
    elif pil_fmt == "JPEG":
        if img.mode == "RGBA":
            img = img.convert("RGB")
        img.save(dst_path, format="JPEG", quality=quality)
    elif pil_fmt == "WEBP":
        img.save(dst_path, format="WEBP", quality=quality)


# ─── Favorite Folders storage ────────────────────────────────────────────────

FAVORITES_FILE = os.path.join(os.path.dirname(__file__), "favorite_folders.json")


def load_favorites():
    if os.path.exists(FAVORITES_FILE):
        try:
            with open(FAVORITES_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_favorites(folders):
    with open(FAVORITES_FILE, "w") as f:
        json.dump(folders, f, indent=2)


# ─── API Routes ───────────────────────────────────────────────────────────────

@PromptServer.instance.routes.post("/save_it/save")
async def save_it_handler(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        file_type = data.get("type", "temp")
        filename_prefix = data.get("filename_prefix", "ComfyUI")
        fmt = data.get("format", "PNG")
        quality = int(data.get("quality", 95))
        use_timestamp = data.get("use_timestamp", False)

        if not filename:
            return web.Response(status=400, text="Missing filename")

        src_dir = folder_paths.get_temp_directory() if file_type == "temp" else folder_paths.get_output_directory()
        src_path = os.path.join(src_dir, subfolder, filename) if subfolder else os.path.join(src_dir, filename)

        if not os.path.exists(src_path):
            return web.Response(status=404, text=f"File not found: {src_path}")

        out_base_dir = folder_paths.get_output_directory()
        out_dir, base_name, out_subfolder = resolve_output_dir(filename_prefix, out_base_dir)

        _, ext = get_pil_format_and_ext(fmt)
        dst_path, new_filename = next_available_path(out_dir, base_name, use_timestamp, ext)

        # Re-save with correct format/quality
        img = Image.open(src_path)
        save_pil_image(img, dst_path, fmt, quality)

        return web.Response(status=200, text=f"Saved to {dst_path}")

    except Exception as e:
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/save_it/open_folder")
async def open_folder_handler(request):
    try:
        data = await request.json()
        filename_prefix = data.get("filename_prefix", "ComfyUI")
        out_base_dir = folder_paths.get_output_directory()
        out_dir, _, _ = resolve_output_dir(filename_prefix, out_base_dir)

        if sys.platform == "win32":
            os.startfile(out_dir)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", out_dir])
        else:
            subprocess.Popen(["xdg-open", out_dir])

        return web.Response(status=200, text=f"Opened {out_dir}")

    except Exception as e:
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.get("/save_it/favorites")
async def get_favorites(request):
    return web.json_response(load_favorites())


@PromptServer.instance.routes.post("/save_it/favorites")
async def set_favorites(request):
    try:
        data = await request.json()
        folders = data.get("folders", [])
        save_favorites(folders)
        return web.Response(status=200, text="OK")
    except Exception as e:
        return web.Response(status=500, text=str(e))


# ─── Helper for save_images_with_metadata ─────────────────────────────────────

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


# ─── Node ─────────────────────────────────────────────────────────────────────

class Save_It:
    def __init__(self):
        self.prefix_append = "_save_" + ''.join(random.choice(string.ascii_lowercase) for _ in range(5))
        self.compress_level = 4
        self.last_prompt_id = None

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "The images to save."}),
                "autosave": ("BOOLEAN", {
                    "default": False,
                    "label_on": "AutoSave ON",
                    "label_off": "AutoSave OFF",
                    "tooltip": "When ON, images are saved automatically. Save button is disabled.",
                }),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI",
                    "tooltip": "Prefix for the saved file. Use subfolder/name e.g. MyFolder/MyImage",
                }),
                "format": (["PNG", "JPEG", "WEBP"], {
                    "default": "PNG",
                    "tooltip": "Image format to save as.",
                }),
                "quality": ("INT", {
                    "default": 95,
                    "min": 1,
                    "max": 100,
                    "step": 1,
                    "display": "slider",
                    "tooltip": "Quality for JPEG and WebP (1-100). Ignored for PNG.",
                }),
                "use_timestamp": ("BOOLEAN", {
                    "default": False,
                    "label_on": "Timestamp ON",
                    "label_off": "Timestamp OFF",
                    "tooltip": "When ON, appends date/time to filename instead of a counter.",
                }),
                "save_trigger": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 99999,
                    "step": 1,
                    "display": "number",
                    "tooltip": "Internal trigger for save button.",
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            },
        }

    @classmethod
    def IS_CHANGED(s, images, autosave=False, filename_prefix="ComfyUI", format="PNG", quality=95,
                   use_timestamp=False, save_trigger=0, prompt=None, extra_pnginfo=None):
        return save_trigger

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "interactive"
    DISPLAY_NAME = "Save_It"
    DESCRIPTION = "Saves images with format options, AutoSave, timestamps, and favorite folders."

    def save_images(self, images, autosave=False, filename_prefix="ComfyUI", format="PNG",
                    quality=95, use_timestamp=False, save_trigger=0, prompt=None, extra_pnginfo=None):
        if images is None:
            return {"ui": {"images": list()}}

        if autosave:
            current_prompt_id = id(prompt) if prompt is not None else None

            out_base_dir = folder_paths.get_output_directory()
            out_dir, base_name, out_subfolder = resolve_output_dir(filename_prefix, out_base_dir)
            _, ext = get_pil_format_and_ext(format)

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

                if current_prompt_id != self.last_prompt_id:
                    self.last_prompt_id = current_prompt_id
                    dst_path, new_filename = next_available_path(out_dir, base_name, use_timestamp, ext)
                    
                    save_pil_image(img, dst_path, format, quality,
                                   metadata=(metadata if format == "PNG" else None),
                                   compress_level=self.compress_level)
                    results.append({
                        "filename": new_filename,
                        "subfolder": out_subfolder,
                        "type": "output"
                    })
                else:
                    
                    output_dir = folder_paths.get_temp_directory()
                    temp_prefix = "save_it_preview" + self.prefix_append
                    temp_results = save_images_with_metadata(
                        images=[image],
                        output_dir=output_dir,
                        save_type="temp",
                        prompt=prompt,
                        extra_pnginfo=extra_pnginfo,
                        prefix=temp_prefix,
                        compress_level=self.compress_level
                    )
                    results.extend(temp_results)

            return {"ui": {"images": results}}

        else:
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