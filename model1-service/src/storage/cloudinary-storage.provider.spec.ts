import { ConfigService } from '@nestjs/config';
import { CloudinaryStorageProvider } from './cloudinary-storage.provider';

const mockUploadStream = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: (...args: unknown[]) => mockUploadStream(...args),
    },
  },
}));

describe('CloudinaryStorageProvider', () => {
  let provider: CloudinaryStorageProvider;
  let config: ConfigService;

  beforeEach(() => {
    mockUploadStream.mockReset();
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'cloudinary.cloudName': 'test-cloud',
          'cloudinary.apiKey': 'test-key',
          'cloudinary.apiSecret': 'test-secret',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    provider = new CloudinaryStorageProvider(config);
  });

  it('resolves with the secure_url on a successful upload', async () => {
    mockUploadStream.mockImplementation((_options: unknown, callback: (error: unknown, result: unknown) => void) => {
      callback(null, { secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/cam-1.jpg' });
      return { end: jest.fn() };
    });

    const url = await provider.save(Buffer.from('fake image data'), 'cam-1');

    expect(url).toBe('https://res.cloudinary.com/test-cloud/image/upload/cam-1.jpg');
  });

  it('rejects when Cloudinary returns an error', async () => {
    mockUploadStream.mockImplementation((_options: unknown, callback: (error: unknown, result: unknown) => void) => {
      callback(new Error('upload failed'), null);
      return { end: jest.fn() };
    });

    await expect(provider.save(Buffer.from('fake image data'), 'cam-1')).rejects.toThrow('upload failed');
  });
});
