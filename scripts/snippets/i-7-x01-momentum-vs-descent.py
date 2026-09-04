"""I.7.X01 — momentum against plain descent on the quadratic of I.7.B01.

Same Hessian, same start, same target. The only change is whether the previous
step is remembered. kappa is 100 here rather than B03's 10,000, so the expected
advantage is sqrt(100)/1 = 10x in the asymptotic rates.

Pure Python, no imports.
"""

LAM = (20.0, 0.2)
KAPPA = LAM[0] / LAM[1]
START = (1.0, 1.0)
TARGET = 1e-3
CAP = 200_000


def norm(e):
    return (e[0] ** 2 + e[1] ** 2) ** 0.5


def run(eta, beta):
    e, v, n = list(START), [0.0, 0.0], 0
    while norm(e) > TARGET and n < CAP:
        g = [L * x for L, x in zip(LAM, e)]
        v = [beta * vi + gi for vi, gi in zip(v, g)]
        e = [x - eta * vi for x, vi in zip(e, v)]
        if not all(abs(x) < 1e12 for x in e):
            return None
        n += 1
    return n if n < CAP else None


eta_gd = 2.0 / (LAM[0] + LAM[1])
root = KAPPA ** 0.5
beta_opt = ((root - 1.0) / (root + 1.0)) ** 2
eta_mo = 4.0 / ((LAM[0] ** 0.5 + LAM[1] ** 0.5) ** 2)

print(f"kappa {KAPPA:.0f}   sqrt(kappa) {root:.0f}")
print()
print(f"{'method':28} {'eta':>10} {'beta':>8}  {'steps':>8}  {'rho':>10}")

rows = [
    ("plain descent (beta=0)", eta_gd, 0.0, (KAPPA - 1) / (KAPPA + 1)),
    ("momentum, tuned", eta_mo, beta_opt, (root - 1) / (root + 1)),
    ("momentum, beta=0.9 default", eta_mo, 0.9, None),
    ("momentum, beta=0.9, eta_gd", eta_gd, 0.9, None),
    ("momentum, beta=0.99", eta_mo, 0.99, None),
]
for name, eta, beta, rho in rows:
    n = run(eta, beta)
    r = f"{rho:.6f}" if rho is not None else "-"
    print(f"{name:28} {eta:10.6f} {beta:8.4f}  "
          f"{('diverges' if n is None else format(n, ',d')):>8}  {r:>10}")

gd = run(eta_gd, 0.0)
mo = run(eta_mo, beta_opt)
print()
print(f"tuned momentum speed-up  {gd / mo:.1f}x   (sqrt(kappa) = {root:.0f})")

print()
print("what raising beta does to the effective step, for a steady gradient")
for beta in (0.0, 0.9, 0.99):
    print(f"  beta {beta:5.2f}   buffer settles at g/(1-beta) = {1.0 / (1.0 - beta):6.1f} g")
