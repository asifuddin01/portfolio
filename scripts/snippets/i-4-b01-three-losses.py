"""I.4.B01 — MSE, MAE and Huber on five residuals, one of them an outlier.

Prints each per-residual contribution, the totals, each loss's share taken by
the outlier alone, and the derivative each loss sends back for that residual.
"""
r = [0.5, -0.8, 0.2, -0.3, 4.0]
n, delta = len(r), 1.0

def huber(t):
    a = abs(t)
    return 0.5 * t * t if a <= delta else delta * (a - 0.5 * delta)

def d_huber(t):
    a = abs(t)
    return t if a <= delta else delta * (1.0 if t > 0 else -1.0)

print(f"{'r':>6} {'r^2':>9} {'|r|':>8} {'huber':>9}")
for t in r:
    print(f"{t:>6.1f} {t*t:>9.4f} {abs(t):>8.4f} {huber(t):>9.4f}")

S2, S1, SH = sum(t*t for t in r), sum(abs(t) for t in r), sum(huber(t) for t in r)
print(f"\n{'sum':>6} {S2:>9.4f} {S1:>8.4f} {SH:>9.4f}")
print(f"{'mean':>6} {S2/n:>9.4f} {S1/n:>8.4f} {SH/n:>9.4f}")

out = r[-1]
print(f"\noutlier share of the total")
print(f"  MSE    {out*out/S2*100:>6.1f}%")
print(f"  MAE    {abs(out)/S1*100:>6.1f}%")
print(f"  Huber  {huber(out)/SH*100:>6.1f}%")

print(f"\nderivative sent back for the outlier (per-example, before the 1/n)")
print(f"  MSE    {2*out:>8.4f}")
print(f"  MAE    {1.0:>8.4f}")
print(f"  Huber  {d_huber(out):>8.4f}")

r2 = r[:-1]
print(f"\nwithout the outlier: MSE {sum(t*t for t in r2)/4:.4f}  "
      f"MAE {sum(abs(t) for t in r2)/4:.4f}  Huber {sum(huber(t) for t in r2)/4:.4f}")
