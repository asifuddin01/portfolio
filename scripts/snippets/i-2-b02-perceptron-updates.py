"""I.2.B02 — the perceptron learning rule, every update shown, to convergence."""
data = [((1.0, 1.0), +1), ((2.0, 0.0), +1), ((-1.0, 0.0), -1), ((0.0, -1.0), -1)]
w = [0.0, 0.0]; b = 0.0
updates = 0
for epoch in range(1, 5):
    changed = False
    print(f"epoch {epoch}")
    for x, y in data:
        margin = y * (w[0] * x[0] + w[1] * x[1] + b)
        if margin <= 0:
            w = [w[0] + y * x[0], w[1] + y * x[1]]; b += y
            updates += 1; changed = True
            print(f"  x={x} y={y:+d}  margin {margin:+.1f}  UPDATE -> w=({w[0]:.1f},{w[1]:.1f}) b={b:.1f}")
        else:
            print(f"  x={x} y={y:+d}  margin {margin:+.1f}  ok")
    if not changed:
        print(f"converged after {updates} updates"); break
