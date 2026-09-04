"""I.6.X09 — what reverse mode costs when the sink is not a scalar.

The whole advantage of reverse mode is the assumption that one number sits at
the end. This prices what happens when that assumption is dropped: a vector
output of width m needs m backward traversals, and per-example gradients for a
batch of B need B of them, which is the same statement wearing a different hat.

Pure Python, no imports.
"""

L, D, B = 48, 1024, 32
FWD = L * 2 * B * D * D            # FLOPs of one forward pass, by I.6.B05


def step_cost(traversals):
    """One forward pass plus `traversals` backward passes, in GFLOP."""
    return (FWD + traversals * 2 * FWD) / 1e9


print(f"model: L={L}, d={D}, batch={B}")
print(f"one forward pass                    {FWD/1e9:10.2f} GFLOP")
print()
print(f"{'sink':34} {'traversals':>11} {'GFLOP':>12} {'vs scalar':>11}")
scalar = step_cost(1)
for label, t in (
    ("a scalar loss", 1),
    ("a 10-vector output", 10),
    ("per-example gradients, batch 32", B),
    ("full Jacobian of the 1024 outputs", D),
):
    c = step_cost(t)
    print(f"{label:34} {t:11,} {c:12.2f} {c/scalar:10.1f}x")

print()
print("why a scalar is not a restriction in practice")
print("  a loss is a reduction: any vector objective is summed or averaged")
print("  before the backward pass, and the sum is one more node in the graph")
print()
print("the reduction that makes it scalar, priced")
print(f"  summing {B} per-example losses costs {B - 1} additions")
print(f"  as a share of one forward pass: {(B - 1) / FWD:.3e}")
