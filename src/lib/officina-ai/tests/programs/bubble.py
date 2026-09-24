def bubble(xs):
    n = len(xs)
    for i in range(n):
        for j in range(n - 1 - i):
            if xs[j] > xs[j + 1]:
                xs[j], xs[j + 1] = xs[j + 1], xs[j]
    return xs

data = list(range(60, 0, -1))
bubble(data)
print(data[:5])
