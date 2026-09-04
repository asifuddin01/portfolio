"""I.6.B01 — one full backward pass through a 2-2-1 network, by hand.

Every number the worked solution quotes is printed here, and the last block
checks the whole gradient against central differences. That check is the point:
a hand-derived gradient and a finite-difference estimate come from completely
different arithmetic, so agreement to six decimals is evidence the derivation
is right rather than merely self-consistent.

Pure Python and no imports, so the numbers do not depend on a library version.
"""

def sigmoid(z):
    # exp without math.exp, to keep this import-free: series is not needed —
    # Python's ** on floats is enough.
    return 1.0 / (1.0 + (2.718281828459045 ** -z))


X = [1.0, 2.0]                      # one example, a row
Y = 1.0                             # target
W1 = [[0.1, 0.3],                   # 2 x 2, rows index inputs
      [0.2, 0.4]]
B1 = [0.0, 0.1]
W2 = [0.5, -0.6]                    # 2 x 1, written flat
B2 = 0.2


def forward(w1, b1, w2, b2):
    """Returns the loss and every intermediate the backward pass will need."""
    z1 = [sum(X[i] * w1[i][j] for i in range(2)) + b1[j] for j in range(2)]
    a1 = [sigmoid(z) for z in z1]
    z2 = sum(a1[j] * w2[j] for j in range(2)) + b2
    loss = 0.5 * (z2 - Y) ** 2
    return loss, z1, a1, z2


loss, z1, a1, z2 = forward(W1, B1, W2, B2)

print("-- forward --")
print(f"z1               {z1[0]:.8f}  {z1[1]:.8f}")
print(f"a1 = sigma(z1)   {a1[0]:.8f}  {a1[1]:.8f}")
print(f"z2 = yhat        {z2:.8f}")
print(f"L                {loss:.8f}")

# -- backward, by (I.6.2): start at 1, multiply by local Jacobians ----------
d2 = z2 - Y                                     # dL/dz2, the head is linear
gW2 = [a1[j] * d2 for j in range(2)]            # (I.6.4): outer product
gB2 = d2
back = [d2 * W2[j] for j in range(2)]           # (I.6.3): travel back through W2
sprime = [a1[j] * (1.0 - a1[j]) for j in range(2)]
d1 = [back[j] * sprime[j] for j in range(2)]    # gate by the slope
gW1 = [[X[i] * d1[j] for j in range(2)] for i in range(2)]
gB1 = d1

print("-- backward --")
print(f"delta2           {d2:.8f}")
print(f"dL/dW2           {gW2[0]:.8f}  {gW2[1]:.8f}")
print(f"dL/db2           {gB2:.8f}")
print(f"sigma'(z1)       {sprime[0]:.8f}  {sprime[1]:.8f}")
print(f"delta1           {d1[0]:.8f}  {d1[1]:.8f}")
print(f"dL/dW1 row 1     {gW1[0][0]:.8f}  {gW1[0][1]:.8f}")
print(f"dL/dW1 row 2     {gW1[1][0]:.8f}  {gW1[1][1]:.8f}")
print(f"dL/db1           {gB1[0]:.8f}  {gB1[1]:.8f}")

# -- the check: central differences on every parameter ----------------------
H = 1e-6


def bump(w1, b1, w2, b2, which, idx, delta):
    """A copy of the parameters with one entry moved by delta."""
    w1 = [row[:] for row in w1]
    b1, w2 = b1[:], w2[:]
    if which == "W1":
        w1[idx[0]][idx[1]] += delta
    elif which == "b1":
        b1[idx] += delta
    elif which == "W2":
        w2[idx] += delta
    else:
        b2 += delta
    return w1, b1, w2, b2


def numeric_grad(which, idx):
    hi = forward(*bump(W1, B1, W2, B2, which, idx, +H))[0]
    lo = forward(*bump(W1, B1, W2, B2, which, idx, -H))[0]
    return (hi - lo) / (2 * H)


checks = [
    ("W1[0][0]", gW1[0][0], numeric_grad("W1", (0, 0))),
    ("W1[0][1]", gW1[0][1], numeric_grad("W1", (0, 1))),
    ("W1[1][0]", gW1[1][0], numeric_grad("W1", (1, 0))),
    ("W1[1][1]", gW1[1][1], numeric_grad("W1", (1, 1))),
    ("b1[0]", gB1[0], numeric_grad("b1", 0)),
    ("b1[1]", gB1[1], numeric_grad("b1", 1)),
    ("W2[0]", gW2[0], numeric_grad("W2", 0)),
    ("W2[1]", gW2[1], numeric_grad("W2", 1)),
    ("b2", gB2, numeric_grad("b2", 0)),
]

print("-- analytic vs central difference --")
worst = 0.0
for name, analytic, numeric in checks:
    gap = abs(analytic - numeric)
    worst = max(worst, gap)
    print(f"{name:9}  {analytic:+.8f}  {numeric:+.8f}")
print(f"largest disagreement  {worst:.2e}")
