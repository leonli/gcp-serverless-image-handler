import * as crypto from 'crypto';
import { ImageRequest } from '../../src/image-request';
import { RequestTypes, StatusCodes } from '../../src/lib/enums';
import { ImageHandlerError } from '../../src/lib/types';

const mockDownload = jest.fn();
const mockFile = jest.fn().mockImplementation(() => ({ download: mockDownload }));
const mockBucket = jest.fn().mockImplementation(() => ({ file: mockFile }));

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: mockBucket,
  })),
}));

const mockGetSecret = jest.fn();
jest.mock('../../src/secret-provider', () => ({
  SecretProvider: jest.fn().mockImplementation(() => ({
    getSecret: mockGetSecret,
  })),
}));

describe('ImageRequest Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SOURCE_BUCKETS;
    delete process.env.ENABLE_SIGNATURE;
    delete process.env.SECRET_KEY;
    delete process.env.SECRET_KEY_NAME;

    mockDownload.mockResolvedValue([Buffer.from('fake-image-data')]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('should decode RequestTypes.DEFAULT (Base64 JSON)', async () => {
    process.env.SOURCE_BUCKETS = 'my-bucket,other-bucket';
    const payload = {
      bucket: 'my-bucket',
      key: 'images/photo.jpg',
      edits: { grayscale: true, resize: { width: 500 } },
    };
    const base64Path = Buffer.from(JSON.stringify(payload)).toString('base64');

    const event = {
      path: `/${base64Path}`,
    };

    const requestInfo = await ImageRequest.setup(event);

    expect(requestInfo.requestType).toBe(RequestTypes.DEFAULT);
    expect(requestInfo.bucket).toBe('my-bucket');
    expect(requestInfo.key).toBe('images/photo.jpg');
    expect(requestInfo.edits).toEqual({ grayscale: true, resize: { width: 500 } });
    expect(mockBucket).toHaveBeenCalledWith('my-bucket');
    expect(mockFile).toHaveBeenCalledWith('images/photo.jpg');
  });

  test('should map query parameters for RequestTypes.CUSTOM', async () => {
    process.env.SOURCE_BUCKETS = 'default-bucket';
    const event = {
      path: '/custom/path/image.png',
      queryStringParameters: {
        width: '800',
        height: '600',
        fit: 'cover',
        format: 'webp',
        quality: '85',
        grayscale: 'true',
      },
    };

    const requestInfo = await ImageRequest.setup(event);

    expect(requestInfo.requestType).toBe(RequestTypes.CUSTOM);
    expect(requestInfo.bucket).toBe('default-bucket');
    expect(requestInfo.key).toBe('custom/path/image.png');
    expect(requestInfo.edits?.resize).toEqual({
      width: 800,
      height: 600,
      fit: 'cover',
    });
    expect(requestInfo.edits?.toFormat).toBe('webp');
    expect(requestInfo.edits?.quality).toBe(85);
    expect(requestInfo.edits?.grayscale).toBe(true);
  });

  test('should map Thumbor paths for RequestTypes.THUMBOR', async () => {
    process.env.SOURCE_BUCKETS = 'thumbor-bucket';
    const event = {
      path: '/fit-in/800x600/filters:format(webp):quality(80)/path/to/thumbor.jpg',
    };

    const requestInfo = await ImageRequest.setup(event);

    expect(requestInfo.requestType).toBe(RequestTypes.THUMBOR);
    expect(requestInfo.bucket).toBe('thumbor-bucket');
    expect(requestInfo.key).toBe('path/to/thumbor.jpg');
    expect(requestInfo.edits?.resize).toEqual({
      fit: 'inside',
      width: 800,
      height: 600,
    });
    expect(requestInfo.edits?.toFormat).toBe('webp');
    expect(requestInfo.edits?.quality).toBe(80);
  });

  test('should default to first bucket in SOURCE_BUCKETS when bucket is missing', async () => {
    process.env.SOURCE_BUCKETS = 'first-bucket, second-bucket';
    const event = {
      path: '/my-pic.jpg',
    };

    const requestInfo = await ImageRequest.setup(event);
    expect(requestInfo.bucket).toBe('first-bucket');
    expect(mockBucket).toHaveBeenCalledWith('first-bucket');
  });

  test('should throw 403 Forbidden when bucket is not in SOURCE_BUCKETS allowlist', async () => {
    process.env.SOURCE_BUCKETS = 'allowed-bucket-1, allowed-bucket-2';
    const payload = {
      bucket: 'unauthorized-bucket',
      key: 'test.jpg',
    };
    const event = {
      path: `/${Buffer.from(JSON.stringify(payload)).toString('base64')}`,
    };

    await expect(ImageRequest.setup(event)).rejects.toMatchObject({
      statusCode: StatusCodes.FORBIDDEN,
      code: 'AccessDenied',
      message: 'Bucket not allowed',
    });
  });

  test('should verify HMAC signature successfully when ENABLE_SIGNATURE is Yes', async () => {
    process.env.SOURCE_BUCKETS = 'sig-bucket';
    process.env.ENABLE_SIGNATURE = 'Yes';
    process.env.SECRET_KEY = 'super-secret-key';

    const targetPath = 'sig-bucket/secure-image.jpg';
    const signature = crypto.createHmac('sha256', 'super-secret-key').update(targetPath).digest('hex');

    const event = {
      path: '/secure-image.jpg',
      queryStringParameters: {
        signature,
      },
    };

    const requestInfo = await ImageRequest.setup(event);
    expect(requestInfo.key).toBe('secure-image.jpg');
  });

  test('should throw 403 when HMAC signature does not match or is missing', async () => {
    process.env.SOURCE_BUCKETS = 'sig-bucket';
    process.env.ENABLE_SIGNATURE = 'Yes';
    process.env.SECRET_KEY = 'super-secret-key';

    const event = {
      path: '/secure-image.jpg',
      queryStringParameters: {
        signature: 'invalid-signature-hex',
      },
    };

    await expect(ImageRequest.setup(event)).rejects.toMatchObject({
      statusCode: StatusCodes.FORBIDDEN,
      code: 'SignatureDoesNotMatch',
    });
  });

  test('should throw 404 NoSuchKey when GCS returns a 404 error', async () => {
    process.env.SOURCE_BUCKETS = 'missing-bucket';
    mockDownload.mockRejectedValueOnce({ code: 404, message: 'No such object' });

    const event = {
      path: '/non-existent.jpg',
    };

    await expect(ImageRequest.setup(event)).rejects.toMatchObject({
      statusCode: StatusCodes.NOT_FOUND,
      code: 'NoSuchKey',
      message: 'Image does not exist',
    });
  });

  test('should retrieve secret key from SecretProvider if SECRET_KEY is not set', async () => {
    process.env.SOURCE_BUCKETS = 'sig-bucket';
    process.env.ENABLE_SIGNATURE = 'Yes';
    process.env.SECRET_KEY_NAME = 'projects/test/secrets/my-secret';
    mockGetSecret.mockResolvedValueOnce('fetched-secret-key');

    const targetPath = 'sig-bucket/secret-image.jpg';
    const signature = crypto.createHmac('sha256', 'fetched-secret-key').update(targetPath).digest('hex');

    const event = {
      path: '/secret-image.jpg',
      queryStringParameters: { signature },
    };

    const requestInfo = await ImageRequest.setup(event);
    expect(requestInfo.key).toBe('secret-image.jpg');
    expect(mockGetSecret).toHaveBeenCalledWith('projects/test/secrets/my-secret');
  });
});
