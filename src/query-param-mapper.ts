import { ImageEdits } from './lib/types';
import { SHARP_EDIT_ALLOWLIST_ARRAY } from './lib/constants';

export class QueryParamMapper {
  /**
   * Maps URL query parameters into Sharp ImageEdits object.
   * Handles both individual query parameters (?width=800&height=600&fit=cover&format=webp)
   * and JSON string passed via 'edits' query parameter (?edits={"resize":{"width":800}}).
   */
  public static mapQueryParams(queryParams: Record<string, string | undefined>): ImageEdits {
    let edits: ImageEdits = {};

    if (!queryParams || Object.keys(queryParams).length === 0) {
      return edits;
    }

    // 1. Check if 'edits' query parameter is provided as JSON string
    if (queryParams.edits && typeof queryParams.edits === 'string') {
      try {
        const parsedEdits = JSON.parse(queryParams.edits);
        if (typeof parsedEdits === 'object' && parsedEdits !== null) {
          edits = { ...parsedEdits };
        }
      } catch (e) {
        // If edits query param is not JSON, ignore or treat as normal string
      }
    }

    // 2. Parse individual query parameters
    // Handle resize options
    const width = queryParams.width ? parseInt(queryParams.width, 10) : undefined;
    const height = queryParams.height ? parseInt(queryParams.height, 10) : undefined;
    const fit = queryParams.fit as 'contain' | 'cover' | 'fill' | 'inside' | 'outside' | undefined;
    const background = queryParams.background;

    if (
      (width !== undefined && !isNaN(width)) ||
      (height !== undefined && !isNaN(height)) ||
      fit !== undefined ||
      background !== undefined
    ) {
      edits.resize = {
        ...edits.resize,
        ...(width !== undefined && !isNaN(width) ? { width } : {}),
        ...(height !== undefined && !isNaN(height) ? { height } : {}),
        ...(fit !== undefined ? { fit } : {}),
        ...(background !== undefined ? { background } : {}),
      };
    }

    // Handle format output
    const format = queryParams.format || queryParams.toFormat;
    if (format && typeof format === 'string') {
      const fmt = format.toLowerCase();
      edits.toFormat = fmt === 'jpg' ? 'jpeg' : fmt;
    }

    // Handle quality & effort
    if (queryParams.quality !== undefined) {
      const q = parseInt(queryParams.quality, 10);
      if (!isNaN(q)) edits.quality = q;
    }

    if (queryParams.effort !== undefined) {
      const e = parseInt(queryParams.effort, 10);
      if (!isNaN(e)) edits.effort = e;
    }

    // Handle booleans / filters
    const booleanEdits = [
      'grayscale',
      'flip',
      'flop',
      'negate',
      'normalise',
      'normalize',
      'smartCrop',
      'faceCrop',
      'stripExif',
      'stripIcc',
    ];

    for (const key of booleanEdits) {
      if (queryParams[key] !== undefined) {
        const val = queryParams[key]?.toLowerCase();
        if (val === 'true' || val === '1' || val === '') {
          edits[key] = true;
        } else if (val === 'false' || val === '0') {
          edits[key] = false;
        }
      }
    }

    // Handle numeric or boolean filters (blur, sharpen, rotate, gamma, median, threshold)
    if (queryParams.blur !== undefined) {
      const val = queryParams.blur.toLowerCase();
      if (val === 'true' || val === '') edits.blur = true;
      else if (val === 'false') edits.blur = false;
      else {
        const num = parseFloat(queryParams.blur);
        if (!isNaN(num)) edits.blur = num;
      }
    }

    if (queryParams.sharpen !== undefined) {
      const val = queryParams.sharpen.toLowerCase();
      if (val === 'true' || val === '') edits.sharpen = true;
      else if (val === 'false') edits.sharpen = false;
      else {
        const num = parseFloat(queryParams.sharpen);
        if (!isNaN(num)) edits.sharpen = num;
      }
    }

    if (queryParams.rotate !== undefined) {
      const num = parseInt(queryParams.rotate, 10);
      if (!isNaN(num)) edits.rotate = num;
    }

    if (queryParams.gamma !== undefined) {
      const num = parseFloat(queryParams.gamma);
      if (!isNaN(num)) edits.gamma = num;
    }

    if (queryParams.median !== undefined) {
      const num = parseInt(queryParams.median, 10);
      if (!isNaN(num)) edits.median = num;
    }

    if (queryParams.threshold !== undefined) {
      const num = parseInt(queryParams.threshold, 10);
      if (!isNaN(num)) edits.threshold = num;
    }

    if (queryParams.tint !== undefined) {
      edits.tint = queryParams.tint;
    }

    // Filter out any edits keys that are not in allowlist or resize/toFormat/quality/effort
    const allowedKeys = new Set([
      ...SHARP_EDIT_ALLOWLIST_ARRAY,
      'quality',
      'effort',
    ]);

    const sanitizedEdits: ImageEdits = {};
    for (const key of Object.keys(edits)) {
      if (allowedKeys.has(key)) {
        sanitizedEdits[key] = edits[key];
      }
    }

    return sanitizedEdits;
  }
}
