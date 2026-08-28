"""I.5.X01 — three hidden units draw three lines; only seven of eight patterns exist."""
W1 = [[1.0, -1.0, 0.5], [0.5, 1.0, -1.0]]
b1 = [-0.5, 0.25, 0.0]

def pattern(x):
    z = [sum(x[i] * W1[i][j] for i in range(2)) + b1[j] for j in range(3)]
    return "".join("1" if t > 0.0 else "0" for t in z)

seen = {}
STEP, SPAN = 0.005, 6.0
n = int(2 * SPAN / STEP)
for i in range(n + 1):
    for j in range(n + 1):
        x = [-SPAN + i * STEP, -SPAN + j * STEP]
        seen.setdefault(pattern(x), x)

for p in sorted(seen):
    x = seen[p]
    print(f"  {p}  realised, e.g. at ({x[0]:+.3f}, {x[1]:+.3f})")
for p in (f"{v:03b}" for v in range(8)):
    if p not in seen:
        print(f"  {p}  never occurs")
print(f"\nrealised {len(seen)} of 8 patterns; Zaslavsky bound for 3 lines in the "
      f"plane is 7")
