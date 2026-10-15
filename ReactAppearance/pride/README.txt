<copyright file="README.txt" company="Curtis Instruments AG">
(c) 2026 Curtis Instruments AG, Biberist, Switzerland, www.curtis.ch
</copyright>
<summary>Exported React appearance and server editor.</summary>
<date>05-10-2026</date>
<author>rsu - Richard Sumka</author>

Publish this brand folder to the update server, then open its editor.html over HTTPS.
It loads CSS and pictures from the fixed subfolders. Enter server authorization and select Save to server.
The Node.js server validates and writes files to its appearance data directory.
Styles and graphics keep separate versions. Save generates new random version folder names for changed files.
The InteractiveStyleEditor folder is the Node.js project and Git submodule.
Its package.json starts server.mjs. Set APPEARANCE_UPLOAD_TOKEN (24+ characters).
The preview/ folder contains the real React pages built from current source. Preview shows unsaved edits with browser mock data.
Editor history defaults to HOME/curtis-appearance-data outside deployments;
APPEARANCE_DATA_DIR can override this with another persistent writable directory.
The editor address is:
https://curtisdemo.dotpro.ch/ReactAppearance/pride/editor.html
Upload styles/ and graphics/ before manifest.json. Keep old version folders.
Keep reference/ and this README local.
Fonts remain bundled in the app. Other CSS, including responsive rules and animation, is editable.
Build exports are regenerated: keep manual edits in a copy of this folder.
