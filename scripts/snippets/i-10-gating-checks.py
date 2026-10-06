"""Numerical checks for I.10. Run with Python 3; standard library only."""
from math import cosh, e, exp, isclose, log, tanh


def close(actual, expected, tol=1e-8):
    assert isclose(actual, expected, rel_tol=tol, abs_tol=tol), (actual, expected)


def fd(f, xs, i, step=1e-6):
    plus, minus = list(xs), list(xs)
    plus[i] += step
    minus[i] -= step
    return (f(plus) - f(minus)) / (2 * step)


def sig(a):
    return 1 / (1 + exp(-a))


def mv(m, v):
    return [sum(a*b for a, b in zip(row, v)) for row in m]


GATES = 'ifoc'  # input, forget, output, candidate: (I.10.1)


def lstm(params, xs, c0, h0):
    """params[k] = (U, W, b) for k in GATES. Returns one record per step."""
    c, h, steps = list(c0), list(h0), []
    for x in xs:
        a = {k: [p+q+r for p, q, r in zip(mv(params[k][0], x),
                                           mv(params[k][1], h),
                                           params[k][2])] for k in GATES}
        i, f, o = ([sig(v) for v in a[k]] for k in 'ifo')
        g = [tanh(v) for v in a['c']]
        c_new = [fj*cj + ij*gj for fj, cj, ij, gj in zip(f, c, i, g)]
        h_new = [oj*tanh(cj) for oj, cj in zip(o, c_new)]
        steps.append(dict(x=x, i=i, f=f, o=o, g=g, c_prev=c, h_prev=h,
                          c=c_new, h=h_new))
        c, h = c_new, h_new
    return steps


def loss_and_grads(params, xs, c0, h0, v, ys):
    """Sum of (v.h_t - y_t)^2/2 over supervised steps; backward is I.10.B02."""
    steps = lstm(params, xs, c0, h0)
    n = len(c0)
    errors = [0.0 if y is None else sum(a*b for a, b in zip(v, s['h']))-y
              for s, y in zip(steps, ys)]
    loss = sum(err*err/2 for err in errors)
    grads = {k: ([[0.0]*len(xs[0]) for _ in range(n)],
                 [[0.0]*n for _ in range(n)], [0.0]*n) for k in GATES}
    dh_future, dc_future = [0.0]*n, [0.0]*n
    for s, err in zip(reversed(steps), reversed(errors)):
        gh = [vj*err + dj for vj, dj in zip(v, dh_future)]
        gc = [ghj*oj*(1-tanh(cj)**2) + dcj for ghj, oj, cj, dcj
              in zip(gh, s['o'], s['c'], dc_future)]
        delta = {
            'o': [a*tanh(cj)*oj*(1-oj) for a, cj, oj in zip(gh, s['c'], s['o'])],
            'f': [a*cp*fj*(1-fj) for a, cp, fj in zip(gc, s['c_prev'], s['f'])],
            'i': [a*gj*ij*(1-ij) for a, gj, ij in zip(gc, s['g'], s['i'])],
            'c': [a*ij*(1-gj*gj) for a, ij, gj in zip(gc, s['i'], s['g'])],
        }
        for k in GATES:
            du, dw, db = grads[k]
            for r in range(n):
                db[r] += delta[k][r]
                for col, xv in enumerate(s['x']):
                    du[r][col] += delta[k][r]*xv
                for col, hv in enumerate(s['h_prev']):
                    dw[r][col] += delta[k][r]*hv
        dh_future = [sum(params[k][1][r][col]*delta[k][r]
                         for k in GATES for r in range(n)) for col in range(n)]
        dc_future = [a*fj for a, fj in zip(gc, s['f'])]
    return loss, grads, dh_future, dc_future


def scalar_params(u, w, b):
    return {k: ([[u[k]]], [[w[k]]], [b[k]]) for k in GATES}


# B01: gates set by biases alone; only the candidate reads the input.
ZERO = dict.fromkeys(GATES, 0.0)
b01 = scalar_params({**ZERO, 'c': log(3)}, ZERO,
                    {'i': 0.0, 'f': log(3), 'o': log(3), 'c': 0.0})
run = lstm(b01, [[1.0], [0.0], [0.0]], [0.0], [0.0])
cs = [s['c'][0] for s in run]
hs = [s['h'][0] for s in run]
close(run[0]['g'][0], 0.8)
for got, want in zip(cs, (0.4, 0.3, 0.225)):
    close(got, want)
assert [s['f'][0] for s in run] == [0.75]*3
assert sum(1 for k in GATES for _ in range(3)) == 12
remember = scalar_params({**ZERO, 'c': log(3)}, ZERO,
                         {'i': 0.0, 'f': log(99), 'o': log(3), 'c': 0.0})
c3_99 = lstm(remember, [[1.0], [0.0], [0.0]], [0.0], [0.0])[-1]['c'][0]
close(c3_99, 0.39204)
twice = lstm(b01, [[1.0], [1.0], [0.0]], [0.0], [0.0])
close(twice[1]['c'][0], 0.7)
close(twice[2]['c'][0], 0.525)
print("B01 cells:", " ".join(f"{c:.6f}" for c in cs),
      "; hidden:", " ".join(f"{h:.6f}" for h in hs),
      f"; f=0.99 cell: {c3_99:.6f}")

# B02: finite differences for every parameter of a two-unit cell, plus the
# initial states. Non-symmetric recurrent weights catch transposes.
vec = {
    'i': ([[0.4], [-0.3]], [[0.2, -0.5], [0.6, 0.1]], [0.1, -0.2]),
    'f': ([[-0.2], [0.5]], [[0.3, 0.7], [-0.4, 0.2]], [1.0, 0.5]),
    'o': ([[0.6], [0.1]], [[-0.1, 0.4], [0.5, -0.6]], [0.2, 0.0]),
    'c': ([[0.9], [-0.7]], [[0.8, -0.2], [0.3, 0.5]], [0.0, 0.1]),
}
xs, ys, v = [[0.5], [-1.0], [0.8], [0.3]], [0.2, None, -0.1, 0.4], [0.7, -1.1]
c0, h0 = [0.3, -0.2], [0.1, 0.4]
_, grads, dh0, dc0 = loss_and_grads(vec, xs, c0, h0, v, ys)
for k in GATES:
    for slot in range(3):
        flat_shape = vec[k][slot]
        rows = flat_shape if slot < 2 else [flat_shape]
        for r, row in enumerate(rows):
            for col in range(len(row)):
                def f(q, k=k, slot=slot, r=r, col=col):
                    p = {kk: tuple([list(map(list, m)) if s < 2 else list(m)
                                    for s, m in enumerate(vec[kk])])
                         for kk in GATES}
                    target = p[k][slot] if slot == 2 else p[k][slot][r]
                    target[col] = q[0]
                    return loss_and_grads(p, xs, c0, h0, v, ys)[0]
                analytic = grads[k][slot][col] if slot == 2 else grads[k][slot][r][col]
                close(analytic, fd(f, [row[col]], 0), 1e-7)
for j in range(2):
    close(dc0[j], fd(lambda q: loss_and_grads(vec, xs, q, h0, v, ys)[0], c0, j), 1e-7)
    close(dh0[j], fd(lambda q: loss_and_grads(vec, xs, c0, q, v, ys)[0], h0, j), 1e-7)
print("Finite differences: 4 gates x (U, W, b), c0 and h0 on a two-unit cell PASS")

# B02 numeric part: constant gates, candidate reads h through w_c = 2, so the
# state is c alone and dc_t/dc_(t-1) = f + i (1 - g_t^2) w_c o (1 - tanh^2 c_(t-1)).
WC = 2.0
b02 = scalar_params({**ZERO, 'c': log(3)}, {**ZERO, 'c': WC},
                    {'i': 0.0, 'f': log(3), 'o': log(3), 'c': 0.0})


def c3_from_c1(c1):
    h1 = 0.75*tanh(c1)
    return lstm(b02, [[0.0], [0.0]], [c1], [h1])[-1]['c'][0]


run = lstm(b02, [[1.0], [0.0], [0.0]], [0.0], [0.0])
factors = [0.75 + 0.5*(1-s['g'][0]**2)*WC*0.75*(1-tanh(s['c_prev'][0])**2)
           for s in run[1:]]
full = factors[0]*factors[1]
close(full, fd(lambda q: c3_from_c1(q[0]), [run[0]['c'][0]], 0), 1e-7)
direct = 0.75**2
close(full - direct, 0.7551, 1e-4)
flat = scalar_params({**ZERO, 'c': log(3)}, ZERO,
                     {'i': 0.0, 'f': log(3), 'o': log(3), 'c': 0.0})
close(fd(lambda q: lstm(flat, [[0.0], [0.0]], [q[0]], [0.75*tanh(q[0])])[-1]['c'][0],
         [0.4], 0), direct, 1e-7)
print(f"B02 factors: {factors[0]:.6f} {factors[1]:.6f}; full dc3/dc1: {full:.6f};"
      f" carry line alone: {direct:.6f}")

# B03: one constant forget value.
f = 0.99
efold, half = -1/log(f), log(2)/-log(f)
assert f/(1-f) - 1e-9 < efold < 1/(1-f)
for value in (0.5, 0.9, 0.999, sig(10)):
    n_e = -1/log(value)
    assert value/(1-value) < n_e < 1/(1-value)
need = exp(-1/100)
logit = log(need/(1-need))
close(sig(logit), need)
close(1/log(2), 1.4426950408889634)
assert 0.9**88 < 1e-4 < 0.9**87          # FigForgetDecay: gone before step 90
assert abs(0.999**1000 - exp(-1)) < 1e-3  # and 0.999 meets 1/e at the edge
print(f"B03 f^100, f^1000: {f**100:.6f} {f**1000:.6e}; e-fold {efold:.6f};"
      f" half-life {half:.6f}; f for 100 steps {need:.6f}, bias {logit:.6f}")

# B04: reset before versus after the recurrent matrix.
Wn = [[0.0, 1.0], [1.0, 0.0]]
h_prev = [0.5, -0.5]
r = [sig(log(3)), sig(-log(3))]
close(r[0], 0.75)
close(r[1], 0.25)
z = sig(0.0)
before = [tanh(a) for a in mv(Wn, [ri*hi for ri, hi in zip(r, h_prev)])]
after = [tanh(ri*a) for ri, a in zip(r, mv(Wn, h_prev))]
h_before = [(1-z)*n + z*hp for n, hp in zip(before, h_prev)]
h_after = [(1-z)*n + z*hp for n, hp in zip(after, h_prev)]
assert all(abs(a-b) > 0.1 for a, b in zip(h_before, h_after))
# They agree for every h exactly when W commutes with diag(r).
for W in ([[0.3, 0.0], [0.0, -2.0]], [[0.3, 0.7], [-0.4, 1.1]]):
    for rr in ([0.6, 0.6], [0.6, 0.2]):
        commute = all(W[j][k]*(rr[k]-rr[j]) == 0 for j in range(2) for k in range(2))
        same = all(isclose(a, b) for a, b in
                   zip(mv(W, [p*q for p, q in zip(rr, h_prev)]),
                       [p*q for p, q in zip(rr, mv(W, h_prev))]))
        assert commute == same
uniform = [0.5, 0.5]
for n in ([tanh(a) for a in mv(Wn, [0.5*hi for hi in h_prev])],
          [tanh(0.5*a) for a in mv(Wn, h_prev)]):
    close(n[0], -0.244919, 1e-6)
    close(n[1], 0.244919, 1e-6)
print("B04 n before:", " ".join(f"{a:.6f}" for a in before),
      "; after:", " ".join(f"{a:.6f}" for a in after))
print("B04 h before:", " ".join(f"{a:.6f}" for a in h_before),
      "; after:", " ".join(f"{a:.6f}" for a in h_after))

# B05: parameter counts with one bias per gate, and PyTorch's two.
def counts(D, H):
    return dict(rnn=H*(D+H+1), gru=3*H*(D+H+1), gru_after=3*H*(D+H+1)+H,
                lstm=4*H*(D+H+1), torch_rnn=H*(D+H)+2*H,
                torch_gru=3*H*(D+H)+6*H, torch_lstm=4*H*(D+H)+8*H)


k5, k6 = counts(3, 5), counts(3, 6)
assert (k5['rnn'], k5['gru'], k5['gru_after'], k5['lstm']) == (45, 135, 140, 180)
assert (k5['torch_rnn'], k5['torch_gru'], k5['torch_lstm']) == (50, 150, 200)
assert k6['gru'] == k5['lstm'] == 180 and k6['torch_gru'] == 198
assert [H for H in range(1, 50) if counts(3, H)['rnn'] == 180] == []
assert (counts(3, 11)['rnn'], counts(3, 12)['rnn']) == (165, 192)
macs = dict(rnn=5*8, lstm=4*5*8, gru6=3*6*9)
assert macs == dict(rnn=40, lstm=160, gru6=162)
assert 3*5*8 == 120 and 4*5*(0+5+1) == 120
assert (4*512*1025, 3*512*1025) == (2_099_200, 1_574_400)
N, T, H = 4, 6, 5
assert (4*N*T*H, 4*N*T*6*H) == (480, 2880)
print(f"B05 one-bias counts RNN/GRU/GRU-after/LSTM: 45 135 140 180;"
      f" PyTorch: 50 150 200; GRU H=6: 180 / 198")

# X01: a saturated sigmoid still leaks.
f10 = sig(10)
close(1/(1-f10), 1+exp(10))
print(f"X01 f: {f10:.7f}; 1-f: {1-f10:.6e}; after 1e5 steps: "
      f"{f10**100000:.6f}; e-fold steps: {-1/log(f10):.2f}")

# X02: the forget slice and the doubled bias.
H = 5
slices = {g: (H*n, H*(n+1)) for n, g in enumerate('ifgo')}
assert slices['f'] == (5, 10) and slices['i'] == (0, 5)
close(1+e, 3.718281828459045)
print(f"X02 sigma(1), sigma(2): {sig(1):.6f} {sig(2):.6f}; horizons "
      f"{1+e:.6f} {1+e*e:.6f}; PyTorch bias bound {1/5**0.5:.6f}")

# X03: no forget gate, constant write.
c = 0.0
for _ in range(200):
    c = 1.0*c + 1.0*0.1
close(c, 20.0, 1e-9)
assert 1 - tanh(20.0)**2 == 0.0          # float64 rounds tanh(20) to 1
assert 1 - tanh(20.0) == 0.0 and 2*exp(-40) < 2**-54  # 8.5e-18, under half a spacing
sech2 = 1/cosh(20.0)**2
c9 = 0.0
for _ in range(200):
    c9 = 0.9*c9 + 0.1
print(f"X03 c200: {c:.6f}; naive 1-tanh^2: 0.0; sech^2(20): {sech2:.6e};"
      f" with f=0.9: c200 {c9:.6f}, sech^2 {1/cosh(c9)**2:.6f}")

# X04: the output gate hides what the cell keeps.
dh_closed = 0.01*(tanh(0.5)-tanh(-0.5))
dh_open = 0.99*(tanh(0.99*0.5)-tanh(-0.99*0.5))
print(f"X04 gap in h, gate 0.01: {dh_closed:.6f}; next step, gate 0.99: {dh_open:.6f}")

# X05: masking a padded step must freeze both states.
c_pad = 0.5*1.0 + 0.5*0.6
leaked, frozen = 0.5*c_pad, 0.5*1.0
close(c_pad, 0.8)
print(f"X05 c after padding: {c_pad:.6f}; next h leaked/frozen: "
      f"{0.75*tanh(leaked):.6f} {0.75*tanh(frozen):.6f}")

# X06: which side z multiplies.
print(f"X06 kept by 0.9^10: {0.9**10:.6f}; by 0.1^10: {0.1**10:.1e}")

# X07: the GRU box, and what happens outside it.
hs7 = [3.0]
for _ in range(3):
    hs7.append(0.5*hs7[-1] + 0.5*0.0)
assert hs7 == [3.0, 1.5, 0.75, 0.375]
for h_start in (-1.0, 0.2, 1.0):
    h = h_start
    for zz, nn in ((0.3, 0.99), (0.9, -0.99), (0.01, 0.5)):
        h = zz*h + (1-zz)*nn
        assert abs(h) < 1
print("X07 outside start: 3 1.5 0.75 0.375; inside starts stay inside")

# X08: chrono initialisation.
for m in (2, 10, 100):
    bf = log(m-1)
    close(1/(1-sig(bf)), m)
    close(sig(-bf), 1-sig(bf))
print(f"X08 biases for m = 2, 10, 100: {log(1):.6f} {log(9):.6f} {log(99):.6f}")

# X09: a forget gate of one half can still amplify.
x9 = scalar_params(ZERO, {**ZERO, 'c': 3.0},
                   {'i': 0.0, 'f': 0.0, 'o': log(3), 'c': 0.0})
k = 0.5 + 0.5*3.0*0.75
close(k, 1.625)
eps = 1e-6
states = lstm(x9, [[0.0]]*20, [eps], [0.75*tanh(eps)])
ratios = [s['c'][0]/p['c'][0] for p, s in zip(states, states[1:4])]
for ratio in ratios:
    close(ratio, k, 1e-5)
grown = states[-1]['c'][0]
assert grown > 1000*eps
print(f"X09 linear factor: {k:.6f}; 20 steps from 1e-6: {grown:.6f};"
      f" linear prediction {eps*k**20:.6f}")

# X10: what backpropagation through time keeps.
N, T, H = 32, 1000, 512
rnn_bytes, lstm_bytes = 4*N*T*H, 4*N*T*6*H
assert (rnn_bytes, lstm_bytes) == (65_536_000, 393_216_000)
print(f"X10 stored bytes RNN/LSTM: {rnn_bytes} {lstm_bytes};"
      f" MiB {rnn_bytes/2**20:.1f} {lstm_bytes/2**20:.1f}")
