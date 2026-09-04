"""I.7.B01 — the learning rate at which descent stops converging.

A quadratic loss with a known Hessian, so the threshold 2/lambda_max is exact
rather than empirical. Runs descent either side of it and shows that the
boundary is a change of sign in an exponent: below it the error contracts
geometrically, above it the error grows geometrically, and there is nothing
gradual in between.

Pure Python, no imports.
"""

LAM = (20.0, 0.2)                 # Hessian eigenvalues; the loss is diagonal
START = (1.0, 1.0)                # error from the optimum, which is at 0


def descend(eta, steps):
    """Returns the error norm at each recorded step, by I.7.3."""
    e = list(START)
    out = []
    for t in range(1, steps + 1):
        e = [(1.0 - eta * L) * v for L, v in zip(LAM, e)]
        if t in (1, 5, 10, 50, 100):
            out.append((t, (e[0] ** 2 + e[1] ** 2) ** 0.5))
    return out


lam_max, lam_min = max(LAM), min(LAM)
kappa = lam_max / lam_min
print(f"eigenvalues        {LAM[0]}  {LAM[1]}")
print(f"lambda_max         {lam_max}")
print(f"stability limit    2/lambda_max = {2.0 / lam_max}")
print(f"condition number   kappa = {kappa:.1f}")

print()
print("error norm, by step")
print(f"{'eta':>7}  {'t=1':>12} {'t=5':>12} {'t=10':>12} {'t=50':>12} {'t=100':>14}")
for eta in (0.01, 0.09, 0.0990099, 0.11, 0.2):
    rows = dict(descend(eta, 100))
    cells = "".join(f"{rows[t]:>13.4e}" for t in (1, 5, 10, 50))
    print(f"{eta:7.4f} {cells}{rows[100]:>15.4e}")

print()
print("the per-step multiplier in each eigendirection, |1 - eta*lambda|")
for eta in (0.09, 0.11):
    m = [abs(1.0 - eta * L) for L in LAM]
    print(f"  eta = {eta:.2f}   steep {m[0]:.4f}   flat {m[1]:.4f}   "
          f"{'converges' if max(m) < 1 else 'diverges'}")

print()
print("the best a single scalar rate can do")
eta_star = 2.0 / (lam_max + lam_min)
rate = (kappa - 1.0) / (kappa + 1.0)
print(f"  eta* = 2/(lam_max+lam_min) = {eta_star:.7f}")
print(f"  contraction per step       = {rate:.6f}")
n, x = 0, 1.0                     # count steps rather than import a logarithm
while x > 1e-3:
    x *= rate
    n += 1
print(f"  steps to shrink error 1000x = {n}")
