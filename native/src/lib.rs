use napi::bindgen_prelude::*;
use napi_derive::napi;
use zeroize::Zeroize;

/// XOR-paired salt halves generated at build time by build.rs into $OUT_DIR.
/// Hardened builds (POP_VAULT_COMPILED_SALT set): A1/B2 are Some(&[...]).
/// OSS/source builds: both are None → derive_key returns null.
include!(concat!(env!("OUT_DIR"), "/salt_constants.rs"));

/// Derive AES-256 key from machine_id + username using scrypt.
/// Salt is reconstructed from XOR pairs, used, then zeroed.
/// Returns null if running from OSS source (no compiled salt data).
#[napi]
pub fn derive_key(machine_id: Buffer, username: Buffer) -> Option<Buffer> {
    let (a1, b2) = match (A1, B2) {
        (Some(a), Some(b)) => (a, b),
        _ => return None,
    };

    let mut salt: Vec<u8> = a1.iter().zip(b2.iter()).map(|(a, b)| a ^ b).collect();

    let mut password = Vec::with_capacity(machine_id.len() + 1 + username.len());
    password.extend_from_slice(&machine_id);
    password.push(b':');
    password.extend_from_slice(&username);

    // scrypt: n=2^14, r=8, p=1, dklen=32 (matches Python version)
    let params = scrypt::Params::new(14, 8, 1, 32).expect("valid scrypt params");
    let mut key = vec![0u8; 32];
    scrypt::scrypt(&password, &salt, &params, &mut key).expect("scrypt derivation");

    salt.zeroize();
    password.zeroize();

    Some(Buffer::from(key))
}

/// Return true if this is a hardened build with compiled salt data.
#[napi]
pub fn is_hardened() -> bool {
    A1.is_some()
}
