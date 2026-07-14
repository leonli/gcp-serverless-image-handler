export enum StatusCodes {
  OK = 200,
  BAD_REQUEST = 400,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
}

export enum RequestTypes {
  DEFAULT = 'Default',
  CUSTOM = 'Custom',
  THUMBOR = 'Thumbor',
}

export enum ImageFormatTypes {
  JPG = 'jpg',
  JPEG = 'jpeg',
  PNG = 'png',
  WEBP = 'webp',
  TIFF = 'tiff',
  HEIF = 'heif',
  GIF = 'gif',
  AVIF = 'avif',
}

export enum ContentTypes {
  JPG = 'image/jpeg',
  JPEG = 'image/jpeg',
  PNG = 'image/png',
  WEBP = 'image/webp',
  TIFF = 'image/tiff',
  HEIF = 'image/heif',
  GIF = 'image/gif',
  AVIF = 'image/avif',
  JSON = 'application/json',
}
