"""Numerical checks for I.12. Run with Python 3; standard library only.

Every worked problem and exercise of the chapter is reproduced here. Most use
one dataset: the four corners of a 4-by-2 rectangle turned through the 3-4-5
angle, whose covariance has eigenvalues 4 and 1.
"""
from math import atan2, cos, dist, exp, isclose, log, pi, radians, sin, sqrt, tanh


def close(actual, expected, tol=1e-9):
    assert isclose(actual, expected, rel_tol=tol, abs_tol=tol), (actual, expected)


def mm(a, b):
    return [[sum(a[i][t]*b[t][j] for t in range(len(b)))
             for j in range(len(b[0]))] for i in range(len(a))]


def tp(a):
    return [list(col) for col in zip(*a)]


def add(a, b, scale=1.0):
    return [[x + scale*y for x, y in zip(ar, br)] for ar, br in zip(a, b)]


def eye(n):
    return [[float(i == j) for j in range(n)] for i in range(n)]


def inv2(a):
    det = a[0][0]*a[1][1] - a[0][1]*a[1][0]
    return [[a[1][1]/det, -a[0][1]/det], [-a[1][0]/det, a[0][0]/det]]


def trace(a):
    return sum(a[i][i] for i in range(len(a)))


def frob2(a):
    return sum(v*v for row in a for v in row)


def flat(a, digits=6):
    return [round(v, digits) + 0.0 for row in a for v in row]


def second_moment(points):
    n, d = len(points), len(points[0])
    return [[sum(p[i]*p[j] for p in points)/n for j in range(d)] for i in range(d)]


def loss(E, D, S):
    """tr((I - DE) S (I - DE)^T), the mean squared reconstruction error."""
    R = add(eye(len(S)), mm(D, E), -1.0)
    return trace(mm(mm(R, S), tp(R)))


def grads(E, D, S):
    """(I.12.2): gradients with respect to the encoder and the decoder."""
    R = mm(add(eye(len(S)), mm(D, E), -1.0), S)
    gE = [[-2*v for v in row] for row in mm(tp(D), R)]
    gD = [[-2*v for v in row] for row in mm(R, tp(E))]
    return gE, gD


def fd_grads(f, E, D, step=1e-6):
    def one(M, which):
        out = [[0.0]*len(M[0]) for _ in M]
        for i in range(len(M)):
            for j in range(len(M[0])):
                plus = [row[:] for row in M]
                minus = [row[:] for row in M]
                plus[i][j] += step
                minus[i][j] -= step
                hi = f(plus, D) if which == 'E' else f(E, plus)
                lo = f(minus, D) if which == 'E' else f(E, minus)
                out[i][j] = (hi - lo)/(2*step)
        return out
    return one(E, 'E'), one(D, 'D')


def same(a, b, tol=1e-6):
    for ar, br in zip(a, b):
        for x, y in zip(ar, br):
            close(x, y, tol)


# The dataset and its principal axes.
X = [(1.0, 2.0), (2.2, 0.4), (-1.0, -2.0), (-2.2, -0.4)]
S = second_moment(X)
U1, U2 = (0.8, 0.6), (-0.6, 0.8)
LAM = (4.0, 1.0)
same(S, [[2.92, 1.44], [1.44, 2.08]], 1e-12)
for u, lam in ((U1, 4.0), (U2, 1.0)):          # S u = lambda u
    same(mm(S, [[u[0]], [u[1]]]), [[lam*u[0]], [lam*u[1]]], 1e-12)
close(sum(sum(p) for p in X), 0.0)             # centred
P1 = [[U1[i]*U1[j] for j in range(2)] for i in range(2)]
P2 = [[U2[i]*U2[j] for j in range(2)] for i in range(2)]


def outer_sum(g1, g2):
    return add([[g1*v for v in row] for row in P1],
               [[g2*v for v in row] for row in P2])


# ── B01: keep the first coordinate, then repair each half in turn ──────────
E, D = [[1.0, 0.0]], [[1.0], [0.0]]
codes = [mm(E, [[p[0]], [p[1]]])[0][0] for p in X]
assert codes == [1.0, 2.2, -1.0, -2.2]
per_example = [(p[0] - D[0][0]*z)**2 + (p[1] - D[1][0]*z)**2 for p, z in zip(X, codes)]
close(sum(per_example)/4, loss(E, D, S))
losses = [loss(E, D, S)]
for sweep in range(12):
    ESE = mm(mm(E, S), tp(E))[0][0]
    D = [[v[0]/ESE] for v in mm(S, tp(E))]              # best decoder, (I.12.3)
    losses.append(loss(E, D, S))
    DtD = mm(tp(D), D)[0][0]
    E = [[D[0][0]/DtD, D[1][0]/DtD]]                    # best encoder, (I.12.3)
    losses.append(loss(E, D, S))
    if sweep == 0:
        first_decoder, first_encoder = [D[0][0], D[1][0]], E[0][:]
assert all(a >= b - 1e-12 for a, b in zip(losses, losses[1:]))
close(losses[-1], 1.0, 1e-9)
close(losses[0], 2.08)
# Variation: keep the second coordinate instead. Break: start on the saddle.
close(loss([[0.0, 1.0]], [[0.0], [1.0]], S), 2.92)
close(loss([[0.0, 1.0]], [[1.44/2.08], [1.0]], S), 5 - 6.4/2.08)
Eb = [list(U2)]
Db = [[v[0]/mm(mm(Eb, S), tp(Eb))[0][0]] for v in mm(S, tp(Eb))]
same(Db, [[U2[0]], [U2[1]]])
close(loss(Eb, Db, S), 4.0)
# Each sweep divides the tangent of the angle to u1 by lambda1/lambda2 = 4.
for sweep, tangent in ((1, 0.1875), (2, 0.046875)):
    close(losses[2*sweep], 1 + 3*tangent**2/(1 + tangent**2))
print("B01 loss %.6f; best decoder (%.6f, %.6f) loss %.6f; best encoder"
      " (%.6f, %.6f) loss %.6f; next two %.6f %.6f; limit %.6f"
      % (losses[0], *first_decoder, losses[1], *first_encoder, losses[2],
         losses[3], losses[4], losses[-1]))

# ── B02: the optimum, its factorisations, and the theorem's bound ──────────
close(loss([list(U1)], [[U1[0]], [U1[1]]], S), 1.0)
same(mm([[0.16], [0.12]], [[4.0, 3.0]]), P1)            # G = 1/5, same function
for Eo, Do in (([list(U1)], [[0.8], [0.6]]), ([[4.0, 3.0]], [[0.16], [0.12]])):
    gE, gD = grads(Eo, Do, S)
    assert frob2(gE) + frob2(gD) < 1e-24
scan = [loss([[cos(t), sin(t)]], [[cos(t)], [sin(t)]], S)
        for t in (i*pi/3600 for i in range(3600))]
assert min(scan) >= 1.0 - 1e-12 and max(scan) <= 4.0 + 1e-12
close(sum(LAM) - 4.0, 1.0)
# (I.12.2) against finite differences at a generic point, untied and tied.
Eg, Dg = [[0.3, -0.7]], [[1.1], [0.4]]
gE, gD = grads(Eg, Dg, S)
nE, nD = fd_grads(lambda e, d: loss(e, d, S), Eg, Dg)
same(gE, nE)
same(gD, nD)
W = [[0.3, -0.7]]
gE, gD = grads(W, tp(W), S)
tied = add(gE, tp(gD))
step = 1e-6
for j in range(2):
    plus, minus = [W[0][:]], [W[0][:]]
    plus[0][j] += step
    minus[0][j] -= step
    close((loss(plus, tp(plus), S) - loss(minus, tp(minus), S))/(2*step), tied[0][j], 1e-6)
# The other stationary point: projection onto u2. Loss 4, and a way down.
Es, Ds = [list(U2)], [[U2[0]], [U2[1]]]
gE, gD = grads(Es, Ds, S)
assert frob2(gE) + frob2(gD) < 1e-24
path = [loss([[cos(t)*U2[0] + sin(t)*U1[0], cos(t)*U2[1] + sin(t)*U1[1]]],
             [[cos(t)*U2[0] + sin(t)*U1[0]], [cos(t)*U2[1] + sin(t)*U1[1]]], S)
        for t in (0.0, 0.1, pi/4, pi/2)]
for t, value in zip((0.0, 0.1, pi/4, pi/2), path):
    close(value, 4.0 - 3.0*sin(t)**2)
close(loss(Es, [[1.1*v[0]] for v in Ds], S), 4.0 + 0.01*1.0)   # scaling goes up
print("B02 optimum loss %.6f, M = %s; saddle at u2 loss %.6f, rotated by 0.1"
      " rad %.6f" % (loss([list(U1)], [[0.8], [0.6]], S), flat(P1), path[0], path[1]))

# ── B03: Gaussian corruption is shrinkage ──────────────────────────────────
def noisy_loss(M, var):
    """Exact mean over the data and four noise vectors with covariance var*I."""
    a = sqrt(2*var)
    total = 0.0
    for p in X:
        for e in ((a, 0), (-a, 0), (0, a), (0, -a)):
            q = (p[0] + e[0], p[1] + e[1])
            total += sum((M[i][0]*q[0] + M[i][1]*q[1] - p[i])**2 for i in range(2))
    return total/16


def denoiser(var):
    return mm(S, inv2(add(S, eye(2), var)))


M = denoiser(1.0)
same(M, outer_sum(0.8, 0.5))
same(M, [[0.692, 0.144], [0.144, 0.608]])
R = add(M, eye(2), -1.0)
formula = trace(mm(mm(R, S), tp(R))) + 1.0*frob2(M)
close(noisy_loss(M, 1.0), formula)
close(formula, 1.3)
same(add([[2*v for v in row] for row in mm(R, S)], M, 2.0), [[0, 0], [0, 0]], 1e-12)
for bump in ([[0.01, 0], [0, 0]], [[0, 0.01], [0, 0]], [[0, 0], [0.01, -0.01]]):
    assert noisy_loss(add(M, bump), 1.0) > formula          # a minimum
same(M, add(eye(2), inv2(add(S, eye(2), 1.0)), -1.0))       # Tweedie, Gaussian case
narrow = outer_sum(0.8, 0.0)
close(noisy_loss(narrow, 1.0), 1.8)
for i in range(180):                                       # no rank-one map beats it
    for j in range(180):
        out, inp = (cos(i*pi/180), sin(i*pi/180)), (cos(j*pi/180), sin(j*pi/180))
        Sq = [S[0][0]*inp[0] + S[0][1]*inp[1], S[1][0]*inp[0] + S[1][1]*inp[1]]
        c = (out[0]*Sq[0] + out[1]*Sq[1])/(inp[0]*Sq[0] + inp[1]*Sq[1] + 1.0)
        rank_one = [[c*out[a]*inp[b] for b in range(2)] for a in range(2)]
        assert noisy_loss(rank_one, 1.0) >= 1.8 - 1e-9
limits = []
for var in (0.01, 1.0, 100.0):
    gains = [lam/(lam + var) for lam in LAM]
    limits.append((gains, sum(lam*var/(lam + var) for lam in LAM)))
    close(noisy_loss(denoiser(var), var), limits[-1][1])
same(denoiser(4.0), outer_sum(0.5, 0.2))                   # variation
close(noisy_loss(denoiser(4.0), 4.0), 2.8)
close(noisy_loss(eye(2), 1.0), 2.0)                        # copying costs more
close(noisy_loss([[0.0, 0.0], [0.0, 0.0]], 1.0), 5.0)
print("B03 denoiser %s loss %.6f; with k=1 %.6f; gains at 0.01/1/100: %s"
      % (flat(M), formula, noisy_loss(narrow, 1.0),
         " ".join("(%.6f, %.6f)" % tuple(g) for g, _ in limits)))
print("B03 losses at 0.01/1/100: %s; total variance %.1f"
      % (" ".join("%.6f" % v for _, v in limits), trace(S)))

# ── B04: a width-one code that memorises ───────────────────────────────────
def relu(a):
    return max(a, 0.0)


def memoriser(p):
    z = p[0]                                              # the code
    return (z, -4*z/3 - 10/3 + 10*relu(z + 1)/3 - 10*relu(z - 1)/3)


def pca(p):
    z = U1[0]*p[0] + U1[1]*p[1]
    return (z*U1[0], z*U1[1])


def sq(p, q):
    return (p[0] - q[0])**2 + (p[1] - q[1])**2


train = [(sq(p, memoriser(p)), sq(p, pca(p))) for p in X]
midpoints = [(-0.6, 0.8), (0.6, -0.8), (1.6, 1.2), (-1.6, -1.2)]
held = [(sq(p, memoriser(p)), sq(p, pca(p))) for p in midpoints]
for got, want in zip(train, [(0, 1)]*4):
    close(got[0], want[0])
    close(got[1], want[1])
both = train + held                                        # variation: eight points
close(sum(t[0] for t in both)/8, 1.0)
close(sum(t[1] for t in both)/8, 0.75)
same(second_moment(X + midpoints), outer_sum(3.0, 0.75))
print("B04 train loss memoriser/PCA: %.6f %.6f; held-out mean: %.6f %.6f;"
      " at (-0.6, 0.8): %.6f %.6f; decode z=5: (%.6f, %.6f)"
      % (sum(t[0] for t in train)/4 + 0.0, sum(t[1] for t in train)/4,
         sum(h[0] for h in held)/4, sum(h[1] for h in held)/4,
         held[0][0], held[0][1], *memoriser((5.0, 0.0))))

# ── B05: count the code before calling it a bottleneck ─────────────────────
def conv_out(n, k, s, p):
    return (n + 2*p - k)//s + 1


def convt_out(n, k, s, p, op):
    return (n - 1)*s - 2*p + (k - 1) + op + 1


widths = [784, 128, 32, 128, 784]
untied = sum(a*b + b for a, b in zip(widths, widths[1:]))
tied_count = 784*128 + 128*32 + sum(widths[1:])
down = [28, conv_out(28, 3, 2, 1)]
down.append(conv_out(down[-1], 3, 2, 1))
up = [7, convt_out(7, 3, 2, 1, 1)]
up.append(convt_out(up[-1], 3, 2, 1, 1))
bare = [7, convt_out(7, 3, 2, 1, 0)]
bare.append(convt_out(bare[-1], 3, 2, 1, 0))
conv_params = (8*1*9 + 8) + (16*8*9 + 16) + (16*8*9 + 8) + (8*1*9 + 1)
assert conv_out(27, 3, 2, 1) == conv_out(28, 3, 2, 1) == 14
assert conv_out(28, 4, 2, 1) == 14 and convt_out(7, 4, 2, 1, 0) == 14
assert 784/32 == 24.5 and 25*25 == 625
print("B05 dense untied/tied: %d %d; conv sizes %s, code %d numbers; transposed"
      " %s, without output padding %s; conv parameters %d; 4-channel code %d"
      % (untied, tied_count, down, 16*7*7, up, bare, conv_params, 4*7*7))
assert (untied, tied_count, conv_params) == (209968, 105520, 2481)

# ── X01: the code has no units ─────────────────────────────────────────────
p = (2.0, -1.0)
z = 0.8*p[0] + 0.6*p[1]
close(sq(p, (0.8*z, 0.6*z)), 4.0)
z5 = 4.0*p[0] + 3.0*p[1]
assert (round(0.16*z5, 12), round(0.12*z5, 12)) == (round(0.8*z, 12), round(0.6*z, 12))
print("X01 code %.6f, reconstruction (%.6f, %.6f), error %.6f; rescaled code %.6f"
      % (z, 0.8*z, 0.6*z, sq(p, (0.8*z, 0.6*z)), z5))

# ── X02: the encoder waits for the decoder ─────────────────────────────────
E, D = [[1.0, 0.0]], [[1.0], [0.0]]
gE, gD = grads(E, D, S)
D1 = add(D, gD, -0.1)
zero_E, zero_D = grads([[0.0, 0.0]], [[0.0], [0.0]], S)
assert frob2(zero_E) + frob2(zero_D) == 0.0
print("X02 grad D %s, grad E %s; after one step D %s, loss %.6f; at zero loss %.6f"
      % (flat(gD), flat(gE), flat(D1), loss(E, D1, S),
         loss([[0.0, 0.0]], [[0.0], [0.0]], S)))

# ── X03: centre the data, or the code spends itself on the mean ────────────
raw = [(10.0, -1.0), (10.0, 0.0), (10.0, 1.0)]
R2 = second_moment(raw)
same(R2, [[100.0, 0.0], [0.0, 2/3]])
uncentred = loss([[1.0, 0.0]], [[1.0], [0.0]], R2)
centred = second_moment([(0.0, p[1]) for p in raw])
print("X03 uncentred loss %.6f with codes %s; centred loss %.6f with codes %s"
      % (uncentred, [p[0] for p in raw],
         loss([[0.0, 1.0]], [[0.0], [1.0]], centred) + 0.0, [p[1] for p in raw]))

# ── X04: as wide as the input, and nothing learned ─────────────────────────
Ew, Dw = [[2.0, 1.0], [1.0, 1.0]], [[1.0, -1.0], [-1.0, 2.0]]
same(mm(Dw, Ew), eye(2))
close(loss(Ew, Dw, S), 0.0)
code = mm(Ew, [[1.0], [2.0]])
far = mm(Dw, mm(Ew, [[100.0], [-7.0]]))
print("X04 loss %.6f; code of (1, 2) is %s; (100, -7) returns %s"
      % (loss(Ew, Dw, S) + 0.0, flat(code), flat(far)))

# ── X05: a flat spectrum cannot be compressed ──────────────────────────────
geo = [2.0**(8 - i) for i in range(1, 9)]
left = {k: sum(geo[k:]) for k in (1, 2, 4, 6, 7)}
first_geo = min(k for k in range(9) if sum(geo[k:])/sum(geo) < 0.01)
close(sum(geo[6:])/sum(geo), 3/255)                        # k = 6 is just over
first_flat = min(k for k in range(9) if (8 - k)/8 < 0.01)
close(0.5**7/(1 - 0.5)/(1/(1 - 0.5)), 0.5**7)
print("X05 geometric losses k=1,2,4,7: %d %d %d %d of %d; fractions %.6f %.6f"
      " %.6f %.6f; under 1 per cent at k=%d; flat spectrum needs k=%d"
      % (left[1], left[2], left[4], left[7], sum(geo), left[1]/255, left[2]/255,
         left[4]/255, left[7]/255, first_geo, first_flat))

# ── X06: weight decay removes the rotation and fixes the axes ──────────────
def decayed(E, D, gamma):
    return loss(E, D, S) + gamma*(frob2(E) + frob2(D))


gamma = 0.5
g = [sqrt(1 - gamma/lam) for lam in LAM]
Dd = [[g[0]*U1[0], g[1]*U2[0]], [g[0]*U1[1], g[1]*U2[1]]]
Ed = tp(Dd)
gE, gD = grads(Ed, Dd, S)
assert frob2(add(gE, Ed, 2*gamma)) + frob2(add(gD, Dd, 2*gamma)) < 1e-24
same(mm(tp(Dd), Dd), mm(Ed, tp(Ed)))                      # balanced
same(mm(Dd, Ed), outer_sum(0.875, 0.5))
value = decayed(Ed, Dd, gamma)
close(value, sum(2*gamma - gamma**2/lam for lam in LAM))
for i in range(2):                                        # a minimum, not a saddle
    for j in range(2):
        for sign in (0.01, -0.01):
            bump = [[sign*(a == i and b == j) for b in range(2)] for a in range(2)]
            assert decayed(add(Ed, bump), Dd, gamma) > value
            assert decayed(Ed, add(Dd, bump), gamma) > value
rot = [[cos(0.7), -sin(0.7)], [sin(0.7), cos(0.7)]]       # rotate the code
Er, Dr = mm(rot, Ed), mm(Dd, tp(rot))
close(decayed(Er, Dr, gamma), value)
D1d = [[sqrt(0.75)*U1[0]], [sqrt(0.75)*U1[1]]]
print("X06 gains %s; decoder columns %s; objective %.6f against identity %.6f;"
      " k=1, gamma=1: decoder %s, objective %.6f"
      % ([1 - gamma/lam for lam in LAM], flat(tp(Dd)), value,
         decayed(eye(2), eye(2), gamma),
         flat(tp(D1d)), decayed(tp(D1d), D1d, 1.0)))

# ── X07: a penalty on the code can be scaled away ──────────────────────────
def l1_objective(scale, beta=0.5):
    Ec, Dc = [[0.8/scale, 0.6/scale]], [[0.8*scale], [0.6*scale]]
    zs = [Ec[0][0]*p[0] + Ec[0][1]*p[1] for p in X]
    return loss(Ec, Dc, S) + beta*sum(abs(v) for v in zs)/4


def soft(a, beta):
    return (1 if a > 0 else -1)*max(abs(a) - beta/2, 0.0)


z = soft(2.0, 0.5)
unit = (2.0 - z)**2 + 1.0 + 0.5*abs(z)
for other in (z - 0.01, z + 0.01, 2.0, 0.0):
    assert (2.0 - other)**2 + 1.0 + 0.5*abs(other) > unit
dead_from = 2*abs(2.0)                                     # beta/2 reaches |a|
assert soft(2.0, dead_from) == 0.0 and soft(2.0, dead_from - 0.01) > 0.0
print("X07 objective at scale 1, 10, 1000: %.6f %.6f %.6f; unit-norm decoder:"
      " code %.6f, objective %.6f; code is zero from beta = %.1f"
      % (l1_objective(1), l1_objective(10), l1_objective(1000), z, unit, dead_from))

# ── X08: the best denoiser returns a conditional mean ──────────────────────
def log_density(v, var):
    return log(0.5*exp(-(v - 1)**2/(2*var)) + 0.5*exp(-(v + 1)**2/(2*var)))


values = []
for v, var in ((0.5, 1.0), (0.5, 0.25), (0.0, 1.0)):
    score = (log_density(v + 1e-6, var) - log_density(v - 1e-6, var))/2e-6
    close(v + var*score, tanh(v/var), 1e-8)                # (I.12.8)
    values.append(tanh(v/var))
print("X08 conditional means: %.6f %.6f %.6f" % (values[0], values[1], values[2] + 0.0))

# ── X09: a circle does not pass through a width-one code ───────────────────
a = (cos(radians(175)), sin(radians(175)))
b = (cos(radians(-175)), sin(radians(-175)))
mid = (atan2(a[1], a[0]) + atan2(b[1], b[0]))/2
decoded = (cos(mid), sin(mid))


def f(t):                                                  # any continuous encoder
    return cos(t) + 0.3*sin(2*t) + 0.2*sin(t)


lo, hi = 0.0, pi                                           # h(t) = f(t) - f(t + pi)
assert (f(lo) - f(lo + pi))*(f(hi) - f(hi + pi)) < 0
for _ in range(60):
    half = (lo + hi)/2
    if (f(lo) - f(lo + pi))*(f(half) - f(half + pi)) <= 0:
        hi = half
    else:
        lo = half
close(f(lo), f(lo + pi), 1e-12)
close(lo, pi - atan2(5, 1))                                # h = 2 cos t + 0.4 sin t
close(dist(a, b), 2*sin(radians(5)))
close(dist(decoded, a), 2*sin(radians(87.5)))
for point in ((0.0, 0.0), (0.3, -0.2), (1.0, 0.0), (2.0, 1.0)):   # one shared output
    antipodes = ((cos(lo), sin(lo)), (-cos(lo), -sin(lo)))
    assert max(dist(point, q) for q in antipodes) >= 1.0 - 1e-12
print("X09 inputs %.6f apart, codes %.6f apart, midpoint decodes %.6f away;"
      " antipodes share a code at angle %.6f"
      % (dist(a, b), abs(atan2(a[1], a[0]) - atan2(b[1], b[0])), dist(decoded, a), lo))

# ── X10: an anomaly on the learned surface scores zero ─────────────────────
scores = {p: sq(p, pca(p)) for p in ((8.0, 6.0), (-1.2, 1.6))}
nearest = {p: min(dist(p, q) for q in X) for p in scores}
assert max(sq(p, pca(p)) for p in X) <= 1.0 + 1e-12
print("X10 scores: %.6f %.6f; distance to nearest training point: %.6f %.6f"
      % (scores[(8.0, 6.0)] + 0.0, scores[(-1.2, 1.6)],
         nearest[(8.0, 6.0)], nearest[(-1.2, 1.6)]))

# ── The propositions' own numbers ──────────────────────────────────────────
E, D = [[1.0, 0.0]], [[0.2], [0.0]]                        # unbalanced start
start_gap = frob2(E) - frob2(D)
for _ in range(4000):
    gE, gD = grads(E, D, S)
    E, D = add(E, gE, -0.01), add(D, gD, -0.01)
same(mm(D, E), P1, 1e-6)
print("P02 gradient descent: loss %.6f, E %s, D %s, imbalance %.4f from %.4f"
      % (loss(E, D, S), flat(E, 4), flat(tp(D), 4), frob2(E) - frob2(D), start_gap))
stalls = []
for tilt in (1e-6, 1e-3):                                  # start beside the saddle
    row = [0.5*U2[0] + tilt*U1[0], 0.5*U2[1] + tilt*U1[1]]
    E, D = [row[:]], [[row[0]], [row[1]]]
    arrive = leave = done = None
    for step in range(2000):
        value = loss(E, D, S)
        if arrive is None and abs(value - 4.0) < 0.01:
            arrive = step
        if arrive is not None and leave is None and value < 3.99:
            leave = step
        if done is None and value < 1.01:
            done = step
        gE, gD = grads(E, D, S)
        E, D = add(E, gE, -0.01), add(D, gD, -0.01)
    stalls.append((arrive, leave, done))
print("P02 beside the saddle, tilt 1e-6: near loss 4 from step %d to %d, below"
      " 1.01 at %d; tilt 1e-3: %d to %d, then %d" % (*stalls[0], *stalls[1]))
labels = [1, -1, -1, 1]                                    # sign of the u2 score
by_code = {}
for p, y in zip(X, labels):
    assert (U2[0]*p[0] + U2[1]*p[1] > 0) == (y > 0)
    by_code.setdefault(round(U1[0]*p[0] + U1[1]*p[1], 9), []).append(y)
best = sum(max(v.count(1), v.count(-1)) for v in by_code.values())/4
print("P03 clean error under bottleneck, noise, decay: %.4f %.4f %.4f"
      % tuple(sum((1 - gain)**2*lam for gain, lam in zip(gs, LAM))
              for gs in ((1.0, 0.0), (0.8, 0.5), (0.875, 0.5))))
print("P04 variance kept %.2f, label accuracy from the code %.2f" % (4.0/5.0, best))
