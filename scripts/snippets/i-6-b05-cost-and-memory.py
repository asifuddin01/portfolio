"""I.6.B05 — what a backward pass costs, in arithmetic and in memory.

Counts FLOPs forward and backward for a stack of square affine layers, then the
activation memory the backward pass forces you to keep, then what checkpointing
at sqrt(L) segments trades away.

The point of the arithmetic count is the ratio, not the absolute number: the
backward pass does two matrix products where the forward pass did one, so
training is about three forward passes rather than the thousand a per-parameter
finite-difference check would need.

Pure Python, no imports.
"""

L = 48                  # layers
D = 1024                # width
BYTES = 4               # fp32


def flops(batch):
    """2*b*d*d per matrix product: one multiply and one add per entry pair."""
    per_layer_fwd = 2 * batch * D * D
    fwd = L * per_layer_fwd
    # Backward does two products per layer, by (I.6.3) and (I.6.4): one to send
    # the adjoint to the previous layer, one to form the weight gradient.
    bwd = 2 * fwd
    return fwd, bwd


def activation_floats(batch):
    """One stored activation per layer, by (I.6.7)."""
    return L * batch * D


params = L * D * D

print("configuration")
print(f"  layers L         {L}")
print(f"  width d          {D}")
print(f"  parameters       {params:,}  ({params * BYTES / 1e9:.3f} GB fp32)")

print()
print("arithmetic, per optimiser step")
for batch, label in ((32, "batch 32"), (32 * 512, "batch 32 x seq 512")):
    fwd, bwd = flops(batch)
    print(f"  {label:22}  forward {fwd/1e9:10.2f} GFLOP   "
          f"backward {bwd/1e9:10.2f} GFLOP   total/forward {(fwd+bwd)/fwd:.1f}x")

print()
print("memory kept for the backward pass")
for batch, label in ((32, "batch 32"), (32 * 512, "batch 32 x seq 512")):
    a = activation_floats(batch)
    print(f"  {label:22}  activations {a * BYTES / 1e9:8.3f} GB   "
          f"parameters {params * BYTES / 1e9:6.3f} GB   "
          f"ratio {a / params:6.2f}x")

print()
print("the crossover: batch at which activations equal parameters")
# L*b*d == L*d*d  =>  b == d
print(f"  activations = parameters when batch = d = {D}")

print()
print("checkpointing at sqrt(L) segments, by (I.6.7)")
seg = int(L ** 0.5 + 0.5)
kept = seg + (L // seg)          # boundaries, plus one segment live at a time
b = 32 * 512
full = activation_floats(b) * BYTES
ck = kept * b * D * BYTES
print(f"  segments               {seg}")
print(f"  tensors held           {kept}  of {L}")
print(f"  activation memory      {full/1e9:.3f} GB  ->  {ck/1e9:.3f} GB")
print(f"  reduction              {full/ck:.1f}x")
print(f"  extra arithmetic       one more forward pass, "
      f"{(2 * flops(b)[0] + flops(b)[1]) / (flops(b)[0] + flops(b)[1]):.2f}x the un-checkpointed step")
