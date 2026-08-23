"""I.2.X02 — all 24 presentation orders of one separable set.

Reports how many updates each order costs and which hyperplane it lands on,
together with the Novikoff bound that every order must respect.
"""
from itertools import permutations
from math import sqrt, sin, cos, pi

data = [((1.0, 1.0), +1), ((-2.0, 0.0), +1), ((2.0, 1.0), -1), ((1.0, 0.0), -1)]

def run(order):
    w, b, u = [0.0, 0.0], 0.0, 0
    for _ in range(200):
        changed = False
        for x, y in order:
            if y * (w[0] * x[0] + w[1] * x[1] + b) <= 0:
                w = [w[0] + y * x[0], w[1] + y * x[1]]; b += y; u += 1; changed = True
        if not changed:
            return u, (w[0], w[1], b)
    return None

outcomes = {}
for p in permutations(range(4)):
    u, sol = run([data[i] for i in p])
    outcomes.setdefault((u, sol), []).append(p)

for (u, sol), orders in sorted(outcomes.items()):
    print(f"updates {u:>2}   w=({sol[0]:+.0f},{sol[1]:+.0f}) b={sol[2]:+.0f}   {len(orders):>2} of 24 orders")

counts = [u for (u, _) in outcomes]
print(f"\nrange: {min(counts)} to {max(counts)} updates on identical data")

# The bound every one of them obeys. Parametrising the unit normal by an
# angle makes the search one-dimensional in direction: for a fixed direction
# the best offset is halfway between the two nearest opposing projections, so
# the margin follows in closed form and no grid over (w, b) is needed.
R = max(sqrt(x[0] ** 2 + x[1] ** 2) for x, _ in data)
best = 0.0
STEPS = 20000
for t in range(STEPS):
    th = 2 * pi * t / STEPS
    u_, v_ = cos(th), sin(th)
    proj_pos = min(u_ * x[0] + v_ * x[1] for x, y in data if y > 0)
    proj_neg = max(u_ * x[0] + v_ * x[1] for x, y in data if y < 0)
    m = (proj_pos - proj_neg) / 2          # half the gap, at the best offset
    if m > best: best = m
print(f"R = {R:.4f}   gamma = {best:.4f}   bound = {(R / best) ** 2:.1f}")
