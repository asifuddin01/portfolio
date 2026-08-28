"""I.5.X08 — a dense layer is memory-bound until the batch is large."""
D_IN = D_OUT = 1024
BYTES = 4                      # fp32

def intensity(B):
    flops = 2 * B * D_IN * D_OUT
    moved = BYTES * (D_IN * D_OUT + B * D_IN + B * D_OUT)   # weights + in + out
    return flops, moved, flops / moved

print(f"one dense layer, {D_IN} -> {D_OUT}, weights {D_IN * D_OUT:,} floats")
print("   B        FLOPs         bytes moved   FLOP/byte")
for B in (1, 2, 8, 32, 128, 256, 1024):
    f, m, r = intensity(B)
    print(f"{B:>4} {f:>13,} {m:>17,} {r:>11.3f}")
print("\nweight bytes as a share of all traffic")
for B in (1, 32, 256):
    print(f"  B = {B:>4}: "
          f"{100 * D_IN * D_OUT / (D_IN * D_OUT + B * D_IN + B * D_OUT):.1f}%")
