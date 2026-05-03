#!/bin/bash
# Batch render a directory of POV-Ray scenes
set -euo pipefail
INPUT_DIR="${1:-./scenes}"
OUTPUT_DIR="${2:-./renders}"
mkdir -p "$OUTPUT_DIR"
for scene in "$INPUT_DIR"/*.pov; do
  name=$(basename "$scene" .pov)
  povray +I"$scene" +O"$OUTPUT_DIR/$name.png" +W1920 +H1080 +Q9 +A0.3
done
echo "Rendered $(ls "$OUTPUT_DIR" | wc -l) frames"
