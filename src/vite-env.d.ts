/// <reference types="vite/client" />

type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
}

interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file';
  getFile: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritableFileStream>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory';
  entries: () => AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>;
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write: (data: Blob | BufferSource | string) => Promise<void>;
  close: () => Promise<void>;
}

interface Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: FileSystemPermissionMode;
    startIn?: WellKnownDirectory;
  }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    id?: string;
    multiple?: boolean;
    startIn?: WellKnownDirectory;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle[]>;
}
