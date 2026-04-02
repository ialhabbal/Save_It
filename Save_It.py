import folder_paths
import json
import random
import os
import shutil
import string
import subprocess
import sys
import ctypes
import time
import numpy as np
import torch
from aiohttp import web
from server import PromptServer
from datetime import datetime

from PIL import Image
from PIL.PngImagePlugin import PngInfo


# ─── Helpers ─────────────────────────────────────────────────────────────────

def resolve_output_dir(filename_prefix, base_dir):
    """Parse filename_prefix into (out_dir, base_name, out_subfolder).

    Rules
    -----
    - If filename_prefix is an absolute path (Windows "X:\\..." or Unix "/...")
      the ENTIRE value is used as the output directory and base_name is "".
      This is true whether or not the path ends with a slash.

    - Otherwise treat as a relative "subfolder/basename" joined onto base_dir,
      preserving the original behaviour for plain names like "ComfyUI" or
      relative paths like "MyFolder/MyImage".
    """
    # Normalise separators so the rest of the logic is separator-agnostic
    normalised = filename_prefix.replace("\\", "/")

    # Detect Windows absolute path ("X:/...") or Unix absolute path ("/...")
    is_absolute = normalised.startswith("/") or (len(normalised) >= 2 and normalised[1] == ":")

    if is_absolute:
        # Strip trailing slash so os.path.normpath gives a clean directory path
        out_dir = os.path.normpath(normalised.rstrip("/"))
        out_subfolder = out_dir
        base_name = ""
    else:
        parts = normalised.rstrip("/").split("/")
        if len(parts) > 1:
            out_subfolder = "/".join(parts[:-1])
            base_name = parts[-1].strip("_").strip()
        else:
            out_subfolder = ""
            base_name = parts[0].strip("_").strip()
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

        # Open the source image
        img = Image.open(src_path)
        
        # Extract existing metadata from the source PNG file if it exists
        metadata = None
        if fmt.upper() == "PNG":
            metadata = PngInfo()
            # Copy all existing text chunks from source image if it's a PNG
            if hasattr(img, 'info'):
                for key, value in img.info.items():
                    if isinstance(key, str) and isinstance(value, str):
                        # Preserve workflow and prompt metadata
                        metadata.add_text(key, value)
        
        # Re-save with correct format/quality and preserved metadata
        save_pil_image(img, dst_path, fmt, quality, metadata=metadata)

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
            try:
                subprocess.Popen(["explorer", out_dir])
                time.sleep(0.2)
            except Exception:
                try:
                    subprocess.Popen(f'start "" "{out_dir}"', shell=True)
                    time.sleep(0.2)
                except Exception:
                    os.startfile(out_dir)
                    time.sleep(0.2)

            try:
                user32 = ctypes.windll.user32

                def enum_windows_callback(hwnd, results):
                    if user32.IsWindowVisible(hwnd):
                        length = user32.GetWindowTextLengthW(hwnd)
                        buff = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buff, length + 1)
                        window_title = buff.value
                        if out_dir in window_title:
                            results.append(hwnd)
                    return True

                results = []
                EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int))
                enum_windows_proc = EnumWindowsProc(enum_windows_callback)
                user32.EnumWindows(enum_windows_proc, ctypes.cast(ctypes.pointer(ctypes.c_int(0)), ctypes.POINTER(ctypes.c_int)))

                if results:
                    hwnd = results[0]
                    user32.ShowWindow(hwnd, 9)
                    user32.SetForegroundWindow(hwnd)
                    user32.BringWindowToTop(hwnd)
                    user32.SetActiveWindow(hwnd)
            except Exception:
                pass

        elif sys.platform == "darwin":
            subprocess.Popen(["open", out_dir])
        else:
            subprocess.Popen(["xdg-open", out_dir])

        return web.Response(status=200, text=f"Opened folder: {out_dir}")
    except Exception as e:
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/save_it/browse_folder")
async def browse_folder_handler(request):
    """Open a native folder picker and return the selected path.

    Returns 204 when the user cancels selection.
    """
    try:
        # On Windows, use PowerShell's FolderBrowserDialog (avoids tkinter
        # dependency and COM complexity). Run the PowerShell call in a
        # thread to avoid blocking the event loop. Fall back to tkinter on
        # non-Windows platforms.
        import asyncio

        if sys.platform == "win32":
            def _run_powershell_picker():
                try:
                    ps_script = (
                        "Add-Type -AssemblyName System.Windows.Forms;"
                        "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
                        "$d.Description='Select folder to save images';"
                        "$d.ShowNewFolderButton=$true;"
                        "$form = New-Object System.Windows.Forms.Form;"
                        "$form.TopMost = $true;"
                        "$form.WindowState = 'Minimized';"
                        "$form.ShowInTaskbar = $false;"
                        "$form.Add_Shown({$form.Activate()});"
                        "if($d.ShowDialog($form) -eq 'OK'){ Write-Output $d.SelectedPath };"
                        "$form.Dispose();"
                    )
                    proc = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0)
                    out = proc.stdout.strip()
                    if out:
                        try:
                            user32 = ctypes.windll.user32
                            hwnd = user32.GetForegroundWindow()
                            if hwnd:
                                user32.SetForegroundWindow(hwnd)
                                user32.BringWindowToTop(hwnd)
                        except Exception:
                            pass
                    return out
                except Exception:
                    return ""

            loop = asyncio.get_event_loop()
            path = await loop.run_in_executor(None, _run_powershell_picker)
            if not path:
                return web.Response(status=204)
            return web.json_response({"path": path})

        # Non-windows fallback: try tkinter
        try:
            import tkinter as tk
            from tkinter import filedialog

            root = tk.Tk()
            root.withdraw()
            try:
                root.attributes('-topmost', True)
            except Exception:
                pass
            path = filedialog.askdirectory()
            try:
                root.destroy()
            except Exception:
                pass

            if not path:
                return web.Response(status=204)
            return web.json_response({"path": path})
        except Exception as e:
            return web.Response(status=500, text=str(e))
    except Exception as e:
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.get("/save_it/favorites")
async def get_favorites_handler(request):
    try:
        folders = load_favorites()
        return web.json_response(folders)
    except Exception as e:
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/save_it/favorites")
async def save_favorites_handler(request):
    try:
        data = await request.json()
        folders = data.get("folders", [])
        save_favorites(folders)
        return web.Response(status=200, text="Favorites saved")
    except Exception as e:
        return web.Response(status=500, text=str(e))


# ─── Helpers for batch saving ─────────────────────────────────────────────────

def save_images_with_metadata(images, output_dir, save_type, prompt=None, extra_pnginfo=None,
                               prefix="ComfyUI", compress_level=4):
    """
    # ORIGINAL (unchanged)
    Helper to save a batch of images as temp or output files with metadata.
    Returns list of dicts {filename, subfolder, type}.
    """
    results = []

    if images is None:
        return results

    if isinstance(images, torch.Tensor):
        if images.numel() == 0:
            return results
    else:
        if len(images) == 0:
            return results

    filename_prefix = prefix
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


# ─── REPLACED: Compare Functionality ────────

def save_compare_images(image_a, original_image, filename_prefix, compress_level=4):
    """
    Replacement for previous compare helper.
    
    Saves two images into the temp directory with a shared prefix and
    returns a UI-style dict: {"ui": {"images": [img_a, img_b]}}
    where each img is a dict {filename, subfolder, type} (type == "temp").
    """
    results = []
    output_dir = folder_paths.get_temp_directory()

    # Robust checks for inputs (avoid evaluating a Tensor's truthiness)
    def _has_images(x):
        if x is None:
            return False
        if isinstance(x, torch.Tensor):
            return x.numel() != 0
        try:
            return len(x) > 0
        except Exception:
            return False

    # Determine width/height from an available tensor
    first_tensor = None
    if _has_images(image_a):
        first_tensor = image_a[0] if not isinstance(image_a, torch.Tensor) else image_a[0]
    elif _has_images(original_image):
        first_tensor = original_image[0] if not isinstance(original_image, torch.Tensor) else original_image[0]

    if first_tensor is None:
        return {"ui": {"images": results}}

    arr0 = first_tensor.cpu().numpy()
    if arr0.ndim == 3 and arr0.shape[0] in (1, 3, 4):
        height, width = arr0.shape[1], arr0.shape[2]
    else:
        height, width = arr0.shape[0], arr0.shape[1]

    prefix = filename_prefix
    full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
        prefix, output_dir, width, height
    )

    # Helper to save a single image-list (take first frame)
    def _save_one(img_list):
        nonlocal counter
        if not _has_images(img_list):
            return None
        tensor = img_list[0] if not isinstance(img_list, torch.Tensor) else img_list[0]
        arr = tensor.cpu().numpy()
        if arr.ndim == 3 and arr.shape[0] in (1, 3, 4):
            arr = np.transpose(arr, (1, 2, 0))
        if arr.dtype != np.uint8:
            arr = (255. * arr).clip(0, 255).astype('uint8')

        img = Image.fromarray(arr)
        file = f"{filename}_{counter:05}_.png"
        img.save(os.path.join(full_output_folder, file), compress_level=compress_level)
        entry = {"filename": file, "subfolder": subfolder, "type": "temp"}
        counter += 1
        return entry

    a_entry = _save_one(image_a)
    if a_entry:
        results.append(a_entry)

    b_entry = _save_one(original_image)
    if b_entry:
        results.append(b_entry)

    return {"ui": {"images": results}}


# ─── Node ─────────────────────────────────────────────────────────────────────

class Save_It:
    def __init__(self):
        # ORIGINAL (unchanged)
        self.prefix_append = "_save_" + ''.join(random.choice(string.ascii_lowercase) for _ in range(5))
        self.compress_level = 4
        self.last_prompt_id = None

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # ORIGINAL (unchanged)
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
                # ADDED: Compare mode toggle (appended at end to preserve widget order)
                "enable_compare": ("BOOLEAN", {
                    "default": False,
                    "label_on": "Compare ON",
                    "label_off": "Compare OFF",
                    "tooltip": "Enable image comparison mode. When ON, shows interactive A/B comparison.",
                }),
            },
            "optional": {
                # ADDED: Second image for comparison (optional, only used when enable_compare is True)
                "original_image": ("IMAGE", {"tooltip": "Second image for A/B comparison (only used when Compare is ON)."}),
            },
            "hidden": {
                # ORIGINAL (unchanged)
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            },
        }

    @classmethod
    def IS_CHANGED(s, images, autosave=False, filename_prefix="ComfyUI", format="PNG", quality=95,
                   use_timestamp=False, save_trigger=0, enable_compare=False, prompt=None, 
                   extra_pnginfo=None, original_image=None):
        # ORIGINAL (unchanged)
        return save_trigger

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "interactive"
    DISPLAY_NAME = "Save_It"
    DESCRIPTION = "Saves images with format options, AutoSave, timestamps, and favorite folders."

    def save_images(self, images, autosave=False, filename_prefix="ComfyUI", format="PNG",
                    quality=95, use_timestamp=False, save_trigger=0, enable_compare=False,
                    prompt=None, extra_pnginfo=None, original_image=None):
        # ORIGINAL (unchanged)
        if images is None:
            return {"ui": {"images": list()}}

        # ADDED: Compare mode logic (only runs when enable_compare is True)
        if enable_compare and original_image is not None:
            # Save both images with compare prefixes and return UI images (temp)
            temp_prefix = "save_it_compare" + self.prefix_append
            compare_ui = save_compare_images(
                image_a=images,
                original_image=original_image,
                filename_prefix=temp_prefix,
                compress_level=self.compress_level
            )
            # `save_compare_images` returns a dict in the form {"ui": {"images": [...]}}
            return compare_ui

        # ORIGINAL (unchanged) - Standard Save_It behavior when compare is disabled
        ui_images_data = []

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

            ui_images_data = results

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

            ui_images_data = results

        # ORIGINAL (unchanged) - Add original_image to UI data if provided
        ui_output = {"images": ui_images_data}

        
        return {"ui": ui_output}


NODE_CLASS_MAPPINGS = {
    "Save_It": Save_It
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Save_It": "Save It"
}
