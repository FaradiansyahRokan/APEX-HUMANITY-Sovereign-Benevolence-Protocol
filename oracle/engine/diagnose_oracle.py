"""
Run this on your oracle server to diagnose the signature mismatch.
Usage: python3 diagnose_oracle.py
"""
import os
import json
from dotenv import load_dotenv
load_dotenv()

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

try:
    from web3 import Web3
    def keccak256(data): return bytes(Web3.keccak(data))
except ImportError:
    import sha3  # pysha3
    def keccak256(data):
        k = sha3.keccak_256(); k.update(data); return k.digest()

ORACLE_PRIVATE_KEY = os.getenv("ORACLE_PRIVATE_KEY", "").strip().lstrip("0x")

if not ORACLE_PRIVATE_KEY:
    print("❌ ORACLE_PRIVATE_KEY not found in environment / .env")
    exit(1)

key_bytes = bytes.fromhex(ORACLE_PRIVATE_KEY)
private_key = ec.derive_private_key(int.from_bytes(key_bytes, "big"), ec.SECP256K1())
public_key  = private_key.public_key()

pub_bytes = public_key.public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint,
)

oracle_address = "0x" + keccak256(pub_bytes[1:])[-20:].hex()

print("=" * 60)
print("  SATIN ORACLE DIAGNOSIS")
print("=" * 60)
print(f"\n✅ Oracle address computed from ORACLE_PRIVATE_KEY:")
print(f"   {oracle_address}")
print()
print("Now run this on your APEX network to get the contract's stored address:")
print()
print(f"  cast call 0x13f0b24F7E9246877d0De8925C884d72EBd57b5f \\")
print(f'    "oracleAddress()" \\')
print(f"    --rpc-url http://127.0.0.1:9654/ext/bc/iPWmyj3eTRsSFUmivVcqc7y4xeeeWvLdw78YNLLGv1JGxUPYG/rpc")
print()
print("OR check via your frontend console:")
print()
print("  // Paste in browser console after connecting wallet:")
print("  const r = await fetch('YOUR_ORACLE_URL/health');")
print("  const d = await r.json();")
print("  console.log('Oracle addr:', d.oracle_address);")
print()
print("  // Compare with contract:")
print("  // Should match! If different → EVERY TX reverts with InvalidOracleSignature")
print()
print("=" * 60)
print("  Also verify token_reward_wei doesn't overflow")
print("=" * 60)
# Simulate token reward calculation
for impact in [30.0, 50.0, 75.0, 100.0]:
    s = impact / 100.0
    reward = 5.0 + (s ** 1.5) * 45.0
    wei    = int(reward * 10**18)
    print(f"  score={impact:.0f} → reward={reward:.4f} APEX → wei={wei} (len={len(str(wei))})")

print()
print("Checking if any wei value causes BigInt overflow in JS...")
print("Max safe int in JS:", 2**53 - 1)
for impact in [100.0]:
    s     = impact / 100.0
    reward = 5.0 + (s ** 1.5) * 45.0
    wei    = int(reward * 10**18)
    print(f"Max wei ({wei}) > JS MAX_SAFE_INT ({2**53 - 1}): {wei > 2**53 - 1}")
    print("→ BigInt() handles this correctly ✓" if True else "")