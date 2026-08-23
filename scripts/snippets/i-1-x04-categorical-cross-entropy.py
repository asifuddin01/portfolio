"""I.1.X04 — categorical cross-entropy is the negative log-likelihood too."""
from math import log
p = [0.7, 0.2, 0.1]
for true_class in (0, 1, 2):
    y  = [1.0 if k == true_class else 0.0 for k in range(3)]
    ce = -sum(y[k] * log(p[k]) for k in range(3))
    nll = -log(p[true_class])
    print(f"true={true_class}  CE={ce:.4f}  NLL={nll:.4f}  equal={abs(ce-nll) < 1e-12}")
print(f"entropy of p   {-sum(q * log(q) for q in p):.4f}")
