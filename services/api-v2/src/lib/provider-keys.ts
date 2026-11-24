// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * A user's own provider API keys (ElevenLabs today), stored AES-256-GCM
 * encrypted in public.user_provider_keys. The plaintext key only ever exists
 * in api-v2 memory for the duration of the provider call — it is never
 * logged, never returned to the client (only `last4`), and never sent to a
 * worker.
 *
 * PROVIDER_KEYS_SECRET: any high-entropy string (≥32 chars). It is hashed to a
 * 32-byte AES key, so rotating it makes existing rows undecryptable — users
 * would simply re-enter their key.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { supabase } from '../server.js';

export type ProviderKeyProvider = 'elevenlabs';

function aesKey(): Buffer {
  const secret = process.env.PROVIDER_KEYS_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('PROVIDER_KEYS_SECRET is not configured (min 32 chars)');
  }
  return createHash('sha256').update(secret).digest();
}

export function providerKeysConfigured(): boolean {
  const secret = process.env.PROVIDER_KEYS_SECRET?.trim();
  return Boolean(secret && secret.length >= 32);
}

/** v1.<iv b64>.<tag b64>.<ciphertext b64> */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(blob: string): string {
  const [v, ivB64, tagB64, ctB64] = blob.split('.');
  if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('provider key: unknown format');
  const decipher = createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export async function getUserProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
): Promise<{ key: string; last4: string } | null> {
  if (!providerKeysConfigured()) return null;
  const { data, error } = await supabase
    .from('user_provider_keys')
    .select('ciphertext, last4')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw new Error(`user_provider_keys lookup failed: ${error.message}`);
  if (!data) return null;
  try {
    return { key: decryptSecret(data.ciphertext as string), last4: data.last4 as string };
  } catch {
    // Secret rotated / corrupt row: behave as "no key" so the user re-enters it.
    return null;
  }
}

export async function getUserProviderKeyMeta(
  userId: string,
  provider: ProviderKeyProvider,
): Promise<{ last4: string; updated_at: string } | null> {
  const { data, error } = await supabase
    .from('user_provider_keys')
    .select('last4, updated_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw new Error(`user_provider_keys lookup failed: ${error.message}`);
  return data ? { last4: data.last4 as string, updated_at: data.updated_at as string } : null;
}

export async function saveUserProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  key: string,
): Promise<{ last4: string }> {
  const last4 = key.slice(-4);
  const { error } = await supabase.from('user_provider_keys').upsert(
    {
      user_id: userId,
      provider,
      ciphertext: encryptSecret(key),
      last4,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`user_provider_keys save failed: ${error.message}`);
  return { last4 };
}

export async function deleteUserProviderKey(userId: string, provider: ProviderKeyProvider): Promise<void> {
  const { error } = await supabase
    .from('user_provider_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  if (error) throw new Error(`user_provider_keys delete failed: ${error.message}`);
}

// ── Workspace-shared keys (one ElevenLabs account for a whole team) ─────────

export async function getWorkspaceProviderKey(workspaceId: string, provider: ProviderKeyProvider): Promise<{ key: string; last4: string } | null> {
  if (!providerKeysConfigured()) return null;
  const { data } = await supabase
    .from('workspace_provider_keys')
    .select('ciphertext, last4')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .maybeSingle();
  if (!data) return null;
  try {
    return { key: decryptSecret(data.ciphertext as string), last4: data.last4 as string };
  } catch {
    return null;
  }
}

export async function getWorkspaceProviderKeyMeta(workspaceId: string, provider: ProviderKeyProvider): Promise<{ last4: string; updated_at: string } | null> {
  const { data } = await supabase.from('workspace_provider_keys').select('last4, updated_at').eq('workspace_id', workspaceId).eq('provider', provider).maybeSingle();
  return data ? { last4: data.last4 as string, updated_at: data.updated_at as string } : null;
}

export async function saveWorkspaceProviderKey(workspaceId: string, provider: ProviderKeyProvider, key: string, userId: string): Promise<{ last4: string }> {
  const last4 = key.slice(-4);
  const { error } = await supabase.from('workspace_provider_keys').upsert(
    { workspace_id: workspaceId, provider, ciphertext: encryptSecret(key), last4, updated_by: userId, updated_at: new Date().toISOString() },
    { onConflict: 'workspace_id,provider' },
  );
  if (error) throw new Error(`workspace_provider_keys save failed: ${error.message}`);
  return { last4 };
}

export async function deleteWorkspaceProviderKey(workspaceId: string, provider: ProviderKeyProvider): Promise<void> {
  await supabase.from('workspace_provider_keys').delete().eq('workspace_id', workspaceId).eq('provider', provider);
}
