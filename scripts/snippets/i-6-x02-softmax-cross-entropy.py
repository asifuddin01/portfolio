"""I.6.X02 — why softmax and cross-entropy are written as one node.

Softmax has a dense Jacobian, diag(p) - p^T p, so composing it with a loss ought
to cost a matrix product. Paired with cross-entropy the product collapses to
p - y, and this run shows the collapse holds exactly, then shows what the
alternative pairing (softmax with squared error) does instead.

Pure Python, no imports.
"""
E = 2.718281828459045


def softmax(z):
    m = max(z)                                  # shift for stability
    ex = [E ** (v - m) for v in z]
    s = sum(ex)
    return [e / s for e in ex]


Z = [2.0, 1.0, 0.1]                             # logits
Y = [1.0, 0.0, 0.0]                             # one-hot target, class 0
P = softmax(Z)

print("logits          " + "  ".join(f"{v:.8f}" for v in Z))
print("p = softmax(z)  " + "  ".join(f"{v:.8f}" for v in P))
print(f"sum p           {sum(P):.8f}")

# -- route 1: the collapsed rule -------------------------------------------
collapsed = [P[i] - Y[i] for i in range(3)]
print()
print("delta = p - y   " + "  ".join(f"{v:+.8f}" for v in collapsed))

# -- route 2: the Jacobian, formed and multiplied ---------------------------
# dL/dp for cross-entropy L = -sum y_i log p_i
dLdp = [-Y[i] / P[i] if Y[i] else 0.0 for i in range(3)]
# softmax Jacobian J[i][j] = p_j (delta_ij - p_i), for dp_j/dz_i
J = [[P[j] * ((1.0 if i == j else 0.0) - P[i]) for j in range(3)] for i in range(3)]
viaJ = [sum(dLdp[j] * J[i][j] for j in range(3)) for i in range(3)]
print("via Jacobian    " + "  ".join(f"{v:+.8f}" for v in viaJ))
print(f"largest gap     {max(abs(a - b) for a, b in zip(collapsed, viaJ)):.2e}")

# -- what the other pairing does -------------------------------------------
print()
print("-- softmax with squared error instead --")
dLdp_sq = [P[i] - Y[i] for i in range(3)]
viaJ_sq = [sum(dLdp_sq[j] * J[i][j] for j in range(3)) for i in range(3)]
print("delta           " + "  ".join(f"{v:+.8f}" for v in viaJ_sq))
print("ratio to p - y  " + "  ".join(f"{a / b:.8f}" for a, b in zip(viaJ_sq, collapsed)))

# -- and how the collapse behaves when the model is confidently wrong -------
print()
print("-- a confidently wrong prediction, true class 2 --")
Zc = [8.0, 0.0, 0.0]
Yc = [0.0, 0.0, 1.0]
Pc = softmax(Zc)
print("p               " + "  ".join(f"{v:.8f}" for v in Pc))
print("delta = p - y   " + "  ".join(f"{v:+.8f}" for v in [Pc[i] - Yc[i] for i in range(3)]))
Jc = [[Pc[j] * ((1.0 if i == j else 0.0) - Pc[i]) for j in range(3)] for i in range(3)]
print(f"softmax slope on the true class  {Jc[2][2]:.8e}")
