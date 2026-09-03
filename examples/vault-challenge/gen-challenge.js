/**
 * pop-pay Vault Challenge Generator (Node.js)
 * Generates a byte-identical challenge artifact for Tier 3 bounty testing.
 * Requires: Node 18+
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

function generate() {
  const salt = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const passphrase = crypto.randomBytes(32); // Discarded after use
  const flagHex = crypto.randomBytes(8).toString('hex');
  const flag = `POPPAY_CHALLENGE_FLAG_2026_04_${flagHex}`;

  // scrypt: N=2^17 (131072) is specifically for the challenge (harder than production 2^14)
  // maxmem must exceed 128 * N * r bytes (≈128MB for N=2^17, r=8)
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const plaintext = JSON.stringify({
    card: '4111111111111111',
    cvv: '123',
    holder: 'CANARY TESTER',
    flag: flag
  });

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt(32) + nonce(12) + ciphertext + tag(16)
  const blob = Buffer.concat([salt, nonce, ciphertext, tag]);

  fs.writeFileSync('vault.enc.challenge', blob);

  const meta = {
    algo: 'aes-256-gcm',
    kdf: 'scrypt',
    kdf_params: { N: 131072, r: 8, p: 1, dkLen: 32 },
    flag_prefix: 'POPPAY_CHALLENGE_FLAG_2026_04_',
    created_at: new Date().toISOString()
  };

  fs.writeFileSync('vault.enc.challenge.meta.json', JSON.stringify(meta, null, 2));

  console.log(`Challenge artifact created: vault.enc.challenge`);
  console.log(`Flag Prefix: ${meta.flag_prefix}`);
  console.log(`Note: Passphrase was discarded. Good luck.`);
}

generate();
