import { QueryParamMapper } from '../../src/query-param-mapper';

describe('QueryParamMapper Unit Tests', () => {
  test('should return empty object when queryParams is undefined or empty', () => {
    expect(QueryParamMapper.mapQueryParams({})).toEqual({});
    expect(QueryParamMapper.mapQueryParams(undefined as any)).toEqual({});
  });

  test('should parse JSON string in edits query parameter', () => {
    const editsJson = JSON.stringify({
      resize: { width: 400, height: 300, fit: 'contain' },
      grayscale: true,
    });

    const result = QueryParamMapper.mapQueryParams({
      edits: editsJson,
    });

    expect(result.resize).toEqual({ width: 400, height: 300, fit: 'contain' });
    expect(result.grayscale).toBe(true);
  });

  test('should ignore malformed JSON in edits query parameter and continue parsing direct query params', () => {
    const result = QueryParamMapper.mapQueryParams({
      edits: 'not-valid-json',
      width: '640',
      height: '480',
    });

    expect(result.resize).toEqual({ width: 640, height: 480 });
  });

  test('should parse direct numeric and boolean filters accurately', () => {
    const result = QueryParamMapper.mapQueryParams({
      width: '1024',
      height: '768',
      fit: 'inside',
      background: 'white',
      format: 'jpg',
      quality: '88',
      effort: '5',
      grayscale: 'true',
      flip: '1',
      flop: 'true',
      negate: 'true',
      normalise: 'true',
      blur: '2.5',
      sharpen: 'true',
      rotate: '90',
      gamma: '2.2',
      median: '3',
      threshold: '128',
      tint: 'blue',
      smartCrop: 'true',
      faceCrop: 'true',
      stripExif: 'true',
      stripIcc: 'false',
    });

    expect(result.resize).toEqual({
      width: 1024,
      height: 768,
      fit: 'inside',
      background: 'white',
    });
    expect(result.toFormat).toBe('jpeg');
    expect(result.quality).toBe(88);
    expect(result.effort).toBe(5);
    expect(result.grayscale).toBe(true);
    expect(result.flip).toBe(true);
    expect(result.flop).toBe(true);
    expect(result.negate).toBe(true);
    expect(result.normalise).toBe(true);
    expect(result.blur).toBe(2.5);
    expect(result.sharpen).toBe(true);
    expect(result.rotate).toBe(90);
    expect(result.gamma).toBe(2.2);
    expect(result.median).toBe(3);
    expect(result.threshold).toBe(128);
    expect(result.tint).toBe('blue');
    expect(result.smartCrop).toBe(true);
    expect(result.faceCrop).toBe(true);
    expect(result.stripExif).toBe(true);
    expect(result.stripIcc).toBe(false);
  });

  test('should sanitize out arbitrary unauthorized keys not in SHARP_EDIT_ALLOWLIST_ARRAY', () => {
    const result = QueryParamMapper.mapQueryParams({
      width: '100',
      unauthorizedKey: 'hacked',
      someRandomParam: '123',
    });

    expect(result.resize).toEqual({ width: 100 });
    expect((result as any).unauthorizedKey).toBeUndefined();
    expect((result as any).someRandomParam).toBeUndefined();
  });
});
