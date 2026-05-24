# ROM Set Manager

A static React app for comparing a full MAME ROM set against a smaller play set and copying selected ROMs into the play set.

The same app runs on GitHub Pages and locally. It uses the browser File System Access API, so use Chrome or Edge and choose these sources when prompted:

- Full ROM set folder: `D:\Downloads\mame2003-plus`
- MAME XML data file: `D:\Downloads\mame2003-plus\MAME 2003-Plus - 2018-12-31.xml`
- Managed play set folder: `\\PACMAN\share\roms\mame\mame2003plus`

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
