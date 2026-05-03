#!/usr/bin/env node
// Build tiny-corpus/ — ~100 files sampled from dummy-corpus + supplements.
// Usage: node scripts/build-tiny-corpus.mjs

import { readdir, mkdir, copyFile, writeFile, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'dummy-corpus')
const OUT = join(ROOT, 'tiny-corpus')

const NEWS_TOPICS = [
  'alt.atheism', 'comp.graphics', 'comp.os.ms-windows.misc',
  'comp.sys.ibm.pc.hardware', 'comp.sys.mac.hardware', 'comp.windows.x',
  'misc.forsale', 'rec.autos', 'rec.motorcycles', 'rec.sport.baseball',
  'rec.sport.hockey', 'sci.crypt', 'sci.electronics', 'sci.med',
  'sci.space', 'soc.religion.christian', 'talk.politics.guns',
  'talk.politics.mideast', 'talk.politics.misc', 'talk.religion.misc',
]
// 10 per topic × 20 topics = 200 .txt. Plus ~12 repo files + 25 supplements
// = ~237 total. Above LAYOUT_THRESHOLD (200) so PCA trains on the demo set.
const FILES_PER_TOPIC = 10

async function pickFromTopic(topic) {
  const dir = join(SRC, '20news-bydate-test', topic)
  const entries = await readdir(dir)
  const txts = entries.filter(f => f.endsWith('.txt') || /^\d+$/.test(f)).slice(0, FILES_PER_TOPIC)
  return txts.map(f => ({ src: join(dir, f), dst: join(OUT, '20news', topic, `${f.replace(/\.txt$/, '')}.txt`) }))
}

async function pickFromRepo(repo, want) {
  // walk repo, return up to `want` small files matching exts
  const exts = ['md', 'js', 'ts', 'json', 'yml', 'html', 'css']
  const out = []
  async function walk(d) {
    if (out.length >= want) return
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= want) return
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile()) {
        const ext = e.name.split('.').pop()?.toLowerCase()
        if (!exts.includes(ext)) continue
        try {
          const s = await stat(full)
          if (s.size > 50_000 || s.size < 80) continue
          out.push(full)
        } catch {}
      }
    }
  }
  await walk(join(SRC, 'repos', repo))
  return out.map(p => {
    const rel = p.slice(SRC.length + 1)
    return { src: p, dst: join(OUT, rel) }
  })
}

// ---------- supplements: small generated files in extensions not already covered

const SUPPLEMENTS = [
  // python — sci.space / sci.electronics flavor
  { path: 'supplements/space/orbit.py', body: `# Orbital mechanics: two-body problem solver
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
` },
  { path: 'supplements/space/telescope.py', body: `# Telescope aperture and resolving power
import math

def rayleigh_resolution(wavelength_m, aperture_m):
    """Smallest resolvable angle in arcseconds."""
    return 1.22 * wavelength_m / aperture_m * 206265

print("Hubble (2.4m, 550nm):", rayleigh_resolution(550e-9, 2.4))
print("JWST (6.5m, 2um):", rayleigh_resolution(2e-6, 6.5))
` },
  { path: 'supplements/crypto/aes_demo.py', body: `# AES-GCM demo using cryptography library
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

def encrypt(key, plaintext, aad=b""):
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext, aad)
    return nonce + ct

def decrypt(key, blob, aad=b""):
    nonce, ct = blob[:12], blob[12:]
    return AESGCM(key).decrypt(nonce, ct, aad)

if __name__ == "__main__":
    key = AESGCM.generate_key(bit_length=256)
    blob = encrypt(key, b"meet at dawn")
    print(decrypt(key, blob))
` },
  { path: 'supplements/crypto/rsa_notes.py', body: `# RSA key generation notes
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
` },
  { path: 'supplements/autos/engines.py', body: `# Engine displacement and power calcs
def displacement_cc(bore_mm, stroke_mm, cylinders):
    import math
    return math.pi * (bore_mm / 2) ** 2 * stroke_mm * cylinders / 1000

def hp_from_torque(torque_lbft, rpm):
    return torque_lbft * rpm / 5252

print("V8 5.0L:", displacement_cc(92.2, 92.7, 8), "cc")
print("400 lb-ft @ 4000 rpm:", hp_from_torque(400, 4000), "hp")
` },

  // CSV — different topical clusters
  { path: 'supplements/space/planets.csv', body: `name,mass_kg,radius_km,orbital_period_days,distance_au
Mercury,3.3011e23,2439.7,87.97,0.387
Venus,4.8675e24,6051.8,224.70,0.723
Earth,5.972e24,6371,365.25,1.000
Mars,6.4171e23,3389.5,686.97,1.524
Jupiter,1.898e27,69911,4332.59,5.203
Saturn,5.683e26,58232,10759.22,9.537
Uranus,8.681e25,25362,30688.5,19.191
Neptune,1.024e26,24622,60182,30.069
` },
  { path: 'supplements/baseball/stats_2024.csv', body: `team,wins,losses,runs_scored,runs_allowed,era
Dodgers,98,64,842,654,3.71
Yankees,94,68,815,668,3.78
Phillies,95,67,784,665,3.81
Brewers,93,69,755,661,3.65
Orioles,91,71,786,699,3.94
Padres,93,69,766,671,3.65
Astros,88,73,750,690,3.95
Royals,86,76,735,702,4.07
` },
  { path: 'supplements/hockey/standings.csv', body: `team,gp,wins,losses,ot,points,gf,ga
Rangers,82,55,23,4,114,279,210
Hurricanes,82,52,23,7,111,260,205
Stars,82,52,21,9,113,287,236
Bruins,82,47,20,15,109,267,224
Panthers,82,52,24,6,110,268,200
Avalanche,82,50,25,7,107,304,254
` },
  { path: 'supplements/medicine/dosages.csv', body: `drug,indication,dose_mg,frequency_hours,route
amoxicillin,otitis media,500,8,oral
metformin,type 2 diabetes,500,12,oral
lisinopril,hypertension,10,24,oral
atorvastatin,hyperlipidemia,40,24,oral
ibuprofen,pain inflammation,400,6,oral
omeprazole,GERD,20,24,oral
` },

  // YAML — religion / politics flavor
  { path: 'supplements/religion/canon.yaml', body: `# New Testament canonical books
gospels:
  - matthew
  - mark
  - luke
  - john
acts:
  - acts of the apostles
pauline_epistles:
  - romans
  - 1 corinthians
  - 2 corinthians
  - galatians
  - ephesians
  - philippians
  - colossians
general_epistles:
  - hebrews
  - james
  - 1 peter
  - 2 peter
apocalyptic:
  - revelation
` },
  { path: 'supplements/politics/policy.yaml', body: `# Federal budget allocations FY2024 (illustrative)
mandatory:
  social_security: 1466
  medicare: 1029
  medicaid: 616
  income_security: 412
discretionary:
  defense: 821
  veterans: 135
  education: 80
  transportation: 116
interest_on_debt: 659
total_outlays_billions: 6750
` },

  // SQL — forsale / hardware flavor
  { path: 'supplements/forsale/listings.sql', body: `-- Marketplace listings schema
CREATE TABLE listing (
  id           INTEGER PRIMARY KEY,
  seller_id    INTEGER NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  category     TEXT NOT NULL,
  posted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sold_at      TIMESTAMP
);

CREATE INDEX idx_listing_category ON listing(category);
CREATE INDEX idx_listing_seller   ON listing(seller_id);

INSERT INTO listing(seller_id, title, price_cents, category) VALUES
  (1, 'IBM PC AT 286 working', 15000, 'hardware'),
  (2, 'Mac SE/30 with extras', 22000, 'hardware'),
  (3, '1992 Honda CB750 motorcycle', 280000, 'vehicles');
` },
  { path: 'supplements/hardware/inventory.sql', body: `-- PC parts inventory
CREATE TABLE part (
  sku        TEXT PRIMARY KEY,
  vendor     TEXT NOT NULL,
  kind       TEXT CHECK (kind IN ('cpu','ram','disk','gpu','psu','board')),
  spec       TEXT,
  cost_cents INTEGER NOT NULL,
  stock      INTEGER NOT NULL DEFAULT 0
);

INSERT INTO part VALUES
  ('CPU-486DX2-66', 'Intel', 'cpu', '80486DX2 @ 66MHz', 18000, 3),
  ('RAM-4MB-72PIN', 'Kingston', 'ram', '4MB 72-pin SIMM', 4500, 12),
  ('HDD-540MB-IDE', 'Quantum', 'disk', '540MB Fireball IDE', 9000, 5);
` },

  // Shell scripts
  { path: 'supplements/graphics/render.sh', body: `#!/bin/bash
# Batch render a directory of POV-Ray scenes
set -euo pipefail
INPUT_DIR="\${1:-./scenes}"
OUTPUT_DIR="\${2:-./renders}"
mkdir -p "$OUTPUT_DIR"
for scene in "$INPUT_DIR"/*.pov; do
  name=$(basename "$scene" .pov)
  povray +I"$scene" +O"$OUTPUT_DIR/$name.png" +W1920 +H1080 +Q9 +A0.3
done
echo "Rendered $(ls "$OUTPUT_DIR" | wc -l) frames"
` },
  { path: 'supplements/electronics/flash.sh', body: `#!/bin/bash
# Flash AVR microcontroller via avrdude
set -e
MCU="\${MCU:-atmega328p}"
PROG="\${PROG:-arduino}"
PORT="\${PORT:-/dev/ttyUSB0}"
HEX="\${1:?usage: flash.sh firmware.hex}"
avrdude -c "$PROG" -p "$MCU" -P "$PORT" -b 115200 -U flash:w:"$HEX":i
echo "Flashed $HEX to $MCU on $PORT"
` },

  // Go — windows-x / graphics flavor
  { path: 'supplements/windows-x/server.go', body: `// Minimal TCP echo server in Go
package main

import (
	"bufio"
	"log"
	"net"
)

func handle(c net.Conn) {
	defer c.Close()
	r := bufio.NewReader(c)
	for {
		line, err := r.ReadString('\\n')
		if err != nil {
			return
		}
		c.Write([]byte("echo: " + line))
	}
}

func main() {
	ln, err := net.Listen("tcp", ":9000")
	if err != nil {
		log.Fatal(err)
	}
	log.Println("listening on :9000")
	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		go handle(c)
	}
}
` },

  // Ruby — autos flavor
  { path: 'supplements/autos/dyno.rb', body: `# Dyno chart parser
class DynoRun
  attr_reader :rpm, :hp, :torque

  def initialize(rpm, hp, torque)
    @rpm = rpm
    @hp = hp
    @torque = torque
  end

  def self.peak(runs, key)
    runs.max_by { |r| r.send(key) }
  end
end

runs = [
  DynoRun.new(2000, 180, 425),
  DynoRun.new(3500, 320, 480),
  DynoRun.new(5000, 410, 430),
  DynoRun.new(6500, 425, 343),
]

peak_hp = DynoRun.peak(runs, :hp)
peak_tq = DynoRun.peak(runs, :torque)
puts "Peak HP: #{peak_hp.hp} @ #{peak_hp.rpm}"
puts "Peak Torque: #{peak_tq.torque} @ #{peak_tq.rpm}"
` },

  // Markdown supplement — guns / mideast
  { path: 'supplements/guns/safety.md', body: `# Firearm safety fundamentals

## The four rules
1. Treat every firearm as if it is loaded.
2. Never point the muzzle at anything you are not willing to destroy.
3. Keep your finger off the trigger until you are ready to fire.
4. Be sure of your target and what is beyond it.

## Storage
- Locked safe, separate from ammunition where local law requires.
- Trigger locks for additional layer.
- Children: education plus mechanical barriers.

## Range etiquette
- Eye and ear protection at all times.
- Cease fire commands obeyed instantly.
- Muzzle downrange — always.
` },
  { path: 'supplements/mideast/geography.md', body: `# Levant geography primer

## Major rivers
- Jordan: source in Mount Hermon, drains into the Dead Sea.
- Litani: entirely within Lebanon.
- Orontes: flows north through Syria into Turkey.

## Mountain ranges
- Lebanon and Anti-Lebanon mountains, separated by the Beqaa Valley.
- Mount Hermon (2,814m) — highest point in the region.
- Judean Mountains run north-south through the West Bank.

## Climate
Mediterranean coast: wet winters, dry summers.
Inland desert (Syrian, Negev, Jordanian Badia): arid, large diurnal swing.
` },

  // JSON supplements — atheism / christianity flavor
  { path: 'supplements/atheism/quotes.json', body: `{
  "quotes": [
    { "author": "Bertrand Russell", "text": "What science cannot tell us, mankind cannot know." },
    { "author": "Carl Sagan", "text": "Extraordinary claims require extraordinary evidence." },
    { "author": "Hume", "text": "A wise man proportions his belief to the evidence." },
    { "author": "Spinoza", "text": "I have striven not to laugh at human actions, not to weep at them, nor to hate them, but to understand them." }
  ]
}
` },
  { path: 'supplements/christianity/liturgy.json', body: `{
  "liturgical_year": [
    { "season": "Advent",    "weeks": 4, "color": "purple" },
    { "season": "Christmas", "weeks": 2, "color": "white" },
    { "season": "Epiphany",  "weeks": 8, "color": "green" },
    { "season": "Lent",      "weeks": 6, "color": "purple" },
    { "season": "Easter",    "weeks": 7, "color": "white" },
    { "season": "Pentecost", "weeks": 25, "color": "green" }
  ]
}
` },

  // XML — motorcycles flavor
  { path: 'supplements/motorcycles/maintenance.xml', body: `<?xml version="1.0" encoding="UTF-8"?>
<schedule bike="Honda CB750">
  <interval miles="600">
    <task>Oil change</task>
    <task>Chain tension check</task>
  </interval>
  <interval miles="4000">
    <task>Valve clearance inspection</task>
    <task>Spark plug replacement</task>
    <task>Air filter clean</task>
  </interval>
  <interval miles="8000">
    <task>Brake fluid flush</task>
    <task>Fork oil replacement</task>
    <task>Carburetor sync</task>
  </interval>
</schedule>
` },
]

async function ensureDir(p) {
  await mkdir(p, { recursive: true })
}

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await ensureDir(OUT)

  // 1) 20news samples
  let copied = 0
  for (const topic of NEWS_TOPICS) {
    const picks = await pickFromTopic(topic)
    for (const { src, dst } of picks) {
      await ensureDir(dirname(dst))
      await copyFile(src, dst)
      copied++
    }
  }

  // 2) repo samples (small set per repo)
  const repoPicks = [
    ...await pickFromRepo('awesome', 4),
    ...await pickFromRepo('commander.js', 4),
    ...await pickFromRepo('express', 4),
  ]
  for (const { src, dst } of repoPicks) {
    await ensureDir(dirname(dst))
    await copyFile(src, dst)
    copied++
  }

  // 3) supplements
  for (const { path, body } of SUPPLEMENTS) {
    const dst = join(OUT, path)
    await ensureDir(dirname(dst))
    await writeFile(dst, body)
    copied++
  }

  console.log(`tiny-corpus built: ${copied} files at ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
