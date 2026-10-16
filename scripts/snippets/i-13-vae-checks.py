"""Numerical checks for I.13. Run with Python 3; standard library only.

The chapter reuses the four points of I.12, (1, 2), (2.2, 0.4), (-1, -2) and
(-2.2, -0.4), whose covariance has eigenvalues 4 and 1 along u1 = (0.8, 0.6)
and u2 = (-0.6, 0.8). The model is linear and Gaussian with one latent
dimension, so every expectation has a closed form; numerical integration
checks the closed forms wherever one is quoted.
"""
from math import cos, e, exp, isclose, log, pi, sin, sqrt


def close(actual, expected, tol=1e-9):
    assert isclose(actual, expected, rel_tol=tol, abs_tol=tol), (actual, expected)


def integrate(f, lo=-12.0, hi=12.0, n=24000):
    """Composite Simpson's rule; ample for the smooth integrands used here."""
    h = (hi - lo)/n
    total = f(lo) + f(hi)
    for i in range(1, n):
        total += (4 if i % 2 else 2)*f(lo + i*h)
    return total*h/3


def normal(z, mean, var):
    return exp(-(z - mean)**2/(2*var))/sqrt(2*pi*var)


def kl_normal(m1, v1, m2, v2):
    """KL(N(m1, v1) || N(m2, v2)) for scalars."""
    return 0.5*(v1/v2 + (m1 - m2)**2/v2 - 1 + log(v2/v1))


X = [(1.0, 2.0), (2.2, 0.4), (-1.0, -2.0), (-2.2, -0.4)]
U1, U2 = (0.8, 0.6), (-0.6, 0.8)
LAM1, LAM2 = 4.0, 1.0
TOTAL = LAM1 + LAM2
LOG2PI = log(2*pi)


def dot(a, b):
    return sum(p*q for p, q in zip(a, b))


def scale(c, v):
    return tuple(c*p for p in v)


def sub(a, b):
    return tuple(p - q for p, q in zip(a, b))


def log_evidence(x, w, var):
    """log N(x; 0, w w^T + var I) in two dimensions, through the eigenbasis."""
    a, b = dot(U1, x), dot(U2, x)
    big = dot(w, w) + var                     # eigenvalue along w (w is along u1)
    return -LOG2PI - 0.5*log(big*var) - 0.5*(a*a/big + b*b/var)


def posterior(x, w, var):
    """p(z | x) for z ~ N(0, 1), x | z ~ N(w z, var I): mean and variance."""
    c = dot(w, w) + var
    return dot(w, x)/c, var/c


def elbo(x, w, var, m, v, beta=1.0):
    """E_q log p(x | z) - beta KL(q || N(0, 1)) for q = N(m, v)."""
    sq = dot(x, x) - 2*m*dot(w, x) + (m*m + v)*dot(w, w)    # E_q ||x - w z||^2
    recon = -LOG2PI - log(var) - sq/(2*var)
    return recon - beta*kl_normal(m, v, 0.0, 1.0)


# ── P01: probabilistic PCA on the four points ──────────────────────────────
sigma2 = LAM2                                 # mean of the discarded eigenvalues
W = scale(sqrt(LAM1 - sigma2), U1)            # Tipping and Bishop's maximum
x = X[0]
logp = log_evidence(x, W, sigma2)
close(logp, -LOG2PI - log(2) - 1)
for p in X:                                   # every corner has the same evidence
    close(log_evidence(p, W, sigma2), logp)
by_quadrature = integrate(lambda z: normal(z, 0, 1)*exp(-dot(sub(x, scale(z, W)),
                          sub(x, scale(z, W)))/(2*sigma2))/(2*pi*sigma2))
close(log(by_quadrature), logp, 1e-9)
m_post, v_post = posterior(x, W, sigma2)
close(m_post, sqrt(3)/2)
close(v_post, 0.25)
# The model covariance is the data covariance: average log-likelihood.
close(sum(log_evidence(p, W, sigma2) for p in X)/4, -0.5*(2*LOG2PI + log(4) + 2))
print("P01 w = (%.6f, %.6f); log p(x) = %.6f, p(x) = %.6f; posterior N(%.6f, %.2f)"
      % (*W, logp, exp(logp), m_post, v_post))


def relative_variance(mean, var):
    """Var of the prior-sampling estimate of p(x), divided by p(x)^2: (I.13.3)."""
    return exp(mean*mean/(2 - var))/(sqrt(var)*sqrt(2 - var)) - 1


rv = relative_variance(m_post, v_post)
close(rv + 1, integrate(lambda z: normal(z, m_post, v_post)**2/normal(z, 0, 1)))
w_sharp = scale(sqrt(LAM1 - 0.01), U1)
m_sharp, v_sharp = posterior(x, w_sharp, 0.01)
rv_sharp = relative_variance(m_sharp, v_sharp)
close(rv_sharp + 1, integrate(lambda z: normal(z, m_sharp, v_sharp)**2/normal(z, 0, 1),
                              -3, 4, 60000), 1e-7)
print("P01 prior-sampling relative variance: %.6f at sigma^2 = 1, %.6f at 0.01"
      % (rv, rv_sharp))

# ── B01: one point, four bounds ────────────────────────────────────────────
candidates = [("prior", 0.0, 1.0), ("right width, mean 0", 0.0, 0.25),
              ("right mean, width 1", m_post, 1.0), ("posterior", m_post, v_post)]
rows = []
for name, m, v in candidates:
    bound = elbo(x, W, sigma2, m, v)
    gap = logp - bound
    close(gap, kl_normal(m, v, m_post, v_post))           # (I.13.4)
    assert gap >= -1e-12
    rows.append((bound, gap))
close(rows[-1][1], 0.0)
close(rows[0][0], -LOG2PI - 4)
print("B01 log p(x) %.6f; ELBO and gap: %s"
      % (logp, "; ".join("%.6f %.6f" % (b, g + 0.0) for b, g in rows)))
print("B01 at the posterior: reconstruction %.6f, KL %.6f"
      % (-LOG2PI - 1, kl_normal(m_post, v_post, 0, 1)))

# ── B02: the Gaussian KL and its derivatives ───────────────────────────────
for m, v in ((0.0, 1.0), (1.0, 0.25), (m_post, v_post), (-0.3, 2.0)):
    numeric = integrate(lambda z: normal(z, m, v)*log(normal(z, m, v)/normal(z, 0, 1)))
    close(numeric, 0.5*(m*m + v - 1 - log(v)), 1e-8)       # (I.13.5)
    h = 1e-6
    close((kl_normal(m + h, v, 0, 1) - kl_normal(m - h, v, 0, 1))/(2*h), m, 1e-7)
    lv = log(v)
    close((kl_normal(m, exp(lv + h), 0, 1) - kl_normal(m, exp(lv - h), 0, 1))/(2*h),
          0.5*(v - 1), 1e-7)
# The posterior maximises the ELBO over (m, v): the gradient vanishes there.
h = 1e-6
for dm, dv in ((h, 0), (0, h)):
    close((elbo(x, W, sigma2, m_post + dm, v_post + dv)
           - elbo(x, W, sigma2, m_post - dm, v_post - dv))/(2*h), 0.0, 1e-6)
print("B02 KL(N(1, 0.25) || N(0, 1)) = %.6f; derivatives at (0.866025, 0.25): %.6f %.6f"
      % (kl_normal(1, 0.25, 0, 1), m_post, 0.5*(v_post - 1)))

# ── B03 and P04: the linear beta-VAE, rate and distortion ──────────────────
def beta_vae_optimum(beta, var=1.0):
    """Optimal ||w||^2, encoder mean factor and variance, rate and distortion."""
    r = max(LAM1 - beta*var, 0.0)
    c = r + beta*var
    v = beta*var/c
    mean_sq = r*LAM1/c**2                    # E[m^2] over the data, m = w.x/c
    rate = 0.5*(mean_sq + v - 1 - log(v))
    distortion = TOTAL - 2*r*LAM1/c + (mean_sq + v)*r
    return r, v, rate, distortion


def beta_objective(r, beta, var=1.0):
    """Average beta-ELBO with the encoder at its optimum, as a function of ||w||^2."""
    w = scale(sqrt(r), U1)
    c = r + beta*var
    return sum(elbo(p, w, var, dot(w, p)/c, beta*var/c, beta) for p in X)/4


table = []
for beta in (0.25, 0.5, 1.0, 2.0, 4.0, 8.0):
    r, v, rate, distortion = beta_vae_optimum(beta)
    if beta < LAM1:
        close(rate, 0.5*log(LAM1/beta))
        close(distortion, LAM2 + beta)
    else:
        close(rate, 0.0)
        close(distortion, TOTAL)
    best = beta_objective(r, beta)
    for other in (r + 0.05, max(r - 0.05, 0.0), r + 0.5):
        assert beta_objective(other, beta) <= best + 1e-12
    table.append((beta, r, rate, distortion))
r1, v1, rate1, d1 = beta_vae_optimum(1.0)
close(r1, dot(W, W))                          # beta = 1 is probabilistic PCA
close(v1, v_post)
close(beta_objective(r1, 1.0), logp)          # and the bound is tight there
print("B03 beta: ||w||^2, rate, distortion: %s"
      % "; ".join("%g: %.6f %.6f %.6f" % row for row in table))
close(TOTAL - LAM1, 1.0)                      # beta -> 0 distortion: I.12's loss

# ── B04: two estimators of one gradient ────────────────────────────────────
mu, s = 1.0, 0.5
pathwise_var = 4*s*s
score_second = (mu**4 + 18*mu*mu*s*s + 15*s**4)/(s*s)
score_var = score_second - 4*mu*mu
gauss = lambda f: integrate(lambda t: normal(t, 0, 1)*f(t))
close(gauss(lambda t: 2*(mu + s*t)), 2*mu, 1e-9)
close(gauss(lambda t: (mu + s*t)**2*t/s), 2*mu, 1e-9)
close(gauss(lambda t: (2*(mu + s*t))**2) - 4*mu*mu, pathwise_var, 1e-8)
close(gauss(lambda t: ((mu + s*t)**2*t/s)**2) - 4*mu*mu, score_var, 1e-8)
baseline_var = 8*mu*mu + 10*s*s                          # variation: subtract E f
close(gauss(lambda t: ((mu + s*t)**2 - mu*mu - s*s)*t/s), 2*mu, 1e-9)
close(gauss(lambda t: (((mu + s*t)**2 - mu*mu - s*s)*t/s)**2) - 4*mu*mu, baseline_var, 1e-8)
close(baseline_var, 10.5)
small = [(sv, 4*sv*sv, (mu**4 + 18*mu*mu*sv*sv + 15*sv**4)/(sv*sv) - 4*mu*mu)
         for sv in (0.5, 0.1, 0.01)]
print("B04 gradient %.1f; variances pathwise %.6f, score function %.6f; ratio %.2f;"
      " s = 0.1: %.4f %.4f; s = 0.01: %.6f %.2f"
      % (2*mu, pathwise_var, score_var, score_var/pathwise_var,
         small[1][1], small[1][2], small[2][1], small[2][2]))

# ── B05: what sampling the prior costs ─────────────────────────────────────
def samples_needed(rel_var, target=0.1):
    return rel_var/target**2


counts = []
for rel in (rv, rv_sharp):
    counts.append((samples_needed(rel), samples_needed((1 + rel)**10 - 1)))
print("B05 samples for 10%% error, 1 and 10 dims: sigma^2 = 1: %.1f %.4g;"
      " sigma^2 = 0.01: %.1f %.4g"
      % (counts[0][0], counts[0][1], counts[1][0], counts[1][1]))
encoder_head = 400*2*20 + 2*20
print("B05 encoder head 400 -> 2 x 20: %d parameters; ELBO step: 1 encoder pass,"
      " 1 decoder pass per sample" % encoder_head)

# ── X01: a Gaussian KL by hand, both ways round ────────────────────────────
forward, backward = kl_normal(1, 0.25, 0, 1), kl_normal(0, 1, 1, 0.25)
print("X01 KL(N(1, 0.25) || N(0, 1)) = %.6f; reversed %.6f" % (forward, backward))

# ── X02: one reparameterised gradient ──────────────────────────────────────
m, s, eps = 0.5, 0.5, 0.6
z = m + s*eps
dz = dot(W, x) - dot(W, W)*z                  # d/dz of -||x - w z||^2 / 2
grad_m = dz - m                               # minus d KL / d m
grad_s = dz*eps - (s - 1/s)                   # d KL / d s = s - 1/s
expected_m = dot(W, x) - dot(W, W)*m - m
close(expected_m, gauss(lambda t: dot(W, x) - dot(W, W)*(m + s*t)) - m)
h = 1e-6
fd = (elbo(x, W, sigma2, m + h, s*s) - elbo(x, W, sigma2, m - h, s*s))/(2*h)
close(fd, expected_m, 1e-7)
print("X02 z = %.1f; dz term %.6f; one-sample grads (m, s): %.6f %.6f; expected d/dm %.6f"
      % (z, dz, grad_m, grad_s, expected_m))

# ── X03: a factorised encoder underestimates a correlated posterior ────────
rho = 0.9
v_fact = 1 - rho*rho
gap = -0.5*log(1 - rho*rho)
inv = 1/(1 - rho*rho)


def kl_factorised(v):
    """KL(N(0, diag(v, v)) || N(0, [[1, rho], [rho, 1]]))."""
    return 0.5*(2*v*inv - 2 + log(1 - rho*rho) - 2*log(v))


close(kl_factorised(v_fact), gap)
for other in (v_fact*0.9, v_fact*1.1, 1.0):
    assert kl_factorised(other) > gap
print("X03 factorised variance %.2f against true 1; smallest KL %.6f" % (v_fact, gap))

# ── X04: a point code has infinite rate ────────────────────────────────────
rates = [kl_normal(m_post, sd*sd, 0, 1) for sd in (0.1, 0.01, 0.001)]
close(rates[1] - rates[0], log(10) + 0.5*(0.01**2 - 0.1**2))   # s^2 term, nearly gone
print("X04 KL at s = 0.1, 0.01, 0.001: %.6f %.6f %.6f; each step adds %.6f"
      % (*rates, log(10)))

# ── X05: Jensen, and where it is tight ─────────────────────────────────────
weights = [exp(log_evidence(x, W, sigma2))]   # p(x, z)/q(z) is p(x) at the posterior
lhs = log(integrate(lambda z: normal(z, 0, 1)*exp(-dot(sub(x, scale(z, W)),
          sub(x, scale(z, W)))/2)/(2*pi)))
close(lhs, logp)
for z0 in (-1.0, 0.0, 0.5, 2.0):
    joint = normal(z0, 0, 1)*exp(-dot(sub(x, scale(z0, W)), sub(x, scale(z0, W)))/2)/(2*pi)
    close(log(joint/normal(z0, m_post, v_post)), logp)
print("X05 log p(x, z) - log p(z | x) = %.6f at every z" % logp)

# ── X06: the rate splits into information and a mismatch ──────────────────
means = sorted({round(dot(W, p)/(dot(W, W) + sigma2), 12) for p in X})
mix = lambda t: sum(normal(t, mm, v_post) for mm in means)/len(means)
h_marg = -integrate(lambda t: mix(t)*log(mix(t)))
h_cond = 0.5*log(2*pi*e*v_post)
info = h_marg - h_cond
kl_marg = -h_marg + 0.5*LOG2PI + 0.5*integrate(lambda t: mix(t)*t*t)
avg_kl = sum(kl_normal(dot(W, p)/4, v_post, 0, 1) for p in X)/4
close(avg_kl, log(2))
close(info + kl_marg, avg_kl, 1e-9)
close(integrate(lambda t: mix(t)*t*t), 1.0, 1e-9)
close(mix(0.0), 0.5*2*normal(0.0, sqrt(3)/2, 0.25))      # the mixture at zero
close(normal(0.0, 0, 1), 1/sqrt(2*pi))
assert mix(0.0) < 0.5*normal(0.0, 0, 1)                    # less than half the prior
print("X06 average KL %.6f = information %.6f + marginal KL %.6f; aggregate variance %.6f;"
      " density at 0: %.6f against the prior's %.6f"
      % (avg_kl, info, kl_marg, integrate(lambda t: mix(t)*t*t), mix(0.0), normal(0.0, 0, 1)))

# ── X07: a mean reduction weights the KL by the input width ───────────────
d, k = 784, 32
threshold, most_variance = d*0.5, d*0.25                  # a [0, 1] pixel: variance <= 1/4
assert most_variance < threshold                          # every direction collapses
print("X07 effective beta %d; survives only above %.0f; total pixel variance at most %.0f"
      % (d, threshold, most_variance))

# ── X08: a discrete code has no pathwise derivative ───────────────────────
f0, f1 = (0 - 0.3)**2, (1 - 0.3)**2
true_grad = f1 - f0
p_on = 0.5
score_vals = [f1/p_on, -f0/(1 - p_on)]
mean_score = p_on*score_vals[0] + (1 - p_on)*score_vals[1]
var_score = p_on*(score_vals[0] - mean_score)**2 + (1 - p_on)*(score_vals[1] - mean_score)**2
close(mean_score, true_grad)
print("X08 true gradient %.2f; pathwise estimate 0; score function values %.2f %.2f,"
      " variance %.4f" % (true_grad, *score_vals, var_score))

# ── X09: the identity behind X06 holds for any encoder ────────────────────
for scale_m, v in ((0.3, 0.5), (1.0, 0.1), (0.0, 1.0)):
    ms = [scale_m*mm for mm in means]
    mixed = lambda t: sum(normal(t, mm, v) for mm in ms)/len(ms)
    hm = -integrate(lambda t: mixed(t)*log(mixed(t)) if mixed(t) > 0 else 0.0)
    left = sum(kl_normal(mm, v, 0, 1) for mm in ms)/len(ms)
    right = (hm - 0.5*log(2*pi*e*v)) + (-hm + 0.5*LOG2PI + 0.5*integrate(lambda t: mixed(t)*t*t))
    close(left, right, 1e-8)
print("X09 identity checked for three encoders; at mean 0, variance 1 both sides are 0")

# ── X10: the pathwise estimator is not always the quieter one ─────────────
omega, sd = 10.0, 1.0
pw_mean = gauss(lambda t: omega*cos(omega*sd*t))
pw_var = gauss(lambda t: (omega*cos(omega*sd*t))**2) - pw_mean**2
sf_mean = gauss(lambda t: sin(omega*sd*t)*t/sd)
sf_var = gauss(lambda t: (sin(omega*sd*t)*t/sd)**2) - sf_mean**2
exact = omega*exp(-omega**2*sd**2/2)          # 10 e^-50: zero to print precision
assert abs(pw_mean - exact) < 1e-12 and abs(sf_mean - exact) < 1e-12
close(pw_var, omega**2*(0.5*(1 + exp(-2*omega**2*sd**2)) - exp(-omega**2*sd**2)), 1e-8)
print("X10 exact gradient %.1e; variances pathwise %.4f, score function %.4f"
      % (exact, pw_var, sf_var))
