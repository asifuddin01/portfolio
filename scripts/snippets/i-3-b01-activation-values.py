"""I.3.B01 — five activations at five points, to 4 d.p."""
from math import exp, tanh, erf, sqrt

def sigmoid(z): return 1.0 / (1.0 + exp(-z))
def relu(z):    return max(0.0, z)
def lrelu(z):   return z if z > 0 else 0.01 * z
def gelu(z):    return 0.5 * z * (1.0 + erf(z / sqrt(2.0)))

print(f"{'z':>6}  {'sigmoid':>9} {'tanh':>9} {'ReLU':>9} {'LeakyReLU':>10} {'GELU':>9}")
for z in (-2.0, -0.5, 0.0, 0.5, 2.0):
    print(f"{z:>6.1f}  {sigmoid(z):>9.4f} {tanh(z):>9.4f} {relu(z):>9.4f} "
          f"{lrelu(z):>10.4f} {gelu(z):>9.4f}")
