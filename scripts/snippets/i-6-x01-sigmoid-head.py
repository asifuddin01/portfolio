"""I.6.X01 — the I.6.B01 network with a sigmoid head instead of a linear one.

Same weights, same input, same target. Only the head changes, and the question
is which gradients move and by how much. One factor in the adjoint at the sink
is responsible for all of it.

Pure Python, no imports.
"""
E = 2.718281828459045


def sigmoid(z):
    return 1.0 / (1.0 + E ** -z)


X = [1.0, 2.0]
Y = 1.0
W1 = [[0.1, 0.3], [0.2, 0.4]]
B1 = [0.0, 0.1]
W2 = [0.5, -0.6]
B2 = 0.2


def run(sigmoid_head):
    z1 = [sum(X[i] * W1[i][j] for i in range(2)) + B1[j] for j in range(2)]
    a1 = [sigmoid(z) for z in z1]
    z2 = sum(a1[j] * W2[j] for j in range(2)) + B2
    yhat = sigmoid(z2) if sigmoid_head else z2
    loss = 0.5 * (yhat - Y) ** 2

    d2 = yhat - Y
    if sigmoid_head:                       # one extra local Jacobian
        d2 *= yhat * (1.0 - yhat)
    gW2 = [a1[j] * d2 for j in range(2)]
    gB2 = d2
    back = [d2 * W2[j] for j in range(2)]
    d1 = [back[j] * a1[j] * (1.0 - a1[j]) for j in range(2)]
    gW1 = [[X[i] * d1[j] for j in range(2)] for i in range(2)]
    return yhat, loss, d2, gW2, gB2, d1, gW1


lin = run(False)
sig = run(True)

for label, r in (("linear head", lin), ("sigmoid head", sig)):
    yhat, loss, d2, gW2, gB2, d1, gW1 = r
    print(f"-- {label} --")
    print(f"yhat        {yhat:.8f}")
    print(f"L           {loss:.8f}")
    print(f"delta2      {d2:.8f}")
    print(f"dL/dW2      {gW2[0]:.8f}  {gW2[1]:.8f}")
    print(f"delta1      {d1[0]:.8f}  {d1[1]:.8f}")
    print(f"dL/dW1 r1   {gW1[0][0]:.8f}  {gW1[0][1]:.8f}")

print()
print("-- the ratio, gradient by gradient --")
print(f"delta2      {sig[2] / lin[2]:.8f}")
print(f"dL/dW2[0]   {sig[3][0] / lin[3][0]:.8f}")
print(f"dL/dW2[1]   {sig[3][1] / lin[3][1]:.8f}")
print(f"dL/db2      {sig[4] / lin[4]:.8f}")
print(f"dL/dW1[0,0] {sig[6][0][0] / lin[6][0][0]:.8f}")

print()
print("-- where that one factor comes from --")
z2 = lin[0]                       # the linear head's output IS z2
yhat_sig = sigmoid(z2)
slope = yhat_sig * (1.0 - yhat_sig)
print(f"z2                    {z2:.8f}")
print(f"sigma(z2) = yhat      {yhat_sig:.8f}")
print(f"sigma'(z2)            {slope:.8f}")
print(f"(yhat_sig - y)        {yhat_sig - Y:.8f}")
print(f"(z2 - y)              {z2 - Y:.8f}")
print(f"product / (z2 - y)    {(yhat_sig - Y) * slope / (z2 - Y):.8f}")
