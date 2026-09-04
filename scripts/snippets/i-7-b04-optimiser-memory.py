"""I.7.B04 — what an optimiser costs in memory, per parameter.

Counts the copies of the parameter vector each method holds, then prices a
concrete model. The point is the multiplier: switching optimiser changes the
memory floor of a training run before a single activation is stored, and the
choice is usually made on convergence grounds alone.

Pure Python, no imports.
"""

BYTES = 4                          # fp32


def copies(state_per_param):
    """weights + gradients + optimiser state, in copies of the parameters."""
    return 1 + 1 + state_per_param


METHODS = [
    ("SGD",                0, "nothing kept between steps"),
    ("SGD + momentum",     1, "one velocity per parameter"),
    ("RMSProp",            1, "one second moment per parameter"),
    ("Adam / AdamW",       2, "first and second moment"),
    ("Adam, fp32 master",  4, "moments plus an fp32 copy of fp16 weights"),
]

print(f"{'method':22} {'state':>6} {'copies':>7} {'bytes/param':>12}  note")
for name, st, note in METHODS:
    c = copies(st)
    print(f"{name:22} {st:6d} {c:7d} {c * BYTES:12d}  {note}")

print()
for label, N in (("124M (GPT-2 small)", 124_000_000),
                 ("1.5B (GPT-2 XL)", 1_500_000_000),
                 ("7B", 7_000_000_000)):
    print(f"-- {label}: N = {N:,} --")
    for name, st, _ in METHODS[:4]:
        total = copies(st) * N * BYTES
        print(f"   {name:22} {total / 1e9:8.2f} GB")
    print()

print("what the optimiser alone costs, as a share of the whole")
for name, st, _ in METHODS[:4]:
    c = copies(st)
    print(f"  {name:22} state is {st / c * 100:5.1f}% of the four-way total")

print()
print("the swap worth knowing")
N = 1_500_000_000
adam = copies(2) * N * BYTES
sgdm = copies(1) * N * BYTES
print(f"  Adam            {adam / 1e9:.2f} GB")
print(f"  SGD + momentum  {sgdm / 1e9:.2f} GB")
print(f"  saved           {(adam - sgdm) / 1e9:.2f} GB  ({adam / sgdm:.2f}x)")
