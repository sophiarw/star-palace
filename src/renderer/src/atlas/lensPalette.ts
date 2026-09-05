/** Fixed false-color palettes, also baked into the bounded overview sprite sheet. */
export const ULTRAVIOLET = { day: '#c3a0f3', week: '#a18bcd', older: '#776393', unknown: '#655777' }
export const INFRARED = { small: '#b56c66', medium: '#e28a62', large: '#ffc094', unknown: '#a07669' }
export const LENS_PALETTE = [...Object.values(ULTRAVIOLET), ...Object.values(INFRARED)]
