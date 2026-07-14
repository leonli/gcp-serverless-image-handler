import request from 'supertest';
import app from '../../src/index';
import { ImageRequest } from '../../src/image-request';
import { ImageHandler } from '../../src/image-handler';
import { RequestTypes, StatusCodes } from '../../src/lib/enums';
import { ImageHandlerError } from '../../src/lib/types';

jest.mock('../../src/image-request');
jest.mock('../../src/image-handler');

describe('API Route Unit Tests (index.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /health should return 200 UP status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(StatusCodes.OK);
    expect(res.body).toEqual({
      status: 'UP',
      service: 'gcp-serverless-image-handler',
    });
  });

  test('GET /photo.jpg?width=200 should return 200 processed buffer with correct headers', async () => {
    const fakeBuffer = Buffer.from('processed-webp-image-data');
    (ImageRequest.setup as jest.Mock).mockResolvedValueOnce({
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'photo.jpg',
      edits: { toFormat: 'webp' },
      originalImage: Buffer.from('raw'),
    });
    (ImageHandler.process as jest.Mock).mockResolvedValueOnce(fakeBuffer);

    const res = await request(app).get('/photo.jpg?width=200');

    expect(res.status).toBe(StatusCodes.OK);
    expect(res.header['content-type']).toContain('image/webp');
    expect(res.header['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.header['access-control-allow-origin']).toBe('*');
    expect(res.body).toEqual(fakeBuffer);
  });

  test('should return 404 when ImageRequest.setup throws NoSuchKey error', async () => {
    (ImageRequest.setup as jest.Mock).mockRejectedValueOnce(
      new ImageHandlerError(StatusCodes.NOT_FOUND, 'NoSuchKey', 'Image does not exist')
    );

    const res = await request(app).get('/nonexistent.jpg');

    expect(res.status).toBe(StatusCodes.NOT_FOUND);
    expect(res.body).toEqual({
      status: StatusCodes.NOT_FOUND,
      code: 'NoSuchKey',
      message: 'Image does not exist',
    });
  });

  test('should return 403 when ImageRequest.setup throws AccessDenied error', async () => {
    (ImageRequest.setup as jest.Mock).mockRejectedValueOnce(
      new ImageHandlerError(StatusCodes.FORBIDDEN, 'AccessDenied', 'Bucket not allowed')
    );

    const res = await request(app).get('/unauthorized/image.jpg');

    expect(res.status).toBe(StatusCodes.FORBIDDEN);
    expect(res.body).toEqual({
      status: StatusCodes.FORBIDDEN,
      code: 'AccessDenied',
      message: 'Bucket not allowed',
    });
  });

  test('should return 500 when unexpected error occurs', async () => {
    (ImageRequest.setup as jest.Mock).mockResolvedValueOnce({
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'corrupt.jpg',
      edits: {},
      originalImage: Buffer.from('raw'),
    });
    (ImageHandler.process as jest.Mock).mockRejectedValueOnce(
      new Error('Unexpected processing error')
    );

    const res = await request(app).get('/corrupt.jpg');

    expect(res.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(res.body).toEqual({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      code: 'InternalServerError',
      message: 'Unexpected processing error',
    });
  });
});
