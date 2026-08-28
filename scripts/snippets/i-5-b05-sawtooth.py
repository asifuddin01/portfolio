"""I.5.B05 — the sawtooth: 2 units per layer deep, 2^k - 1 units wide."""
def relu(v):
    return v if v > 0.0 else 0.0

def tooth(x):          # one triangle, written with exactly two ReLU units
    return 2.0 * relu(x) - 4.0 * relu(x - 0.5)

def compose(x, k):
    for _ in range(k):
        x = tooth(x)
    return x

def pieces(k, per=16):  # count slope sign changes on a grid finer than the pieces
    m = (2 ** k) * per
    slopes = []
    for i in range(m):
        a, b = compose(i / m, k), compose((i + 1) / m, k)
        slopes.append(1 if b > a else -1)
    return 1 + sum(1 for i in range(1, m) if slopes[i] != slopes[i - 1])

print("  k   pieces   deep units (2 per layer)   shallow units needed (pieces-1)")
for k in (1, 2, 3, 4, 6, 8, 10):
    p = pieces(k)
    print(f"{k:>3} {p:>8} {2 * k:>26} {p - 1:>31,}")
print()
print(f"deep    k=10: {2 * 10} hidden units, "
      f"{10 * (1 * 2 + 2 + 2 * 1 + 1):,} parameters")
print(f"shallow k=10: {1023:,} hidden units, "
      f"{1 * 1023 + 1023 + 1023 * 1 + 1:,} parameters")
print(f"check tooth(0.25) = {tooth(0.25):.4f}, tooth(0.5) = {tooth(0.5):.4f}, "
      f"tooth(0.75) = {tooth(0.75):.4f}")
