"""Numerical checks for I.9. Run with Python 3; standard library only."""
from math import isclose, prod, sqrt, tanh


def close(actual, expected, tol=1e-8):
    assert isclose(actual, expected, rel_tol=tol, abs_tol=tol), (actual, expected)


def fd(f, xs, i, step=1e-6):
    plus, minus = list(xs), list(xs)
    plus[i] += step
    minus[i] -= step
    return (f(plus) - f(minus)) / (2 * step)


def states(xs, u=0.5, w=0.5, b=0.0, h0=0.0):
    hs = [h0]
    for x in xs:
        hs.append(tanh(u*x + w*hs[-1] + b))
    return hs


def scalar(xs, parameters, targets, nonlinear=False, h0=0.0):
    """None target means no local loss. The objective is a sum, not a mean."""
    u, w, b, v, c = parameters
    hs = [h0]
    for x in xs:
        a = u*x + w*hs[-1] + b
        hs.append(tanh(a) if nonlinear else a)
    errors = [0.0 if y is None else v*h+c-y
              for h, y in zip(hs[1:], targets)]
    loss = sum(e*e/2 for e in errors)
    grads = [0.0] * 5
    deltas = [0.0] * len(xs)
    future = 0.0
    for t in reversed(range(len(xs))):
        delta = (v*errors[t] + w*future)
        if nonlinear:
            delta *= 1-hs[t+1]**2
        deltas[t] = delta
        grads[0] += delta*xs[t]
        grads[1] += delta*hs[t]
        grads[2] += delta
        grads[3] += errors[t]*hs[t+1]
        grads[4] += errors[t]
        future = delta
    return loss, hs, grads, [u*d for d in deltas], w*deltas[0]


p = [1.0, 0.5, 0.0, 2.0, 0.0]
xs = [1.0, 2.0, 0.0]
ys = [None, None, 1.0]
loss, hs, grads, dx, dh0 = scalar(xs, p, ys)
assert hs == [0.0, 1.0, 2.5, 1.25]
close(loss, 1.125)
assert grads == [3.75, 9.0, 5.25, 1.875, 1.5]
assert dx == [0.75, 1.5, 3.0]
close(dh0, 0.375)
assert scalar([2.0, 1.0, 0.0], p, ys)[1] == [0.0, 2.0, 2.0, 1.0]
close(scalar([2.0, 1.0, 0.0], p, ys)[0], 0.5)
print("B01 states: 1.000000 2.500000 1.250000; loss: %.6f" % loss)
print("B02 du dw db dv dc:", " ".join(f"{g:.6f}" for g in grads))

# Scalar checks include input and initial-state derivatives, both activations,
# final-only and multi-position supervision, and nonzero initial state.
for nonlinear in (False, True):
    for targets in (ys, [0.2, -0.1, 0.7]):
        params = [0.7, -0.4, 0.15, 1.2, -0.2]
        values = [0.3, -0.8, 1.1]
        result = scalar(values, params, targets, nonlinear, h0=0.2)
        for i, g in enumerate(result[2]):
            numeric = fd(lambda q: scalar(values, q, targets, nonlinear, 0.2)[0],
                         params, i)
            close(g, numeric)
        for i, g in enumerate(result[3]):
            close(g, fd(lambda q: scalar(q, params, targets, nonlinear, 0.2)[0],
                        values, i))
        close(result[4], fd(lambda q: scalar(values, params, targets, nonlinear,
                                             q[0])[0], [0.2], 0))
for i, g in enumerate(grads):
    close(g, fd(lambda q: scalar(xs, q, ys)[0], p, i))


def vector_loss_and_dw(flat_w):
    """Two-state tanh cell, fixed U=I; non-symmetric W tests transpose order."""
    w = [flat_w[:2], flat_w[2:]]
    inputs = [[0.3, -0.2], [-0.1, 0.6], [0.5, 0.1]]
    targets = [0.2, -0.4, 0.3]
    v = [0.7, -0.9]
    h = [[0.1, -0.2]]
    for x in inputs:
        h.append([tanh(x[i]+sum(w[i][j]*h[-1][j] for j in range(2)))
                  for i in range(2)])
    errors = [sum(v[j]*ht[j] for j in range(2))-y
              for ht, y in zip(h[1:], targets)]
    dw = [[0.0, 0.0], [0.0, 0.0]]
    future = [0.0, 0.0]
    for t in reversed(range(3)):
        delta = [(v[i]*errors[t]+sum(w[j][i]*future[j] for j in range(2)))
                 * (1-h[t+1][i]**2) for i in range(2)]
        for i in range(2):
            for j in range(2):
                dw[i][j] += delta[i]*h[t][j]
        future = delta
    return sum(e*e/2 for e in errors), [g for row in dw for g in row]


w = [0.4, 0.8, -0.3, 0.2]
for i, g in enumerate(vector_loss_and_dw(w)[1]):
    close(g, fd(lambda q: vector_loss_and_dw(q)[0], w, i))
print("Finite differences: linear/tanh, local/final losses, inputs, h0, matrix W PASS")

# B03: powers checked against repeated matrix-vector application.
for n in range(1, 31):
    v = [0.0, 1.0]
    for _ in range(n):
        v = [0.5*v[0]+4*v[1], 0.5*v[1]]
    close(v[0], 4*n*0.5**(n-1))
    close(v[1], 0.5**n)
n1, n2 = sqrt(16+0.5**2), sqrt(16+0.25**2)
close(n1, 4.031128874149275)
close(n2, 4.00780488547035)
print(f"B03 norms: {n1:.6f} {n2:.6f}; step-10 first: {4*10*0.5**9:.6f}")

N, T, D, H, C = 4, 6, 3, 5, 2
parameters = H*D+H*H+H+C*H+C
macs, storage = N*T*(H*D+H*H+C*H), 4*N*T*H
assert (parameters, macs, storage, 4*N*H) == (57, 1200, 480, 80)
assert parameters+H == 62
assert N*T*(H*D+H*H)+N*C*H == 1000
print(f"B04 parameters: {parameters}; MACs: {macs}; hidden bytes: {storage}")

# B05: freeze h2 while checking the detached graph.
boundary = hs[2]
truncated = scalar([0.0], p, [1.0], h0=boundary)
close(truncated[0], loss)
assert truncated[2][:2] == [0.0, 7.5]
for i, g in enumerate(truncated[2]):
    close(g, fd(lambda q: scalar([0.0], q, [1.0], h0=boundary)[0], p, i))
reset = scalar([0.0], p, [1.0])
close(reset[0], 0.5)
two_step = scalar([2.0, 0.0], p, [None, 1.0], h0=1.0)
assert two_step[2][:2] == [3.0, 9.0]
print(f"B05 full dw/du: {grads[1]:.6f} {grads[0]:.6f}; detached: "
      f"{truncated[2][1]:.6f} {truncated[2][0]:.6f}")

# X01: swapping two inputs; also check the general equality expression.
a, b, weight = 1.0, 2.0, 0.5
close((b+weight*a)-(a+weight*b), (1-weight)*(b-a))
assert (b+weight*a, a+weight*b) == (2.5, 2.0)
print("X01 final states: %.6f %.6f" % (b+weight*a, a+weight*b))

d1, d2 = 5*(1-0.6**2), 5*(1-0.99**2)
close(d1, 3.2)
close(d2, 0.0995)
print(f"X02 delta/returned: {d1:.6f} {0.5*d1:.6f}; {d2:.6f} {0.5*d2:.6f}")

# X03: closed form and derivative, including w=0 and a nonzero initial state.
for weight in (0.0, 0.5, -0.7, 1.0):
    for initial in (0.0, 0.2):
        u, length = 0.8, len(xs)
        closed = weight**length*initial + u*sum(
            weight**(length-1-s)*x for s, x in enumerate(xs))
        derivative = length*weight**(length-1)*initial + u*sum(
            (length-1-s)*weight**(length-2-s)*xs[s] for s in range(length-1))
        result = scalar(xs, [u, weight, 0, 1, 0], ys, h0=initial)
        close(closed, result[1][-1])
        close(derivative, fd(lambda q: scalar(xs, [u, q[0], 0, 1, 0], ys,
                                              h0=initial)[1][-1], [weight], 0))
close(2*0.5+2, 3.0)
print("X03 h3: 1.250000; dh3/dw: 3.000000")

small, large = 0.7**30, 1.3**30
assert small > 1.17549435e-38  # Even above the smallest normal float32.
assert prod([2.0, 0.5]*15) == 1.0
print(f"X04 products: {small:.10f} 1.000000 {large:.6f}; alternating: 1.000000")

assert 2*0.25 == 0.5
for n in range(1, 10):
    close(prod([2.0, 0.25]*n), 0.5**n)
print("X05 factor norms: 2 2; product norm: 0.5; upper bound: 4")

valid = 2.0
padded, masked = 0.5*valid+0.0, valid
new_reset, new_carried = 0.5*0.0+1, 0.5*valid+1
assert (padded, masked, new_reset, new_carried) == (1.0, 2.0, 1.0, 2.0)
print("X06 padded/masked: 1 2; reset/carried: 1 2")

def clip(g, threshold):
    norm = sqrt(sum(x*x for x in g))
    scale = min(1.0, threshold/norm) if norm else 1.0
    return [x*scale for x in g]

assert clip([6.0, 8.0], 5) == [3.0, 4.0]
assert clip([0.0, 0.0], 5) == [0.0, 0.0]
assert clip([1.0, 2.0], 5) == [1.0, 2.0]
close(sqrt(0.3**2+0.4**2), 0.5)
print(f"X07 clipped: 3 4; step norm: 0.5; coordinate norm: {sqrt(50):.6f}")

assert 256**8 == 2**64 < 2**65
for bits in ([0, 1, 1, 0], [1, 1, 1]):
    state = 0
    for bit in bits:
        state ^= bit
    assert state == sum(bits) % 2
print("X08 state bits: 64; history bits: 65; parity states: 2")

def reverse_states(values):
    state = 0.0
    result = []
    for x in reversed(values):
        state = x+0.5*state
        result.append(state)
    return result

assert reverse_states([1, 2, 3]) == [3.0, 3.5, 2.75]
assert reverse_states([1, 2, 7]) == [7.0, 5.5, 3.75]
print("X09 position-one states: 2.750000 3.750000")

def offsets(dilations):
    reachable = {0}
    for dilation in dilations:
        reachable = {x+dilation*k for x in reachable for k in range(3)}
    return reachable

for layers in range(1, 7):
    reached = offsets([2**i for i in range(layers)])
    assert reached == set(range(2**(layers+1)-1))
assert 2**6-1 < 100 <= 2**7-1
assert offsets([2, 2, 2]) == {0, 2, 4, 6, 8, 10, 12}
print("X10 spans: 15 63 127; even-only span/count: 13 7")

nonlinear_history = states(xs)
close(nonlinear_history[1], 0.46211715726000974)
close(nonlinear_history[2], 0.8428861033202313)
assert all(-1.0 < value < 1.0 for value in nonlinear_history)
print("Tanh forward:", " ".join(f"{h:.6f}" for h in nonlinear_history))
