import { describe, expect, it } from 'vitest'
import { distanceKm, mapLink, placeOfDetail, roundedPlace } from './place'

describe('where someone signed in', () => {
  it('rounds to about ten metres and keeps the accuracy in whole metres', () => {
    expect(roundedPlace(-33.809712345, 151.185498765, 23.6)).toEqual({ status: 'shared', lat: -33.8097, lng: 151.1855, acc: 24 })
    expect(roundedPlace(1, 2, -5)).toMatchObject({ acc: 0 })
    expect(roundedPlace(1, 2, 1e9)).toMatchObject({ acc: 99999 })
  })

  it('reads a place back from an event, and ignores anything that is not one', () => {
    expect(placeOfDetail({ status: 'shared', lat: -33.8, lng: 151.2, acc: 30 })).toEqual({ status: 'shared', lat: -33.8, lng: 151.2, acc: 30 })
    expect(placeOfDetail({ status: 'declined' })).toEqual({ status: 'declined' })
    expect(placeOfDetail({ status: 'denied' })).toEqual({ status: 'denied' })
    expect(placeOfDetail({ status: 'shared', lat: 'x', lng: 1 })).toBeNull()
    expect(placeOfDetail({ status: 'shared', lat: 95, lng: 1 })).toBeNull() // not on Earth
    expect(placeOfDetail({ tab: 'order' })).toBeNull()
    expect(placeOfDetail(undefined)).toBeNull()
  })

  it('measures distance in kilometres', () => {
    const sydney = { lat: -33.8688, lng: 151.2093 }, melbourne = { lat: -37.8136, lng: 144.9631 }
    expect(Math.round(distanceKm(sydney, melbourne))).toBe(713) // the usual great-circle figure
    expect(distanceKm(sydney, sydney)).toBe(0)
    expect(distanceKm({ lat: -33.8097, lng: 151.1855 }, { lat: -33.8097, lng: 151.1865 })).toBeLessThan(0.1) // about 9 metres
  })

  it('links to a map at the place', () => {
    expect(mapLink({ lat: -33.8097, lng: 151.1855 })).toBe('https://www.openstreetmap.org/?mlat=-33.8097&mlon=151.1855#map=17/-33.8097/151.1855')
  })
})
