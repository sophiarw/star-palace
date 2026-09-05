/** Final filename suffix, case-insensitive. Dotfiles without a suffix have none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : ''
}
