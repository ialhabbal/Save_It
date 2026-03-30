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
                # Launch Explorer for the folder. Using the explorer.exe command
                # tends to open a new window for the path specified.
                subprocess.Popen(["explorer", out_dir])
            except Exception:
                try:
                    subprocess.Popen(f'start "" "{out_dir}"', shell=True)
                except Exception:
                    os.startfile(out_dir)

            # Attempt to find the Explorer window and bring it to the foreground.
            try:
                user32 = ctypes.windll.user32

                CALLBACK = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

                def _find_windows(match_lower):
                    found_hwnds = []

                    GetClassNameW = user32.GetClassNameW
                    GetWindowTextW = user32.GetWindowTextW
                    GetWindowTextLengthW = user32.GetWindowTextLengthW

                    def _cb(hwnd, lParam):
                        try:
                            if not user32.IsWindowVisible(hwnd):
                                return True
                            # Check class name to focus on Explorer windows only
                            cls_buf = ctypes.create_unicode_buffer(256)
                            GetClassNameW(hwnd, cls_buf, 256)
                            cls_name = cls_buf.value
                            if cls_name != "CabinetWClass":
                                return True

                            title_len = GetWindowTextLengthW(hwnd)
                            if title_len == 0:
                                return True
                            title_buf = ctypes.create_unicode_buffer(title_len + 1)
                            GetWindowTextW(hwnd, title_buf, title_len + 1)
                            title = title_buf.value.lower()

                            if match_lower in title:
                                found_hwnds.append(hwnd)
                        except Exception:
                            pass
                        return True

                    cb = CALLBACK(_cb)
                    user32.EnumWindows(cb, 0)
                    return found_hwnds

                # Wait a short time for the Explorer window to appear
                time.sleep(0.3)

                # Try matching just the final folder name
                folder_name = os.path.basename(out_dir).lower()
                hwnds = _find_windows(folder_name)

                # If no match, try matching the entire path
                if not hwnds:
                    hwnds = _find_windows(out_dir.lower())

                # Bring the first matching window to the front
                if hwnds:
                    hwnd = hwnds[0]
                    SW_RESTORE = 9
                    user32.ShowWindow(hwnd, SW_RESTORE)
                    user32.SetForegroundWindow(hwnd)

            except Exception:
                pass

        elif sys.platform == "darwin":
            # macOS: use 'open'
            subprocess.Popen(["open", out_dir])
        else:
            # Linux: use xdg-open
            subprocess.Popen(["xdg-open", out_dir])

        return web.Response(status=200, text="OK")

    except Exception as e:
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/save_it/browse_folder")
async def browse_folder_handler(request):
    try:
        folder = None

        if sys.platform == "win32":
            # Use modern Windows IFileDialog (Windows Vista+) for native Windows 11 dialog
            try:
                import pythoncom
                import win32com.client
                from win32com.shell import shell, shellcon
                
                # Initialize COM for this thread
                pythoncom.CoInitialize()
                
                try:
                    # Create a modern File Dialog using IFileDialog
                    # This gives us the native Windows 11 file picker
                    folder_dialog = win32com.client.Dispatch("Shell.Application")
                    
                    # Use the newer FolderBrowserDialog with proper flags
                    # BIF_NEWDIALOGSTYLE = 0x0040 (modern look)
                    # BIF_USENEWUI = 0x0050 (modern UI with new folder button)
                    folder_obj = folder_dialog.BrowseForFolder(
                        0,  # hwnd (0 = no parent window, will be foreground)
                        "Select Save Folder",
                        0x0040 | 0x0001,  # BIF_NEWDIALOGSTYLE | BIF_RETURNONLYFSDIRS
                        0  # root folder (0 = Desktop)
                    )
                    
                    if folder_obj:
                        folder = folder_obj.Self.Path
                        
                finally:
                    pythoncom.CoUninitialize()
                    
            except Exception as e1:
                print(f"win32com IFileDialog failed: {e1}")
                
                # Fallback: Use PowerShell with proper foreground handling
                try:
                    import subprocess
                    # Enhanced PowerShell script with foreground window handling
                    ps_script = """
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Create the dialog
$folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
$folderBrowser.Description = "Select Save Folder"
$folderBrowser.RootFolder = [System.Environment+SpecialFolder]::MyComputer
$folderBrowser.ShowNewFolderButton = $true

# Create a dummy form to ensure the dialog appears in foreground
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.MinimizeBox = $false
$form.MaximizeBox = $false
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.ShowInTaskbar = $false

# Show the dialog with the form as parent to force foreground
$result = $folderBrowser.ShowDialog($form)

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $folderBrowser.SelectedPath
}

$form.Dispose()
"""
                    result = subprocess.run(
                        ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps_script],
                        capture_output=True,
                        text=True,
                        timeout=120,
                        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
                    )
                    
                    if result.returncode == 0 and result.stdout.strip():
                        folder = result.stdout.strip()
                    
                except Exception as e2:
                    print(f"PowerShell approach failed: {e2}")
                    import traceback
                    traceback.print_exc()
                    folder = f"__error__:All folder dialog methods failed. Install pywin32: pip install pywin32"

        elif sys.platform == "darwin":
            import subprocess

            try:
                result = subprocess.run(
                    ["osascript", "-e", 'choose folder with prompt "Select Save Folder"'],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                if result.returncode == 0:
                    # AppleScript returns "alias Macintosh HD:path:to:folder"
                    output = result.stdout.strip()
                    if output.startswith("alias "):
                        output = output[6:]  # strip "alias "
                    # Convert colon-separated path to slash-separated
                    parts = output.split(":")
                    if len(parts) > 1:
                        folder = "/" + "/".join(parts[1:])
                    else:
                        folder = None
                else:
                    folder = None
            except Exception as e:
                folder = f"__error__:{str(e)}"

        else:
            # Linux: attempt tkinter
            import tkinter as tk
            from tkinter import filedialog

            def _pick_linux():
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                try:
                    selected = filedialog.askdirectory(title="Select Save Folder")
                    return selected if selected else None
                except Exception as e:
                    return f"__error__:{str(e)}"
                finally:
                    root.destroy()

            folder = _pick_linux()

        if isinstance(folder, str) and folder.startswith("__error__:"):
            return web.Response(status=500, text=folder[len("__error__:"):])
        if not folder:
            return web.Response(status=204, text="")  # user cancelled

        folder = folder.replace("\\", "/")
        if not folder.endswith("/"):
            folder += "/"

        return web.json_response({"path": folder})

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


NODE_CLASS_MAPPINGS = {
    "Save_It": Save_It
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Save_It": "Save It"
}
