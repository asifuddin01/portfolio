"""I.6.X08 — which mode of automatic differentiation is cheaper, and when.

For f: R^n -> R^m, forward mode builds the Jacobian in n sweeps and reverse mode
in m. Training is n huge, m = 1. A directional derivative is n huge, m huge, one
direction. The table below prices the four corners in units of one function
evaluation, so the answer is arithmetic rather than preference.

Pure Python, no imports.
"""

CASES = [
    ("training a network",        int(1e8), 1,        "gradient"),
    ("a scalar of few inputs",    3,        1,        "gradient"),
    ("sensitivity of an ODE",     4,        int(1e6), "full Jacobian"),
    ("Jacobian of a layer",       1024,     1024,     "full Jacobian"),
    ("one directional derivative", int(1e8), int(1e6), "one JVP"),
]

print(f"{'task':28} {'n':>10} {'m':>10}  {'forward':>10} {'reverse':>10}  cheaper")
for name, n, m, want in CASES:
    if want == "one JVP":
        fwd, rev = 1, m            # one direction needs one forward sweep
    else:
        fwd, rev = n, m
    cheaper = "forward" if fwd < rev else ("reverse" if rev < fwd else "tie")
    print(f"{name:28} {n:10,} {m:10,}  {fwd:10,} {rev:10,}  {cheaper}")

print()
print("the ratio that decides training")
n, m = int(1e8), 1
print(f"  n = {n:,}   m = {m}")
print(f"  reverse is cheaper by a factor of {n // m:,}")

print()
print("memory is the other half of the trade")
L, B, D = 48, 32, 1024
tape = L * B * D
print(f"  reverse: a tape of every intermediate   {tape:,} values")
print(f"  forward: one extra value per node       {B * D:,} values live at a time")
print(f"  ratio                                   {tape / (B * D):.0f}x")

print()
print("cost of the full Jacobian of one 1024x1024 layer, in forward sweeps")
d = 1024
print(f"  forward sweeps  {d:,}")
print(f"  reverse sweeps  {d:,}")
print(f"  either way, {d:,} times one evaluation — a Jacobian is expensive both ways")
