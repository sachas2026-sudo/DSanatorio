import { useEffect, useState, type RefObject } from 'react'

type VirtualSlice = {
  start: number
  end: number
  paddingTop: number
  paddingBottom: number
}

const DEFAULT_ROW_HEIGHT = 44
const DEFAULT_OVERSCAN = 10

export function useVirtualSlice(
  itemCount: number,
  scrollRef: RefObject<HTMLElement | null>,
  rowHeight = DEFAULT_ROW_HEIGHT,
): VirtualSlice {
  const [slice, setSlice] = useState<VirtualSlice>({
    start: 0,
    end: Math.min(itemCount, 40),
    paddingTop: 0,
    paddingBottom: 0,
  })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      const top = el.scrollTop
      const height = el.clientHeight
      const start = Math.max(
        0,
        Math.floor(top / rowHeight) - DEFAULT_OVERSCAN,
      )
      const end = Math.min(
        itemCount,
        Math.ceil((top + height) / rowHeight) + DEFAULT_OVERSCAN,
      )
      setSlice((prev) => {
        if (prev.start === start && prev.end === end) return prev
        return {
          start,
          end,
          paddingTop: start * rowHeight,
          paddingBottom: Math.max(0, (itemCount - end) * rowHeight),
        }
      })
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [itemCount, rowHeight, scrollRef])

  useEffect(() => {
    setSlice({
      start: 0,
      end: Math.min(itemCount, 40),
      paddingTop: 0,
      paddingBottom: Math.max(0, (itemCount - Math.min(itemCount, 40)) * rowHeight),
    })
    scrollRef.current?.scrollTo({ top: 0 })
  }, [itemCount, rowHeight, scrollRef])

  return slice
}
