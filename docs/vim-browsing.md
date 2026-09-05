# Vim browsing

Star Palace has native Normal-mode browsing keys in the atlas, file list/grid, search results, and reader. Use **`:help`**, **F1**, or the **Commands** button for the in-app reference. `:` opens a command field; its Up/Down keys recall this session's command history.

This first implementation covers navigation, search, file ranges, marks, and a small set of app commands. It does not emulate a text editor or implement all Vim commands. Original files stay unchanged by these commands; explicit `:pin` and `:unpin` update atlas metadata, and `:collection` opens the existing reviewable collection form.

## Contexts and commands

| Keys | Atlas / file browser | Focused or expanded reader |
| --- | --- | --- |
| `h j k l`, counts such as `3j` | Pan map; select adjacent files in list/grid or search results. Grid j/k move rows. In visual mode, map motions follow the selected file sequence. | Scroll horizontally/vertically. |
| `w W e E`, `b B ge gE` | Next / previous file in the current sequence. | Scroll forward/backward one line; there is no simulated text cursor. |
| `gg`, `G`, `12gg`, `12G` | First, last, or numbered file in the loaded page/viewport. | Top, bottom, or approximate line (24 CSS pixels per line). |
| `0 ^ $` | First/last file in list; first/last card in current grid row. | Left/right scroll edge. |
| `H M L` | First/middle/last visible file. On map: loaded file sequence. | Scroll toward top/middle/bottom of the current viewport; M holds current position. |
| `50%` | File at that percentage of the loaded sequence. | Percentage of scrollable document. Bare `%` has no bracket-matching equivalent. |
| `{ }`, `[[ ]]`, `( )` | Previous/next direct-parent-folder boundary in the loaded sequence. | Previous/next heading; parentheses move paragraphs. |
| `Ctrl D/U`, PageDown/Up | Half/full viewport scroll or map pan. | Half/full viewport scroll. |
| `Ctrl E/Y` | Scroll/pan one line without changing selection. | Scroll one line. |
| `/`, `?` | Focus library search, setting forward/backward direction. Enter selects a result and leaves typing; backward search initially selects the last result. | Same library search, not an independent in-document query. |
| `n N` | Next/previous search result in the remembered search direction; without search, next/previous file. Counts wrap through the sequence. | Next/previous highlighted text match when a query exists; otherwise next/previous file. |
| `* #` | Search the selected filename forward/backward. | Same. |
| `i a I A` | Focus search for ordinary typing. | Same. |
| Escape | Leave search typing with query intact; clear visual mode, then query, then navigate back as applicable. | Collapse expanded reader first. Native modal Escape closes the modal. |
| `v V`, `gv` | Select an inclusive range of files; toggle it off or restore the previous selection anchor/sequence. The sequence is frozen while Visual mode is active. | Use native text selection; file visual mode belongs to the atlas pane. |
| `yy`, visual `y` | Copy selected file path(s) to the clipboard. | Copy current file path; native text copy remains available. |
| `ma`, `'a`, `` `a `` | Set/restore session mark a, including scope, selected file, and camera. A–Z also available. | Same atlas location; reader scroll already persists per file. |
| `Ctrl O/I`, `''`, double backtick | Older/newer keyboard jump, with counts. Jumps record boundaries, search-result navigation, folder jumps, and mark visits. | Same. |
| `Space w/h/l` | Switch pane / focus atlas / focus reader. | Same. |
| `gt gT` | Next/previous map, list, grid view. | Same. |
| `[f ]f` | Previous/next file in the sequence. | Same, independent of text-match navigation. |
| Enter | Expand/collapse selected file reader. Focused buttons and links retain native Enter behavior. | Same. |
| `o O`, `gf` | Open in default app / reveal in folder; gf opens in default app. | Same. |
| `+ = -` | Zoom map, bounded by the existing camera. | Use image/PDF controls for their own zoom. |
| `zz zt zb`, `zf` | Center selected file; fit map. | Align current highlighted match center/top/bottom. |
| Shift P | Existing render-metrics toggle. | Same. |

Counts are capped at 999 to bound a single event's work. Prefixes clear on Escape, blur, entry into an editable control, unsupported sequence, or a native modifier shortcut. Unknown keys do not perform destructive file actions. No mode state is persisted across reloads.

Visual selection is highlighted in list/search cards and on the map, with a selection count and **Save selection** action. `:collection` opens a form containing exactly that range, even when a broader search has additional results. Crossing a query, view, or scope boundary clears visual mode. Metadata and file positions are never edited by motions.

## Command field

Supported commands: `help`/`h`/`commands`, `map`, `list`, `grid`, `next`/`n`, `previous`/`prev`/`N`, `open`, `reveal`, `pin`, `unpin`, `collection`, `marks`, `fit`, `noh`/`nohlsearch`, and `q`/`quit`/`close`. `q` closes/collapses the reader, not the browser tab. Unknown commands produce a visible message. There is no shell execution or Ex expression evaluation.

## Compatibility decisions and remaining vocabulary

- Existing map `hjkl`, `n/N`, `o/O`, zoom, Enter, and Shift P remain. **`gg` now means first file/top of reader; map fit moves to `zf`. `?` now begins backward search; help moves to `:help` or F1.** Cmd/Ctrl K and the previous app Cmd/Ctrl F continue to focus library search.
- Native typing, composition, select/copy/paste, browser refresh, tab handling, and native action activation stay available. Space on a focused button/summary activates it; start the pane sequence from atlas/reader content. Browser `Ctrl W`, `Ctrl R`, `Ctrl B`, and `Ctrl F` are not Vim window-close/redo/page commands; Ctrl F retains the existing app search behavior. Use Space pane sequences and PageDown/Up.
- File motions operate on bounded data already loaded. They do not fetch the whole library or cross list pagination automatically. The Previous/Next buttons load adjacent 100-file pages. Search retains the existing bounded result set. Reader document and nested table/code scroll areas are distinct; focus the area to scroll it. Embedded PDF viewers own their keyboard events; use searchable-text view for app reader commands.
- Editing operators (`d c x r s`, case changes, indentation, joining), text objects (`iw`, `a(`), registers, paste, undo/redo, dot-repeat, macros, insert-mode editing, folds, buffers/tabs/splits, tag stacks, regex substitution, shell commands, and Vim configuration have no implementation. Some (macros, stronger reader cursor semantics, cross-page motions, and window commands) may warrant later work. Do not describe this as complete Vim emulation.

## Audit sources and validation

The vocabulary audit used Vim's maintained [command index](https://vimhelp.org/index.txt.html), [motion reference](https://vimhelp.org/motion.txt.html), and [quick reference](https://vimhelp.org/quickref.txt.html). The mapping above describes Star Palace's implementation and intentional differences; it is not a claim that Vim's text-editing semantics transfer unchanged to a spatial file browser.

Regression coverage: `tests/atlas/vimCommands.test.ts` checks counts, prefixes, native shortcut bypass, unsupported destructive operators, file boundaries/ranges, and counted jump history. `tests/browser/vim.spec.ts` checks real UI selection, collection ranges, literal typing, search exit, command help/errors, marks/jumps, and reader scrolling using the isolated fictional demo.
