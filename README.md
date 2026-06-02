# ROM Set Manager

A static React app for comparing a full MAME ROM set against a smaller play set and copying selected ROMs into the play set.
It can also compare any two configured sets, show shared ROM IDs, and copy the matching counterpart into the other playing set.

The same app runs on GitHub Pages and locally. It uses the browser File System Access API, so use Chrome or Edge and choose the sources for the selected pair when prompted:

- MAME 2003-Plus full set folder: `D:\Downloads\mame2003-plus`
- MAME 2003-Plus managed play set folder: `\\PACMAN\share\roms\mame\mame2003plus`
- MAME 0.287 full set folder: `D:\Downloads\mame 0.287 full rom set non-merged`
- MAME 0.287 managed play set folder: `\\PACMAN\share\roms\mame`
- FBNeo full set folder: `D:\Downloads\fbneo-1.0.0.3-full-non-merged`
- FBNeo managed play set folder: `\\PACMAN\share\roms\fbneo`
- FBNeo sample target folder: `\\PACMAN\share\bios\fbneo\samples`

Choose the active set and the set to compare against in the UI. Both sets need their full-set folder and playing-set folder selected. XML metadata is required for the active set and is auto-detected from its full-set folder. For MAME 0.287, use the official `mame0287.xml` list XML from `mame0287lx.zip`; it is preferred automatically over ROM-manager DATs such as `MAME 0.287 ROMs (non-merged).xml` because it includes parent, clone, sample, driver, input, and display metadata. MAME samples use explicit source and target folders so the browser can grant read/write permissions.
FBNeo sample packs are auto-detected from the full set's `samples` folder and are copied only to the configured FBNeo sample target, not to the ROM folder.

Use the Shared view to see games found in both selected full sets. Use the Counterpart view to select games that are already in one playing set and available in the other full set, then use Swap to copy the destination set's version. The Remove after swap option removes the original only after the copied counterpart is confirmed present.

If a swap was copied without removing the original, use the In both sets view and select the duplicate ROMs. The Remove duplicates action names the active playing set it will clean and leaves the compared playing set unchanged.

To replace a regional clone with its parent ROM in the active playing set, use the Non-parent in set view, select the clone, and use To Parent. The app copies the parent archive from the active full set, verifies that it reached the playing set, and only then removes the selected clone. Parent swaps use MAME-style `cloneof` metadata, which commonly points regional variants to the World release.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the app and deploys `dist` to GitHub Pages from pushes to `main`.
