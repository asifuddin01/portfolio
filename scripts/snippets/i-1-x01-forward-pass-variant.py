"""I.1.X01 — the same 2-2-1 network on a different input."""
def relu(v): return [max(0.0, t) for t in v]
def layer(x, W, b): return [sum(x[i] * W[i][j] for i in range(len(x))) + b[j]
                            for j in range(len(b))]
x  = [2.0, 1.0]
W1 = [[1.0, 0.0], [-1.0, 2.0]]; b1 = [0.5, -1.0]
W2 = [[2.0], [1.0]];            b2 = [-1.0]
z1 = layer(x, W1, b1); a1 = relu(z1); z2 = layer(a1, W2, b2)
print("z1 =", "  ".join(f"{v:.4f}" for v in z1))
print("a1 =", "  ".join(f"{v:.4f}" for v in a1))
print(f"yhat = {z2[0]:.4f}")
print("dead units:", sum(1 for v in a1 if v == 0.0))
