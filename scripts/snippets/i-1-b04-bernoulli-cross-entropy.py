"""I.1.B04 — cross-entropy for a Bernoulli target is the negative log-likelihood.

Computes both quantities from their own definitions, so agreeing is evidence
rather than a restatement.
"""
from math import log

def cross_entropy(p, y): return -(y * log(p) + (1 - y) * log(1 - p))
def likelihood(p, y):    return p if y == 1 else 1 - p

for p, y in [(0.8, 1), (0.8, 0), (0.5, 1), (0.99, 1)]:
    ce  = cross_entropy(p, y)
    nll = -log(likelihood(p, y))
    print(f"p={p:<5} y={y}   CE={ce:.4f}   NLL={nll:.4f}   equal={abs(ce-nll) < 1e-12}")
