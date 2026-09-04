"""I.7.X08 — what a larger batch buys, and where it stops buying.

Noise falls as 1/sqrt(B) while arithmetic rises as B, so the returns are
square-root. This prices that, then shows the shape of the critical-batch
argument: past the point where the gradient is already accurate, more examples
per step buy accuracy nobody needed.

Pure Python, no imports.
"""

SIGMA = 1.0                        # per-example gradient standard deviation


def noise(B):
    return SIGMA / B ** 0.5


print(f"{'B':>8} {'std err':>12} {'vs B=1':>10} {'arithmetic':>12} {'error per FLOP':>16}")
base = noise(1)
for B in (1, 4, 16, 64, 256, 1024, 4096):
    n = noise(B)
    print(f"{B:8d} {n:12.6f} {n/base:10.4f} {B:12d} {n * B:16.2f}")

print()
print("the trade, stated twice")
print("  quadrupling B halves the noise and costs 4x the arithmetic")
print(f"  B=1 -> B=4     noise {noise(1):.4f} -> {noise(4):.4f}  ({noise(1)/noise(4):.1f}x better, 4x cost)")
print(f"  B=4 -> B=16    noise {noise(4):.4f} -> {noise(16):.4f}  ({noise(4)/noise(16):.1f}x better, 4x cost)")

print()
print("critical batch: gradient noise against the gradient itself")
GRAD = 1.0                         # signal, held fixed
print(f"{'B':>8} {'noise/signal':>14} {'regime':>34}")
for B in (1, 16, 256, 4096, 65536):
    r = noise(B) / GRAD
    if r > 0.5:
        regime = "noise-dominated: more B helps a lot"
    elif r > 0.05:
        regime = "mixed: linear scaling roughly holds"
    else:
        regime = "signal-dominated: more B buys little"
    print(f"{B:8d} {r:14.6f} {regime:>34}")

print()
print("what that means for a fixed compute budget")
BUDGET = 1_000_000                 # example-visits, however they are spent
print(f"  budget {BUDGET:,} example-visits")
for B in (32, 256, 2048):
    steps = BUDGET // B
    print(f"  B={B:5d}   {steps:8,d} steps   noise/step {noise(B):.5f}")
print("  fewer, cleaner steps or more, noisier ones — the budget does not decide it")
