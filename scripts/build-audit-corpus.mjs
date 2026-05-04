#!/usr/bin/env node
// Build audit-corpus/ — diagnostic corpus for graphics audit.
//
// 10 star types × 21 variants = 210 files (>= LAYOUT_THRESHOLD=200, so PCA
// trains on first index). Filenames carry the star_type prefix so seed-audit.ts
// can assign types deterministically. Variant content is per-type so embeddings
// land in 10 distinct clusters.
//
// Usage: node scripts/build-audit-corpus.mjs
// Then:  npx tsx scripts/seed-audit.ts
// Or:    bash scripts/dev-audit.sh   (one-shot end-to-end)
// Docs:  docs/graphics-test-bed.md
//
// Constants here are duplicated in src/shared/auditCorpus.ts (the typed source
// of truth used by seed-audit.ts and tests/graphics/auditCorpus.test.ts).
// Update both when bumping PER_TYPE.

import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'audit-corpus')

const PER_TYPE = 21

const TYPES = [
  ['red-giant',
    'cool luminous expanded outer-shell hydrogen-shell-burning AGB asymptotic-giant-branch',
    'A red giant is a cool luminous star that has exhausted core hydrogen. Its envelope swells and the surface temperature drops below 5000 K.'],
  ['blue-supergiant',
    'massive hot OB-class short-lived radiation-driven-wind Wolf-Rayet',
    'A blue supergiant is a massive star with surface temperature above 20000 K. It loses mass rapidly to radiation-driven stellar winds.'],
  ['white-dwarf',
    'electron-degenerate cooling stellar-remnant Chandrasekhar carbon-oxygen',
    'A white dwarf is the electron-degenerate remnant left when a sun-like star sheds its envelope. It cools for billions of years.'],
  ['main-sequence',
    'hydrogen-fusing equilibrium core temperate sun-like proton-proton-chain CNO',
    'A main-sequence star fuses hydrogen to helium in its core via the proton-proton chain or CNO cycle. The Sun is a G2V example.'],
  ['neutron-star',
    'collapsed dense crust-magnetic core-collapse-supernova-remnant magnetar',
    'A neutron star packs roughly 1.4 solar masses into a 20 km radius. The crust is iron and the interior is degenerate neutron fluid.'],
  ['pulsar',
    'rotating beamed lighthouse magnetic-axis-misaligned millisecond timing',
    'A pulsar is a rotating neutron star whose magnetic axis is misaligned with its spin axis. Beamed radio emission produces lighthouse-like pulses.'],
  ['binary',
    'pair orbiting common-center-of-mass mass-transfer Roche-lobe eclipsing',
    'A binary system contains two stars in mutual orbit about a common center of mass. Mass transfer through the Roche lobe drives many evolutionary paths.'],
  ['quasar',
    'active-galactic-nucleus relativistic jet bright-disc supermassive blazar',
    'A quasar is a luminous active galactic nucleus powered by accretion onto a supermassive black hole. Relativistic jets escape along the rotation axis.'],
  ['black-hole',
    'event-horizon spacetime-curvature accretion-disc Hawking Schwarzschild Kerr',
    'A black hole has an event horizon beyond which spacetime curvature traps even light. Stellar-mass and supermassive variants exist.'],
  ['nebula',
    'gas-cloud emission-reflection HII-region planetary supernova-remnant Orion',
    'A nebula is an interstellar cloud of gas and dust. Emission nebulae glow from ionised hydrogen; reflection nebulae scatter starlight.'],
]

const TAGS = [
  'photometric calibration of stellar luminosity',
  'spectral lines indicating element abundance',
  'parallax distance measured against galactic background',
  'redshift of observed wavelengths',
  'bolometric correction across the HR diagram',
  'metallicity index from spectroscopic survey',
  'proper motion in the galactic frame',
  'radial velocity from Doppler shift',
  'angular diameter from interferometry',
  'limb darkening across the photosphere',
  'effective temperature from blackbody fit',
  'mass-luminosity relation on the main sequence',
  'absolute magnitude relative to the Sun',
  'colour index B minus V',
  'standard candle for cosmic distance ladder',
  'opacity in the radiative zone',
  'convective envelope dynamics',
  'magnetic activity cycle',
  'rotational broadening of spectral lines',
  'asteroseismic mode identification',
  'gravitational lensing of background source',
]

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  let count = 0
  for (const [type, keywords, summary] of TYPES) {
    for (let i = 0; i < PER_TYPE; i++) {
      const idx = String(i + 1).padStart(2, '0')
      const tag = TAGS[(i + type.length) % TAGS.length]
      const body = `# ${type} variant ${idx}

${summary}

## Keywords
${keywords}

## Variant note
Variant ${idx} of ${PER_TYPE}. Topic: ${tag}.

## Filler

This file exists for the graphics audit. The corpus contains ${TYPES.length} star
types × ${PER_TYPE} variants = ${TYPES.length * PER_TYPE} files, enough to cross
the LAYOUT_THRESHOLD so PCA trains and the renderer projects positions.
`
      const path = join(OUT, `${type}-${idx}.md`)
      await writeFile(path, body)
      count++
    }
  }

  console.log(`audit-corpus built: ${count} files at ${OUT}`)
  console.log(`Next: npx tsx scripts/seed-audit.ts`)
}

main().catch(e => { console.error(e); process.exit(1) })
