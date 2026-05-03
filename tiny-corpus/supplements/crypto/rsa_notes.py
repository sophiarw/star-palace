# RSA key generation notes
# Pick two primes p, q. n = p*q. phi = (p-1)(q-1).
# Choose e coprime to phi. d = e^-1 mod phi.
# Public: (n, e). Private: (n, d).

def egcd(a, b):
    if b == 0: return (a, 1, 0)
    g, x1, y1 = egcd(b, a % b)
    return (g, y1, x1 - (a // b) * y1)

def modinv(a, m):
    g, x, _ = egcd(a, m)
    if g != 1: raise ValueError("no inverse")
    return x % m

p, q = 61, 53
n = p * q
phi = (p - 1) * (q - 1)
e = 17
d = modinv(e, phi)
print(f"n={n} e={e} d={d}")
