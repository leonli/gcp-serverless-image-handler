import { ThumborMapper } from '../../src/thumbor-mapper';

describe('ThumborMapper Unit Tests', () => {
  test('should map unsafe prefix and fit-in correctly', () => {
    const res = ThumborMapper.mapPath('/unsafe/fit-in/800x600/my-folder/image.png');
    expect(res.key).toBe('my-folder/image.png');
    expect(res.edits.resize).toEqual({
      fit: 'inside',
      width: 800,
      height: 600,
    });
  });

  test('should strip long signature prefix before parsing dimensions', () => {
    const res = ThumborMapper.mapPath('/a1b2c3d4e5f6g7h8i9j0abcdef123456/1200x900/test.jpg');
    expect(res.key).toBe('test.jpg');
    expect(res.edits.resize).toEqual({
      width: 1200,
      height: 900,
    });
  });

  test('should handle negative width (flop) and negative height (flip)', () => {
    const res = ThumborMapper.mapPath('/-500x-400/photo.jpg');
    expect(res.key).toBe('photo.jpg');
    expect(res.edits.flop).toBe(true);
    expect(res.edits.flip).toBe(true);
    expect(res.edits.resize).toEqual({
      width: 500,
      height: 400,
    });
  });

  test('should parse comprehensive filters segment (format, quality, grayscale, blur, sharpen, rotate, strip_exif, strip_icc, smart_crop, fill)', () => {
    const path =
      '/filters:format(jpg):quality(90):grayscale():blur(3.5):sharpen(1.2):rotate(180):strip_exif():strip_icc():smart_crop():fill(red)/path/to/img.tiff';
    const res = ThumborMapper.mapPath(path);

    expect(res.key).toBe('path/to/img.tiff');
    expect(res.edits.toFormat).toBe('jpeg');
    expect(res.edits.quality).toBe(90);
    expect(res.edits.grayscale).toBe(true);
    expect(res.edits.blur).toBe(3.5);
    expect(res.edits.sharpen).toBe(1.2);
    expect(res.edits.rotate).toBe(180);
    expect(res.edits.stripExif).toBe(true);
    expect(res.edits.stripIcc).toBe(true);
    expect(res.edits.smartCrop).toBe(true);
    expect(res.edits.resize?.background).toBe('red');
  });

  test('should decode URL-encoded keys properly and handle malformed URI gracefully', () => {
    const resValid = ThumborMapper.mapPath('/800x600/my%20folder%2Fimage.jpg');
    expect(resValid.key).toBe('my folder/image.jpg');

    const resMalformed = ThumborMapper.mapPath('/800x600/malformed%image.jpg');
    expect(resMalformed.key).toBe('malformed%image.jpg');
  });
});
