# Atlas panels

The atlas opens with the library and file preview closed, giving the map the available workspace width. **Library** opens sources, regions, collections, and saved places; **Close library panel** or the same toolbar control hides it. This choice is remembered between visits.

Selecting a file opens its preview. **Preview** and **Close preview panel** hide it while retaining the selected file and its saved scroll position. Opening Preview again returns to that file. A reload restores the selection but leaves the preview closed. The expanded reader remains available through **Expand** or Enter; returning restores the map and panel preferences.

Search opens results as before. **Close search results panel** hides the result panel while preserving the query and map highlights. **Results** brings it back. Changing the query reveals the results again; **Clear search** removes the query and its highlights. Searches scoped to a region show that scope in the result header; an empty geographic search offers **Search all regions**, preserving source, type, tag, and collection filters.

The panel toggles use `aria-expanded` and restore keyboard focus when a panel closes. Vim's **Space l** opens and focuses the selected file's reader even when the preview was closed. Small windows show library and preview as dismissible overlays; the expanded reader uses the whole workspace. No animation interpolates panel widths, and showing or hiding a panel does not fit, pan, or reset the map camera.

The reader's **Edit in Vim** action is available for Markdown and plain-text files. It opens the original in Neovim when available, otherwise Vim. **Space e** and **:edit** provide the same action; ordinary selection only opens the preview.

Browser checks cover hidden defaults, remembered library visibility, full-width map/reader states, retained selection and camera, restored focus, keyboard reopening, small windows, and hiding search results without clearing the query. Existing atlas, favorites, and reader tests explicitly open panels where required.
