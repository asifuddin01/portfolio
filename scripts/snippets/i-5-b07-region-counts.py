"""I.5.B07 — width adds regions polynomially; depth multiplies them."""
from math import comb

def shallow(n, d):                       # Zaslavsky 1975, one hidden layer
    return sum(comb(n, i) for i in range(d + 1))

def deep(n, d, L):                       # Montufar et al. 2014, L hidden layers
    return (n // d) ** (d * (L - 1)) * shallow(n, d)

print("one hidden layer, input dimension d = 2")
for n in (1, 2, 3, 4, 5, 10, 30, 100):
    print(f"  n = {n:>3}: at most {shallow(n, 2):>7,} regions")

print("\nthirty units in the plane, spent two ways")
print(f"  1 layer  x 30: at most  {shallow(30, 2):>10,}")
print(f"  3 layers x 10: at least {deep(10, 2, 3):>10,}"
      f"   ({deep(10, 2, 3) / shallow(30, 2):.1f}x)")

print("\nsixty units in the plane, spent three ways")
for L, n in ((1, 60), (2, 30), (6, 10)):
    got = shallow(60, 2) if L == 1 else deep(n, 2, L)
    print(f"  {L} layer(s) x {n:>2}: {got:>15,}")
