"""I.1.B01 — forward pass of a 2-2-1 ReLU network, every intermediate shown.

Row-major throughout: x is a row vector, so a layer is x @ W + b.
"""
def relu(v):        return [max(0.0, t) for t in v]
def matvec(x, W, b): return [sum(x[i] * W[i][j] for i in range(len(x))) + b[j]
                             for j in range(len(b))]

x  = [1.0, 2.0]
W1 = [[1.0, 0.0], [-1.0, 2.0]]; b1 = [0.5, -1.0]
W2 = [[2.0], [1.0]];            b2 = [-1.0]

z1 = matvec(x, W1, b1)
a1 = relu(z1)
z2 = matvec(a1, W2, b2)

print("x  =", "  ".join(f"{v:.4f}" for v in x))
print("z1 =", "  ".join(f"{v:.4f}" for v in z1))
print("a1 =", "  ".join(f"{v:.4f}" for v in a1))
print("z2 =", "  ".join(f"{v:.4f}" for v in z2))
print(f"yhat = {z2[0]:.4f}")
