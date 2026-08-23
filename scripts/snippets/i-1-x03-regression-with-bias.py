"""I.1.X03 — least squares with an intercept, by the two normal equations."""
data = [(1.0, 2.0), (2.0, 4.0), (3.0, 5.0)]
n  = len(data)
Sx = sum(x for x, _ in data); Sy = sum(y for _, y in data)
Sxy = sum(x * y for x, y in data); Sxx = sum(x * x for x, y in data)

w = (n * Sxy - Sx * Sy) / (n * Sxx - Sx * Sx)
b = (Sy - w * Sx) / n
loss = sum((w * x + b - y) ** 2 for x, y in data) / (2 * n)
loss_origin = sum((Sxy / Sxx * x - y) ** 2 for x, y in data) / (2 * n)

print(f"w              {w:.4f}")
print(f"b              {b:.4f}")
for x, y in data:
    print(f"  x={x:.0f}  residual {w * x + b - y:+.4f}")
print(f"loss with bias {loss:.4f}")
print(f"loss origin    {loss_origin:.4f}")
