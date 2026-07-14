import { SecretProvider } from '../../src/secret-provider';

const mockAccessSecretVersion = jest.fn();
const mockSecretManagerClient = {
  accessSecretVersion: mockAccessSecretVersion,
} as any;

describe('SecretProvider Unit Tests', () => {
  let secretProvider: SecretProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    secretProvider = new SecretProvider(mockSecretManagerClient);
  });

  test('should throw error when secretName is empty or missing', async () => {
    await expect(secretProvider.getSecret('')).rejects.toThrow('Secret name must be provided.');
  });

  test('should retrieve secret from Secret Manager and cache the result', async () => {
    mockAccessSecretVersion.mockResolvedValueOnce([
      {
        payload: {
          data: Buffer.from('my-super-secret-value'),
        },
      },
    ]);

    const result1 = await secretProvider.getSecret('projects/123/secrets/hmac-key/versions/latest');
    expect(result1).toBe('my-super-secret-value');
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);

    // Call second time to verify cache hit without calling client again
    const result2 = await secretProvider.getSecret('projects/123/secrets/hmac-key/versions/latest');
    expect(result2).toBe('my-super-secret-value');
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
  });

  test('should throw error when secret payload is empty', async () => {
    mockAccessSecretVersion.mockResolvedValueOnce([
      {
        payload: {
          data: null,
        },
      },
    ]);

    await expect(
      secretProvider.getSecret('projects/123/secrets/empty/versions/latest')
    ).rejects.toThrow('Failed to retrieve secret from Secret Manager: Secret projects/123/secrets/empty/versions/latest payload is empty.');
  });

  test('should throw error when Secret Manager API call throws', async () => {
    mockAccessSecretVersion.mockRejectedValueOnce(new Error('Permission denied'));

    await expect(
      secretProvider.getSecret('projects/123/secrets/error/versions/latest')
    ).rejects.toThrow('Failed to retrieve secret from Secret Manager: Permission denied');
  });

  test('should clear cache when clearCache is called', async () => {
    mockAccessSecretVersion.mockResolvedValue([
      {
        payload: {
          data: Buffer.from('value-1'),
        },
      },
    ]);

    await secretProvider.getSecret('secret-key');
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);

    secretProvider.clearCache();

    await secretProvider.getSecret('secret-key');
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(2);
  });
});
