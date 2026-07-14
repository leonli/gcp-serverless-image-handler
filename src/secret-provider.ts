import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export class SecretProvider {
  private client: SecretManagerServiceClient;
  private cache: Map<string, string>;

  constructor(client?: SecretManagerServiceClient) {
    this.client = client || new SecretManagerServiceClient();
    this.cache = new Map<string, string>();
  }

  /**
   * Retrieves a secret payload from Google Cloud Secret Manager with in-memory caching.
   * @param secretName Fully qualified secret name or secret ID (e.g. projects/my-proj/secrets/hmac-secret/versions/latest)
   */
  public async getSecret(secretName: string): Promise<string> {
    if (!secretName) {
      throw new Error('Secret name must be provided.');
    }

    if (this.cache.has(secretName)) {
      return this.cache.get(secretName)!;
    }

    try {
      const [version] = await this.client.accessSecretVersion({
        name: secretName,
      });

      const payload = version.payload?.data?.toString();
      if (!payload) {
        throw new Error(`Secret ${secretName} payload is empty.`);
      }

      this.cache.set(secretName, payload);
      return payload;
    } catch (error: any) {
      throw new Error(`Failed to retrieve secret from Secret Manager: ${error.message || error}`);
    }
  }

  /**
   * Clears the in-memory secret cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }
}
