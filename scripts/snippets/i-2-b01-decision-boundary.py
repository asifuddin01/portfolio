"""I.2.B01 — signed distances from four points to one hyperplane."""
from math import sqrt
w, b = (2.0, -1.0), -1.0
pts = {"A": (2.0, 1.0), "B": (0.0, 1.0), "C": (1.0, -1.0), "D": (0.0, 3.0)}
norm = sqrt(w[0] ** 2 + w[1] ** 2)
print(f"||w|| = {norm:.4f}")
for name, x in pts.items():
    score = w[0] * x[0] + w[1] * x[1] + b
    print(f"{name}  score {score:+.4f}   dist {score / norm:+.4f}   class {'+1' if score > 0 else '-1'}")
