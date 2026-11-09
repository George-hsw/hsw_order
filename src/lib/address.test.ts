import { describe, expect, it } from 'vitest'
import { matchesTyped, parseTyped, toSuggestion, typedNumber } from './address'

const heatherton = { properties: { housenumber: '1212', street: 'Heatherton Road', district: 'Noble Park', city: 'Melbourne', state: 'Victoria', postcode: '3174' } }
const grandview = { properties: { housenumber: '12-14', street: 'Grandview Street', city: 'Parramatta', state: 'New South Wales', postcode: '2150' } }

describe('toSuggestion', () => {
  it('builds the street and the suburb STATE postcode lines', () => {
    const s = toSuggestion({ properties: { housenumber: '1128', street: 'Nepean Highway', district: 'Mornington', city: 'Melbourne', state: 'Victoria', postcode: '3931' } })
    expect(s).toEqual({ street: '1128 Nepean Highway', suburb: 'Mornington VIC 3931', label: '1128 Nepean Highway, Mornington VIC 3931' })
  })

  it('puts the unit back on the street line', () => {
    expect(toSuggestion(heatherton, 'Unit 5')).toMatchObject({ street: 'Unit 5, 1212 Heatherton Road', suburb: 'Noble Park VIC 3174' })
  })

  it('falls back to locality and keeps an unknown state as given', () => {
    const s = toSuggestion({ properties: { street: 'Main Rd', locality: 'Kew', state: 'Elsewhere' } })
    expect(s?.suburb).toBe('Kew Elsewhere')
  })

  it('skips results with no street or place name', () => {
    expect(toSuggestion({ properties: { city: 'Mornington' } })).toBeNull()
  })
})

describe('parseTyped', () => {
  it('takes a unit off the front in the usual ways', () => {
    expect(parseTyped('unit 5, 1212 heather')).toEqual({ unit: 'Unit 5', rest: '1212 heather' })
    expect(parseTyped('Unit 5 1212 Heatherton Rd')).toEqual({ unit: 'Unit 5', rest: '1212 Heatherton Rd' })
    expect(parseTyped('5/1212 heather')).toEqual({ unit: 'Unit 5', rest: '1212 heather' })
    expect(parseTyped('u12, 3 Smith St')).toEqual({ unit: 'Unit 12', rest: '3 Smith St' })
    expect(parseTyped('Shop 3, 40 High St')).toEqual({ unit: 'Shop 3', rest: '40 High St' })
  })

  it('leaves an ordinary address alone', () => {
    expect(parseTyped('1212 heather')).toEqual({ unit: '', rest: '1212 heather' })
  })
})

describe('matchesTyped', () => {
  it('accepts the address that was typed, even part-typed', () => {
    expect(matchesTyped(heatherton, '1212 heather')).toBe(true)
    expect(matchesTyped(heatherton, '1212 heatherton road noble')).toBe(true)
  })

  it('rejects an unrelated street or a different number', () => {
    expect(matchesTyped(grandview, '1212 heather')).toBe(false)
    expect(matchesTyped(heatherton, '1214 heather')).toBe(false)
  })

  it('accepts a number inside a range like 12-14', () => {
    expect(matchesTyped(grandview, '13 grandview')).toBe(true)
  })
})

describe('street-only results', () => {
  const street = { properties: { name: 'Heatherton Road', osm_key: 'highway', district: 'Noble Park', city: 'Melbourne', state: 'Victoria', postcode: '3174' } }
  it('uses the street and suburb with the number that was typed', () => {
    expect(toSuggestion(street, 'Unit 2', '999')).toMatchObject({ street: 'Unit 2, 999 Heatherton Road', suburb: 'Noble Park VIC 3174' })
  })
  it('ignores suburbs and landmarks that are not a street', () => {
    expect(toSuggestion({ properties: { name: 'Noble Park', osm_key: 'place', state: 'Victoria' } })).toBeNull()
  })
})

describe('typedNumber', () => {
  it('finds the house number wherever the words are', () => {
    expect(typedNumber('45 smith street fitzroy')).toBe('45')
    expect(typedNumber('12-14 grandview st')).toBe('12-14')
    expect(typedNumber('heatherton road')).toBe('')
  })
})
