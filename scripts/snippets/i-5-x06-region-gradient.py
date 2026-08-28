"""I.5.X06 — inside a region the gradient is W1 D W2, and the off unit gets nothing."""
W1 = [[1.0, -1.0, 0.5], [0.5, 1.0, -1.0]]
b1 = [-0.5, 0.25, 0.0]
W2 = [2.0, -1.0, 1.5]
b2 = 0.75
H = 1e-6

def f(x, W=W1):
    z = [sum(x[i] * W[i][j] for i in range(2)) + b1[j] for j in range(3)]
    return sum(max(0.0, z[j]) * W2[j] for j in range(3))+ b2

x = [1.0, 2.0]
z = [sum(x[i] * W1[i][j] for i in range(2)) + b1[j] for j in range(3)]
D = [1.0 if t > 0.0 else 0.0 for t in z]
closed = [sum(W1[i][j] * D[j] * W2[j] for j in range(3)) for i in range(2)]
numeric = []
for i in range(2):
    hi = [x[0], x[1]]; lo = [x[0], x[1]]
    hi[i] += H; lo[i] -= H
    numeric.append((f(hi) - f(lo)) / (2 * H))
print("pattern      ", "".join(str(int(t)) for t in D))
print("W1 D W2      ", "  ".join(f"{v:+.4f}" for v in closed))
print("central diff ", "  ".join(f"{v:+.4f}" for v in numeric))

print("\ngradient reaching each column of W1 (finite difference on W1[0][j]):")
for j in range(3):
    hi = [r[:] for r in W1]; lo = [r[:] for r in W1]
    hi[0][j] += H; lo[0][j] -= H
    g = (f(x, hi) - f(x, lo)) / (2 * H)
    print(f"  unit {j + 1} ({'on ' if D[j] else 'off'}): {g:+.4f}")
