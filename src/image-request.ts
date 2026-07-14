import { Storage } from '@google-cloud/storage';
import * as crypto from 'crypto';
import { StatusCodes, RequestTypes } from './lib/enums';
import { ImageHandlerEvent, ImageRequestInfo, ImageEdits, ImageHandlerError } from './lib/types';
import { ThumborMapper } from './thumbor-mapper';
import { QueryParamMapper } from './query-param-mapper';
import { SecretProvider } from './secret-provider';

export class ImageRequest {
  private storage: Storage;
  private secretProvider: SecretProvider;

  constructor(storageClient?: Storage, secretProvider?: SecretProvider) {
    this.storage = storageClient || new Storage();
    this.secretProvider = secretProvider || new SecretProvider();
  }

  /**
   * Static setup helper that initializes an ImageRequest instance and calls setup.
   */
  public static async setup(
    event: ImageHandlerEvent,
    storageClient?: Storage,
    secretProvider?: SecretProvider
  ): Promise<ImageRequestInfo> {
    const instance = new ImageRequest(storageClient, secretProvider);
    return instance.setup(event);
  }

  /**
   * Sets up and validates the image request:
   * 1. Determines request type (Default Base64, Thumbor, Custom) and parses key, bucket, edits.
   * 2. Validates SOURCE_BUCKETS allowlist.
   * 3. Validates HMAC signature if ENABLE_SIGNATURE is 'Yes'.
   * 4. Downloads original image from GCS.
   */
  public async setup(event: ImageHandlerEvent): Promise<ImageRequestInfo> {
    try {
      if (!event || !event.path) {
        throw new ImageHandlerError(StatusCodes.BAD_REQUEST, 'BadRequest', 'Event or path is missing');
      }

      let rawPath = event.path.startsWith('/') ? event.path.substring(1) : event.path;
      let requestType: RequestTypes;
      let bucket: string | undefined;
      let key: string = '';
      let edits: ImageEdits = {};

      // Parse allowed buckets from environment variable
      const allowedBuckets = process.env.SOURCE_BUCKETS
        ? process.env.SOURCE_BUCKETS.split(',').map((b) => b.trim()).filter(Boolean)
        : [];
      const defaultBucket = allowedBuckets.length > 0 ? allowedBuckets[0] : undefined;

      // 1. Determine Request Type and decode path/parameters
      const isBase64Candidate = /^[A-Za-z0-9\-_+=/]+$/.test(rawPath);
      let parsedBase64: any = null;

      if (isBase64Candidate) {
        try {
          const decodedString = Buffer.from(rawPath, 'base64').toString('utf8');
          parsedBase64 = JSON.parse(decodedString);
        } catch (e) {
          parsedBase64 = null;
        }
      }

      if (parsedBase64 && typeof parsedBase64 === 'object' && parsedBase64.key) {
        // RequestTypes.DEFAULT
        requestType = RequestTypes.DEFAULT;
        bucket = parsedBase64.bucket;
        key = parsedBase64.key;
        edits = parsedBase64.edits || {};
      } else if (
        rawPath.startsWith('unsafe/') ||
        rawPath.startsWith('fit-in/') ||
        /^((-?\d+)x(-?\d+))\//.test(rawPath) ||
        rawPath.includes('filters:') ||
        rawPath.includes('smart_crop')
      ) {
        // RequestTypes.THUMBOR
        requestType = RequestTypes.THUMBOR;
        const thumborResult = ThumborMapper.mapPath(rawPath);
        key = thumborResult.key;
        edits = thumborResult.edits;
        bucket = event.queryStringParameters?.bucket;
      } else {
        // RequestTypes.CUSTOM
        requestType = RequestTypes.CUSTOM;
        key = rawPath || event.queryStringParameters?.key || '';
        if (key.includes('%')) {
          try {
            key = decodeURIComponent(key);
          } catch (e) {
            // Keep original if decode fails
          }
        }
        bucket = event.queryStringParameters?.bucket;
        edits = QueryParamMapper.mapQueryParams(event.queryStringParameters || {});
      }

      // 2. Validate SOURCE_BUCKETS
      if (!bucket) {
        if (defaultBucket) {
          bucket = defaultBucket;
        } else {
          throw new ImageHandlerError(
            StatusCodes.BAD_REQUEST,
            'BadRequest',
            'Bucket not specified and SOURCE_BUCKETS not configured'
          );
        }
      }

      if (allowedBuckets.length > 0 && !allowedBuckets.includes(bucket)) {
        throw new ImageHandlerError(StatusCodes.FORBIDDEN, 'AccessDenied', 'Bucket not allowed');
      }

      // 3. Validate HMAC Signature if enabled
      if (process.env.ENABLE_SIGNATURE?.toLowerCase() === 'yes') {
        await this.validateSignature(event, rawPath, key, bucket);
      }

      // 4. Download original image from GCS
      const originalImage = await this.downloadImageFromGCS(bucket, key);

      return {
        requestType,
        bucket,
        key,
        edits,
        originalImage,
        headers: event.headers,
      };
    } catch (error: any) {
      if (error instanceof ImageHandlerError) {
        throw error;
      }
      throw new ImageHandlerError(
        error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
        error.code || 'InternalServerError',
        error.message || 'An unexpected error occurred during request setup'
      );
    }
  }

  /**
   * Validates the HMAC signature for the request.
   */
  private async validateSignature(
    event: ImageHandlerEvent,
    rawPath: string,
    key: string,
    bucket: string
  ): Promise<void> {
    // Check where signature is provided
    let providedSignature =
      event.queryStringParameters?.signature ||
      event.queryStringParameters?.sig ||
      (event.headers ? (event.headers['x-signature'] as string) || (event.headers['signature'] as string) : undefined);

    let pathWithoutSignature = rawPath;

    // Check if signature is embedded in path prefix e.g. /abcdef1234567890/fit-in/...
    if (!providedSignature) {
      const parts = rawPath.split('/');
      if (parts.length > 1 && /^[A-Za-z0-9\-_+=]{16,}$/.test(parts[0])) {
        providedSignature = parts[0];
        pathWithoutSignature = parts.slice(1).join('/');
      }
    }

    if (!providedSignature) {
      throw new ImageHandlerError(StatusCodes.FORBIDDEN, 'SignatureDoesNotMatch', 'Signature verification failed');
    }

    // Retrieve Secret Key
    let secretKey = process.env.SECRET_KEY;
    if (!secretKey && process.env.SECRET_KEY_NAME) {
      try {
        secretKey = await this.secretProvider.getSecret(process.env.SECRET_KEY_NAME);
      } catch (e: any) {
        throw new ImageHandlerError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          'ConfigurationError',
          `Failed to retrieve HMAC secret key: ${e.message}`
        );
      }
    }

    if (!secretKey) {
      throw new ImageHandlerError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'ConfigurationError',
        'Secret key is not configured for signature verification'
      );
    }

    // Compute candidates for string to sign
    const candidateStrings = [
      event.path,
      rawPath,
      pathWithoutSignature,
      `/${pathWithoutSignature}`,
      key,
      `${bucket}/${key}`,
    ];

    let signatureMatches = false;
    for (const stringToSign of candidateStrings) {
      if (!stringToSign) continue;

      const hexDigest = crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex');
      const base64Digest = crypto.createHmac('sha256', secretKey).update(stringToSign).digest('base64');
      const base64UrlDigest = crypto.createHmac('sha256', secretKey).update(stringToSign).digest('base64url');

      if (
        providedSignature.toLowerCase() === hexDigest.toLowerCase() ||
        providedSignature === base64Digest ||
        providedSignature === base64UrlDigest
      ) {
        signatureMatches = true;
        break;
      }
    }

    if (!signatureMatches) {
      throw new ImageHandlerError(StatusCodes.FORBIDDEN, 'SignatureDoesNotMatch', 'Signature verification failed');
    }
  }

  /**
   * Downloads the image from Google Cloud Storage.
   */
  private async downloadImageFromGCS(bucket: string, key: string): Promise<Buffer> {
    try {
      const [buffer] = await this.storage.bucket(bucket).file(key).download();
      return buffer;
    } catch (error: any) {
      if (
        error.code === 404 ||
        error.message?.includes('No such object') ||
        error.code === 'NoSuchKey'
      ) {
        throw new ImageHandlerError(StatusCodes.NOT_FOUND, 'NoSuchKey', 'Image does not exist');
      }
      if (error.code === 403 || error.message?.includes('Access denied')) {
        throw new ImageHandlerError(
          StatusCodes.FORBIDDEN,
          'AccessDenied',
          error.message || 'Access denied to GCS object'
        );
      }
      throw new ImageHandlerError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'InternalServerError',
        error.message || 'Failed to download image from GCS'
      );
    }
  }
}
