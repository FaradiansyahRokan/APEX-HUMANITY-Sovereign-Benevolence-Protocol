"""
Pure-Python Keccak-256 — Ethereum compatible.

Note: Python's hashlib.sha3_256 uses NIST SHA-3 (padding 0x06).
Ethereum uses original Keccak (padding 0x01). They are DIFFERENT.
This module implements the original Keccak used by Ethereum.
"""

# Keccak round constants
RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

# Rotation offsets
ROT = [
    [0,  36,  3, 41, 18],
    [1,  44, 10, 45,  2],
    [62,  6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39,  8, 14],
]


def _rot64(x, n):
    return ((x << n) | (x >> (64 - n))) & 0xFFFFFFFFFFFFFFFF


def _keccak_f(state):
    for rc in RC:
        # Theta
        C = [state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4] for x in range(5)]
        D = [C[(x - 1) % 5] ^ _rot64(C[(x + 1) % 5], 1) for x in range(5)]
        state = [[state[x][y] ^ D[x] for y in range(5)] for x in range(5)]
        # Rho + Pi
        B = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                B[y][(2 * x + 3 * y) % 5] = _rot64(state[x][y], ROT[x][y])
        # Chi
        state = [[B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        # Iota
        state[0][0] ^= rc
    return state


def keccak256(data: bytes) -> bytes:
    """Return 32-byte Keccak-256 digest (Ethereum-compatible)."""
    # Parameters for Keccak-256
    rate    = 1088 // 8   # 136 bytes
    # Pad with 0x01 (Keccak, NOT 0x06 which is NIST SHA-3)
    msg = bytearray(data)
    msg.append(0x01)
    while len(msg) % rate != 0:
        msg.append(0x00)
    msg[-1] |= 0x80

    # Absorb
    state = [[0] * 5 for _ in range(5)]
    for block_start in range(0, len(msg), rate):
        block = msg[block_start: block_start + rate]
        lanes = [int.from_bytes(block[i*8:(i+1)*8], 'little') for i in range(rate // 8)]
        for i, lane in enumerate(lanes):
            x, y = i % 5, i // 5
            state[x][y] ^= lane
        state = _keccak_f(state)

    # Squeeze first 256 bits
    out = b""
    for y in range(5):
        for x in range(5):
            out += state[x][y].to_bytes(8, 'little')
            if len(out) >= 32:
                return out[:32]
    return out[:32]


if __name__ == "__main__":
    # Sanity check against known Keccak-256 vectors
    assert keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    assert keccak256(b"abc").hex() == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    print("✅ Keccak-256 implementation verified")