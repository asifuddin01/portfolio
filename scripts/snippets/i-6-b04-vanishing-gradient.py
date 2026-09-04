"""I.6.B04 — how far an adjoint travels through a stack of sigmoid layers.

Builds a chain of scalar sigmoid units, y = sigma(w * a + b) repeated L times,
propagates the adjoint back by (I.6.3), and reports the ratio between the
gradient arriving at layer 1 and the one leaving the loss.

The bound sigma' <= 1/4 makes 4^-L an upper limit on that ratio no matter what
the weights are. The run shows the measured ratio sitting under it, and the
depth at which the ratio falls below fp32's smallest normal number — the point
where the early layers stop moving on real hardware rather than in principle.

Pure Python, no imports, so the numbers do not depend on a library version.
"""

E = 2.718281828459045
FP32_MIN_NORMAL = 1.1754943508222875e-38


def sigmoid(z):
    return 1.0 / (1.0 + E ** -z)


def chain_ratio(depth, w, x0=0.5):
    """Adjoint at layer 1 divided by the adjoint at the loss, for a scalar chain.

    Forward first, keeping every pre-activation, then walk back multiplying by
    the local Jacobian of each node: w for the affine part, sigma' for the
    nonlinearity.
    """
    a = x0
    zs = []
    for _ in range(depth):
        z = w * a
        zs.append(z)
        a = sigmoid(z)

    adjoint = 1.0                      # dL/d(output), normalised
    for z in reversed(zs):
        s = sigmoid(z)
        adjoint *= s * (1.0 - s)       # through the nonlinearity
        adjoint *= w                   # through the weight
    return adjoint


print("w = 1.0 — the slope bound is the only thing shrinking the adjoint")
print(f"{'depth':>6}  {'|ratio|':>14}  {'4^-depth':>14}")
for depth in (1, 2, 5, 10, 20, 40):
    r = abs(chain_ratio(depth, 1.0))
    print(f"{depth:6d}  {r:14.6e}  {4.0 ** -depth:14.6e}")

print()
print("the largest slope any logistic unit has")
z = 0.0
s = sigmoid(z)
print(f"sigma'(0) = {s * (1 - s):.6f}")

print()
print("depth at which the ratio drops below fp32's smallest normal, w = 1.0")
depth = 1
while abs(chain_ratio(depth, 1.0)) > FP32_MIN_NORMAL and depth < 500:
    depth += 1
print(f"first depth with |ratio| < {FP32_MIN_NORMAL:.6e}:  {depth}")
print(f"ratio there: {abs(chain_ratio(depth, 1.0)):.6e}")

print()
print("a larger weight delays it but does not prevent it")
for w in (1.0, 2.0, 4.0, 4.5):
    r10 = abs(chain_ratio(10, w))
    r40 = abs(chain_ratio(40, w))
    print(f"w = {w:4.1f}   depth 10: {r10:12.6e}   depth 40: {r40:12.6e}")
