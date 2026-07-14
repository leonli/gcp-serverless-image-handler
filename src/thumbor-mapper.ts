import { ImageEdits } from './lib/types';

export interface ThumborMapping {
  edits: ImageEdits;
  key: string;
}

export class ThumborMapper {
  /**
   * Maps a Thumbor-style URL path into Sharp ImageEdits and GCS object key.
   * Examples:
   *  - /fit-in/800x600/filters:format(webp):quality(85)/path/to/img.jpg
   *  - /800x600/path/to/img.jpg
   */
  public static mapPath(path: string): ThumborMapping {
    const edits: ImageEdits = {};
    let remainingPath = path.startsWith('/') ? path.substring(1) : path;

    // 1. Strip optional 'unsafe/' or signature prefix if present
    if (remainingPath.startsWith('unsafe/')) {
      remainingPath = remainingPath.substring(7);
    } else {
      // Check for /sig/ or signature segment
      const sigMatch = remainingPath.match(/^[A-Za-z0-9\-_+=]{20,}\//);
      if (sigMatch) {
        remainingPath = remainingPath.substring(sigMatch[0].length);
      }
    }

    // 2. Check for 'fit-in/' prefix
    if (remainingPath.startsWith('fit-in/')) {
      edits.resize = { fit: 'inside' };
      remainingPath = remainingPath.substring(7);
    }

    // 3. Check for dimensions e.g. 800x600, -800x-600, 800x0, 0x600
    const dimMatch = remainingPath.match(/^((-?\d+)x(-?\d+))\//);
    if (dimMatch) {
      const rawWidth = parseInt(dimMatch[2], 10);
      const rawHeight = parseInt(dimMatch[3], 10);

      if (rawWidth < 0) {
        edits.flop = true;
      }
      if (rawHeight < 0) {
        edits.flip = true;
      }

      const width = Math.abs(rawWidth);
      const height = Math.abs(rawHeight);

      if (width > 0 || height > 0) {
        edits.resize = {
          ...edits.resize,
          ...(width > 0 ? { width } : {}),
          ...(height > 0 ? { height } : {}),
        };
      }

      remainingPath = remainingPath.substring(dimMatch[0].length);
    }

    // 4. Parse filters sections if present (could be one or multiple filters segments)
    while (remainingPath.startsWith('filters:')) {
      const filterEndIndex = remainingPath.indexOf('/');
      if (filterEndIndex === -1) break;

      const filtersSegment = remainingPath.substring(0, filterEndIndex);
      remainingPath = remainingPath.substring(filterEndIndex + 1);

      // Match individual filters like format(webp), quality(85), grayscale(), etc.
      const filterRegex = /(\w+)\(([^)]*)\)/g;
      let match;
      while ((match = filterRegex.exec(filtersSegment)) !== null) {
        const filterName = match[1].toLowerCase();
        const filterValue = match[2].trim();

        switch (filterName) {
          case 'format': {
            const fmt = filterValue.toLowerCase();
            edits.toFormat = fmt === 'jpg' ? 'jpeg' : fmt;
            break;
          }
          case 'quality': {
            const q = parseInt(filterValue, 10);
            if (!isNaN(q)) edits.quality = q;
            break;
          }
          case 'grayscale':
          case 'greyscale': {
            edits.grayscale = true;
            break;
          }
          case 'blur': {
            const b = parseFloat(filterValue);
            edits.blur = !isNaN(b) ? b : true;
            break;
          }
          case 'sharpen': {
            const s = parseFloat(filterValue);
            edits.sharpen = !isNaN(s) ? s : true;
            break;
          }
          case 'rotate': {
            const r = parseInt(filterValue, 10);
            if (!isNaN(r)) edits.rotate = r;
            break;
          }
          case 'strip_exif': {
            edits.stripExif = true;
            break;
          }
          case 'strip_icc': {
            edits.stripIcc = true;
            break;
          }
          case 'smart_crop': {
            edits.smartCrop = true;
            break;
          }
          case 'fill':
          case 'background_color': {
            edits.resize = {
              ...edits.resize,
              background: filterValue,
            };
            break;
          }
          default:
            break;
        }
      }
    }

    // 5. The remainder is the GCS object key
    let key = remainingPath;
    try {
      if (key.includes('%')) {
        key = decodeURIComponent(key);
      }
    } catch (e) {
      // Keep key as is if decodeURIComponent fails
    }

    return {
      edits,
      key,
    };
  }
}
