"""I.7.X09 — the 1/B variance law, measured rather than assumed.

Builds a population of per-example gradients with a known mean and variance,
draws many minibatches of each size, and compares the measured variance of the
batch mean against sigma^2/B. Agreement to a few percent over three orders of
magnitude in B is the evidence; the derivation is I.7.X10.

A small linear congruential generator stands in for random, so the numbers are
reproducible without importing anything.
"""

N = 10_000                         # population size
TRIALS = 4_000                     # minibatches drawn per size


class LCG:
    """Numerical Recipes constants. Deterministic across machines."""

    def __init__(self, seed=12345):
        self.s = seed

    def next_index(self, n):
        self.s = (1664525 * self.s + 1013904223) % (2 ** 32)
        return self.s % n


# A population with a deliberately non-normal shape, so the result does not
# depend on the per-example gradients being Gaussian.
pop = [((i % 97) - 48) * 0.1 + (3.0 if i % 1000 == 0 else 0.0) for i in range(N)]
mu = sum(pop) / N
sigma2 = sum((x - mu) ** 2 for x in pop) / N

print(f"population N = {N:,}")
print(f"  mean mu        {mu:.6f}")
print(f"  variance s^2   {sigma2:.6f}")
print(f"  std   s        {sigma2 ** 0.5:.6f}")

print()
print(f"{'B':>6} {'measured Var':>14} {'s^2/B':>14} {'ratio':>8} {'mean of means':>15}")
rng = LCG()
for B in (1, 2, 8, 32, 128, 512):
    means = []
    for _ in range(TRIALS):
        acc = 0.0
        for _ in range(B):
            acc += pop[rng.next_index(N)]
        means.append(acc / B)
    m = sum(means) / TRIALS
    var = sum((x - m) ** 2 for x in means) / (TRIALS - 1)
    pred = sigma2 / B
    print(f"{B:6d} {var:14.6f} {pred:14.6f} {var/pred:8.3f} {m:15.6f}")

print()
print("unbiasedness: every 'mean of means' above sits near mu = "
      f"{mu:.6f}, for every B")
print("variance: the ratio is near 1, so Var falls as 1/B across three orders")
