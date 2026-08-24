"""I.4.B05 — weights that equalise what each class contributes to the gradient."""
n_neg, n_pos = 950, 50
N, K = n_neg + n_pos, 2

print(f"counts      negative {n_neg}   positive {n_pos}   ratio {n_neg/n_pos:.0f}:1")
print(f"unweighted  negative mass {n_neg/N*100:.0f}%   positive mass {n_pos/N*100:.0f}%")

w_neg = N / (K * n_neg)
w_pos = N / (K * n_pos)
print(f"\ninverse-frequency weights")
print(f"  w_neg = N/(K*n_neg) = {N}/({K}*{n_neg}) = {w_neg:.4f}")
print(f"  w_pos = N/(K*n_pos) = {N}/({K}*{n_pos}) = {w_pos:.4f}")
print(f"  ratio w_pos/w_neg   = {w_pos/w_neg:.4f}")
print(f"  weighted mass       negative {n_neg*w_neg:.1f}   positive {n_pos*w_pos:.1f}")
print(f"  mean weight         {(n_neg*w_neg + n_pos*w_pos)/N:.4f}  (loss scale preserved)")

beta = 0.999
eff = lambda n: (1 - beta) / (1 - beta ** n)
e_neg, e_pos = eff(n_neg), eff(n_pos)
s = 2 / (e_neg + e_pos)
print(f"\neffective-number weights, beta = {beta}")
print(f"  E_neg = (1-b)/(1-b^{n_neg}) = {e_neg:.6e}")
print(f"  E_pos = (1-b)/(1-b^{n_pos})  = {e_pos:.6e}")
print(f"  normalised: w_neg {e_neg*s:.4f}   w_pos {e_pos*s:.4f}   ratio {e_pos/e_neg:.4f}")
