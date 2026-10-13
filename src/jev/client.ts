import { TypeSafeClient } from '@typesafe-ai/sdk';

/**
 * Singleton TypeSafe Jev client.
 * Reads TYPESAFE_API_KEY from environment.
 * Pin model via TYPESAFE_DEFAULT_MODEL or constructor.
 */
let client: TypeSafeClient | null = null;

export function getJevClient(): TypeSafeClient {
  if (!client) {
    if (!process.env.TYPESAFE_API_KEY) {
      throw new Error(
        'TYPESAFE_API_KEY is not set. Copy .env.example to .env and add your key from https://typesafe.ai'
      );
    }
    client = new TypeSafeClient({
      defaultModel: process.env.TYPESAFE_DEFAULT_MODEL || 'jev-latest',
    });
  }
  return client;
}
