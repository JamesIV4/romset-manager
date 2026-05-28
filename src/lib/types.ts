export type SourceKey =
  | 'fullDir'
  | 'fbneoFullDir'
  | 'fbneoTargetDir'
  | 'xmlFile'
  | 'targetDir'
  | 'sampleSourceDir'
  | 'sampleTargetDir'
  | 'soundtrackSourceDir';

export type SourceHandles = {
  fullDir: FileSystemDirectoryHandle | null;
  fbneoFullDir: FileSystemDirectoryHandle | null;
  fbneoTargetDir: FileSystemDirectoryHandle | null;
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
  folder?: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  kind: AssetKind;
  name: string;
  relativePath?: string;
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
  counterpartAvailable: boolean;
  counterpartAsset?: RomAsset;
  counterpartAssetName: string;
  counterpartInTarget: boolean;
  counterpartTargetAsset?: RomAsset;
  counterpartTargetAssetName: string;
  fullAsset?: RomAsset;
  fullAssetName: string;
  inTarget: boolean;
  targetAsset?: RomAsset;
  targetAssetName: string;
  parentTitle: string;
};

export type CounterpartDirection = 'primaryToCounterpart' | 'counterpartToPrimary';

export type CounterpartPlanItem = {
  direction: CounterpartDirection;
  entry: RomEntry;
  removeAsset?: RomAsset;
  removeTarget?: FileSystemDirectoryHandle;
  sourceAsset: RomAsset;
  targetDirectory: FileSystemDirectoryHandle;
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
