"""I.2.X09 — the subgradient of the perceptron loss, on both branches."""
def loss(w, b, x, y):     return max(0.0, -(y * (w[0]*x[0] + w[1]*x[1] + b)))
def subgrad(w, b, x, y, alpha=1.0):
    m = y * (w[0]*x[0] + w[1]*x[1] + b)
    if m > 0:  return (0.0, 0.0), 0.0
    return (-alpha*y*x[0], -alpha*y*x[1]), -alpha*y

for w, b, x, y, label in [
    ([2.0, 1.0], 0.0, (1.0, 1.0), +1, "correct, m>0"),
    ([2.0, 1.0], 0.0, (-1.0, -1.0), +1, "wrong,   m<0"),
    ([1.0, -1.0], 0.0, (1.0, 1.0), +1, "kink,    m=0"),
]:
    m = y * (w[0]*x[0] + w[1]*x[1] + b)
    g, gb = subgrad(w, b, x, y)
    print(f"{label}  m={m:+.1f}  loss={loss(w,b,x,y):.1f}  dW=({g[0]:+.1f},{g[1]:+.1f})  db={gb:+.1f}")
