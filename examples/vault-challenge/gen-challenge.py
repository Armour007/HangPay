"""
pop-pay Vault Challenge Generator (Python)
Generates a byte-identical challenge artifact for Tier 3 bounty testing.
Requires: pip install cryptography
"""

import os
import json
import hashlib
from datetime import datetime
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def generate():
    salt = os.urandom(32)
    nonce = os.urandom(12)
    passphrase = os.urandom(32)  # Discarded after use
    flag_hex = os.urandom(8).hex()
    flag = f"POPPAY_CHALLENGE_FLAG_2026_04_{flag_hex}"

    # scrypt: N=2^17 (131072), r=8, p=1, dklen=32
    key = hashlib.scrypt(passphrase, salt=salt, n=2**17, r=8, p=1, dklen=32)

    aesgcm = AESGCM(key)
    plaintext = json.dumps({
        "card": "4111111111111111",
        "cvv": "123",
        "holder": "CANARY TESTER",
        "flag": flag
    }).encode('utf-8')

    # cryptography's AESGCM returns ciphertext + tag
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext, None)

    # Binary Format: salt(32) + nonce(12) + ciphertext + tag(16)
    blob = salt + nonce + ciphertext_with_tag

    with open('vault.enc.challenge', 'wb') as f:
        f.write(blob)

    meta = {
        "algo": "aes-256-gcm",
        "kdf": "scrypt",
        "kdf_params": {"N": 131072, "r": 8, "p": 1, "dkLen": 32},
        "flag_prefix": "POPPAY_CHALLENGE_FLAG_2026_04_",
        "created_at": datetime.utcnow().isoformat() + "Z"
    }

    with open('vault.enc.challenge.meta.json', 'w') as f:
        json.dump(meta, f, indent=2)

    print("Challenge artifact created: vault.enc.challenge")
    print(f"Flag Prefix: {meta['flag_prefix']}")
    print("Note: Passphrase was discarded. Good luck.")


if __name__ == "__main__":
    generate()
