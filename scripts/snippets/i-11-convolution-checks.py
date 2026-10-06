"""Reproduce Chapter I.11 with the Python standard library only.

The forward/backward routines use one channel; channel and batch axes add sums.
Central differences check every input, kernel and bias derivative for both
valid convolution and a padded, strided, dilated case.
"""
from copy import deepcopy
from math import isclose


def output_size(n, k, stride=1, padding=0, dilation=1):
    return (n + 2 * padding - dilation * (k - 1) - 1) // stride + 1


def correlate(x, k, bias=0, stride=1, padding=0, dilation=1):
    h, w = len(x), len(x[0])
    kh, kw = len(k), len(k[0])
    oh = output_size(h, kh, stride, padding, dilation)
    ow = output_size(w, kw, stride, padding, dilation)
    y = [[bias for _ in range(ow)] for _ in range(oh)]
    for i in range(oh):
        for j in range(ow):
            for u in range(kh):
                for v in range(kw):
                    a = i * stride - padding + u * dilation
                    b = j * stride - padding + v * dilation
                    if 0 <= a < h and 0 <= b < w:
                        y[i][j] += x[a][b] * k[u][v]
    return y


def backward(x, k, g, stride=1, padding=0, dilation=1):
    h, w = len(x), len(x[0])
    kh, kw = len(k), len(k[0])
    dx = [[0 for _ in range(w)] for _ in range(h)]
    dk = [[0 for _ in range(kw)] for _ in range(kh)]
    db = 0
    for i in range(len(g)):
        for j in range(len(g[0])):
            db += g[i][j]
            for u in range(kh):
                for v in range(kw):
                    a = i * stride - padding + u * dilation
                    b = j * stride - padding + v * dilation
                    if 0 <= a < h and 0 <= b < w:
                        dk[u][v] += g[i][j] * x[a][b]
                        dx[a][b] += g[i][j] * k[u][v]
    return dx, dk, db


def dot(a, b):
    return sum(x * y for ar, br in zip(a, b) for x, y in zip(ar, br))


def check(label, actual, expected):
    assert actual == expected, (label, actual, expected)
    print(f"{label}: {actual}")


def finite_difference_check(x, k, bias=0.3, **options):
    y = correlate(x, k, bias, **options)
    g = [[(i + 1) * 0.3 - (j + 1) * 0.2
          for j in range(len(y[0]))] for i in range(len(y))]
    dx, dk, db = backward(x, k, g, **options)
    h = 1e-6
    for which, values, gradients in (("x", x, dx), ("k", k, dk)):
        for i, row in enumerate(values):
            for j in range(len(row)):
                plus, minus = deepcopy(values), deepcopy(values)
                plus[i][j] += h
                minus[i][j] -= h
                if which == "x":
                    fp = dot(correlate(plus, k, bias, **options), g)
                    fm = dot(correlate(minus, k, bias, **options), g)
                else:
                    fp = dot(correlate(x, plus, bias, **options), g)
                    fm = dot(correlate(x, minus, bias, **options), g)
                assert isclose((fp - fm) / (2 * h), gradients[i][j],
                               rel_tol=1e-7, abs_tol=1e-7)
    fp = dot(correlate(x, k, bias + h, **options), g)
    fm = dot(correlate(x, k, bias - h, **options), g)
    assert isclose((fp - fm) / (2 * h), db, rel_tol=1e-7, abs_tol=1e-7)
    # Zero-bias map is linear in either argument separately.
    linear = correlate(x, k, **options)
    assert isclose(dot(linear, g), dot(x, dx), abs_tol=1e-10)
    assert isclose(dot(linear, g), dot(k, dk), abs_tol=1e-10)


def pool(a, reducer=max):
    return [reducer(a[i:i + 2]) for i in range(0, len(a), 2)]


def mean(a):
    return sum(a) / len(a)


x = [[1, 2, 0], [0, 1, 3], [2, 1, 0]]
k = [[1, 0], [-1, 2]]
g = [[1, 2], [-1, 1]]
y = correlate(x, k)
check("B01 output", y, [[3, 7], [0, 0]])
assert correlate(x, k, 1) == [[4, 8], [1, 1]]
assert len(k) * len(k[0]) + 1 == 5
assert len(y) * len(y[0]) * len(k) * len(k[0]) == 16
dx, dk, db = backward(x, k, g)
check("B02 (dK, dX, db)", (dk, dx, db),
      ([[6, 4], [1, 6]], [[1, 2, 0], [-2, 1, 4], [1, -3, 2]], 3))
assert dot(y, g) == dot(k, dk) == dot(x, dx) == 17

oh, ow = (output_size(n, 3, 2, 1, 2) for n in (7, 8))
params = 4 * (3 * 3 * 3 + 1)
macs = 2 * 4 * oh * ow * 3 * 3 * 3
check("B03 (shape, parameters, MACs)", ((2, 4, oh, ow), params, macs),
      ((2, 4, 3, 3), 112, 1944))
assert [output_size(n, 3, 2, 1) for n in (7, 8)] == [4, 4]
assert 2 * 4 * 4 * 4 * 3 * 3 * 3 == 3456

signals = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
check("B04 max pooling", [pool(a) for a in signals], [[1, 0], [1, 0], [0, 1]])
assert [pool(a, mean) for a in signals] == [[0.5, 0], [0.5, 0], [0, 0.5]]
standard = 32 * 64 * 3 * 3
factorised = 32 * 3 * 3 + 32 * 64
check("B05 (weights, MACs)", ((standard, factorised),
      (standard * 28 * 28, factorised * 28 * 28)),
      ((18432, 2336), (14450688, 1831424)))
assert round(standard / factorised, 6) == 7.890411
assert round(factorised / standard, 6) == 0.126736

check("X01 (correlation, convolution)",
      (correlate([[1, 2, 3]], [[1, 2]])[0],
       correlate([[1, 2, 3]], [[2, 1]])[0]), ([5, 8], [4, 7]))
check("X02 (size, padded origins)",
      (output_size(7, 3, 2, 1), list(range(0, 7, 2))),
      (4, [0, 2, 4, 6]))
assert ((7 + 1 + 2 - 4) // 1 + 1) == 7

def padded_corr(a):
    return [sum(([0] + a + [0])[i:i + 3]) for i in range(len(a))]

original = padded_corr([1, 2, 3])
shifted = padded_corr([0, 1, 2])
check("X03 (original, shift input, shift output)",
      (original, shifted, [0] + original[:-1]),
      ([3, 6, 5], [1, 3, 3], [0, 3, 6]))
r, jump = 1, 1
fields = []
for stride in (1, 2, 1):
    r += (3 - 1) * jump
    jump *= stride
    fields.append((r, jump))
check("X04 (R, J)", fields, [(3, 1), (5, 2), (9, 2)])

window = [1, 3, 2, 0]
upstream = 4
max_grad = [upstream if i == window.index(max(window)) else 0 for i in range(4)]
avg_grad = [upstream / len(window)] * 4
check("X05 (max gradient, mean gradient)", (max_grad, avg_grad),
      ([0, 4, 0, 0], [1.0, 1.0, 1.0, 1.0]))
for reducer, grad in ((max, max_grad), (mean, avg_grad)):
    for i in range(4):
        plus, minus = window[:], window[:]
        plus[i] += 1e-6
        minus[i] -= 1e-6
        assert isclose(upstream * (reducer(plus) - reducer(minus)) / 2e-6,
                       grad[i], abs_tol=1e-7)
# Tie subgradients are convex combinations, not central derivatives.
for alpha in (0, 0.25, 0.5, 1):
    tie_grad = [0, 4 * alpha, 4 * (1 - alpha), 0]
    assert sum(tie_grad) == 4 and min(tie_grad) >= 0

check("X06 (mean, gradient)", (mean([1, 3, 5, 7]), [2 / 4] * 4),
      (4.0, [0.5, 0.5, 0.5, 0.5]))
a = [[2, 3, 0, 0], [0, 1, 2, 3]]
v, adjoint_g = [1, 2, 3, 4], [1, -1]
av = [sum(w * z for w, z in zip(row, v)) for row in a]
atg = [sum(a[i][j] * adjoint_g[i] for i in range(2)) for j in range(4)]
check("X07 (Ax, transpose times g)", (av, atg), ([8, 20], [2, 2, -2, -3]))
assert sum(z * w for z, w in zip(av, adjoint_g)) == -12
assert sum(z * w for z, w in zip(v, atg)) == -12
assert (2 - 1) * 2 - 2 * 1 + (3 - 1) + 1 + 1 == 4

check("X08 (grouped parameters, depthwise parameters)",
      (12 * (8 // 4) * 3 * 3 + 12, 16 * (8 // 8) * 3 * 3 + 16),
      (228, 160))
assert 8 % 3 != 0
check("X09 (residual derivative, projected shape)",
      (1 + (-1), (32, output_size(32, 1, 2), output_size(32, 1, 2))),
      (0, (32, 16, 16)))
check("X10 (flattened head, pooled head)", (64 * 7 * 7 * 10 + 10, 64 * 10 + 10),
      (31370, 650))

finite_difference_check(x, k)
finite_difference_check([[0.1 * (i * 5 + j - 7) for j in range(5)] for i in range(4)],
                        [[0.2, -0.3], [0.4, 0.1]], stride=2, padding=2, dilation=2)
print("Finite differences and adjoint identities: PASS (valid and padded/strided/dilated)")
