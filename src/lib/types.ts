export type SourceKey =
  | 'fullDir'
  | 'xmlFile'
  | 'targetDir'
  | 'sampleSourceDir'
  | 'sampleTargetDir'
  | 'soundtrackSourceDir';

export type SourceHandles = {
  fullDir: FileSystemDirectoryHandle | null;
  xmlFile: FileSystemFileHandle | null;
  targetDir: FileSystemDirectoryHandle | null;
  sampleSourceDir: FileSystemDirectoryHandle | null;
  sampleTargetDir: FileSystemDirectoryHandle | null;
  soundtrackSourceDir: FileSystemDirectoryHandle | null;
};

export type AssetKind = 'file' | 'directory';

export type RomAsset = {
  baseName: string;
  extension: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  kind: AssetKind;
  name: string;
  size?: number;
  updated?: number;
};

export type ParsedRom = {
  id: string;
  title: string;
  region: string;
  year: string;
  manufacturer: string;
  players: string;
  buttons: string;
  controls: string;
  coins: string;
  genre: string;
  category: string;
  cloneOf: string;
  romOf: string;
  sampleOf: string;
  sampleArchiveIds: string[];
  sampleNames: string[];
  driverName: string;
  display: string;
  driverStatus: string;
  isBios: boolean;
  isRunnable: boolean;
  romCount: number;
  romSize: number;
  searchText: string;
};

export type RomEntry = ParsedRom & {
  available: boolean;
  fullAsset?: RomAsset;
  fullAssetName: string;
  inTarget: boolean;
  targetAsset?: RomAsset;
  targetAssetName: string;
  parentTitle: string;
};

export type CopyPlanItem = {
  entry: RomEntry;
  asset: RomAsset;
  reason: 'selected' | 'dependency';
};

export type CopyPlan = {
  items: CopyPlanItem[];
  missing: RomEntry[];
  alreadyPresent: RomEntry[];
};

export type SamplePlanItem = {
  entry: RomEntry;
  asset: RomAsset;
  sampleId: string;
};

export type MissingSample = {
  entry: RomEntry;
  sampleId: string;
};

export type SamplePlan = {
  alreadyPresent: MissingSample[];
  items: SamplePlanItem[];
  missing: MissingSample[];
  required: MissingSample[];
};
