"""Numerical checks for the Book I problem set. Python 3, standard library only.

Each problem combines two or more chapters of Book I; the comment on each
block names them.
"""
from math import exp, isclose, log, sqrt, tanh


def close(actual, expected, tol=1e-9):
    assert isclose(actual, expected, rel_tol=tol, abs_tol=tol), (actual, expected)


def relu(a):
    return max(a, 0.0)


# ── B01: XOR from the perceptron to the network (I.2, I.3, I.5, I.6, I.7) ──
DATA = [((0, 0), 0), ((0, 1), 1), ((1, 0), 1), ((1, 1), 0)]


def xor_net(x, v2=-2.0):
    s = x[0] + x[1]
    h1, h2 = relu(s), relu(s - 1)
    return h1 + v2*h2, (h1, h2, s - 1)


assert [xor_net(x)[0] for x, _ in DATA] == [0.0, 1.0, 1.0, 0.0]
# No single threshold unit fits XOR: the four inequalities are inconsistent.
for w1 in [i/4 for i in range(-12, 13)]:
    for w2 in [i/4 for i in range(-12, 13)]:
        for b in [i/4 for i in range(-12, 13)]:
            fits = all((w1*x[0] + w2*x[1] + b > 0) == bool(t) for x, t in DATA)
            assert not fits
outs = [xor_net(x, -1.8)[0] for x, _ in DATA]
loss = sum((y - t)**2 for y, (_, t) in zip(outs, DATA))/4
grad_v2 = sum(2*(y - t)/4*xor_net(x, -1.8)[1][1] for y, (x, t) in zip(outs, DATA))
delta = 2*(outs[3] - 0)/4                       # only (1, 1) has an error
grad_b2 = delta*(-1.8)*1.0                      # relu'(1) = 1
grad_w2_inputs = (grad_b2*1, grad_b2*1)
grad_b1 = delta*1.0*1.0
close(loss, 0.01)
close(grad_v2, 0.1)
close(grad_b2, -0.18)
h = 1e-6
fd = (sum((xor_net(x, -1.8 + h)[0] - t)**2 for x, t in DATA)
      - sum((xor_net(x, -1.8 - h)[0] - t)**2 for x, t in DATA))/(4*2*h)
close(fd, grad_v2, 1e-6)
v2_new = -1.8 - 1.0*grad_v2
walk = [v2_new]
for _ in range(2):                              # each step halves the error
    err = 2 + walk[-1]
    walk.append(walk[-1] - 2*err/4)
assert [round(v, 6) for v in walk] == [-1.9, -1.95, -1.975]
assert 25**3 == 15625
print("B01 outputs %s; perturbed outputs %s; loss %.6f; dL/dv2 %.6f; dL/db2 %.6f;"
      " dL/db1 %.6f; after one step v2 = %.1f"
      % ([0, 1, 1, 0], [round(y, 6) for y in outs], loss, grad_v2, grad_b2, grad_b1, v2_new))

# ── B02: three ways a gradient crosses many steps (I.3, I.6, I.9, I.10, I.11) ─
rows = []
for steps in (20, 100):
    rows.append((0.25**steps, 0.9**steps, 0.95**steps, 1.05**steps))
close(rows[0][0], 9.094947e-13, 1e-6)
close((1 + (-1.0))**20, 0.0)
half = 0.5**(1/100)                             # variation: keep half over 100 steps
close(half, 0.993092, 1e-6)
close(log(half/(1 - half)), 4.97, 1e-3)
print("B02 L = 20: sigmoid %.6e, recurrent 0.9 %.6f, forget 0.95 %.6f, residual +0.05 %.6f;"
      " L = 100: %.6e %.6e %.6f %.3f" % (*rows[0], *rows[1]))

# ── B03: reduction, batch size and the step (I.4, I.7) ─────────────────────
var, batch, lr = 4.0, 32, 0.1
mean_var, sum_var = var/batch, var*batch
print("B03 gradient variance, mean %.6f, sum %.1f; step sd at lr 0.1: mean %.6f, sum %.6f;"
      " matching lr for the sum %.6f; batch 128 mean variance %.6f"
      % (mean_var, sum_var, lr*sqrt(mean_var), lr*sqrt(sum_var), lr/batch, var/128))
close(lr*sqrt(sum_var)/(lr*sqrt(mean_var)), batch)

# ── B04: one sequence, three architectures (I.9, I.11, I.14) ───────────────
T, d = 64, 128
per_layer = 2*d*d + d
conv_layers = next(L for L in range(1, 20) if 2**L >= T)    # kernel 2, dilations 1..2^(L-1)
gnn_layers = T - 1
assert 2**conv_layers == T
assert 1 + 2*(2**5 - 1) == 63 and 1 + 2*(2**6 - 1) == 127   # kernel 3: still six
assert 6*(3*d*d + d) == 295680
print("B04 per layer %d; RNN 1 layer %d params, %d sequential steps; dilated conv %d layers"
      " %d params; message passing %d layers %d params"
      % (per_layer, per_layer, T, conv_layers, conv_layers*per_layer, gnn_layers,
         gnn_layers*per_layer))

# ── B05: a zero loss that taught nothing (I.1, I.4, I.5, I.12) ─────────────
xs, ys = [0.0, 1.0, 2.0, 3.0], [0.0, 1.0, 0.0, 1.0]


def interpolant(x):
    return x - 2*relu(x - 1) + 2*relu(x - 2)


assert [interpolant(x) for x in xs] == ys
xbar, ybar = sum(xs)/4, sum(ys)/4
slope = sum((x - xbar)*(y - ybar) for x, y in zip(xs, ys))/sum((x - xbar)**2 for x in xs)
icept = ybar - slope*xbar
lin_train = sum((y - (icept + slope*x))**2 for x, y in zip(xs, ys))/4
close(slope, 0.2)
close(icept, 0.2)
close(lin_train, 0.2)
tests = [0.5, 1.5, 2.5]
interp_test = sum((interpolant(t) - 0.5)**2 + 0.25 for t in tests)/3   # labels fair coins
lin_test = sum(((icept + slope*t) - 0.5)**2 + 0.25 for t in tests)/3
print("B05 interpolant train 0, test %.6f; line y = %.1f + %.1f x train %.6f, test %.6f;"
      " constant 0.5 test 0.25" % (interp_test, icept, slope, lin_train, lin_test))

# ── B06: shapes through a convolutional VAE (I.11, I.12, I.13) ─────────────
def conv_out(n, k, s, p):
    return (n + 2*p - k)//s + 1


def convt_out(n, k, s, p, op):
    return (n - 1)*s - 2*p + (k - 1) + op + 1


k = 16
sizes = [28, conv_out(28, 3, 2, 1), conv_out(14, 3, 2, 1)]
flat = 32*sizes[2]**2
params = {
    "conv1": 16*1*9 + 16, "conv2": 32*16*9 + 32, "enc": flat*2*k + 2*k,
    "dec": k*flat + flat, "convT1": 32*16*9 + 16, "convT2": 16*1*9 + 1,
}
up = [7, convt_out(7, 3, 2, 1, 1), convt_out(14, 3, 2, 1, 1)]
assert sizes == [28, 14, 7] and up == [7, 14, 28] and flat == 1568
wrong_flat = 32*8*8
assert params["enc"] + params["dec"] == 76864                # nearly nine tenths
small = {**params, "enc": flat*4 + 4, "dec": 2*flat + flat}  # variation: k = 2
assert (small["enc"], small["dec"], sum(small.values())) == (6276, 4704, 20549)
print("B06 sizes %s, flattened %d (not %d), code 2 x %d; decoder %s; parameters %s, total %d"
      % (sizes, flat, wrong_flat, k, up, params, sum(params.values())))

# ── B07: a graph convolution trained by cross-entropy (I.4, I.6, I.14) ─────
A = [[0, 1, 1, 0], [1, 0, 1, 0], [1, 1, 0, 1], [0, 0, 1, 0]]
deg = [sum(r) + 1 for r in A]
Ahat = [[(A[i][j] + (i == j))/sqrt(deg[i]*deg[j]) for j in range(4)] for i in range(4)]
X = [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0]]
labels = [0, 0, 1, 1]
AX = [[sum(Ahat[i][m]*X[m][c] for m in range(4)) for c in range(2)] for i in range(4)]


def forward(W):
    Z = [[sum(AX[i][c]*W[c][o] for c in range(2)) for o in range(2)] for i in range(4)]
    P = []
    for z in Z:
        top = max(z)
        e = [exp(v - top) for v in z]
        P.append([v/sum(e) for v in e])
    L = -sum(log(P[i][labels[i]]) for i in range(4))/4
    return L, P


W = [[1.0, 0.0], [0.0, 1.0]]
L0, P = forward(W)
G = [[(P[i][o] - (o == labels[i]))/4 for o in range(2)] for i in range(4)]   # dL/dZ
gW = [[sum(AX[i][c]*G[i][o] for i in range(4)) for o in range(2)] for c in range(2)]
for c in range(2):
    for o in range(2):
        Wp = [row[:] for row in W]
        Wm = [row[:] for row in W]
        Wp[c][o] += 1e-6
        Wm[c][o] -= 1e-6
        close((forward(Wp)[0] - forward(Wm)[0])/2e-6, gW[c][o], 1e-6)
close(P[2][1], 0.50655, 1e-5)                         # node 3: own evidence diluted
close(P[0][0], 0.593389, 1e-5)
close(Ahat[2][0] + Ahat[2][1], 0.577350, 1e-6)             # class-1 weight at node 3
close(Ahat[2][2] + Ahat[2][3], 0.603553, 1e-6)
close(1/(1 + exp(-1)), 0.731059, 1e-6)                     # variation: own features
W1 = [[W[c][o] - 1.0*gW[c][o] for o in range(2)] for c in range(2)]
print("B07 A-hat X %s; loss %.6f; P(node 4 = class 2) %.6f; dL/dW %s; loss after one step %.6f"
      % ([[round(v, 6) for v in r] for r in AX], L0, P[3][1],
         [[round(v, 6) for v in r] for r in gW], forward(W1)[0]))

# ── B08: depth adds nothing to a linear autoencoder (I.3, I.12, I.13) ──────
S = [[2.92, 1.44], [1.44, 2.08]]
U1 = (0.8, 0.6)
layers = [  # widths 2 -> 3 -> 1 -> 3 -> 2: the narrowest is the bottleneck
    [[0.8, 0.6], [0.0, 0.0], [1.0, 0.0]],
    [[1.0, 0.0, 0.0]],
    [[1.0], [0.0], [0.0]],
    [[0.8, 0.0, 0.0], [0.6, 0.0, 0.0]],
]


def matmul(a, b):
    return [[sum(a[i][t]*b[t][j] for t in range(len(b))) for j in range(len(b[0]))]
            for i in range(len(a))]


M = layers[0]
for lay in layers[1:]:
    M = matmul(lay, M)
for i in range(2):
    for j in range(2):
        close(M[i][j], U1[i]*U1[j])
R = [[(i == j) - M[i][j] for j in range(2)] for i in range(2)]
loss_deep = sum(sum(R[i][a]*S[a][b]*R[i][b] for a in range(2) for b in range(2)) for i in range(2))
close(loss_deep, 1.0)
print("B08 product of four layers %s; loss %.6f = lambda_2; beta -> 0 distortion of I.13: %.1f"
      % ([round(v, 6) for row in M for v in row], loss_deep, 1.0))
