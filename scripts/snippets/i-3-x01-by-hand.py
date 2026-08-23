"""I.3.X01 — sigmoid and tanh at three points, and the identity linking them."""
from math import exp, tanh
def sigmoid(z): return 1.0 / (1.0 + exp(-z))
for z in (-1.0, 0.0, 1.5):
    s, t = sigmoid(z), tanh(z)
    via = 2 * sigmoid(2 * z) - 1
    print(f"z={z:>5.1f}  sigma={s:.4f}  tanh={t:.4f}  2*sigma(2z)-1={via:.4f}  "
          f"dsigma={s*(1-s):.4f}  dtanh={1-t*t:.4f}")
