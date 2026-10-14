import { describe, expect, test } from 'bun:test'
import { parseSubmission, type RawSubmission } from '../src/submission-form.ts'

const ok: RawSubmission = { schoolUai: '0590001A', status: 'blocked', lat: '50.63', lng: '3.06' }

describe('parseSubmission', () => {
  test('a school of the directory', () => {
    expect(parseSubmission(ok)).toMatchObject({
      school: { uai: '0590001A' },
      status: 'blocked',
      lat: 50.63,
      lng: 3.06,
      sourceUrl: null,
    })
  })

  test('a proposed school needs a name and a city', () => {
    const base = { status: 'filtering', lat: 1, lng: 1 }
    expect(
      parseSubmission({ ...base, newSchoolName: 'Lycée Neuf', newSchoolCity: 'Albi' })?.school,
    ).toEqual({
      name: 'Lycée Neuf',
      city: 'Albi',
    })
    expect(parseSubmission({ ...base, newSchoolName: 'Lycée Neuf' })).toBeNull()
    expect(parseSubmission({ ...base, newSchoolName: 'ab', newSchoolCity: 'Albi' })).toBeNull()
    expect(parseSubmission(base)).toBeNull()
  })

  test('both a directory school and a proposed name is ambiguous', () => {
    expect(
      parseSubmission({ ...ok, newSchoolName: 'Lycée Neuf', newSchoolCity: 'Albi' }),
    ).toBeNull()
  })

  test('empty form fields count as absent', () => {
    expect(
      parseSubmission({ ...ok, newSchoolName: '', newSchoolCity: '', sourceUrl: '  ' })?.school,
    ).toEqual({ uai: '0590001A' })
  })

  test('status, UAI and positions are checked', () => {
    expect(parseSubmission({ ...ok, status: 'bloque' })).toBeNull()
    expect(parseSubmission({ ...ok, schoolUai: '123' })).toBeNull()
    expect(parseSubmission({ ...ok, lat: 91 })).toBeNull()
    expect(parseSubmission({ ...ok, lng: 'x' })).toBeNull()
    expect(parseSubmission({ ...ok, lat: '' })).toBeNull()
  })

  test('the source link must be https; its domain is derived', () => {
    expect(parseSubmission({ ...ok, sourceUrl: 'https://www.lemonde.fr/x' })).toMatchObject({
      sourceUrl: 'https://www.lemonde.fr/x',
      sourceDomain: 'lemonde.fr',
    })
    expect(parseSubmission({ ...ok, sourceUrl: 'http://lemonde.fr/x' })).toBeNull()
    expect(parseSubmission({ ...ok, sourceUrl: `https://a.fr/${'x'.repeat(2000)}` })).toBeNull()
  })
})
