"""I.4.B07 — every shape and every byte on the path from logits to one scalar."""
B, T, V = 4, 512, 32000
PAD_FRACTION = 0.15

logits = B * T * V
print("shapes")
print(f"  logits            ({B}, {T}, {V})           {logits:,} values")
print(f"  targets           ({B}, {T})                {B*T:,} values")
print(f"  flattened logits  ({B*T}, {V})           {logits:,}")
print(f"  flattened targets ({B*T},)")
print(f"  per-token loss    ({B*T},)                {B*T:,}")
print(f"  reduced loss      ()                     1")

print("\nmemory for the logits alone")
for bits, name in ((32, "fp32"), (16, "bf16")):
    print(f"  {name}  {logits * bits / 8 / 1e6:8.1f} MB")

print("\nif softmax probabilities are materialised as well")
print(f"  fp32  {2 * logits * 4 / 1e6:8.1f} MB")
print(f"  bf16  {2 * logits * 2 / 1e6:8.1f} MB")

valid = round(B * T * (1 - PAD_FRACTION))
total = B * T
print(f"\nmasking at {PAD_FRACTION:.0%} padding")
print(f"  positions          {total:,}")
print(f"  valid              {valid:,}")
print(f"  mean over all      divides by {total:,}")
print(f"  mean over valid    divides by {valid:,}")
print(f"  ratio              {total / valid:.4f}  ({(total/valid - 1) * 100:.1f}% understated)")
