// Debounce function with improved typing
function debounce<T extends (...args: P) => void, P extends unknown[]>(
  func: T,
  wait: number
): (...args: P) => void {
  let timeout: NodeJS.Timeout | null = null
  return (...args: P): void => {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
      func(...args)
    }, wait)
  }
}

export { debounce }
