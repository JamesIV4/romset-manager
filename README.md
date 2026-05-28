# ROM Set Manager

A static React app for comparing a full MAME ROM set against a smaller play set and copying selected ROMs into the play set.
It can also compare a MAME 2003-Plus set with an FBNeo set, show shared ROM IDs, and copy the matching counterpart into the other playing set.

The same app runs on GitHub Pages and locally. It uses the browser File System Access API, so use Chrome or Edge and choose the sources for the active dropdown entry when prompted:

- MAME 2003-Plus full set folder: `D:\Downloads\mame2003-plus`
- MAME 2003-Plus managed play set folder: `\\PACMAN\share\roms\mame\mame2003plus`
- MAME 0.287 full set folder: `D:\Downloads\mame 0.287 full rom set non-merged`
- MAME 0.287 managed play set folder: `\\PACMAN\share\roms\mame`
- FBNeo full set folder: `D:\Downloads\fbneo-1.0.0.3-full-non-merged`
- FBNeo managed play set folder: `\\PACMAN\share\roms\fbneo`
- FBNeo sample target folder: `\\PACMAN\share\bios\fbneo\samples`

The active set needs its full-set folder and playing-set folder selected in the UI. XML metadata is required and is auto-detected from the full-set folder, including `MAME 0.287 ROMs (non-merged).xml` for the MAME 0.287 entry. MAME samples use explicit source and target folders so the browser can grant read/write permissions.
FBNeo sample packs are auto-detected from the full set's `samples` folder and are copied only to the configured FBNeo sample target, not to the ROM folder.

Use the Shared view to see games found in both full sets. Use the Counterpart view to select games that are already in one playing set and available in the other full set, then use Swap to copy the other version. The Remove after swap option removes the original only after the copied counterpart is confirmed present.

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
