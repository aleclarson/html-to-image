export function createUnicodeRangeRegex(range: string) {
  return new RegExp(
    range
      .split(/,\s*/)
      .map((range) => {
        const [start, end] = range
          .slice(2)
          .split('-')
          .map((code) => parseInt(code, 16))
        return end
          ? `[\\u{${start.toString(16)}}-\\u{${end.toString(16)}}]`
          : `\\u{${start.toString(16)}}`
      })
      .join('|'),
    'u',
  )
}
