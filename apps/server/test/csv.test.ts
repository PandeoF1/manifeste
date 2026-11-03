import { expect, test } from 'bun:test'
import { csvCell, toCsv } from '../src/lib/csv.ts'

test('quotes cells that need it and defuses spreadsheet formulas', () => {
  expect(csvCell('Lycée "Pasteur", Lille')).toBe('"Lycée ""Pasteur"", Lille"')
  expect(csvCell('=HYPERLINK("http://x")')).toStartWith(`"'=`)
  expect(csvCell('+33 1')).toBe("'+33 1")
  expect(csvCell(null)).toBe('')
  expect(csvCell(0.5)).toBe('0.5')
  expect(csvCell(-3)).toBe('-3')
})

test('starts with a BOM and ends each line with CRLF', () => {
  const csv = toCsv(['a', 'b'], [['1', 'x,y']])
  expect(csv).toBe('﻿a,b\r\n1,"x,y"\r\n')
})
