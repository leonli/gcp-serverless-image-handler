import sharp from 'sharp';
import { ImageHandler } from '../../src/image-handler';
import { RequestTypes } from '../../src/lib/enums';
import { ImageRequestInfo } from '../../src/lib/types';

const mockFaceDetection = jest.fn();
const mockCropHintsDetection = jest.fn();

jest.mock('@google-cloud/vision', () => ({
  ImageAnnotatorClient: jest.fn().mockImplementation(() => ({
    faceDetection: mockFaceDetection,
    cropHintsDetection: mockCropHintsDetection,
    cropHints: mockCropHintsDetection,
  })),
}));

// A 1x1 transparent PNG buffer for testing Sharp operations
const oneByOnePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('ImageHandler Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should process resize, grayscale, and rotate edits correctly', async () => {
    const requestInfo: ImageRequestInfo = {
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'test.png',
      originalImage: oneByOnePng,
      edits: {
        resize: { width: 20, height: 20, fit: 'fill' },
        grayscale: true,
        rotate: 90,
      },
    };

    const processedBuffer = await ImageHandler.process(requestInfo);
    expect(processedBuffer).toBeInstanceOf(Buffer);

    const metadata = await sharp(processedBuffer).metadata();
    expect(metadata.width).toBe(20);
    expect(metadata.height).toBe(20);
  });

  test('should handle format conversion with quality and effort', async () => {
    const requestInfo: ImageRequestInfo = {
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'test.png',
      originalImage: oneByOnePng,
      edits: {
        toFormat: 'webp',
        quality: 75,
        effort: 2,
      },
    };

    const processedBuffer = await ImageHandler.process(requestInfo);
    expect(processedBuffer).toBeInstanceOf(Buffer);

    const metadata = await sharp(processedBuffer).metadata();
    expect(metadata.format).toBe('webp');
  });

  test('should handle stripExif while keeping ICC profile', async () => {
    const requestInfo: ImageRequestInfo = {
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'test.png',
      originalImage: oneByOnePng,
      edits: {
        stripExif: true,
        stripIcc: false,
      },
    };

    const processedBuffer = await ImageHandler.process(requestInfo);
    expect(processedBuffer).toBeInstanceOf(Buffer);
  });

  test('should handle stripIcc while keeping EXIF metadata', async () => {
    const requestInfo: ImageRequestInfo = {
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'test.png',
      originalImage: oneByOnePng,
      edits: {
        stripExif: false,
        stripIcc: true,
      },
    };

    const processedBuffer = await ImageHandler.process(requestInfo);
    expect(processedBuffer).toBeInstanceOf(Buffer);
  });

  test('should apply AI face crop using Google Cloud Vision API when faceCrop is true', async () => {
    mockFaceDetection.mockResolvedValueOnce([
      {
        faceAnnotations: [
          {
            boundingPoly: {
              vertices: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
            },
          },
        ],
      },
    ]);

    const requestInfo: ImageRequestInfo = {
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'face.png',
      originalImage: oneByOnePng,
      edits: {
        faceCrop: true,
      },
    };

    const processedBuffer = await ImageHandler.process(requestInfo);
    expect(mockFaceDetection).toHaveBeenCalled();
    expect(processedBuffer).toBeInstanceOf(Buffer);
  });

  test('should apply AI smart crop using cropHintsDetection when smartCrop is true', async () => {
    mockCropHintsDetection.mockResolvedValueOnce([
      {
        cropHintsAnnotation: {
          cropHints: [
            {
              boundingPoly: {
                vertices: [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ],
              },
            },
          ],
        },
      },
    ]);

    const requestInfo: ImageRequestInfo = {
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'smart.png',
      originalImage: oneByOnePng,
      edits: {
        smartCrop: true,
      },
    };

    const processedBuffer = await ImageHandler.process(requestInfo);
    expect(mockCropHintsDetection).toHaveBeenCalled();
    expect(processedBuffer).toBeInstanceOf(Buffer);
  });

  test('should apply multiple filter edits (blur, sharpen, tint, negate, normalise)', async () => {
    const requestInfo: ImageRequestInfo = {
      requestType: RequestTypes.CUSTOM,
      bucket: 'test-bucket',
      key: 'filters.png',
      originalImage: oneByOnePng,
      edits: {
        blur: 2,
        sharpen: 1,
        tint: { r: 255, g: 0, b: 0 },
        negate: true,
        normalise: true,
      },
    };

    const processedBuffer = await ImageHandler.process(requestInfo);
    expect(processedBuffer).toBeInstanceOf(Buffer);
  });
});
