// Stores, reads and deletes a throwaway key through achat's own key functions.
// Used by CI on macOS and Linux: npx tsx scripts/keystore-check.ts
const { storeApiKey, resolveApiKey, deleteApiKey } = await import("../src/config.ts");
const { keyStore } = await import("../src/keystore.ts");

const account = `ci-roundtrip-${process.pid}`;
const key = `test-key-${Date.now()}`;
const store = await keyStore();
console.log('store:', store?.label ?? 'none');
if (!store) process.exit(process.env.EXPECT_NO_KEYRING ? 0 : 1);

await storeApiKey(account, key);
const read = await resolveApiKey(`keychain:${account}`);
if (read !== key) throw new Error(`read back ${JSON.stringify(read)}, expected the stored key`);
await deleteApiKey(account);
await deleteApiKey(account); // deleting twice must not fail
try {
  await resolveApiKey(`keychain:${account}`);
  throw new Error('key still there after delete');
} catch (error) {
  if (!String((error as Error).message).startsWith('No key in the')) throw error;
}
console.log('round trip ok');
