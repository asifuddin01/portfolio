"""Numerical checks for I.14. Run with Python 3; standard library only.

Most items use one small graph, the paw: a triangle on nodes 1, 2, 3 and a
pendant node 4 joined to 3. Python indices are one less than the prose's.
"""
from math import cos, isclose, log, pi, sqrt


def close(actual, expected, tol=1e-9):
    assert isclose(actual, expected, rel_tol=tol, abs_tol=tol), (actual, expected)


def mm(a, b):
    return [[sum(a[i][t]*b[t][j] for t in range(len(b))) for j in range(len(b[0]))]
            for i in range(len(a))]


def mv(a, v):
    return [sum(p*q for p, q in zip(row, v)) for row in a]


def tp(a):
    return [list(c) for c in zip(*a)]


def eye(n):
    return [[float(i == j) for j in range(n)] for i in range(n)]


def adjacency(n, edges):
    a = [[0.0]*n for _ in range(n)]
    for i, j in edges:
        a[i][j] = a[j][i] = 1.0
    return a


def gcn_matrix(a, self_loops=True):
    n = len(a)
    at = [[a[i][j] + (1.0 if self_loops and i == j else 0.0) for j in range(n)]
          for i in range(n)]
    d = [sum(r) for r in at]
    return [[at[i][j]/sqrt(d[i]*d[j]) for j in range(n)] for i in range(n)], d


def eigen_symmetric(m, sweeps=100):
    """Jacobi rotations: eigenvalues and eigenvectors (columns) of a symmetric matrix."""
    n = len(m)
    a = [row[:] for row in m]
    v = eye(n)
    for _ in range(sweeps):
        off = sum(a[i][j]**2 for i in range(n) for j in range(n) if i != j)
        if off < 1e-30:
            break
        for p in range(n):
            for q in range(p + 1, n):
                if abs(a[p][q]) < 1e-300:
                    continue
                theta = (a[q][q] - a[p][p])/(2*a[p][q])
                t = (1 if theta >= 0 else -1)/(abs(theta) + sqrt(theta*theta + 1))
                c = 1/sqrt(t*t + 1)
                s = t*c
                for k in range(n):
                    akp, akq = a[k][p], a[k][q]
                    a[k][p], a[k][q] = c*akp - s*akq, s*akp + c*akq
                for k in range(n):
                    apk, aqk = a[p][k], a[q][k]
                    a[p][k], a[q][k] = c*apk - s*aqk, s*apk + c*aqk
                for k in range(n):
                    vkp, vkq = v[k][p], v[k][q]
                    v[k][p], v[k][q] = c*vkp - s*vkq, s*vkp + c*vkq
    return [a[i][i] for i in range(n)], v


def permute(p, a=None, x=None):
    """Relabel node i as p[i]: A -> P A P^T, x -> P x."""
    n = len(p)
    out_a = None
    if a is not None:
        out_a = [[0.0]*n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                out_a[p[i]][p[j]] = a[i][j]
    out_x = None
    if x is not None:
        out_x = [None]*n
        for i in range(n):
            out_x[p[i]] = x[i]
    return out_a, out_x


PAW = adjacency(4, [(0, 1), (0, 2), (1, 2), (2, 3)])
x = [1.0, 2.0, 3.0, 4.0]
deg = [sum(r) for r in PAW]
A_hat, d_tilde = gcn_matrix(PAW)

# ── B01: one round of message passing, three aggregators ───────────────────
summed = mv(PAW, x)
mean = [s/d for s, d in zip(summed, deg)]
gcn = mv(A_hat, x)
assert summed == [5.0, 4.0, 7.0, 3.0] and deg == [2.0, 2.0, 3.0, 1.0]
assert d_tilde == [3.0, 3.0, 4.0, 2.0]
close(gcn[0], 1 + 3/sqrt(12))
close(gcn[2], 3/sqrt(12) + 0.75 + 4/sqrt(8))
close(gcn[3], 3/sqrt(8) + 2)
ones = mv(A_hat, [1.0]*4)                     # variation: constant features
for got, want in zip(ones, [0.955342, 0.955342, 1.180904, 0.853553]):
    close(got, want, 1e-6)
assert [s/d for s, d in zip(mv(PAW, [1.0]*4), deg)] == [1.0]*4
p = [3, 1, 2, 0]                              # swap nodes 1 and 4
pa, px = permute(p, PAW, x)
_, p_sum = permute(p, None, summed)
assert mv(pa, px) == p_sum                    # relabel in, relabel out
p_hat, _ = gcn_matrix(pa)
_, p_gcn = permute(p, None, gcn)
for got, want in zip(mv(p_hat, px), p_gcn):
    close(got, want)
print("B01 sum %s; mean %s; GCN %s; relabelled output is the relabelled input's"
      % ([round(v, 6) for v in summed], [round(v, 6) for v in mean],
         [round(v, 6) for v in gcn]))

# ── B02 and P03: where repeated averaging converges ────────────────────────
vals, vecs = eigen_symmetric(A_hat)
order = sorted(range(4), key=lambda i: -vals[i])
vals = [vals[i] for i in order]
vecs = [[vecs[r][i] for i in order] for r in range(4)]
u = [sqrt(d)/sqrt(sum(d_tilde)) for d in d_tilde]
close(vals[0], 1.0)
for r in range(4):
    close(abs(vecs[r][0]), u[r], 1e-9)
assert all(-1 < lam < 1 for lam in vals[1:])
second = max(abs(lam) for lam in vals[1:])
close(vals[1], (5 + sqrt(73))/24)                      # exact forms, B02
close(vals[3], (5 - sqrt(73))/24)
close(abs(vals[2]), 0.0)
close(sum(1/dd for dd in d_tilde), 17/12)                 # trace of A-hat
close(sum(A_hat[i][j]**2 for i in range(4) for j in range(4)), sum(v*v for v in vals))
close(sum(sqrt(dd)*xx for dd, xx in zip(d_tilde, x))/12, 1.404417, 1e-6)
limit = [ui*sum(uj*xj for uj, xj in zip(u, x)) for ui in u]
dist0 = sqrt(sum((a - b)**2 for a, b in zip(x, limit)))
dists, h = [], x[:]
for k in range(1, 17):
    h = mv(A_hat, h)
    dist = sqrt(sum((a - b)**2 for a, b in zip(h, limit)))
    assert dist <= second**k*dist0 + 1e-12   # the geometric bound
    if k in (1, 2, 4, 8, 16):
        dists.append(dist)
close(dists[3]/dists[4], second**-8, 4e-3)            # the rate, from k = 8 to 16
ratio = [hi/sqrt(di) for hi, di in zip(h, d_tilde)]   # limit is proportional to sqrt(d)
assert max(ratio) - min(ratio) < 1e-2
print("B02 eigenvalues %s; |lambda_2| %.6f; limit %s; distance at k = 1, 2, 4, 8, 16: %s"
      % ([round(v, 6) + 0.0 for v in vals], second, [round(v, 6) for v in limit],
         " ".join("%.6f" % dd for dd in dists)))
print("B02 distance at k = 0: %.6f; limit per sqrt(degree): %.6f"
      % (dist0, sum(uj*xj for uj, xj in zip(u, x))/sqrt(sum(d_tilde))))

# ── B03: two triangles and a hexagon ───────────────────────────────────────
TWO_TRIANGLES = adjacency(6, [(0, 1), (1, 2), (2, 0), (3, 4), (4, 5), (5, 3)])
HEXAGON = adjacency(6, [(i, (i + 1) % 6) for i in range(6)])


def wl_histogram(a, rounds=4):
    colours = [0]*len(a)
    history = []
    for _ in range(rounds):
        signatures = [(colours[v], tuple(sorted(colours[u] for u in range(len(a)) if a[v][u])))
                      for v in range(len(a))]
        palette = {s: i for i, s in enumerate(sorted(set(signatures)))}
        colours = [palette[s] for s in signatures]
        history.append(sorted(signatures))
    return history


assert wl_histogram(TWO_TRIANGLES) == wl_histogram(HEXAGON)


class Lcg:
    def __init__(self, seed):
        self.state = seed

    def __call__(self):
        self.state = (1103515245*self.state + 12345) % 2**31
        return self.state/2**31 - 0.5


def mpnn(a, layers=3, width=3, seed=7):
    """Sum aggregation, separate self and neighbour weights, tanh-free ReLU."""
    rand = Lcg(seed)
    h = [[1.0]*width for _ in a]
    for _ in range(layers):
        w0 = [[rand() for _ in range(width)] for _ in range(width)]
        w1 = [[rand() for _ in range(width)] for _ in range(width)]
        agg = mm(a, h)
        h = [[max(0.0, sum(h[v][i]*w0[i][j] + agg[v][i]*w1[i][j] for i in range(width)))
              for j in range(width)] for v in range(len(a))]
    return h


for seed in (1, 7, 42):
    e1 = sorted(tuple(round(v, 12) for v in row) for row in mpnn(TWO_TRIANGLES, seed=seed))
    e2 = sorted(tuple(round(v, 12) for v in row) for row in mpnn(HEXAGON, seed=seed))
    assert e1 == e2
TWO_K4 = adjacency(8, [(i, j) for i in range(4) for j in range(i + 1, 4)]
                    + [(i + 4, j + 4) for i in range(4) for j in range(i + 1, 4)])
CUBE = adjacency(8, [(i, i ^ b) for i in range(8) for b in (1, 2, 4) if i < i ^ b])
assert all(sum(r) == 3 for r in TWO_K4) and all(sum(r) == 3 for r in CUBE)
assert wl_histogram(TWO_K4) == wl_histogram(CUBE)
assert [sum(mm(mm(g, g), g)[i][i] for i in range(8))/6 for g in (TWO_K4, CUBE)] == [8.0, 0.0]
close(second**8*dist0, 0.025884, 1e-6)                    # B02's bound at k = 8
triangles = [sum(mm(mm(g, g), g)[i][i] for i in range(6))/6 for g in (TWO_TRIANGLES, HEXAGON)]
assert triangles == [2.0, 0.0]
print("B03 1-WL histograms equal; three random sum-aggregation networks agree on both;"
      " triangles %d and %d; components 2 and 1" % tuple(triangles))

# ── B04: what a layer costs ────────────────────────────────────────────────
n, m, width = 10**6, 10**7, 128
dense = n*n*width
sparse = 2*m*width + n*width*width
dense_bytes = n*n*4
edge_bytes = 2*m*2*8
print("B04 dense %.3g MACs, sparse %.3g MACs (%.4g + %.4g); dense adjacency %.3g bytes,"
      " edge list %.3g bytes; average degree %d; 3-hop bound %d; sampled 25 x 10: %d"
      % (dense, sparse, 2*m*width, n*width*width, dense_bytes, edge_bytes, 2*m//n,
         (2*m//n)**3, 25*10))

# ── B05: a batch of three graphs ───────────────────────────────────────────
sizes = [4, 3, 5]
edge_sets = [[(0, 1), (0, 2), (1, 2), (2, 3)], [(0, 1), (1, 2)],
             [(i, (i + 1) % 5) for i in range(5)]]
offsets = [0, 4, 7]
batch = [g for g, s in enumerate(sizes) for _ in range(s)]
edges = [(i + o, j + o) for es, o in zip(edge_sets, offsets) for i, j in es]
big = adjacency(12, edges)
for g, (s, o) in enumerate(zip(sizes, offsets)):   # block diagonal
    for i in range(12):
        for j in range(12):
            if big[i][j]:
                assert (o <= i < o + s) == (o <= j < o + s)
wrong = adjacency(12, [e for es in edge_sets for e in es])
feats = [1.0]*12
right_read = [sum(v for v, b in zip(mv(big, feats), batch) if b == g) for g in range(3)]
wrong_read = [sum(v for v, b in zip(mv(wrong, feats), batch) if b == g) for g in range(3)]
assert right_read == [8.0, 4.0, 10.0]
print("B05 %d nodes, batch %s, %d directed edge entries, offsets %s; readout of one"
      " summed round: right %s, without offsets %s"
      % (sum(sizes), batch, 2*len(edges), offsets, right_read, wrong_read))

# ── X01: a path of three nodes ─────────────────────────────────────────────
P3 = adjacency(3, [(0, 1), (1, 2)])
p3_hat, p3_d = gcn_matrix(P3)
p3_out = mv(p3_hat, [1.0, 0.0, 0.0])
close(p3_out[0], 0.5)
close(p3_out[1], 1/sqrt(6))
print("X01 degrees with self-loops %s; A-hat row 1 %s; signal (1, 0, 0) becomes %s"
      % (p3_d, [round(v, 6) for v in p3_hat[0]], [round(v, 6) for v in p3_out]))

# ── X02: an order-dependent layer is not equivariant ───────────────────────
def first_neighbour(a, x):
    """Take each node's lowest-numbered neighbour: depends on the labelling."""
    return [x[min(j for j in range(len(a)) if a[i][j])] for i in range(len(a))]


out = first_neighbour(PAW, x)
_, want = permute(p, None, out)
got = first_neighbour(pa, px)
assert got != want
print("X02 lowest-numbered neighbour: %s; after relabelling %s, not %s" % (out, got, want))

# ── X03: mean and max forget the multiset ──────────────────────────────────
pairs = [([1, 1, 2, 2], [1, 2]), ([1, 1, 2], [1, 2, 2])]
rows = []
for a, b in pairs:
    rows.append(((sum(a), sum(b)), (sum(a)/len(a), sum(b)/len(b)), (max(a), max(b))))
assert rows[0][1][0] == rows[0][1][1] and rows[0][2][0] == rows[0][2][1]
assert rows[1][2][0] == rows[1][2][1] and rows[1][1][0] != rows[1][1][1]
star2 = adjacency(3, [(0, 1), (0, 2)])
star4 = adjacency(5, [(0, i) for i in range(1, 5)])
centre_sum = (mv(star2, [1.0]*3)[0], mv(star4, [1.0]*5)[0])
assert centre_sum == (2.0, 4.0)
print("X03 {1,1,2,2} vs {1,2}: sum %s, mean %s, max %s; {1,1,2} vs {1,2,2}: sum %s, mean"
      " (%.6f, %.6f), max %s; star centres: mean 1 and 1, sum %s"
      % (rows[0][0], rows[0][1], rows[0][2], rows[1][0], *rows[1][1], rows[1][2], centre_sum))

# ── X04 and X05: the cycle's spectrum ──────────────────────────────────────
C6 = adjacency(6, [(i, (i + 1) % 6) for i in range(6)])
c6_hat, _ = gcn_matrix(C6)
c6_vals = sorted(eigen_symmetric(c6_hat)[0], reverse=True)
want_vals = sorted(((1 + 2*cos(2*pi*j/6))/3 for j in range(6)), reverse=True)
for g, w in zip(c6_vals, want_vals):
    close(g, w)
plain, _ = gcn_matrix(C6, self_loops=False)
plain_vals = sorted(eigen_symmetric(plain)[0])
close(plain_vals[0], -1.0)
alternate = [(-1.0)**i for i in range(6)]
for g, w in zip(mv(plain, alternate), alternate):
    close(g, -w)                              # flips sign every layer
layers = next(k for k in range(1, 100) if (2/3)**k < 0.01)
# A polynomial in a symmetric matrix is symmetric; the difference operator is not.
diff = [[(1.0 if j == (i + 1) % 6 else -1.0 if j == (i - 1) % 6 else 0.0) for j in range(6)]
        for i in range(6)]
assert all(diff[i][j] == -diff[j][i] for i in range(6) for j in range(6))
sq = mm(c6_hat, c6_hat)
assert all(isclose(sq[i][j], sq[j][i]) for i in range(6) for j in range(6))
print("X04 C6 GCN eigenvalues %s; the difference operator is antisymmetric"
      % [round(v, 6) + 0.0 for v in c6_vals])
print("X05 |lambda_2| = 2/3; layers for 1%%: %d ((2/3)^%d = %.6f); without self-loops the"
      " smallest eigenvalue is %.1f and the alternating signal flips each layer"
      % (layers, layers, (2/3)**layers, plain_vals[0]))

# ── X06: backpropagation through one graph convolution ────────────────────
w, target = 0.5, [0.0, 0.0, 1.0, 1.0]


def gcn_loss(xs, ws):
    y = [ws*v for v in mv(A_hat, xs)]
    return 0.5*sum((a - b)**2 for a, b in zip(y, target)), y


loss, y = gcn_loss(x, w)
resid = [a - b for a, b in zip(y, target)]
grad_w = sum(a*b for a, b in zip(mv(A_hat, x), resid))
grad_x = [w*v for v in mv(tp(A_hat), resid)]
h = 1e-6
close((gcn_loss(x, w + h)[0] - gcn_loss(x, w - h)[0])/(2*h), grad_w, 1e-6)
for i in range(4):
    xp, xm = x[:], x[:]
    xp[i] += h
    xm[i] -= h
    close((gcn_loss(xp, w)[0] - gcn_loss(xm, w)[0])/(2*h), grad_x[i], 1e-6)
print("X06 output %s; loss %.6f; dL/dw %.6f; dL/dx %s"
      % ([round(v, 6) for v in y], loss, grad_w, [round(v, 6) for v in grad_x]))

# ── X07: two layers cannot see three hops ──────────────────────────────────
def path(n_nodes):
    return adjacency(n_nodes, [(i, i + 1) for i in range(n_nodes - 1)])


views = []
for n_nodes in (4, 5):
    ah, _ = gcn_matrix(path(n_nodes))
    hh = [1.0]*n_nodes
    seen = []
    for _ in range(3):
        hh = mv(ah, hh)
        seen.append(hh[0])
    views.append(seen)
close(views[0][1], views[1][1])
assert abs(views[0][2] - views[1][2]) > 1e-3
print("X07 node 1 of P4 after 1, 2, 3 layers: %s; of P5: %s"
      % ([round(v, 6) for v in views[0]], [round(v, 6) for v in views[1]]))

# ── X08: an edge list for the paw ──────────────────────────────────────────
directed = [(i, j) for i in range(4) for j in range(4) if PAW[i][j]]
with_loops = directed + [(i, i) for i in range(4)]
src = [x[i] for i, _ in directed]
scatter = [0.0]*4
for (i, j), value in zip(directed, src):
    scatter[j] += value
assert scatter == summed
print("X08 %d undirected edges, %d directed entries, %d with self-loops; gather then"
      " scatter-add gives %s" % (len(directed)//2, len(directed), len(with_loops), scatter))

# ── X09: sampling neighbours ───────────────────────────────────────────────
def sampled_mean_variance(var, degree, s):
    return var/s*(degree - s)/(degree - 1)


samples = [sampled_mean_variance(1.0, 100, s) for s in (10, 25, 100)]
close(samples[2], 0.0)
print("X09 variance of a sampled mean, degree 100: s = 10 %.6f, s = 25 %.6f, s = 100 %.1f"
      % tuple(samples))

# ── X10: the Laplacian spectrum separates the pair ────────────────────────
def laplacian(a):
    return [[(sum(a[i]) if i == j else 0.0) - a[i][j] for j in range(len(a))]
            for i in range(len(a))]


spec = [sorted(round(v, 9) + 0.0 for v in eigen_symmetric(laplacian(g))[0])
        for g in (TWO_TRIANGLES, HEXAGON)]
assert spec[0] == [0.0, 0.0, 3.0, 3.0, 3.0, 3.0] and spec[1] == [0.0, 1.0, 1.0, 3.0, 3.0, 4.0]
print("X10 Laplacian spectra: two triangles %s; hexagon %s" % (spec[0], spec[1]))
