"""I.3.B07 — what activations cost in memory and arithmetic."""
B, T, d, L = 8, 2048, 4096, 32
acts = B * T * d
print(f"one activation tensor: B*T*d = {acts:,} values")
for bits, name in ((16, "bf16"), (32, "fp32")):
    print(f"  {name}: {acts * bits // 8 / 1e6:.1f} MB each, "
          f"{L * acts * bits // 8 / 1e9:.2f} GB for {L} layers")
print()
COST = {"ReLU": 1, "LeakyReLU": 2, "sigmoid": 4, "tanh": 6, "GELU (erf)": 12, "GELU (tanh approx)": 8}
for name, c in COST.items():
    print(f"{name:<20} ~{c:>2} FLOP/element   {c * acts / 1e9:.2f} GFLOP per layer")
mm = 2 * acts * d
print(f"\none d x d matmul     {mm / 1e9:.1f} GFLOP  ({mm // (12 * acts)}x the costliest activation)")
