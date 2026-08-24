"""I.4.B03 — softmax + cross-entropy: the gradient collapses to p - y."""
from math import exp, log

z, true = [2.0, 1.0, 0.0], 0
m = max(z); e = [exp(v - m) for v in z]; S = sum(e); p = [v / S for v in e]
y = [1.0 if k == true else 0.0 for k in range(3)]

print("exponentials (shifted by the max, 0.NU.02)")
for k, (v, ev) in enumerate(zip(z, e)):
    print(f"  z{k} = {v:+.1f}   exp(z{k} - {m:.0f}) = {ev:.6f}")
print(f"  sum S = {S:.6f}")
print("\np = softmax(z)")
for k, v in enumerate(p): print(f"  p{k} = {v:.4f}")
print(f"  sum   = {sum(p):.4f}")
print(f"\nloss = -log p[{true}] = {-log(p[true]):.4f}")

# the full Jacobian, then the chain rule through it
J = [[p[i] * ((1.0 if i == j else 0.0) - p[j]) for j in range(3)] for i in range(3)]
print("\nsoftmax Jacobian  dp_i/dz_j")
for row in J: print("  [" + "  ".join(f"{v:+.4f}" for v in row) + "]")

dL_dp = [-(y[k] / p[k]) for k in range(3)]
print("\ndL/dp")
for k, v in enumerate(dL_dp): print(f"  {v:+.4f}")

dL_dz = [sum(dL_dp[i] * J[i][j] for i in range(3)) for j in range(3)]
print("\ndL/dz  by the full chain rule")
for k, v in enumerate(dL_dz): print(f"  {v:+.4f}")
print("dL/dz  as p - y")
for k in range(3): print(f"  {p[k] - y[k]:+.4f}")
print(f"\nagreement: {all(abs(dL_dz[k] - (p[k]-y[k])) < 1e-12 for k in range(3))}")
print(f"sum of dL/dz = {sum(dL_dz):+.4f}")
