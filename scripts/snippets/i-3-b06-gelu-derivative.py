"""I.3.B06 — the GELU derivative, and how it differs from ReLU near the origin."""
from math import exp, erf, sqrt, pi

def Phi(z):  return 0.5 * (1.0 + erf(z / sqrt(2.0)))
def phi(z):  return exp(-z * z / 2.0) / sqrt(2.0 * pi)
def gelu(z): return z * Phi(z)
def dgelu(z): return Phi(z) + z * phi(z)
def drelu(z): return 1.0 if z > 0 else 0.0

print(f"{'z':>6} {'GELU':>9} {'dGELU':>9} {'dReLU':>7}")
for z in (-3.0, -1.0, -0.5, 0.0, 0.5, 1.0, 3.0):
    print(f"{z:>6.1f} {gelu(z):>9.4f} {dgelu(z):>9.4f} {drelu(z):>7.1f}")
lo = min(dgelu(z / 1000.0) for z in range(-3000, 1))
print(f"\nmost negative dGELU  {lo:.4f}")
print(f"dGELU(0)             {dgelu(0.0):.4f}   dReLU(0) undefined")
