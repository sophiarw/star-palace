# Engine displacement and power calcs
def displacement_cc(bore_mm, stroke_mm, cylinders):
    import math
    return math.pi * (bore_mm / 2) ** 2 * stroke_mm * cylinders / 1000

def hp_from_torque(torque_lbft, rpm):
    return torque_lbft * rpm / 5252

print("V8 5.0L:", displacement_cc(92.2, 92.7, 8), "cc")
print("400 lb-ft @ 4000 rpm:", hp_from_torque(400, 4000), "hp")
