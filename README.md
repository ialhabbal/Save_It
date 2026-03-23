# Save_It
Simple ComfyUI Save node that Displays the generated Images and waits for the user to save it.

![Save_It Node](https://raw.githubusercontent.com/ialhabbal/Save_It/main/Save_It.jpg)

# Save_It — ComfyUI Custom Node

Saves generated images to a specified folder without rerunning the workflow.

## Installation
1. Go to your ComfyUI `custom_nodes` folder
2. CMD
3. Git Clone https://github.com/ialhabbal/Save_It.git
4. Restart ComfyUI
   or:
1. Go to your ComfyUI `custom_nodes` folder
2. Create a folder named `Save_It`
3. Copy all files into it
4. Restart ComfyUI

## Usage
- Connect your IMAGE output to the node
- Type your desired folder/filename prefix, e.g. `MyFolder/_`
- Run the workflow to preview the image
- Click **Save Image** to save
