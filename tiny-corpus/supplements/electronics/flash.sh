#!/bin/bash
# Flash AVR microcontroller via avrdude
set -e
MCU="${MCU:-atmega328p}"
PROG="${PROG:-arduino}"
PORT="${PORT:-/dev/ttyUSB0}"
HEX="${1:?usage: flash.sh firmware.hex}"
avrdude -c "$PROG" -p "$MCU" -P "$PORT" -b 115200 -U flash:w:"$HEX":i
echo "Flashed $HEX to $MCU on $PORT"
