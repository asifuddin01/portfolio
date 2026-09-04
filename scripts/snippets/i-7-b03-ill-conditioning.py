"""I.7.B03 — a problem no single learning rate solves, and what fixes it.

Two eigenvalues four orders of magnitude apart. Any rate stable in the steep
direction is far too small for the flat one, and the run below sweeps rates to
show there is no setting that escapes it — the failure is the condition number
itself rather than a badly chosen number.

Then heavy-ball momentum on the same problem, whose rate depends on sqrt(kappa)
rather than kappa, which turns four orders of magnitude into two.

Pure Python, no imports.
"""

LAM = (100.0, 0.01)
KAPPA = LAM[0] / LAM[1]
START = (1.0, 1.0)
TARGET = 1e-3                     # a thousandfold reduction in the error norm
CAP = 2_000_000                   # give up rather than loop forever


def norm(e):
    return (e[0] ** 2 + e[1] ** 2) ** 0.5


def steps_gd(eta):
    """Steps for plain descent to reach TARGET, or None if it diverges."""
    if max(abs(1.0 - eta * L) for L in LAM) >= 1.0:
        return None
    e, n = list(START), 0
    while norm(e) > TARGET and n < CAP:
        e = [(1.0 - eta * L) * v for L, v in zip(LAM, e)]
        n += 1
    return n


def steps_momentum(eta, beta):
    """Same, for v <- beta*v + g ; theta <- theta - eta*v, by (I.7.5)."""
    e, v, n = list(START), [0.0, 0.0], 0
    while norm(e) > TARGET and n < CAP:
        g = [L * x for L, x in zip(LAM, e)]
        v = [beta * vi + gi for vi, gi in zip(v, g)]
        e = [x - eta * vi for x, vi in zip(e, v)]
        if not all(abs(x) < 1e12 for x in e):
            return None
        n += 1
    return n if n < CAP else None


print(f"eigenvalues      {LAM[0]}  {LAM[1]}")
print(f"kappa            {KAPPA:,.0f}")
print(f"stability limit  {2.0 / LAM[0]}")

print()
print("plain descent, swept across the whole stable range")
print(f"{'eta':>10}  {'steep mult':>11} {'flat mult':>11}  {'steps to 1e-3':>14}")
for eta in (0.02, 0.01, 0.0198, 0.019801, 0.0199, 0.02001, 0.05):
    m = [abs(1.0 - eta * L) for L in LAM]
    n = steps_gd(eta)
    print(f"{eta:10.6f}  {m[0]:11.6f} {m[1]:11.6f}  "
          f"{'diverges' if n is None else format(n, ',d'):>14}")

eta_star = 2.0 / (LAM[0] + LAM[1])
rho = (KAPPA - 1.0) / (KAPPA + 1.0)
print()
print("the best plain descent can do")
print(f"  eta*   {eta_star:.8f}")
print(f"  rho    {rho:.8f}")
print(f"  steps  {steps_gd(eta_star):,d}")

# heavy ball, at the classical optimum
root = KAPPA ** 0.5
beta = ((root - 1.0) / (root + 1.0)) ** 2
eta_m = 4.0 / ((LAM[0] ** 0.5 + LAM[1] ** 0.5) ** 2)
rho_m = (root - 1.0) / (root + 1.0)
print()
print("heavy-ball momentum, at its optimum")
print(f"  beta   {beta:.8f}")
print(f"  eta    {eta_m:.8f}")
print(f"  rho    {rho_m:.8f}   (sqrt(kappa) form)")
print(f"  steps  {steps_momentum(eta_m, beta):,d}")

print()
gd = steps_gd(eta_star)
mo = steps_momentum(eta_m, beta)
print(f"speed-up  {gd / mo:.1f}x   against sqrt(kappa) = {root:.0f}")
