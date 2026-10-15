<!--
  <copyright file="README.md" company="Curtis Instruments AG">
  (c) 2026 Curtis Instruments AG, Biberist, Switzerland, www.curtis.ch
  </copyright>
  <summary>Node.js deployment for editable React appearance packages.</summary>
  <date>06-10-2026</date>
  <author>rsu - Richard Sumka</author>
-->

# InteractiveStyleEditor

This standalone Node.js project is the `curtisdemo` GitHub repository and a submodule of ECON-R at `ECON-R/InteractiveStyleEditor`. It is included in `InteractiveAssist.React.slnx` and `InteractiveAssist.sln`. Hostinger starts it with `npm start` and supplies `PORT`.

The repository folders now match the public URLs: `ReactAppearance/pride/editor.html` is served at `/ReactAppearance/pride/editor.html`, and `preview/index.html` is served at `/preview/index.html`. The project owns `server.mjs`, `index.html`, `editor-template.html`, the generated `preview/` React app, and `ReactAppearance/generic/`, `ReactAppearance/ottobock/`, and `ReactAppearance/pride/`. Each brand folder contains its editor, logo, manifest, versioned styles, and versioned graphics. The app's original TSX pages remain in `InteractiveAssist.React`; the Common React postbuild target compiles them into this project's `preview/` folder and exports all brand assets here. To regenerate without a MAUI build, run from `InteractiveAssist.React`:

```powershell
node scripts/export-appearance.mjs --brand All --project-root ../InteractiveStyleEditor
```

Vite writes the compiled JavaScript and CSS to `preview/vite_generated/`. The JavaScript is unminified so it can be inspected. Edit the original TSX in `InteractiveAssist.React/src/pages/`; the generated files are replaced on every export.

For local preview, run `node server.mjs` and open the address printed in the terminal (normally `http://127.0.0.1:3000/`). Leave the command running while editing. Refresh the browser after exporting changed styles, graphics, or React pages. Restart the command only if `server.mjs` changes. Change `LOCAL_PORT` near the top of `server.mjs` if you need another local port. Hostinger's `PORT` environment variable takes priority.

Commit and push this submodule first, then commit the new submodule revision in the ECON-R `feature/react` branch. Building generates local changes here but does not publish to GitHub by itself. Keep existing version folders when updating the repository. `reference/` folders and brand `README.txt` files are for inspection and are not needed by Hostinger.

Set `APPEARANCE_UPLOAD_TOKEN` in Hostinger to a separate secret of at least 24 characters before using **Save to server**. Edited versions are stored under `HOME/curtis-appearance-data` outside the deployed source; `APPEARANCE_DATA_DIR` can override that location. Keep the token out of this repository.

The editor URLs are `/ReactAppearance/pride/editor.html`, `/ReactAppearance/generic/editor.html`, and `/ReactAppearance/ottobock/editor.html`. Editors load their brand's files automatically. Preview runs the actual compiled React pages from `preview/` with browser mock data; its page selector follows the React routes. It applies unsaved CSS and graphics locally. Changed styles and graphics receive independent random version IDs. Old version folders remain available after Save. The upload API is `/ReactAppearance/api/publish`.

The app validates downloaded files and retains its bundled appearance for rollback. The server can run independently from the React solution after its generated files are committed.
