"""I.4.X09 — focal loss: the modulating factor, and the gradient it produces."""
from math import log, exp
def sigmoid(z): return 1.0 / (1.0 + exp(-z))

print("modulating factor (1 - p_t)^gamma")
print(f"{'p_t':>6} {'g=0':>8} {'g=1':>8} {'g=2':>8} {'g=5':>10}")
for pt in (0.1, 0.5, 0.9, 0.99):
    row = "  ".join(f"{(1-pt)**g:8.5f}" for g in (0, 1, 2, 5))
    print(f"{pt:>6.2f} {row}")

print("\nbinary focal loss and its gradient in z, y = 1, gamma = 2")
g = 2.0
print(f"{'z':>6} {'p':>9} {'CE':>9} {'FL':>10} {'dCE/dz':>10} {'dFL/dz':>11}")
for z in (-4.0, -2.0, 0.0, 2.0, 4.0):
    p = sigmoid(z); y = 1.0
    ce = -log(p)
    fl = -((1 - p) ** g) * log(p)
    d_ce = p - y
    # d/dz of -(1-p)^g log p, with dp/dz = p(1-p)
    d_fl = ((1 - p) ** g) * (g * p * log(p) + p - 1)
    print(f"{z:>6.1f} {p:>9.5f} {ce:>9.5f} {fl:>10.6f} {d_ce:>10.5f} {d_fl:>11.6f}")
