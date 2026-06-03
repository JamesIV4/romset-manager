import type { RomAsset, SourceHandles, SourceKey } from './types';

const DB_NAME = 'romset-manager';
const STORE_NAME = 'handles';
const ROM_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.chd']);
const SAMPLE_EXTENSIONS = new Set(['.zip', '.7z']);
const EXTENSION_PRIORITY = ['.zip', '.7z', '.rar', '.chd', ''];

export type ResolvedRomDirectory = {
  assets: Map<string, RomAsset>;
  chdAssets: Map<string, RomAsset>;
  directory: FileSystemDirectoryHandle;
  effectiveName: string;
  selectedName: string;
  usedSubfolder: boolean;
};

export type ResolvedAssetDirectory = {
  assets: Map<string, RomAsset>;
  directory: FileSystemDirectoryHandle;
  effectiveName: string;
  selectedName: string;
  usedSubfolder: boolean;
};

export type ResolvedXmlFile = {
  file: File;
  handle: FileSystemFileHandle;
  selectedName: string;
  usedSubfolder: boolean;
};

export type CopyFileProgress = {
  bytesCopied: number;
  bytesTotal: number;
  fileName: string;
};

const SOUNDTRACK_FOLDER_NAME = 'optional soundtrack samples';

export const supportsFileSystemAccess =
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function' &&
  typeof window.showOpenFilePicker === 'function';

export async function pickFullDirectory() {
  return window.showDirectoryPicker?.({
    id: 'full-romset',
    mode: 'read',
  });
}

export async function pickFbneoFullDirectory() {
  return window.showDirectoryPicker?.({
    id: 'fbneo-full-romset',
    mode: 'read',
  });
}

export async function pickTargetDirectory() {
  return window.showDirectoryPicker?.({
    id: 'managed-romset',
    mode: 'readwrite',
  });
}

export async function pickFbneoTargetDirectory() {
  return window.showDirectoryPicker?.({
    id: 'fbneo-managed-romset',
    mode: 'readwrite',
  });
}

export async function pickFbneoSampleTargetDirectory() {
  return window.showDirectoryPicker?.({
    id: 'fbneo-sample-target',
    mode: 'readwrite',
  });
}

export async function pickSampleSourceDirectory() {
  return window.showDirectoryPicker?.({
    id: 'sample-source',
    mode: 'read',
  });
}

export async function pickSampleTargetDirectory() {
  return window.showDirectoryPicker?.({
    id: 'sample-target',
    mode: 'readwrite',
  });
}

export async function pickSoundtrackSourceDirectory() {
  return window.showDirectoryPicker?.({
    id: 'soundtrack-source',
    mode: 'read',
  });
}

export async function pickXmlFile() {
  const handles = await window.showOpenFilePicker?.({
    id: 'mame-xml',
    multiple: false,
    types: [
      {
        description: 'MAME XML',
        accept: {
          'application/xml': ['.xml'],
          'text/xml': ['.xml'],
        },
      },
    ],
  });

  return handles?.[0];
}

export async function resolveXmlFile(directory: FileSystemDirectoryHandle): Promise<ResolvedXmlFile | null> {
  const direct = await findXmlInDirectory(directory);
  if (direct) {
    return {
      ...direct,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  for await (const [, handle] of directory.entries()) {
    if (handle.kind !== 'directory') {
      continue;
    }

    const nested = await findXmlInDirectory(handle);
    if (nested) {
      return {
        ...nested,
        selectedName: directory.name,
        usedSubfolder: true,
      };
    }
  }

  return null;
}

export async function verifyPermission(
  handle: FileSystemHandle,
  mode: FileSystemPermissionMode = 'read',
) {
  if (!handle.queryPermission || !handle.requestPermission) {
    return true;
  }

  const options = { mode };
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  return (await handle.requestPermission(options)) === 'granted';
}

export async function listRomAssets(
  directory: FileSystemDirectoryHandle,
  options: { includeSubdirectories?: boolean } = {},
) {
  const assets = new Map<string, RomAsset>();
  await addRomAssetsFromDirectory(directory, assets, options.includeSubdirectories ?? false, []);
  return assets;
}

export async function listChdAssets(
  directory: FileSystemDirectoryHandle,
  options: { includeSubdirectories?: boolean } = {},
) {
  const assets = new Map<string, RomAsset>();
  await addChdAssetsFromDirectory(directory, assets, options.includeSubdirectories ?? false, []);
  return assets;
}

async function addRomAssetsFromDirectory(
  directory: FileSystemDirectoryHandle,
  assets: Map<string, RomAsset>,
  includeSubdirectories: boolean,
  pathParts: string[],
) {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'directory') {
      if (includeSubdirectories && !(await directoryContainsChd(handle))) {
        await addRomAssetsFromDirectory(handle, assets, includeSubdirectories, [...pathParts, name]);
      }
      continue;
    }

    const asset = await createAsset(name, handle, pathParts);
    if (!asset) {
      continue;
    }

    const key = asset.baseName.toLowerCase();
    const existing = assets.get(key);
    if (!existing || compareAssetPriority(asset, existing) < 0) {
      assets.set(key, asset);
    }
  }
}

async function addChdAssetsFromDirectory(
  directory: FileSystemDirectoryHandle,
  assets: Map<string, RomAsset>,
  includeSubdirectories: boolean,
  pathParts: string[],
) {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'directory') {
      continue;
    }

    if (await directoryContainsChd(handle)) {
      const asset = createChdAsset(name, handle, pathParts);
      const key = asset.baseName.toLowerCase();
      const existing = assets.get(key);
      if (!existing || compareAssetPriority(asset, existing) < 0) {
        assets.set(key, asset);
      }
      continue;
    }

    if (includeSubdirectories) {
      await addChdAssetsFromDirectory(handle, assets, includeSubdirectories, [...pathParts, name]);
    }
  }
}

export async function listSampleAssets(directory: FileSystemDirectoryHandle) {
  const assets = new Map<string, RomAsset>();

  for await (const [name, handle] of directory.entries()) {
    const asset = await createSampleAsset(name, handle);
    if (!asset) {
      continue;
    }

    const key = asset.baseName.toLowerCase();
    const existing = assets.get(key);
    if (!existing || compareAssetPriority(asset, existing) < 0) {
      assets.set(key, asset);
    }
  }

  return assets;
}

export async function resolveRomDirectory(
  directory: FileSystemDirectoryHandle,
  options: { preferRomsSubfolder?: boolean } = {},
): Promise<ResolvedRomDirectory> {
  if (directory.name.toLowerCase() === 'games') {
    const { assets, chdAssets } = await listResolvedRomAssets(directory, true);
    return {
      assets,
      chdAssets,
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  if (options.preferRomsSubfolder && directory.name.toLowerCase() !== 'roms') {
    const romsDirectory = await getChildDirectory(directory, 'roms');
    if (romsDirectory) {
      const { assets: romsAssets, chdAssets: romsChdAssets } = await listResolvedRomAssets(romsDirectory);
      if (romsAssets.size > 0) {
        return {
          assets: romsAssets,
          chdAssets: romsChdAssets,
          directory: romsDirectory,
          effectiveName: romsDirectory.name,
          selectedName: directory.name,
          usedSubfolder: true,
        };
      }
    }
  }

  const gamesDirectory = await findRomSubfolder(directory, 'games');
  if (gamesDirectory) {
    const { assets: gamesAssets, chdAssets: gamesChdAssets } = await listResolvedRomAssets(
      gamesDirectory.directory,
      true,
    );
    if (gamesAssets.size > 0) {
      return {
        assets: gamesAssets,
        chdAssets: gamesChdAssets,
        directory: gamesDirectory.directory,
        effectiveName: gamesDirectory.directory.name,
        selectedName: directory.name,
        usedSubfolder: true,
      };
    }
  }

  const { assets, chdAssets } = await listResolvedRomAssets(directory);

  if (assets.size > 0 || directory.name.toLowerCase() === 'roms') {
    return {
      assets,
      chdAssets,
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  const romsDirectory = await getChildDirectory(directory, 'roms');
  if (romsDirectory) {
    const resolved = await listResolvedRomAssets(romsDirectory);
    return {
      assets: resolved.assets,
      chdAssets: resolved.chdAssets,
      directory: romsDirectory,
      effectiveName: romsDirectory.name,
      selectedName: directory.name,
      usedSubfolder: true,
    };
  }

  const nestedRomsDirectory = await findRomSubfolder(directory, 'roms');
  if (nestedRomsDirectory) {
    const resolved = await listResolvedRomAssets(nestedRomsDirectory.directory);
    return {
      assets: resolved.assets,
      chdAssets: resolved.chdAssets,
      directory: nestedRomsDirectory.directory,
      effectiveName: nestedRomsDirectory.directory.name,
      selectedName: directory.name,
      usedSubfolder: true,
    };
  }

  return {
    assets,
    chdAssets,
    directory,
    effectiveName: directory.name,
    selectedName: directory.name,
    usedSubfolder: false,
  };
}

export async function resolveSampleDirectory(
  directory: FileSystemDirectoryHandle,
  options: { createSubfolder?: boolean; onlySamplesSubfolder?: boolean; preferSamplesSubfolder?: boolean } = {},
): Promise<ResolvedAssetDirectory> {
  if (directory.name.toLowerCase() === 'samples') {
    return {
      assets: await listSampleAssets(directory),
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  if (options.preferSamplesSubfolder || options.createSubfolder) {
    const samplesDirectory =
      options.createSubfolder
        ? await directory.getDirectoryHandle('samples', { create: true })
        : (await getChildDirectory(directory, 'samples')) ?? (await findRomSubfolder(directory, 'samples'))?.directory;

    if (samplesDirectory) {
      return {
        assets: await listSampleAssets(samplesDirectory),
        directory: samplesDirectory,
        effectiveName: samplesDirectory.name,
        selectedName: directory.name,
        usedSubfolder: true,
      };
    }
  }

  if (options.onlySamplesSubfolder) {
    return {
      assets: new Map(),
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  return {
    assets: await listSampleAssets(directory),
    directory,
    effectiveName: directory.name,
    selectedName: directory.name,
    usedSubfolder: false,
  };
}

export async function resolveSoundtrackDirectory(
  directory: FileSystemDirectoryHandle,
  options: { onlySoundtrackSubfolder?: boolean; preferSoundtrackSubfolder?: boolean } = {},
): Promise<ResolvedAssetDirectory> {
  if (directory.name.toLowerCase() === SOUNDTRACK_FOLDER_NAME) {
    return {
      assets: await listSampleAssets(directory),
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  if (options.preferSoundtrackSubfolder) {
    const soundtrackDirectory = await getChildDirectory(directory, SOUNDTRACK_FOLDER_NAME);

    if (soundtrackDirectory) {
      return {
        assets: await listSampleAssets(soundtrackDirectory),
        directory: soundtrackDirectory,
        effectiveName: soundtrackDirectory.name,
        selectedName: directory.name,
        usedSubfolder: true,
      };
    }
  }

  if (options.onlySoundtrackSubfolder) {
    return {
      assets: new Map(),
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  return {
    assets: await listSampleAssets(directory),
    directory,
    effectiveName: directory.name,
    selectedName: directory.name,
    usedSubfolder: false,
  };
}

export async function copyAssetToDirectory(
  asset: RomAsset,
  target: FileSystemDirectoryHandle,
  onProgress?: (progress: CopyFileProgress) => void,
) {
  if (asset.kind === 'file') {
    await copyFile(asset.handle as FileSystemFileHandle, target, asset.name, asset.name, onProgress);
    return;
  }

  const destination = await target.getDirectoryHandle(asset.name, { create: true });
  await copyDirectory(asset.handle as FileSystemDirectoryHandle, destination, onProgress, [asset.name]);
}

export async function removeAssetFromDirectory(asset: RomAsset, target: FileSystemDirectoryHandle) {
  await target.removeEntry(asset.name, {
    recursive: asset.kind === 'directory',
  });
}

export async function saveHandle(key: SourceKey, handle: FileSystemHandle) {
  const db = await openDb();
  await runStoreRequest(db, 'readwrite', (store) => store.put(handle, key));
  db.close();
}

export async function loadHandles(): Promise<SourceHandles> {
  const db = await openDb();
  const [
    fullDir,
    fbneoFullDir,
    fbneoSampleTargetDir,
    fbneoTargetDir,
    mame287FullDir,
    mame287SampleSourceDir,
    mame287SampleTargetDir,
    mame287TargetDir,
    xmlFile,
    targetDir,
    sampleSourceDir,
    sampleTargetDir,
    soundtrackSourceDir,
  ] = await Promise.all([
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('fullDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('fbneoFullDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('fbneoSampleTargetDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('fbneoTargetDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('mame287FullDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('mame287SampleSourceDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('mame287SampleTargetDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('mame287TargetDir')),
    runStoreRequest<FileSystemFileHandle | null>(db, 'readonly', (store) => store.get('xmlFile')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('targetDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('sampleSourceDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('sampleTargetDir')),
    runStoreRequest<FileSystemDirectoryHandle | null>(db, 'readonly', (store) => store.get('soundtrackSourceDir')),
  ]);
  db.close();

  return {
    fullDir: fullDir ?? null,
    fbneoFullDir: fbneoFullDir ?? null,
    fbneoSampleTargetDir: fbneoSampleTargetDir ?? null,
    fbneoTargetDir: fbneoTargetDir ?? null,
    mame287FullDir: mame287FullDir ?? null,
    mame287SampleSourceDir: mame287SampleSourceDir ?? null,
    mame287SampleTargetDir: mame287SampleTargetDir ?? null,
    mame287TargetDir: mame287TargetDir ?? null,
    xmlFile: xmlFile ?? null,
    targetDir: targetDir ?? null,
    sampleSourceDir: sampleSourceDir ?? null,
    sampleTargetDir: sampleTargetDir ?? null,
    soundtrackSourceDir: soundtrackSourceDir ?? null,
  };
}

export function stripKnownExtension(name: string) {
  const index = name.lastIndexOf('.');
  if (index <= 0) {
    return { baseName: name, extension: '' };
  }

  const extension = name.slice(index).toLowerCase();
  return {
    baseName: name.slice(0, index),
    extension,
  };
}

async function createAsset(
  name: string,
  handle: FileSystemFileHandle | FileSystemDirectoryHandle,
  pathParts: string[] = [],
): Promise<RomAsset | null> {
  const relativePath = [...pathParts, name].join('/');
  const folder = pathParts[pathParts.length - 1] || '';

  if (handle.kind === 'directory') {
    return null;
  }

  const { baseName, extension } = stripKnownExtension(name);
  if (extension && !ROM_EXTENSIONS.has(extension)) {
    return null;
  }

  const file = await handle.getFile();
  return {
    baseName,
    extension,
    folder,
    handle,
    kind: 'file',
    name,
    relativePath,
    size: file.size,
    updated: file.lastModified,
  };
}

function createChdAsset(
  name: string,
  handle: FileSystemDirectoryHandle,
  pathParts: string[] = [],
): RomAsset {
  return {
    baseName: name,
    extension: '',
    folder: pathParts[pathParts.length - 1] || '',
    handle,
    kind: 'directory',
    name,
    relativePath: [...pathParts, name].join('/'),
  };
}

async function listResolvedRomAssets(
  directory: FileSystemDirectoryHandle,
  includeSubdirectories = false,
) {
  const [assets, chdAssets] = await Promise.all([
    listRomAssets(directory, { includeSubdirectories }),
    listChdAssets(directory, { includeSubdirectories }),
  ]);

  if (!includeSubdirectories && directory.name.toLowerCase() !== 'roms') {
    const romsDirectory = await getChildDirectory(directory, 'roms');
    if (romsDirectory) {
      mergeAssets(chdAssets, await listChdAssets(romsDirectory));
    }
  }

  return { assets, chdAssets };
}

function mergeAssets(target: Map<string, RomAsset>, source: Map<string, RomAsset>) {
  for (const [key, asset] of source) {
    const existing = target.get(key);
    if (!existing || compareAssetPriority(asset, existing) < 0) {
      target.set(key, asset);
    }
  }
}

async function createSampleAsset(
  name: string,
  handle: FileSystemFileHandle | FileSystemDirectoryHandle,
): Promise<RomAsset | null> {
  if (handle.kind === 'directory') {
    if (!(await directoryHasEntries(handle))) {
      return null;
    }

    return {
      baseName: name,
      extension: '',
      handle,
      kind: 'directory',
      name,
    };
  }

  const { baseName, extension } = stripKnownExtension(name);
  if (!SAMPLE_EXTENSIONS.has(extension)) {
    return null;
  }

  const file = await handle.getFile();
  return {
    baseName,
    extension,
    handle,
    kind: 'file',
    name,
    size: file.size,
    updated: file.lastModified,
  };
}

async function directoryContainsChd(directory: FileSystemDirectoryHandle) {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'file' && stripKnownExtension(name).extension === '.chd') {
      return true;
    }
  }

  return false;
}

async function directoryHasEntries(directory: FileSystemDirectoryHandle) {
  for await (const [, handle] of directory.entries()) {
    if (handle.kind === 'file') {
      return true;
    }
  }

  return false;
}

async function getChildDirectory(directory: FileSystemDirectoryHandle, name: string) {
  try {
    return await directory.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function findRomSubfolder(directory: FileSystemDirectoryHandle, name: string) {
  const direct = await getChildDirectory(directory, name);
  if (direct) {
    return { directory: direct };
  }

  for await (const [, handle] of directory.entries()) {
    if (handle.kind !== 'directory') {
      continue;
    }

    const nested = await getChildDirectory(handle, name);
    if (nested) {
      return { directory: nested };
    }
  }

  return null;
}

async function findXmlInDirectory(directory: FileSystemDirectoryHandle) {
  const candidates: ResolvedXmlFile[] = [];

  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.xml')) {
      continue;
    }

    candidates.push({
      file: await handle.getFile(),
      handle,
      selectedName: directory.name,
      usedSubfolder: false,
    });
  }

  return candidates.sort(compareXmlPriority)[0] ?? null;
}

function compareXmlPriority(left: ResolvedXmlFile, right: ResolvedXmlFile) {
  return getXmlPriority(right.file.name) - getXmlPriority(left.file.name);
}

function getXmlPriority(name: string) {
  const normalized = name.toLowerCase();
  if (/^mame\d+(lx)?\.xml$/.test(normalized)) {
    return 3;
  }

  if (normalized.includes('listxml')) {
    return 2;
  }

  return 1;
}

function compareAssetPriority(left: RomAsset, right: RomAsset) {
  const leftIndex = EXTENSION_PRIORITY.indexOf(left.extension);
  const rightIndex = EXTENSION_PRIORITY.indexOf(right.extension);
  return normalizedPriority(leftIndex) - normalizedPriority(rightIndex);
}

function normalizedPriority(index: number) {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

async function copyFile(
  source: FileSystemFileHandle,
  targetDirectory: FileSystemDirectoryHandle,
  fileName: string,
  relativeName: string,
  onProgress?: (progress: CopyFileProgress) => void,
) {
  const file = await source.getFile();
  const destination = await targetDirectory.getFileHandle(fileName, { create: true });
  const writable = await destination.createWritable();
  const reader = file.stream().getReader();
  let bytesCopied = 0;

  onProgress?.({
    bytesCopied,
    bytesTotal: file.size,
    fileName: relativeName,
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      await writable.write(value);
      bytesCopied += value.byteLength;
      onProgress?.({
        bytesCopied,
        bytesTotal: file.size,
        fileName: relativeName,
      });
    }
  } finally {
    reader.releaseLock();
    await writable.close();
  }
}

async function copyDirectory(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
  onProgress?: (progress: CopyFileProgress) => void,
  pathParts: string[] = [],
) {
  for await (const [name, handle] of source.entries()) {
    if (handle.kind === 'directory') {
      const childTarget = await target.getDirectoryHandle(name, { create: true });
      await copyDirectory(handle, childTarget, onProgress, [...pathParts, name]);
    } else {
      await copyFile(handle, target, name, [...pathParts, name].join('/'), onProgress);
    }
  }
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function runStoreRequest<T = unknown>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));

    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve(request.result as T);
  });
}
