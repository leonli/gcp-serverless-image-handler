import { StatusCodes, RequestTypes } from './enums';

export interface Headers {
  [key: string]: string | string[] | undefined;
}

export interface ImageEdits {
  resize?: {
    width?: number;
    height?: number;
    fit?: 'contain' | 'cover' | 'fill' | 'inside' | 'outside';
    background?: string | { r: number; g: number; b: number; alpha: number };
    withoutEnlargement?: boolean;
  };
  grayscale?: boolean;
  flip?: boolean;
  flop?: boolean;
  negate?: boolean;
  normalise?: boolean;
  normalize?: boolean;
  blur?: boolean | number;
  sharpen?: boolean | number | { sigma?: number; m1?: number; m2?: number; x1?: number; y1?: number };
  rotate?: number | null;
  webp?: Record<string, any>;
  avif?: Record<string, any>;
  jpeg?: Record<string, any>;
  png?: Record<string, any>;
  tiff?: Record<string, any>;
  heif?: Record<string, any>;
  tint?: string | { r: number; g: number; b: number };
  flatten?: boolean | { background?: string | { r: number; g: number; b: number } };
  gamma?: number | { gamma?: number; gammaOut?: number };
  median?: number;
  threshold?: number;
  smartCrop?: boolean | { faceCrop?: boolean; padding?: number };
  faceCrop?: boolean;
  stripExif?: boolean;
  stripIcc?: boolean;
  toFormat?: string;
  quality?: number;
  effort?: number;
  [key: string]: any;
}

export interface ImageRequestInfo {
  requestType: RequestTypes;
  bucket: string;
  key: string;
  edits?: ImageEdits;
  originalImage: Buffer;
  headers?: Headers;
}

export interface ImageHandlerEvent {
  path: string;
  queryStringParameters?: Record<string, string>;
  headers?: Headers;
  [key: string]: any;
}

export class ImageHandlerError extends Error {
  public statusCode: StatusCodes;
  public code: string;

  constructor(statusCode: StatusCodes, code: string, message: string) {
    super(message);
    this.name = 'ImageHandlerError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, ImageHandlerError.prototype);
  }
}
