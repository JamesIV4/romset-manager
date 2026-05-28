import type { RomAsset, SourceHandles, SourceKey } from './types';

const DB_NAME = 'romset-manager';
const STORE_NAME = 'handles';
const ROM_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.chd']);
const SAMPLE_EXTENSIONS = new Set(['.zip', '.7z']);
const EXTENSION_PRIORITY = ['.zip', '.7z', '.rar', '.chd', ''];

export type ResolvedRomDirectory = {
  assets: Map<string, RomAsset>;
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

async function addRomAssetsFromDirectory(
  directory: FileSystemDirectoryHandle,
  assets: Map<string, RomAsset>,
  includeSubdirectories: boolean,
  pathParts: string[],
) {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'directory' && includeSubdirectories) {
      await addRomAssetsFromDirectory(handle, assets, includeSubdirectories, [...pathParts, name]);
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
    return {
      assets: await listRomAssets(directory, { includeSubdirectories: true }),
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  if (options.preferRomsSubfolder && directory.name.toLowerCase() !== 'roms') {
    const romsDirectory = await getChildDirectory(directory, 'roms');
    if (romsDirectory) {
      const romsAssets = await listRomAssets(romsDirectory);
      if (romsAssets.size > 0) {
        return {
          assets: romsAssets,
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
    const gamesAssets = await listRomAssets(gamesDirectory.directory, { includeSubdirectories: true });
    if (gamesAssets.size > 0) {
      return {
        assets: gamesAssets,
        directory: gamesDirectory.directory,
        effectiveName: gamesDirectory.directory.name,
        selectedName: directory.name,
        usedSubfolder: true,
      };
    }
  }

  const assets = await listRomAssets(directory);

  if (assets.size > 0 || directory.name.toLowerCase() === 'roms') {
    return {
      assets,
      directory,
      effectiveName: directory.name,
      selectedName: directory.name,
      usedSubfolder: false,
    };
  }

  const romsDirectory = await getChildDirectory(directory, 'roms');
  if (romsDirectory) {
    return {
      assets: await listRomAssets(romsDirectory),
      directory: romsDirectory,
      effectiveName: romsDirectory.name,
      selectedName: directory.name,
      usedSubfolder: true,
    };
  }

  const nestedRomsDirectory = await findRomSubfolder(directory, 'roms');
  if (nestedRomsDirectory) {
    return {
      assets: await listRomAssets(nestedRomsDirectory.directory),
      directory: nestedRomsDirectory.directory,
      effectiveName: nestedRomsDirectory.directory.name,
      selectedName: directory.name,
      usedSubfolder: true,
    };
  }

  return {
    assets,
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

export async function copyAssetToDirectory(asset: RomAsset, target: FileSystemDirectoryHandle) {
  if (asset.kind === 'file') {
    await copyFile(asset.handle as FileSystemFileHandle, target, asset.name);
    return;
  }

  const destination = await target.getDirectoryHandle(asset.name, { create: true });
  await copyDirectory(asset.handle as FileSystemDirectoryHandle, destination);
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
    if (!(await directoryContainsChd(handle))) {
      return null;
    }

    return {
      baseName: name,
      extension: '',
      folder,
      handle,
      kind: 'directory',
      name,
      relativePath,
    };
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
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.xml')) {
      continue;
    }

    return {
      file: await handle.getFile(),
      handle,
    };
  }

  return null;
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
) {
  const file = await source.getFile();
  const destination = await targetDirectory.getFileHandle(fileName, { create: true });
  const writable = await destination.createWritable();
  await writable.write(file);
  await writable.close();
}

async function copyDirectory(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
) {
  for await (const [name, handle] of source.entries()) {
    if (handle.kind === 'directory') {
      const childTarget = await target.getDirectoryHandle(name, { create: true });
      await copyDirectory(handle, childTarget);
    } else {
      await copyFile(handle, target, name);
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
