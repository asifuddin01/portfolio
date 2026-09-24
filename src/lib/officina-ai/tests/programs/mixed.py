count = 0

class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next

def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

def bump(xs):
    global count
    count += 1
    xs.append(len(xs))

data = [3, 1, 2]
for i in range(len(data)):
    if data[i] > 1 and i != 2:
        bump(data)
data.sort()
head = Node(1, Node(2))
label = "even" if fact(4) % 2 == 0 else "odd"
try:
    int("nope")
except ValueError as err:
    msg = str(err)
del label
total = sum(x * x for x in data)
name = input("name? ")
print(count, data, total, name, 2 ** 70, 1 / 3)
