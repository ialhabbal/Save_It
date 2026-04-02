# Save_It
## ComfyUI Custom Node

Save_It is a ComfyUI custom node that gives you full control over when and how your generated images are saved. Unlike the default save node, Save_It previews the image first and lets you decide what to do with it — save it manually or automatically, choose the file format, control quality, organize images into subfolders, browse for a save location using a native folder picker, manage a persistent list of favorite save paths, and review a history of everything you have saved. Now, you can also compare a generated image to the original.

### Node
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/save_it.png)

### Compare off
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/compare_off.png)

### Compare on without toggling
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/compare_on_without_toggling.png)

### Compare on with toggling
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/compare_on_with_toggling.png)

### Compare on with toggling
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/compare_on_with_toggling2.png)

### Compare (vertical wipe left to right)
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/vertical_wipe_compare.png)

### Browse & Set Save Path
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/browse_&_set_save_path.png)

### Open Output Folder
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/open_output_folder.png)

### Save History
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/save_history.png)

### Favorite Folders
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/favorite_folders.png)
![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/media/favorite_folders1.png)

## Update 1.3.5

- Added vertical wipe (left-to-right) compare.

## Update 1.3.0

- Added image compare feature.

## Update 1.2.3

- Fixed a bug in the "Browse & Set Save Path" function.

## Update 1.2.2

- Fixed: manual saving (.png) now embeds workflow.
- Fixed: autosaving after manual saving duplicates manual saving.

## Update 1.2.1

"Open Output Folder" Now opens in the foreground.

## Update 1.2.0

- The Favorite Folders dialogue box can now be resized by dragging its bottom-right corner.
- A search field has been added inside the Favorite Folders dialogue to filter your saved paths in real time.

## Update 1.1.0

- Click "Browse & Set Save Path" to open a native Windows folder picker and set the save location directly from your file system. After selecting a folder, a prompt appears for 15 seconds offering to add that location to your favorites with a single click.
- Favorite locations are stored permanently in a file named `favorite_folders.json` inside the custom node's folder. You can also edit this file manually, restart ComfyUI, and any paths you added will appear in the Favorite Folders panel.

## Installation

Install directly from ComfyUI Manager by searching for Save_It.

Alternatively:

1. Go to your ComfyUI `custom_nodes` folder
2. Open a terminal or command prompt there
3. Run: `git clone https://github.com/ialhabbal/Save_It.git`
4. Restart ComfyUI

Or manually:

1. Go to your ComfyUI `custom_nodes` folder
2. Create a folder named `Save_It`
3. Copy all files into it
4. Restart ComfyUI

## To Update:

- Update through ComfyUI Manager, or
- Go the node's folder, run a cmd, then: Git Pull

## Node Inputs

**images:** Connect this to the output of any node that produces an image, such as a VAE Decode node. This is the image that will be previewed and saved.
**original_image:** Connect this to the original image in the workflow (for comparison with the generated image)

**AutoSave (ON/OFF toggle):** When set to OFF (the default), the node displays the generated image as a preview but does not save it until you click the Save Image button. When set to ON, the node automatically saves every newly generated image immediately after it is produced, without requiring any manual action. The Save Image button is dimmed and disabled while AutoSave is ON. AutoSave is designed to save each unique generation exactly once — if the same image is re-displayed without a new generation occurring, it will not be saved again.

**filename_prefix:** A text field where you type the name and destination path for your saved image. It works in the following ways:

- Type just a name like `MyImage` and the file will be saved as `MyImage_00001.png` in your main ComfyUI output folder.
- Type a relative path like `Portraits/MyImage` and the file will be saved as `MyImage_00001.png` inside a `Portraits` subfolder within your output folder. The subfolder is created automatically if it does not exist.
- Type a path ending with a forward slash or an underscore like `Portraits/_` and the file will be saved with only a number as its name, such as `00001.png`, inside the specified subfolder.
- Type an absolute path like `F:/MyImages/Portraits/` to save images to any folder on your system, completely outside the ComfyUI output directory. Both Windows-style (`F:\MyImages\`) and Unix-style (`/home/user/images/`) paths are supported.

**format:** A dropdown menu for choosing the file format. The available options are PNG, JPEG, and WebP. PNG is the default and produces lossless output with no quality degradation. JPEG and WebP produce smaller files but apply lossy compression, controlled by the Quality slider. When saving as JPEG, any transparency in the image is automatically converted to an RGB layer before saving.

**quality:** A slider ranging from 1 to 100. This setting only applies when the format is set to JPEG or WebP. Higher values produce better-looking images at larger file sizes. Lower values produce smaller files with more noticeable compression. This setting has no effect on PNG files.

**Timestamp (ON/OFF toggle):** When set to OFF (the default), saved images are numbered sequentially — for example, `MyImage_00001.png`, `MyImage_00002.png`, and so on. The counter is stored in a hidden file called `.save_it_counter` inside the save folder and persists across ComfyUI restarts, so the numbering never resets unintentionally. When set to ON, a date and time stamp is appended to the filename instead — for example, `MyImage_2026-03-23_14-30-00.png`. If two images are saved within the same second, a numeric suffix is appended automatically to avoid collisions.

**Compare (On/Off toggle):** When set to off (the default), the node will display one image (the generated image). When set to on, the node will display a vertical wipe (left-to-right) compare. Turn off the compare and you will get the previous method of compare; the generated image and the original image side by side, click on any image and the generated image will appear, also an "X" button and a "1/2 toggle" will appear next to the image. Toggle 1/2 for image comparison between the generated image and the original image. Click on "X" to close the comparison and return to the generated image.

## Buttons

**Browse & Set Save Path:** Opens a native Windows folder picker dialog. Selecting a folder sets the `filename_prefix` field to the chosen path automatically. After selecting, a prompt appears in the bottom-right corner for 15 seconds offering to add the selected path to your Favorite Folders.

**Save Image:** Saves the currently previewed image to the location specified in `filename_prefix`, using the selected format and quality settings. This button is only active when AutoSave is OFF. If no image has been generated yet, a notification will inform you to run the workflow first.

**Open Output Folder:** Opens the folder corresponding to the current `filename_prefix` value in your system's file explorer (Windows Explorer on Windows, Finder on macOS, or the default file manager on Linux). If the folder does not yet exist, it is created automatically before opening.

**Save History:** Opens a panel showing the last 50 images saved using Save_It during the current browser session. Each entry displays the filename, the full path it was saved to, and the date and time it was saved. A Clear button inside the panel erases the entire history. History is stored in the browser's local storage and will persist between sessions unless you clear your browser data.

**Favorite Folders:** Opens a panel for managing a list of frequently used save locations. To add a folder, type its path into the input field and click Add — a trailing slash is appended automatically if not already present. To apply a favorite, click on it in the list and it will immediately be set as the current `filename_prefix`. To remove a favorite, click the X button next to it. The panel supports real-time search to filter your list by typing part of a path. The panel can also be resized by dragging the handle in its bottom-right corner.

## Notes

- The sequential counter is stored in a hidden file called `.save_it_counter` inside your save folder. Do not delete this file if you want numbering to continue from where it left off.
- When saving as JPEG or WebP and quality is a priority, set the quality slider to 95 or higher.
- AutoSave is well-suited for long unattended runs where every generation should be kept. Manual save is preferable when reviewing results and only keeping selected images.
- Favorite Folders are saved to `favorite_folders.json` on disk and persist permanently across ComfyUI restarts. You can edit this file directly to add or remove entries in bulk.
- Save History is stored in browser local storage. It will persist across sessions but will be lost if you clear your browser's stored data.
- The Browse & Set Save Path button uses the Windows native IFileOpenDialog API via ctypes and does not require tkinter. It is currently only functional on Windows.
- Workflow metadata (prompt and extra PNG info) is embedded in files saved via AutoSave when the format is PNG, preserving the full generation parameters alongside the image.

## Known bug in v_1.3.5

When a folder is selected using “Browse & Set Save Path”:

- AutoSave successfully saves the image to the chosen folder, but the image is not displayed in the node.
- Re-running the workflow with AutoSave enabled does not save the image again.
- Enabling the timestamp and running the workflow saves the image to the folder, but it still does not appear in the node.
- Disabling the timestamp and running the workflow again still saves the image, but the node display issue persists.
- On subsequent runs, AutoSave stops saving the image altogether.
- In general, AutoSave functions (including when toggling the timestamp), but images saved via “Browse & Set Save Path” never appear in the node.

When saving to a manually selected folder (not using “Browse & Set Save Path”):

- AutoSave initially works correctly.
- However, re-running the workflow does not save a new image or increment the filename, unlike manual saving.
- If the timestamp is enabled and the workflow is run, the image is saved and appears in the node.
- But on subsequent runs, AutoSave again fails to save new images or increment filenames.
