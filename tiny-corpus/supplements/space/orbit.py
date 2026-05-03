# Orbital mechanics: two-body problem solver
import math

G = 6.67430e-11

def orbital_period(a, m1, m2):
    """Kepler's third law. a in meters, masses in kg, returns seconds."""
    return 2 * math.pi * math.sqrt(a**3 / (G * (m1 + m2)))

def escape_velocity(m, r):
    return math.sqrt(2 * G * m / r)

if __name__ == "__main__":
    earth = 5.972e24
    moon = 7.342e22
    a = 384_400_000
    print("Lunar period (days):", orbital_period(a, earth, moon) / 86400)
    print("Earth escape (m/s):", escape_velocity(earth, 6.371e6))
