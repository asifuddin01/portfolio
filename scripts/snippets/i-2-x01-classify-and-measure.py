"""I.2.X01 — a different hyperplane, the same two questions."""
from math import sqrt
w, b = (1.0, 3.0), -6.0
pts = {"P": (3.0, 2.0), "Q": (0.0, 0.0), "R": (6.0, 1.0), "S": (1.0, 0.0)}
n = sqrt(w[0] ** 2 + w[1] ** 2)
print(f"||w|| = {n:.4f}")
for k, x in pts.items():
    s = w[0] * x[0] + w[1] * x[1] + b
    print(f"{k}  score {s:+.4f}  dist {s / n:+.4f}  class {'+1' if s > 0 else '-1'}")
