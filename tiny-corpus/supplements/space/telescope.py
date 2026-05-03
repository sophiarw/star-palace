# Telescope aperture and resolving power
import math

def rayleigh_resolution(wavelength_m, aperture_m):
    """Smallest resolvable angle in arcseconds."""
    return 1.22 * wavelength_m / aperture_m * 206265

print("Hubble (2.4m, 550nm):", rayleigh_resolution(550e-9, 2.4))
print("JWST (6.5m, 2um):", rayleigh_resolution(2e-6, 6.5))
