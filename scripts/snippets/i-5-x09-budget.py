"""I.5.X09 — the same parameter budget, spent on width or on depth."""
from math import comb

def shallow_params(w, d=2, out=1):
    return d * w + w + w * out + out

def deep_params(w, layers=3, d=2, out=1):
    return d * w + w + (layers - 1) * (w * w + w) + w * out + out

def zas(n, d=2):
    return sum(comb(n, i) for i in range(d + 1))

BUDGET = 10_000
w1 = max(w for w in range(1, 5000) if shallow_params(w) <= BUDGET)
w3 = max(w for w in range(1, 5000) if deep_params(w) <= BUDGET)
print(f"budget {BUDGET:,} parameters, input dimension 2, one output")
print(f"  1 hidden layer  x {w1:>4}: {shallow_params(w1):>6,} params, "
      f"at most  {zas(w1):>15,} regions")
r3 = (w3 // 2) ** (2 * 2) * zas(w3)
print(f"  3 hidden layers x {w3:>4}: {deep_params(w3):>6,} params, "
      f"at least {r3:>15,} regions")
print(f"  ratio: {r3 / zas(w1):,.0f}x more regions for the same money")
