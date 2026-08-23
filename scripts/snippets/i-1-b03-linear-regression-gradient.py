"""I.1.B03 — the squared-loss gradient for one-dimensional linear regression.

Confirms the hand-derived gradient at w = 1 and the normal-equation optimum,
and checks the optimum by showing the gradient vanishes there.
"""
data = [(1.0, 2.0), (2.0, 4.0), (3.0, 5.0)]
n = len(data)

def loss(w):  return sum((w * x - y) ** 2 for x, y in data) / (2 * n)
def grad(w):  return sum(x * (w * x - y) for x, y in data) / n

Sxy = sum(x * y for x, y in data)
Sxx = sum(x * x for x, y in data)
w_star = Sxy / Sxx

print(f"grad at w=1      {grad(1.0):.4f}")
print(f"loss at w=1      {loss(1.0):.4f}")
print(f"Sxy              {Sxy:.4f}")
print(f"Sxx              {Sxx:.4f}")
print(f"w* = Sxy/Sxx     {w_star:.4f}")
print(f"grad at w*       {grad(w_star):.4f}")
print(f"loss at w*       {loss(w_star):.4f}")
