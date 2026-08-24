"""I.4.B06 — through a sigmoid, MSE's gradient vanishes where cross-entropy's does not."""
from math import exp
def sigmoid(z): return 1.0 / (1.0 + exp(-z))

print(f"{'z':>6} {'p=sigma(z)':>13} {'MSE dL/dz':>13} {'BCE dL/dz':>12} {'ratio':>12}")
for z in (-1.0, -3.0, -5.0, -10.0, -20.0):
    p = sigmoid(z); y = 1.0
    d_mse = (p - y) * p * (1 - p)        # chain rule through sigma'
    d_bce = p - y                        # sigma' cancels
    print(f"{z:>6.1f} {p:>13.6e} {d_mse:>13.6e} {d_bce:>12.6f} {abs(d_bce/d_mse):>12.1f}")

print("\nthe same at a point the model already gets right")
for z in (5.0, 10.0):
    p = sigmoid(z); y = 1.0
    print(f"z={z:>5.1f}  MSE {abs((p-y)*p*(1-p)):.6e}   BCE {abs(p-y):.6e}")
