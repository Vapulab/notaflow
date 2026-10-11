# C4 Diagrams

The `.mmd` files are the sources of the C4 diagrams in the [Architecture Overview](../OVERVIEW.md). They are Mermaid flowcharts in the C4 colors: dark blue for people, blue for the system and its containers, light blue for components, grey for external systems. Each PNG is exported from its source and committed next to it.

## Change a diagram

1. Edit the `.mmd` file.
2. Serve this folder: `python -m http.server 4181 --bind 127.0.0.1`.
3. Open `http://localhost:4181/render.html?file=<name>.mmd` in a browser at 100% zoom (Chrome keeps a zoom per host, and a zoomed page makes a small PNG). The page loads Mermaid 11.4.1 from jsDelivr, so it needs the internet.
4. Save a screenshot of the diagram as `<name>.png` (in Chrome: DevTools, select `#out`, then "Capture node screenshot"; with Playwright, a screenshot of `#out`).
5. Commit the `.mmd` and the `.png` together.

`render.html` breaks long labels (boxes at 28 characters, arrows at 22) because Mermaid does not wrap a long line by itself. Keep group titles short: they stay on one line.
