"""I.5.B01 — the activation pattern names which affine map the network applies."""
W1 = [[1.0, -1.0, 0.5], [0.5, 1.0, -1.0]]
b1 = [-0.5, 0.25, 0.0]
W2 = [2.0, -1.0, 1.5]
b2 = 0.75

def forward(x):
    z = [sum(x[i] * W1[i][j] for i in range(2)) + b1[j] for j in range(3)]
    a = [max(0.0, t) for t in z]
    return z, a, sum(a[j] * W2[j] for j in range(3)) + b2

def effective(mask):
    W = [sum(W1[i][j] * mask[j] * W2[j] for j in range(3)) for i in range(2)]
    return W, sum(b1[j] * mask[j] * W2[j] for j in range(3)) + b2

for x in ([1.0, 2.0], [1.2, 2.5], [-1.0, 0.0]):
    z, a, y = forward(x)
    mask = [1 if t > 0 else 0 for t in z]
    We, be = effective(mask)
    print(f"x = ({x[0]:+.4f}, {x[1]:+.4f})")
    print("  z       = " + "  ".join(f"{t:+.4f}" for t in z))
    print("  a       = " + "  ".join(f"{t:+.4f}" for t in a))
    print(f"  pattern = {''.join(str(m) for m in mask)}   yhat = {y:+.4f}")
    print(f"  region  : yhat = {We[0]:+.4f}*x1 {We[1]:+.4f}*x2 {be:+.4f}"
          f"  -> {We[0]*x[0] + We[1]*x[1] + be:+.4f}")
