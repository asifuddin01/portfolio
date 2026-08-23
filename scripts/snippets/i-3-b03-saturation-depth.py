"""I.3.B03 — how fast a product of sigmoid derivatives dies, and where fp16 ends."""
from math import exp

def sigmoid(z): return 1.0 / (1.0 + exp(-z))
def dsigmoid(z):
    s = sigmoid(z); return s * (1.0 - s)

print(f"max sigma'      {dsigmoid(0.0):.4f}   at z = 0")
d4 = dsigmoid(4.0)
print(f"sigma'(4)       {d4:.6f}")
print(f"sigma'(4)^10    {d4 ** 10:.6e}")
print(f"0.25^10         {0.25 ** 10:.6e}")

FP16_MIN_SUBNORMAL = 2.0 ** -24          # smallest positive fp16
for name, g in (("|z|=4", d4), ("z=0 (best case)", 0.25)):
    L, prod = 0, 1.0
    while prod > FP16_MIN_SUBNORMAL:
        prod *= g; L += 1
    print(f"{name:<16} underflows fp16 at depth {L}")
