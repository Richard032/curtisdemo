<!--
  <copyright file="README.md" company="Curtis Instruments AG">
  (c) 2026 Curtis Instruments AG, Biberist, Switzerland, www.curtis.ch
  </copyright>
  <summary>Node.js deployment for editable React appearance packages.</summary>
  <date>06-10-2026</date>
  <author>rsu - Richard Sumka</author>
-->

# Curtis demo appearance server

This Node.js app serves versioned React styles, graphics, and a browser editor for Pride, Generic, and Ottobock. Hostinger starts it with `npm start` and supplies `PORT`.

Set `APPEARANCE_UPLOAD_TOKEN` in Hostinger to a separate secret of at least 24 characters before using **Save to server**. Edited versions are stored under `HOME/curtis-appearance-data` outside the deployed source; `APPEARANCE_DATA_DIR` can override that location. Keep the token out of this repository.

The editor URLs are `/ReactAppearance/pride/editor.html`, `/ReactAppearance/generic/editor.html`, and `/ReactAppearance/ottobock/editor.html`. Editors load their brand's files automatically. Preview runs the actual compiled React pages from `preview/` with browser mock data; its page selector follows the React routes. It applies unsaved CSS and graphics locally. Changed styles and graphics receive independent random version IDs. Old version folders remain available after Save. The upload API is `/ReactAppearance/api/publish`.

The initial assets in this repository come from the `feature/react` branch of ECON-R. Regenerate them there with `node scripts/export-appearance.mjs --brand All --output <folder>`, then copy the exported `ReactAppearance` contents, including `preview/`, into this repository. Each export rebuilds the React pages, so later page changes reach the editor. Keep old version folders and copy new versions before their manifest. This is a demo server; the app still validates downloaded files and retains its bundled appearance for rollback.
