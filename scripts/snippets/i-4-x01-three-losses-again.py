"""I.4.X01 — the three losses on a set with two moderate outliers."""
r = [1.0, -1.5, 0.4, -2.5, 0.1]
n, delta = len(r), 1.0
def huber(t):
    a = abs(t)
    return 0.5 * t * t if a <= delta else delta * (a - 0.5 * delta)
print(f"{'r':>6} {'r^2':>8} {'|r|':>7} {'huber':>8}  branch")
for t in r:
    print(f"{t:>6.1f} {t*t:>8.4f} {abs(t):>7.4f} {huber(t):>8.4f}  "
          f"{'quadratic' if abs(t) <= delta else 'linear'}")
S2, S1, SH = sum(t*t for t in r), sum(abs(t) for t in r), sum(huber(t) for t in r)
print(f"\n{'sum':>6} {S2:>8.4f} {S1:>7.4f} {SH:>8.4f}")
print(f"{'mean':>6} {S2/n:>8.4f} {S1/n:>7.4f} {SH/n:>8.4f}")
print(f"\nshare taken by the two |r|>1 residuals")
big = [t for t in r if abs(t) > delta]
print(f"  MSE   {sum(t*t for t in big)/S2*100:5.1f}%")
print(f"  MAE   {sum(abs(t) for t in big)/S1*100:5.1f}%")
print(f"  Huber {sum(huber(t) for t in big)/SH*100:5.1f}%")
