"""I.7.X02 — what bias correction corrects, measured on the first steps.

A moving average initialised at zero is biased towards zero, and the bias is
worst at the start. With beta2 = 0.999 the raw second moment after one step is a
thousandth of its target, so its square root is about a thirtieth — and Adam
divides by that, making the first step roughly thirty times too large.

Pure Python, no imports.
"""

B1, B2, EPS = 0.9, 0.999, 1e-8
G = 0.1                            # a steady gradient, same every step

m = v = 0.0
print(f"steady gradient g = {G}")
print()
print(f"{'t':>4} {'m_raw':>12} {'m_hat':>12} {'v_raw':>14} {'v_hat':>12} "
      f"{'step_raw':>12} {'step_hat':>12}")
for t in range(1, 11):
    m = B1 * m + (1 - B1) * G
    v = B2 * v + (1 - B2) * G * G
    mh = m / (1 - B1 ** t)
    vh = v / (1 - B2 ** t)
    raw = m / (v ** 0.5 + EPS)
    cor = mh / (vh ** 0.5 + EPS)
    print(f"{t:4d} {m:12.8f} {mh:12.8f} {v:14.10f} {vh:12.8f} "
          f"{raw:12.6f} {cor:12.6f}")

print()
print("the first step, which is where it matters")
m1 = (1 - B1) * G
v1 = (1 - B2) * G * G
print(f"  m after 1 step, raw      {m1:.8f}   target {G:.8f}   ratio {m1/G:.4f}")
print(f"  v after 1 step, raw      {v1:.10f}  target {G*G:.8f}  ratio {v1/(G*G):.6f}")
print(f"  sqrt(v) raw / target     {(v1 ** 0.5) / G:.6f}")
print(f"  uncorrected step         {m1 / (v1 ** 0.5 + EPS):.6f}")
print(f"  corrected step           {(m1/(1-B1)) / ((v1/(1-B2)) ** 0.5 + EPS):.6f}")
ratio = (m1 / (v1 ** 0.5)) / ((m1 / (1 - B1)) / ((v1 / (1 - B2)) ** 0.5))
print(f"  ratio                    {ratio:.4f}x too LARGE, not too small")
print("  (v is biased towards zero harder than m is, and it sits in the")
print("   denominator, so the uncorrected step is inflated rather than shrunk)")

print()
print("how long the correction still matters, as 1 - beta^t")
for t in (1, 10, 100, 1000, 5000):
    print(f"  t={t:5d}   1-b1^t {1-B1**t:.8f}   1-b2^t {1-B2**t:.8f}")
