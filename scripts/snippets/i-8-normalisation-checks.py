"""Reproduce every numerical example in I.8, using only the standard library.

The paired expected-output file is checked by npm run check:elementa.
Assertions check unrounded values, not just the displayed digits.
Finite differences independently check the normalisation backward pass.
"""
from math import sqrt, isclose
from itertools import product


def close(actual, expected, tol=1e-10):
    assert isclose(actual, expected, rel_tol=tol, abs_tol=tol), (actual, expected)


def vector_close(actual, expected, tol=1e-10):
    assert len(actual) == len(expected)
    for a, b in zip(actual, expected):
        close(a, b, tol)


def stats(x):
    mu = sum(x) / len(x)
    return mu, sum((v - mu)**2 for v in x) / len(x)


def norm(x, eps=1e-5, frozen=None):
    mu, var = stats(x) if frozen is None else frozen
    return [(v - mu) / sqrt(var + eps) for v in x]


def affine(x, gamma=1.0, beta=0.0, eps=1e-5, frozen=None):
    return [gamma * v + beta for v in norm(x, eps, frozen)]


def backward(x, g, gamma, eps):
    z = norm(x, eps)
    r = sqrt(stats(x)[1] + eps)
    u = [a * b for a, b in zip(g, gamma)]
    ubar = sum(u) / len(x)
    uzbar = sum(a * b for a, b in zip(u, z)) / len(x)
    return [(a - ubar - b * uzbar) / r for a, b in zip(u, z)]


def check_gradient(x, g, gamma, eps):
    # A linear scalar loss after the layer supplies the chosen upstream g.
    def loss(values):
        return sum(a*b*c for a, b, c in zip(g, gamma, norm(values, eps)))
    analytic = backward(x, g, gamma, eps)
    numeric = []
    h = 1e-5
    for j in range(len(x)):
        plus, minus = list(x), list(x)
        plus[j] += h
        minus[j] -= h
        numeric.append((loss(plus) - loss(minus)) / (2*h))
    assert max(abs(a-b) for a, b in zip(analytic, numeric)) < 1e-8
    close(sum(analytic), 0)
    return analytic


# B01: forward pass and the exact code example's printed values.
x = [1.0, 2.0, 3.0]
vector_close(stats(x), [2, 2/3])
z = norm(x)
close(sum(z), 0)
close(sum(v*v for v in z)/3, (2/3)/(2/3+1e-5))
assert [round(v, 4) for v in z] == [-1.2247, 0.0, 1.2247]
close(norm([3], frozen=(2, 2/3))[0], z[-1])
close(norm([3])[0], 0)
close(sum(affine(x, 2, -1))/3, -1)
close(stats(affine(x, 2, -1))[1], 4*stats(z)[1])
print("B01 output: " + " ".join(f"{v:.4f}" for v in z))
print(f"B01 variance: {stats(z)[1]:.10f}")

# B02: analytic BN and per-feature-scale LN derivatives.
dx = check_gradient([-1, 0, 1], [1, -1, 2], [2, 2, 2], 1/3)
vector_close(dx, [4/3, -10/3, 2])
close(sum(a*b for a, b in zip([-1, 0, 1], dx)), 2/3)
close(sum(a*b for a, b in zip([1, -1, 2], [-1, 0, 1])), 1)
close(sum([1, -1, 2]), 2)
check_gradient([-2, .4, 3, 5], [.3, -.7, 1.4, 2], [1.7]*4, 1e-5)
check_gradient([-2, .4, 3, 5], [.3, -.7, 1.4, 2], [.5, 2, -1, 3], .2)
vector_close(backward([1, 2, 3], [1, 1, 1], [2]*3, 1e-5), [0]*3)
print("B02 dx: " + " ".join(f"{v:.6f}" for v in dx))
print("B02 finite differences: passed (BN and per-feature LN)")

# B03: changing the companion changes the sign, not the target.
a, b = norm([1, 3])[0], norm([1, -1])[0]
assert a < 0 < b
close(a, -b)
vector_close(norm([1, 3]), [-b, b])
vector_close(norm([5]), [0])
print(f"B03 target: {a:.4f} -> {b:.4f}")

# B04: group partitions and affine counts, including the variation.
N, C, H, W = 2, 3, 4, 4
assert C*(N*H*W) == N*(C*H*W) == (N*H*W)*C == 96
assert (2*C, 2*C*H*W, 2*C) == (6, 96, 6)
assert 2*3*4*5 == 120
print("B04 learned scalars: 6 96 6; group sizes: 32 48 3")

# B05: exact enumeration, no Monte Carlo fluctuation.
h, q = 2, .5
outcomes = [(0, 1-q), (h/q, q)]
mean = sum(v*p for v, p in outcomes)
second = sum(v*v*p for v, p in outcomes)
close(mean, 2)
close(second-mean**2, 4)
close(second, 8)
close(h*h, 4)
print("B05 mean/variance/masked square/inference square: 2 4 8 4")

# X01: shift invariance and epsilon-dependent scale change.
vector_close(norm([-1, 0, 1], 1/3), [-1, 0, 1])
vector_close(norm([9, 10, 11], 1/3), [-1, 0, 1])
vector_close(norm([-2, 0, 2], 1/3), [-2/sqrt(3), 0, 2/sqrt(3)])
print("X01 rescaled endpoint: " + f"{norm([-2, 0, 2], 1/3)[-1]:.4f}")

# X02: positive variance allows epsilon=0 in this exact exercise.
vector_close(affine([4, 6], 2, -1, 0), [-3, 1])
vector_close(affine([4, 6], 2, -1, 0, (2, 4)), [1, 3])
print("X02 training: -3 1; evaluation: 1 3")

# X03: ridge normal equations in an eigenbasis.
curvatures, rhs, penalty = [1, 4], [2, 8], 1
vector_close([b/a for a, b in zip(curvatures, rhs)], [2, 2])
ridge = [b/(a+penalty) for a, b in zip(curvatures, rhs)]
vector_close(ridge, [1, 1.6])
print("X03 ridge: 1.0000 1.6000")

# X04: frozen preconditioner counterexample; not a simulated Adam run.
w, g, P, eta, lam = [1, 1], [1, 100], [1, .01], .01, .1
coupled = [v-eta*p*(grad+lam*v) for v, grad, p in zip(w, g, P)]
decoupled = [(1-eta*lam)*v-eta*p*grad for v, grad, p in zip(w, g, P)]
vector_close(coupled, [.989, .98999])
vector_close(decoupled, [.989, .989])
print("X04 coupled: 0.98900 0.98999; decoupled: 0.98900 0.98900")

# X05: the actual reduction size, not the name of the batch.
close(affine([7], 3, 2)[0], 2)
close(backward([7], [1], [3], 1e-5)[0], 0)
print("X05 singleton: output = beta; input gradient = 0")

# X06: running-state estimator conventions.
biased, unbiased = stats([1, 2, 3])[1], 1
close(.75*2+.25*biased, 5/3)
close(.75*2+.25*unbiased, 7/4)
close(norm([10], 0, (0, 1))[0], 10)
print(f"X06 running variance: {5/3:.4f} or {7/4:.4f}")

# X07: dependent mask invalidates the conditional-mean guarantee.
source = [-1, 1]
masked = [(int(v == 1)*v/.5) for v in source]
close(sum(source)/2, 0)
close(sum(masked)/2, 1)
assert h*h*(1-.01)/.01 > h*h*(1-.1)/.1 > 0
print("X07 dependent-mask mean: 1; original mean: 0")

# X08: two shape-preserving but distinct reductions.
assert 2*3*4 == 24 and 2*4*5 == 40
assert 24*5 == 40*3 == 120
assert 2*5 == 10 and 2*3 == 6
print("X08 width groups/parameters: 24/10; channel groups/parameters: 40/6")

# X09: enumerate the augmented joint distribution and all classifiers.
pairs = [(x*sign, int(x > 0)) for x, sign in product([-1, 1], repeat=2)]
for observed in [-1, 1]:
    labels = [y for x, y in pairs if x == observed]
    close(sum(labels)/len(labels), .5)
for prediction in product([0, 1], repeat=2):
    close(sum(prediction[int(x == 1)] != y for x, y in pairs)/4, .5)
print("X09 minimum augmented classification error: 0.5000")

# X10: check the closed form against two actual gradient updates.
factors = []
for a in [1, 2]:
    w = 0
    for _ in range(2):
        w -= .25*(a*w-a)
    close(w, 1-(1-.25*a)**2)
    factors.append(w)
vector_close(factors, [7/16, 3/4])
lambdas = [a*(1-f)/f for a, f in zip([1, 2], factors)]
vector_close(lambdas, [9/7, 2/3])
print("X10 stopping factors: 0.4375 0.7500; matching ridge lambdas: 9/7 2/3")
