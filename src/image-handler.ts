import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ImageRequestInfo, ImageEdits, ImageHandlerError } from './lib/types';
import { StatusCodes } from './lib/enums';
import { SHARP_EDIT_ALLOWLIST_ARRAY } from './lib/constants';

export class ImageHandler {
  private visionClient: ImageAnnotatorClient;

  constructor(visionClient?: ImageAnnotatorClient) {
    this.visionClient = visionClient || new ImageAnnotatorClient();
  }

  /**
   * Static helper to process an image request info.
   */
  public static async process(
    requestInfo: ImageRequestInfo,
    visionClient?: ImageAnnotatorClient
  ): Promise<Buffer> {
    const handler = new ImageHandler(visionClient);
    return handler.process(requestInfo);
  }

  /**
   * Processes the image according to the requested edits using Sharp and optional Vision API for smart cropping.
   */
  public async process(requestInfo: ImageRequestInfo): Promise<Buffer> {
    try {
      if (!requestInfo || !requestInfo.originalImage) {
        throw new ImageHandlerError(StatusCodes.BAD_REQUEST, 'BadRequest', 'Original image buffer is missing');
      }

      let image = sharp(requestInfo.originalImage, { failOn: 'none' });
      const metadata = await image.metadata();
      const edits = requestInfo.edits || {};

      // 1. Handle AI Smart Cropping or Face Cropping via Vision API
      if (edits.smartCrop || edits.faceCrop) {
        image = await this.applySmartCrop(image, requestInfo.originalImage, metadata, edits);
      }

      // 2. Handle EXIF and ICC stripping/retention
      if (edits.stripExif === true && edits.stripIcc !== true) {
        // Strip EXIF but keep ICC
        if (typeof (image as any).keepIccProfile === 'function') {
          (image as any).keepIccProfile();
        } else {
          image.withMetadata({ density: metadata.density, orientation: metadata.orientation });
        }
      } else if (edits.stripIcc === true && edits.stripExif !== true) {
        // Strip ICC but keep EXIF
        if (typeof (image as any).keepMetadata === 'function') {
          (image as any).keepMetadata();
        } else {
          image.withMetadata({ exif: metadata.exif as any });
        }
      } else if (edits.stripExif !== true && edits.stripIcc !== true) {
        // Retain metadata unless explicitly stripped
        if (typeof (image as any).keepMetadata === 'function') {
          (image as any).keepMetadata();
        } else {
          image.withMetadata();
        }
      }

      // 3. Apply Sharp edits from allowlist
      for (const editKey of SHARP_EDIT_ALLOWLIST_ARRAY) {
        if (edits[editKey] === undefined || editKey === 'smartCrop' || editKey === 'faceCrop' || editKey === 'stripExif' || editKey === 'stripIcc' || editKey === 'toFormat') {
          continue;
        }

        switch (editKey) {
          case 'resize': {
            if (edits.resize && (edits.resize.width || edits.resize.height || edits.resize.fit || edits.resize.background)) {
              image.resize(edits.resize);
            }
            break;
          }
          case 'grayscale': {
            if (edits.grayscale) image.grayscale();
            break;
          }
          case 'flip': {
            if (edits.flip) image.flip();
            break;
          }
          case 'flop': {
            if (edits.flop) image.flop();
            break;
          }
          case 'negate': {
            if (edits.negate !== undefined) image.negate(edits.negate);
            break;
          }
          case 'normalise':
          case 'normalize': {
            const val = edits.normalise ?? edits.normalize;
            if (val !== undefined && val !== false) image.normalise();
            break;
          }
          case 'blur': {
            if (typeof edits.blur === 'number') image.blur(edits.blur);
            else if (edits.blur) image.blur();
            break;
          }
          case 'sharpen': {
            if (typeof edits.sharpen === 'number') image.sharpen(edits.sharpen);
            else if (typeof edits.sharpen === 'object' && typeof edits.sharpen.sigma === 'number') image.sharpen(edits.sharpen as sharp.SharpenOptions);
            else if (edits.sharpen) image.sharpen();
            break;
          }
          case 'rotate': {
            if (edits.rotate !== undefined && edits.rotate !== null) {
              image.rotate(edits.rotate);
            }
            break;
          }
          case 'tint': {
            if (edits.tint !== undefined) image.tint(edits.tint as any);
            break;
          }
          case 'flatten': {
            if (edits.flatten !== undefined) image.flatten(edits.flatten as any);
            break;
          }
          case 'gamma': {
            if (typeof edits.gamma === 'number') image.gamma(edits.gamma);
            else if (typeof edits.gamma === 'object') image.gamma(edits.gamma.gamma, edits.gamma.gammaOut);
            break;
          }
          case 'median': {
            if (typeof edits.median === 'number') image.median(edits.median);
            break;
          }
          case 'threshold': {
            if (typeof edits.threshold === 'number') image.threshold(edits.threshold);
            break;
          }
          default:
            break;
        }
      }

      // 4. Modify Image Output (format, quality, effort)
      const format = edits.toFormat || (edits.webp ? 'webp' : edits.jpeg ? 'jpeg' : edits.png ? 'png' : edits.avif ? 'avif' : edits.tiff ? 'tiff' : edits.heif ? 'heif' : undefined);
      if (format) {
        const formatOptions: Record<string, any> = {
          ...(typeof edits[format] === 'object' ? edits[format] : {}),
        };
        if (edits.quality !== undefined) formatOptions.quality = edits.quality;
        if (edits.effort !== undefined) formatOptions.effort = edits.effort;

        image.toFormat(format as keyof sharp.FormatEnum, formatOptions);
      } else if (edits.quality !== undefined || edits.effort !== undefined) {
        // If no explicit format change, but quality/effort is specified, apply to existing format if known
        if (metadata.format) {
          const formatOptions: Record<string, any> = {};
          if (edits.quality !== undefined) formatOptions.quality = edits.quality;
          if (edits.effort !== undefined) formatOptions.effort = edits.effort;
          image.toFormat(metadata.format as keyof sharp.FormatEnum, formatOptions);
        }
      }

      const processedBuffer = await image.toBuffer();
      return processedBuffer;
    } catch (error: any) {
      if (error instanceof ImageHandlerError) {
        throw error;
      }
      throw new ImageHandlerError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'ImageProcessingError',
        `Failed to process image: ${error.message || error}`
      );
    }
  }

  /**
   * Performs AI Smart Crop or Face Crop using Google Cloud Vision API and sharp extract.
   */
  private async applySmartCrop(
    image: sharp.Sharp,
    originalBuffer: Buffer,
    metadata: sharp.Metadata,
    edits: ImageEdits
  ): Promise<sharp.Sharp> {
    const isFaceCrop =
      edits.faceCrop === true ||
      (typeof edits.smartCrop === 'object' && edits.smartCrop.faceCrop === true);
    const padding = typeof edits.smartCrop === 'object' && edits.smartCrop.padding ? edits.smartCrop.padding : 0;

    let boundingBox: { left: number; top: number; width: number; height: number } | null = null;

    if (isFaceCrop) {
      try {
        const [detectionResult] = await this.visionClient.faceDetection({
          image: { content: originalBuffer },
        });
        const faces = detectionResult.faceAnnotations;
        if (faces && faces.length > 0) {
          const poly = faces[0].boundingPoly || faces[0].fdBoundingPoly;
          if (poly && poly.vertices && poly.vertices.length > 0) {
            boundingBox = this.verticesToBoundingBox(poly.vertices, metadata, padding);
          }
        }
      } catch (e) {
        // Fallback or continue if Vision API fails
      }
    }

    if (!boundingBox) {
      try {
        const [cropResult] = await (typeof (this.visionClient as any).cropHints === 'function'
          ? (this.visionClient as any).cropHints({ image: { content: originalBuffer } })
          : (this.visionClient as any).cropHintsDetection({ image: { content: originalBuffer } }));
        const hints = cropResult.cropHintsAnnotation?.cropHints;
        if (hints && hints.length > 0) {
          const poly = hints[0].boundingPoly;
          if (poly && poly.vertices && poly.vertices.length > 0) {
            boundingBox = this.verticesToBoundingBox(poly.vertices, metadata, padding);
          }
        }
      } catch (e) {
        // Fallback or continue if Vision API fails
      }
    }

    if (boundingBox) {
      image.extract(boundingBox);
    }

    return image;
  }

  /**
   * Converts Vision API bounding vertices to Sharp extract bounds.
   */
  private verticesToBoundingBox(
    vertices: Array<{ x?: number | null; y?: number | null }>,
    metadata: sharp.Metadata,
    padding: number = 0
  ): { left: number; top: number; width: number; height: number } {
    const imgWidth = metadata.width || 1000;
    const imgHeight = metadata.height || 1000;

    const xs = vertices.map((v) => v.x || 0);
    const ys = vertices.map((v) => v.y || 0);

    let minX = Math.max(0, Math.min(...xs) - padding);
    let minY = Math.max(0, Math.min(...ys) - padding);
    let maxX = Math.min(imgWidth, Math.max(...xs) + padding);
    let maxY = Math.min(imgHeight, Math.max(...ys) + padding);

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    return {
      left: Math.floor(minX),
      top: Math.floor(minY),
      width: Math.floor(width),
      height: Math.floor(height),
    };
  }
}
