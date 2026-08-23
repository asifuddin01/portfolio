"""I.2.B06 — parameters and FLOPs for one perceptron and for a bank of K."""
for d in (2, 784, 4096):
    params = d + 1
    flops = 2 * d              # d multiplies, d-1 adds, +1 for the bias
    print(f"d={d:<6} params {params:<8} flops {flops}")
print()
for d, K in ((784, 10), (4096, 1000)):
    print(f"d={d:<6} K={K:<6} params {K * (d + 1):<12} flops {2 * d * K}")
