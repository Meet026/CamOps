// Section 6a point 7's swap boundary: any future feature needing file
// storage depends on this interface, never on CloudinaryStorageProvider
// directly.
export interface StorageProvider {
  // Uploads a file buffer under the given logical key (e.g. a camera ID)
  // and returns its publicly-accessible URL.
  save(fileBuffer: Buffer, key: string): Promise<string>;
}
