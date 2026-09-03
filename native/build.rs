extern crate napi_build;

use rand::RngCore;
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    napi_build::setup();

    println!("cargo:rerun-if-env-changed=POP_VAULT_COMPILED_SALT");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR set by cargo"));
    let dest = out_dir.join("salt_constants.rs");

    let contents = match env::var("POP_VAULT_COMPILED_SALT") {
        Ok(s) if !s.is_empty() => {
            let salt = s.as_bytes();
            let mut mask = vec![0u8; salt.len()];
            rand::thread_rng().fill_bytes(&mut mask);
            let xor: Vec<u8> = salt.iter().zip(mask.iter()).map(|(a, b)| a ^ b).collect();
            format!(
                "static A1: Option<&[u8]> = Some(&{:?});\nstatic B2: Option<&[u8]> = Some(&{:?});\n",
                xor, mask
            )
        }
        _ => {
            println!("cargo:warning=POP_VAULT_COMPILED_SALT not set — building OSS mode (no salt).");
            "static A1: Option<&[u8]> = None;\nstatic B2: Option<&[u8]> = None;\n".to_string()
        }
    };

    fs::write(&dest, contents).expect("write salt_constants.rs");
}
