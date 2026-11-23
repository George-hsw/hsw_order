import { describe, expect, it } from 'vitest'
import { PHOTO_MAX, fitWithin } from './photos'

describe('fitWithin', () => {
  it('shrinks the longest side to the limit and keeps the shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: PHOTO_MAX, h: 960 })
    expect(fitWithin(3000, 4000)).toEqual({ w: 960, h: PHOTO_MAX })
  })
  it('never makes a small photo bigger', () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 })
  })
})
