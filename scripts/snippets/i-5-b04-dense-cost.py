"""I.5.B04 — where an MLP's parameters go, and what the dense assumption costs."""
def mlp(widths):
    return sum(widths[i] * widths[i + 1] + widths[i + 1] for i in range(len(widths) - 1))

def flops(widths):  # one example, forward only: two FLOPs per multiply-add
    return 2 * sum(widths[i] * widths[i + 1] for i in range(len(widths) - 1))

wide = [150528, 4096, 1000]
deep = [150528] + [1024] * 6 + [1000]
for name, w in (("wide  1 hidden x 4096", wide), ("deep  6 hidden x 1024", deep)):
    n = mlp(w)
    first = w[0] * w[1] + w[1]
    print(f"{name}: {n:,} params, {n * 4 / 1e9:.3f} GB fp32, "
          f"{flops(w) / 1e9:.3f} GFLOP/example")
    print(f"    first matrix alone: {first:,}  ({100 * first / n:.1f}% of the model)")

print(f"3x3 conv, 3 -> 64 channels:      {3 * 3 * 3 * 64 + 64:,} params")
print(f"dense layer, 3072 -> 64:         {3072 * 64 + 64:,} params"
      f"  ({(3072 * 64 + 64) / (3 * 3 * 3 * 64 + 64):.1f}x)")
for w in (512, 1024, 2048):
    print(f"one hidden layer of width {w:>4}: {w * w + w:>12,} params in its matrix")
