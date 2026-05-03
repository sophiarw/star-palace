# AES-GCM demo using cryptography library
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

def encrypt(key, plaintext, aad=b""):
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext, aad)
    return nonce + ct

def decrypt(key, blob, aad=b""):
    nonce, ct = blob[:12], blob[12:]
    return AESGCM(key).decrypt(nonce, ct, aad)

if __name__ == "__main__":
    key = AESGCM.generate_key(bit_length=256)
    blob = encrypt(key, b"meet at dawn")
    print(decrypt(key, blob))
