"""I.4.B04 — binary cross-entropy, and why it is computed from logits.

Compares the naive route (sigmoid, then log) with the stable identity
    BCE(z, y) = max(z, 0) - z*y + log(1 + exp(-|z|))
at four logits, including two where the naive route fails outright.
"""
from math import exp, log

def sigmoid(z):
    return 1.0 / (1.0 + exp(-z))

def bce_naive(z, y):
    p = sigmoid(z)                       # may round to exactly 0 or 1
    return -(y * log(p) + (1 - y) * log(1 - p))

def bce_stable(z, y):
    return max(z, 0.0) - z * y + log(1.0 + exp(-abs(z)))

print(f"{'z':>8} {'y':>2} {'sigmoid(z)':>14} {'naive':>14} {'stable':>12}")
for z, y in [(2.0, 1), (0.0, 1), (-5.0, 1), (-50.0, 1), (-800.0, 1), (800.0, 0)]:
    try:
        s = f"{sigmoid(z):.6e}"
    except OverflowError:
        s = "overflow"
    try:
        nv = f"{bce_naive(z, y):.6f}"
    except (ValueError, OverflowError) as err:
        nv = type(err).__name__
    print(f"{z:>8.1f} {y:>2} {s:>14} {nv:>14} {bce_stable(z, y):>12.6f}")

print("\nthe identity, checked where both routes work")
for z, y in [(2.0, 1), (0.0, 1), (-5.0, 1)]:
    a, b = bce_naive(z, y), bce_stable(z, y)
    print(f"  z={z:>5.1f}  naive {a:.10f}  stable {b:.10f}  |diff| {abs(a-b):.2e}")
