"""Reproduction snippet for II.3.B01 — scaled dot-product attention, T = 3, d_k = 2.

Prints every intermediate the worked solution states, to four decimal places.
Pure standard library: the point is that the arithmetic is checkable, not that
a framework agrees with itself.
"""
from math import exp, sqrt

Q = [[1, 0], [0, 1], [1, 1]]
K = [[1, 0], [0, 1], [1, 1]]
V = [[1, 0], [0, 1], [1, 1]]
d_k = 2


def show(name, M):
    print(name)
    for row in M:
        print("  [" + "  ".join(f"{v:.4f}" for v in row) + "]")


S = [[sum(q[i] * k[i] for i in range(d_k)) for k in K] for q in Q]
show("S = Q K^T", S)

Z = [[s / sqrt(d_k) for s in row] for row in S]
show("Z = S / sqrt(d_k)", Z)

A = []
for row in Z:
    m = max(row)
    e = [exp(z - m) for z in row]
    total = sum(e)
    A.append([v / total for v in e])
show("A = softmax(Z), row-wise", A)

print("row sums")
for r in A:
    print(f"  {sum(r):.4f}")

O = [[sum(a[j] * V[j][c] for j in range(3)) for c in range(2)] for a in A]
show("O = A V", O)
