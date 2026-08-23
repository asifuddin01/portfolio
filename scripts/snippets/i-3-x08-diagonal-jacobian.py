"""I.3.X08 — an elementwise activation has a diagonal Jacobian; softmax does not."""
from math import exp
def sigmoid(z): return 1.0 / (1.0 + exp(-z))

z = [0.5, -1.0, 2.0]
n = len(z)

# elementwise: J[i][j] is zero off the diagonal, by construction
J_elem = [[(sigmoid(z[i]) * (1 - sigmoid(z[i])) if i == j else 0.0) for j in range(n)]
          for i in range(n)]
print("sigmoid Jacobian")
for r in J_elem: print("  [" + "  ".join(f"{v:+.4f}" for v in r) + "]")
print("  off-diagonal entries:", sum(1 for i in range(n) for j in range(n)
                                     if i != j and J_elem[i][j] != 0.0))

m = max(z); e = [exp(v - m) for v in z]; S = sum(e); a = [v / S for v in e]
J_soft = [[a[i] * ((1.0 if i == j else 0.0) - a[j]) for j in range(n)] for i in range(n)]
print("\nsoftmax Jacobian")
for r in J_soft: print("  [" + "  ".join(f"{v:+.4f}" for v in r) + "]")
print("  off-diagonal entries:", sum(1 for i in range(n) for j in range(n)
                                     if i != j and abs(J_soft[i][j]) > 1e-12))
print("  row sums:", "  ".join(f"{sum(r):+.4f}" for r in J_soft))
